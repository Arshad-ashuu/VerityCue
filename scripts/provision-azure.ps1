[CmdletBinding()]
param(
  [Parameter(Mandatory)]
  [string]$SubscriptionId,

  [string]$Location = 'swedencentral',
  [string]$ResourceGroup = 'rg-veritycue',
  [string]$OpenAIAccountName,
  [string]$SpeechAccountName,
  [ValidateSet('Keys', 'EntraId')]
  [string]$Authentication = 'Keys',
  [ValidateSet('Standard', 'GlobalStandard', 'DataZoneStandard')]
  [string]$DeploymentSku = 'GlobalStandard',
  [ValidateRange(1, 1000)]
  [int]$ChatCapacity = 10,
  [ValidateRange(1, 1000)]
  [int]$DetectCapacity = 10,
  [ValidateRange(1, 1000)]
  [int]$EmbeddingCapacity = 10
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot

function Invoke-Az {
  param([Parameter(ValueFromRemainingArguments)][string[]]$Arguments)

  $output = & az @Arguments 2>&1
  if ($LASTEXITCODE -ne 0) {
    throw "az $($Arguments -join ' ') failed:`n$($output -join "`n")"
  }
  return $output
}

function Test-AzResource {
  param([string[]]$Arguments)

  & az @Arguments --only-show-errors 1>$null 2>$null
  return $LASTEXITCODE -eq 0
}

function Get-ModelVersion {
  param([string]$ModelName)

  $catalogJson = Invoke-Az cognitiveservices model list `
    --location $Location `
    --subscription $SubscriptionId `
    --output json `
    --only-show-errors
  $catalog = ($catalogJson -join "`n") | ConvertFrom-Json
  $candidates = @($catalog | Where-Object {
      $_.model.name -eq $ModelName -and
      $_.model.format -eq 'OpenAI' -and
      ($_.model.skus.name -contains $DeploymentSku)
    })

  if ($candidates.Count -eq 0) {
    throw "Model '$ModelName' with SKU '$DeploymentSku' is unavailable in '$Location'. Choose another -Location or -DeploymentSku."
  }

  return ($candidates.model.version | Sort-Object -Descending | Select-Object -First 1)
}

function Deploy-Model {
  param(
    [string]$DeploymentName,
    [string]$ModelName,
    [int]$Capacity
  )

  if (Test-AzResource @('cognitiveservices', 'account', 'deployment', 'show', '--resource-group', $ResourceGroup, '--name', $OpenAIAccountName, '--deployment-name', $DeploymentName)) {
    Write-Host "Model deployment '$DeploymentName' already exists."
    return
  }

  $version = Get-ModelVersion $ModelName
  Write-Host "Deploying $ModelName version $version as '$DeploymentName'..."
  Invoke-Az cognitiveservices account deployment create `
    --resource-group $ResourceGroup `
    --name $OpenAIAccountName `
    --deployment-name $DeploymentName `
    --model-name $ModelName `
    --model-version $version `
    --model-format OpenAI `
    --sku-name $DeploymentSku `
    --sku-capacity $Capacity `
    --only-show-errors `
    --output none
}

function Grant-RoleIfMissing {
  param(
    [string]$PrincipalId,
    [string]$Role,
    [string]$Scope
  )

  $assignmentId = (Invoke-Az role assignment list `
      --assignee $PrincipalId `
      --role $Role `
      --scope $Scope `
      --query '[0].id' `
      --output tsv `
      --only-show-errors).Trim()
  if ($assignmentId) {
    Write-Host "Role '$Role' is already assigned."
    return
  }

  Invoke-Az role assignment create `
    --assignee-object-id $PrincipalId `
    --assignee-principal-type User `
    --role $Role `
    --scope $Scope `
    --output none `
    --only-show-errors
}

if (-not (Get-Command az -ErrorAction SilentlyContinue)) {
  throw 'Azure CLI is required. Install it from https://aka.ms/installazurecliwindows and run az login.'
}

$account = & az account show --output json --only-show-errors 2>$null
if ($LASTEXITCODE -ne 0) {
  throw 'Not signed in to Azure. Run az login, then run this script again.'
}

Invoke-Az account set --subscription $SubscriptionId
$subscriptionSuffix = ($SubscriptionId -replace '-', '').Substring(0, 8).ToLowerInvariant()
if (-not $OpenAIAccountName) { $OpenAIAccountName = "veritycue-ai-$subscriptionSuffix" }
if (-not $SpeechAccountName) { $SpeechAccountName = "veritycue-speech-$subscriptionSuffix" }

Write-Host 'Registering Microsoft.CognitiveServices...'
Invoke-Az provider register --namespace Microsoft.CognitiveServices --wait --only-show-errors

if (-not (Test-AzResource @('group', 'show', '--name', $ResourceGroup))) {
  Write-Host "Creating resource group '$ResourceGroup' in '$Location'..."
  Invoke-Az group create --name $ResourceGroup --location $Location --output none --only-show-errors
}

if (-not (Test-AzResource @('cognitiveservices', 'account', 'show', '--resource-group', $ResourceGroup, '--name', $OpenAIAccountName))) {
  Write-Host "Creating Azure OpenAI account '$OpenAIAccountName'..."
  Invoke-Az cognitiveservices account create `
    --resource-group $ResourceGroup `
    --name $OpenAIAccountName `
    --location $Location `
    --kind OpenAI `
    --sku S0 `
    --custom-domain $OpenAIAccountName `
    --yes `
    --output none `
    --only-show-errors
}

if (-not (Test-AzResource @('cognitiveservices', 'account', 'show', '--resource-group', $ResourceGroup, '--name', $SpeechAccountName))) {
  Write-Host "Creating Speech account '$SpeechAccountName'..."
  Invoke-Az cognitiveservices account create `
    --resource-group $ResourceGroup `
    --name $SpeechAccountName `
    --location $Location `
    --kind SpeechServices `
    --sku S0 `
    --custom-domain $SpeechAccountName `
    --yes `
    --output none `
    --only-show-errors
}

Deploy-Model -DeploymentName 'gpt-4.1-mini' -ModelName 'gpt-4.1-mini' -Capacity $ChatCapacity
Deploy-Model -DeploymentName 'gpt-4.1-nano' -ModelName 'gpt-4.1-nano' -Capacity $DetectCapacity
Deploy-Model -DeploymentName 'text-embedding-3-small' -ModelName 'text-embedding-3-small' -Capacity $EmbeddingCapacity

$openAiId = (Invoke-Az cognitiveservices account show --resource-group $ResourceGroup --name $OpenAIAccountName --query id --output tsv --only-show-errors).Trim()
$openAiEndpoint = (Invoke-Az cognitiveservices account show --resource-group $ResourceGroup --name $OpenAIAccountName --query properties.endpoint --output tsv --only-show-errors).Trim()
$speechId = (Invoke-Az cognitiveservices account show --resource-group $ResourceGroup --name $SpeechAccountName --query id --output tsv --only-show-errors).Trim()

$openAiKey = ''
$speechKey = ''
if ($Authentication -eq 'EntraId') {
  $principalId = (Invoke-Az ad signed-in-user show --query id --output tsv --only-show-errors).Trim()
  Write-Host 'Assigning data-plane roles to the signed-in user...'
  Grant-RoleIfMissing -PrincipalId $principalId -Role 'Cognitive Services OpenAI User' -Scope $openAiId
  Grant-RoleIfMissing -PrincipalId $principalId -Role 'Cognitive Services Speech User' -Scope $speechId
}
else {
  $openAiKey = (Invoke-Az cognitiveservices account keys list --resource-group $ResourceGroup --name $OpenAIAccountName --query key1 --output tsv --only-show-errors).Trim()
  $speechKey = (Invoke-Az cognitiveservices account keys list --resource-group $ResourceGroup --name $SpeechAccountName --query key1 --output tsv --only-show-errors).Trim()
}

$envPath = Join-Path $repoRoot '.env'
$envContent = @"
# Generated by scripts/provision-azure.ps1. Do not commit this file.
AZURE_OPENAI_ENDPOINT=$openAiEndpoint
AZURE_OPENAI_API_KEY=$openAiKey
AZURE_OPENAI_API_VERSION=2024-10-21
AZURE_OPENAI_CHAT_DEPLOYMENT=gpt-4.1-mini
AZURE_OPENAI_DETECT_DEPLOYMENT=gpt-4.1-nano
AZURE_OPENAI_EMBEDDING_DEPLOYMENT=text-embedding-3-small

AZURE_SPEECH_KEY=$speechKey
AZURE_SPEECH_REGION=$Location
AZURE_SPEECH_RESOURCE_ID=$speechId

PORT=3978
ALLOWED_ORIGINS=http://localhost:5173
VITE_API_BASE=
"@

if (Test-Path $envPath) {
  $generatedPath = Join-Path $repoRoot '.env.generated'
  Set-Content -Path $generatedPath -Value $envContent -Encoding utf8NoBOM
  Write-Warning ".env already exists and was not overwritten. New configuration was written to '$generatedPath'."
}
else {
  Set-Content -Path $envPath -Value $envContent -Encoding utf8NoBOM
  Write-Host "Created '$envPath'."
}

Write-Host ''
Write-Host 'Azure resources and model deployments are ready.'
Write-Host "Resource group: $ResourceGroup"
Write-Host "Azure OpenAI:  $OpenAIAccountName"
Write-Host "Azure Speech:  $SpeechAccountName"
Write-Host 'Next: install dependencies, then run the server and client as described in README.md.'