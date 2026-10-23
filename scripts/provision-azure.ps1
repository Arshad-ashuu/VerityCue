#requires -Version 5.1
<#
.SYNOPSIS
Installs Azure CLI if needed, signs in, and provisions VerityCue using Entra ID only.
.DESCRIPTION
Uses the subscription selected by az login unless SubscriptionId is supplied.
Discovers supported regions, model versions, deployment SKUs, and available quota.
Prints the exact Azure environment settings and preserves any existing .env file.
Azure resource creation and usage can incur charges. Installation may require elevation.
#>
[CmdletBinding()]
param(
  [string]$SubscriptionId,
  [string]$TenantId,
  [switch]$UseDeviceCode,
  [string]$Location,
  [string]$SpeechLocation,
  [ValidateNotNullOrEmpty()]
  [string]$ResourceGroup = 'rg-veritycue',
  [string]$OpenAIAccountName,
  [string]$SpeechAccountName,
  [ValidateSet('EntraId')]
  [string]$Authentication = 'EntraId',
  [ValidateNotNullOrEmpty()]
  [string]$ChatModel = 'gpt-4.1-mini',
  [ValidateNotNullOrEmpty()]
  [string]$DetectModel = 'gpt-4.1-nano',
  [ValidateNotNullOrEmpty()]
  [string]$EmbeddingModel = 'text-embedding-3-small',
  [string]$ChatDeploymentName,
  [string]$DetectDeploymentName,
  [string]$EmbeddingDeploymentName,
  [ValidateSet('Standard', 'GlobalStandard', 'DataZoneStandard')]
  [string]$DeploymentSku,
  [ValidateSet('Standard', 'GlobalStandard', 'DataZoneStandard')]
  [string]$EmbeddingDeploymentSku,
  [ValidateRange(0, 1000)]
  [int]$ChatCapacity = 0,
  [ValidateRange(0, 1000)]
  [int]$DetectCapacity = 0,
  [ValidateRange(0, 1000)]
  [int]$EmbeddingCapacity = 0
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
if ($Location) { $Location = ($Location -replace '\s', '').ToLowerInvariant() }
if ($SpeechLocation) { $SpeechLocation = ($SpeechLocation -replace '\s', '').ToLowerInvariant() }

function Install-AzureCliIfMissing {
  if (Get-Command az -ErrorAction SilentlyContinue) { return }

  Write-Host 'Azure CLI was not found. Installing it (administrator approval may be required)...'
  if (Get-Command winget -ErrorAction SilentlyContinue) {
    & winget install --exact --id Microsoft.AzureCLI --source winget `
      --accept-package-agreements --accept-source-agreements --silent --disable-interactivity
    if ($LASTEXITCODE -ne 0) {
      throw "Azure CLI installation failed (winget exit code $LASTEXITCODE). Install from https://aka.ms/installazurecliwindows and rerun."
    }
  }
  else {
    if ($env:OS -ne 'Windows_NT') {
      throw 'Automatic Azure CLI installation requires Windows. See https://learn.microsoft.com/cli/azure/install-azure-cli.'
    }
    $installer = Join-Path ([IO.Path]::GetTempPath()) "veritycue-azure-cli-$([guid]::NewGuid().ToString('N')).msi"
    $installerUrl = 'https://aka.ms/installazurecliwindows'
    if ([Environment]::Is64BitOperatingSystem) { $installerUrl += 'x64' }
    try {
      Invoke-WebRequest -Uri $installerUrl -OutFile $installer -UseBasicParsing
      $process = Start-Process -FilePath msiexec.exe -Verb RunAs -Wait -PassThru `
        -ArgumentList @('/i', "`"$installer`"", '/passive', '/norestart')
      if ($process.ExitCode -notin @(0, 3010)) {
        throw "Azure CLI installation failed (MSI exit code $($process.ExitCode))."
      }
    }
    finally {
      if (Test-Path -LiteralPath $installer) { Remove-Item -LiteralPath $installer }
    }
  }

  $paths = @(
    $env:Path
    [Environment]::GetEnvironmentVariable('Path', 'Machine')
    [Environment]::GetEnvironmentVariable('Path', 'User')
    foreach ($programFiles in @($env:ProgramFiles, ${env:ProgramFiles(x86)})) {
      if ($programFiles) {
        $bin = Join-Path $programFiles 'Microsoft SDKs\Azure\CLI2\wbin'
        if (Test-Path -LiteralPath (Join-Path $bin 'az.cmd')) { $bin }
      }
    }
  )
  $env:Path = ($paths | Where-Object { $_ }) -join [IO.Path]::PathSeparator
  if (-not (Get-Command az -ErrorAction SilentlyContinue)) {
    throw 'Azure CLI installation finished but az is still unavailable. Restart the terminal (or Windows if requested) and rerun.'
  }
}

function Invoke-Az {
  param([Parameter(ValueFromRemainingArguments)][string[]]$Arguments)

  if ($SubscriptionId -and $Arguments[0] -in @('provider', 'group', 'cognitiveservices', 'resource', 'role')) {
    $Arguments += @('--subscription', $SubscriptionId)
  }
  # Windows PowerShell can turn redirected native stderr into terminating errors.
  $ErrorActionPreference = 'Continue'
  $PSNativeCommandUseErrorActionPreference = $false
  $output = & az @Arguments --only-show-errors 2>&1
  if ($LASTEXITCODE -ne 0) {
    throw "az $($Arguments -join ' ') failed:`n$($output -join "`n")"
  }
  return ($output -join "`n").Trim()
}

function Invoke-AzJson {
  param([Parameter(ValueFromRemainingArguments)][string[]]$Arguments)

  $json = Invoke-Az @Arguments --output json
  if (-not $json) { throw "az $($Arguments -join ' ') returned no JSON." }
  try {
    return ConvertFrom-Json -InputObject $json -ErrorAction Stop
  }
  catch {
    throw "Invalid JSON from az $($Arguments -join ' '): $($_.Exception.Message)"
  }
}

function Get-ServiceLocation {
  param([string]$Kind)

  $skus = @(Invoke-AzJson cognitiveservices account list-skus --kind $Kind)
  $regions = @(
    foreach ($sku in $skus | Where-Object name -eq 'S0') {
      foreach ($region in $sku.locations) {
        $blocked = @($sku.restrictions | Where-Object {
            $_.type -eq 'Location' -and ($_.values -contains $region)
          })
        if ($blocked.Count -eq 0 -and $region -ne 'global') {
          ($region -replace '\s', '').ToLowerInvariant()
        }
      }
    }
  )
  if ($regions.Count -eq 0) { throw "Azure reports no available S0 regions for '$Kind' in this subscription." }
  return $regions | Sort-Object -Unique
}

function Get-ExistingAccount {
  param([string]$Kind, [string]$Name)

  $found = @($accounts | Where-Object {
      if ($Name) { $_.name -eq $Name } else { $_.kind -eq $Kind }
    })
  if ($found.Count -gt 1) {
    throw "Multiple '$Kind' accounts exist in '$ResourceGroup'. Specify -OpenAIAccountName or -SpeechAccountName."
  }
  if ($found.Count -eq 1) {
    if ($found[0].kind -ne $Kind) { throw "Account '$Name' has kind '$($found[0].kind)', not '$Kind'." }
    return $found[0]
  }
}

function Get-DeploymentPlan {
  param([string]$Region)

  $items = [System.Collections.Generic.List[object]]::new()
  $missing = @()
  foreach ($requirement in $requirements) {
    $existing = @($deployments | Where-Object name -eq $requirement.Name)
    if ($existing.Count -eq 0) { $missing += $requirement; continue }
    $deployment = $existing[0]
    if ($deployment.properties.model.name -ne $requirement.Model -or $deployment.properties.model.format -ne 'OpenAI') {
      throw "Deployment '$($requirement.Name)' uses a different model. Choose another deployment name or the matching -ChatModel/-DetectModel/-EmbeddingModel."
    }
    if ($deployment.properties.provisioningState -ne 'Succeeded') {
      throw "Deployment '$($requirement.Name)' is not ready: $($deployment.properties.provisioningState)."
    }
    if (($requirement.Sku -and $deployment.sku.name -ne $requirement.Sku) -or
        ($requirement.Capacity -gt 0 -and $deployment.sku.capacity -ne $requirement.Capacity)) {
      throw "Deployment '$($requirement.Name)' has a different SKU or capacity. Existing deployments are not resized; update it in Azure or choose a different deployment name."
    }
    $items.Add([pscustomobject]@{ Requirement = $requirement; Existing = $deployment })
  }
  if ($missing.Count -eq 0) { return [pscustomobject]@{ Ready = $true; Items = $items } }

  $catalog = @(Invoke-AzJson cognitiveservices model list --location $Region)
  $usages = @(Invoke-AzJson cognitiveservices usage list --location $Region)
  $remaining = @{}
  foreach ($usage in $usages) {
    $remaining[$usage.name.value] = [double]$usage.limit - [double]$usage.currentValue
  }

  foreach ($requirement in $missing) {
    $models = @($catalog | Where-Object {
        $_.model.name -eq $requirement.Model -and $_.model.format -eq 'OpenAI' -and
        $_.model.lifecycleStatus -notin @('Deprecated', 'Disabled') -and
        (-not $_.model.deprecation.inference -or [datetimeoffset]$_.model.deprecation.inference -gt [datetimeoffset]::UtcNow)
      } | ForEach-Object { $_.model } | Sort-Object `
        @{ Expression = { $_.isDefaultVersion -eq $true }; Descending = $true }, `
        @{ Expression = { [regex]::Replace($_.version, '\d+', { param($match) $match.Value.PadLeft(12, '0') }) }; Descending = $true })

    $preferredSkus = @('GlobalStandard', 'Standard', 'DataZoneStandard')
    if ($requirement.Sku) { $preferredSkus = @($requirement.Sku) }
    $selected = $null
    foreach ($model in $models) {
      foreach ($skuName in $preferredSkus) {
        $sku = $model.skus | Where-Object name -eq $skuName | Select-Object -First 1
        if (-not $sku -or -not $remaining.ContainsKey($sku.usageName)) { continue }
        $minimum = [Math]::Max(1, [int]$sku.capacity.minimum)
        $step = [Math]::Max(1, [int]$sku.capacity.step)
        $capacity = $minimum
        if ($requirement.Capacity -gt 0) { $capacity = $requirement.Capacity }
        if ($capacity -lt $minimum -or ($capacity - $minimum) % $step -ne 0) { continue }
        if ($sku.capacity.maximum -and $capacity -gt $sku.capacity.maximum) { continue }
        if ($remaining[$sku.usageName] -lt $capacity) { continue }
        $selected = [pscustomobject]@{
          Requirement = $requirement
          Existing = $null
          Version = $model.version
          Sku = $skuName
          Capacity = $capacity
        }
        $remaining[$sku.usageName] -= $capacity
        break
      }
      if ($selected) { break }
    }
    if (-not $selected) {
      return [pscustomobject]@{
        Ready = $false
        Reason = "'$($requirement.Model)' has no supported version/SKU with sufficient reported quota for the requested capacity."
      }
    }
    $items.Add($selected)
  }
  return [pscustomobject]@{ Ready = $true; Items = $items }
}

function Initialize-AiAccount {
  param([string]$Name, [string]$Kind, [string]$Region, $Existing)

  $resource = $Existing
  if (-not $resource) {
    Write-Host "Creating $Kind account '$Name' in '$Region'..."
    $resource = Invoke-AzJson cognitiveservices account create `
      --resource-group $ResourceGroup --name $Name --location $Region `
      --kind $Kind --sku S0 --custom-domain $Name --yes
    if (-not $resource.id) { throw "Azure returned no resource ID for '$Name'." }
    Invoke-Az resource update --ids $resource.id --set properties.disableLocalAuth=true --output none
  }
  elseif (-not $resource.properties.customSubDomainName) {
    Write-Host "Configuring the custom subdomain required by Entra ID on '$Name'..."
    $resource = Invoke-AzJson cognitiveservices account update `
      --resource-group $ResourceGroup --name $Name --custom-domain $Name
  }
  if (-not $resource.id -or -not $resource.location -or $resource.properties.provisioningState -ne 'Succeeded') {
    throw "Account '$Name' is not ready. Inspect its provisioning state in Azure before rerunning."
  }
  return $resource
}

function Grant-RoleIfMissing {
  param([string]$Role, [string]$Scope)

  $assignments = @(Invoke-AzJson role assignment list --assignee-object-id $principalId `
      --fill-principal-name false --role $Role --scope $Scope --include-inherited)
  if ($assignments.Count -gt 0) {
    Write-Host "Role '$Role' is already assigned."
    return
  }
  Write-Host "Assigning '$Role' to the signed-in user..."
  Invoke-Az role assignment create --assignee-object-id $principalId `
    --assignee-principal-type User --role $Role --scope $Scope --output none
}

Install-AzureCliIfMissing
Write-Host 'Signing in to Azure with Microsoft Entra ID...'
$loginArguments = @('login', '--output', 'none')
if ($TenantId) { $loginArguments += @('--tenant', $TenantId) }
if ($UseDeviceCode) { $loginArguments += '--use-device-code' }
Invoke-Az @loginArguments
if ($SubscriptionId) { Invoke-Az account set --subscription $SubscriptionId --output none }
$account = Invoke-AzJson account show
if (-not $account.id -or -not $account.tenantId) { throw 'az account show returned no subscription or tenant ID.' }
if ($account.state -ne 'Enabled') { throw "Subscription '$($account.name)' is not enabled: $($account.state)." }
$SubscriptionId = $account.id
if ($account.user.type -ne 'user') { throw 'This local setup requires an interactive user login. Run az login with your Entra account.' }
$principal = Invoke-AzJson ad signed-in-user show
$principalId = $principal.id
if (-not $principalId) { throw 'Could not determine the signed-in Entra user object ID.' }

Write-Host "Subscription: $($account.name) ($SubscriptionId)"
Write-Host "Tenant:       $($account.tenantId)"
Write-Host "Authentication: $Authentication only. Resource keys will not be retrieved."
Write-Host 'This app needs Azure OpenAI and Speech; no separate Foundry project or hub is required.'
Write-Host 'Registering Microsoft.CognitiveServices...'
Invoke-Az provider register --namespace Microsoft.CognitiveServices --wait --output none

$groups = @(Invoke-AzJson group list)
$group = $groups | Where-Object name -eq $ResourceGroup | Select-Object -First 1
$accounts = @()
if ($group) { $accounts = @(Invoke-AzJson cognitiveservices account list --resource-group $ResourceGroup) }
$openAi = Get-ExistingAccount -Kind OpenAI -Name $OpenAIAccountName
$speech = Get-ExistingAccount -Kind SpeechServices -Name $SpeechAccountName
$hash = [Security.Cryptography.SHA256]::Create()
try {
  $suffix = ([BitConverter]::ToString($hash.ComputeHash(
        [Text.Encoding]::UTF8.GetBytes("$SubscriptionId/$($ResourceGroup.ToLowerInvariant())")
      )) -replace '-', '').Substring(0, 10).ToLowerInvariant()
}
finally { $hash.Dispose() }
if ($openAi) { $OpenAIAccountName = $openAi.name }
elseif (-not $OpenAIAccountName) { $OpenAIAccountName = "veritycue-ai-$suffix" }
if ($speech) { $SpeechAccountName = $speech.name }
elseif (-not $SpeechAccountName) { $SpeechAccountName = "veritycue-speech-$suffix" }
if (-not $ChatDeploymentName) { $ChatDeploymentName = $ChatModel }
if (-not $DetectDeploymentName) { $DetectDeploymentName = $DetectModel }
if (-not $EmbeddingDeploymentName) { $EmbeddingDeploymentName = $EmbeddingModel }

$requirements = @(
  [pscustomobject]@{ Name = $ChatDeploymentName; Model = $ChatModel; Capacity = $ChatCapacity; Sku = $DeploymentSku }
  [pscustomobject]@{ Name = $DetectDeploymentName; Model = $DetectModel; Capacity = $DetectCapacity; Sku = $DeploymentSku }
  [pscustomobject]@{ Name = $EmbeddingDeploymentName; Model = $EmbeddingModel; Capacity = $EmbeddingCapacity; Sku = $EmbeddingDeploymentSku }
)
if (@($requirements.Name | Sort-Object -Unique).Count -ne $requirements.Count) {
  throw 'Chat, detection, and embedding deployment names must be distinct.'
}
foreach ($name in $requirements.Name) {
  if ($name -notmatch '^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$') { throw "Invalid deployment name '$name'." }
}
$deployments = @()
if ($openAi) {
  $deployments = @(Invoke-AzJson cognitiveservices account deployment list `
      --resource-group $ResourceGroup --name $OpenAIAccountName)
  if ($Location -and $Location -ne $openAi.location) {
    throw "Existing OpenAI account is in '$($openAi.location)', not '$Location'. Use its actual location or a different account name."
  }
  $Location = $openAi.location
}
if ($speech) {
  if ($SpeechLocation -and $SpeechLocation -ne $speech.location) {
    throw "Existing Speech account is in '$($speech.location)', not '$SpeechLocation'."
  }
  $SpeechLocation = $speech.location
}

$openAiRegions = @()
if (-not $Location) { $openAiRegions = @(Get-ServiceLocation OpenAI) }
$speechRegions = @()
if (-not $speech) { $speechRegions = @(Get-ServiceLocation SpeechServices) }
$candidateRegions = @()
if ($Location) {
  $candidateRegions = @($Location)
}
else {
  if ($group -and $group.location -in $openAiRegions) { $candidateRegions += $group.location }
  $candidateRegions += $openAiRegions
  $candidateRegions = @($candidateRegions | Select-Object -Unique)
  if (-not $speech -and -not $SpeechLocation) {
    $candidateRegions = @($candidateRegions | Where-Object { $_ -in $speechRegions })
  }
}
if (-not $speech -and $SpeechLocation -and $SpeechLocation -notin $speechRegions) {
  throw "Speech S0 is not available in '$SpeechLocation' for this subscription."
}
$plan = $null
foreach ($region in $candidateRegions) {
  if (-not $speech -and -not $SpeechLocation -and $region -notin $speechRegions) { continue }
  Write-Host "Checking model availability and quota in '$region'..."
  $candidate = Get-DeploymentPlan -Region $region
  if ($candidate.Ready) { $plan = $candidate; $Location = $region; break }
  Write-Host "Skipping '$region': $($candidate.Reason)"
}
if (-not $plan) {
  throw "No suitable region was found for the requested models, SKUs, and quota. Use -Location/-SpeechLocation or adjust the model, SKU, or capacity parameters. Inspect 'az cognitiveservices usage list --location <region>' for quota."
}
if (-not $SpeechLocation) { $SpeechLocation = $Location }
Write-Host "OpenAI region: $Location; Speech region: $SpeechLocation"

if (-not $group) {
  Write-Host "Creating resource group '$ResourceGroup'..."
  $group = Invoke-AzJson group create --name $ResourceGroup --location $Location
}
$openAi = Initialize-AiAccount -Name $OpenAIAccountName -Kind OpenAI -Region $Location -Existing $openAi
$speech = Initialize-AiAccount -Name $SpeechAccountName -Kind SpeechServices -Region $SpeechLocation -Existing $speech
foreach ($item in $plan.Items) {
  if ($item.Existing) {
    Write-Host "Deployment '$($item.Requirement.Name)' already exists and matches the requested model."
    continue
  }
  Write-Host "Deploying '$($item.Requirement.Name)': $($item.Requirement.Model) version $($item.Version), $($item.Sku), capacity $($item.Capacity)..."
  $deployment = Invoke-AzJson cognitiveservices account deployment create `
    --resource-group $ResourceGroup --name $OpenAIAccountName `
    --deployment-name $item.Requirement.Name --model-name $item.Requirement.Model `
    --model-version $item.Version --model-format OpenAI --sku-name $item.Sku --sku-capacity $item.Capacity
  if ($deployment.properties.provisioningState -ne 'Succeeded') {
    throw "Deployment '$($item.Requirement.Name)' is not ready: $($deployment.properties.provisioningState)."
  }
}
Write-Host 'Assigning data-plane access. Owner, User Access Administrator, or equivalent role-assignment permission is required.'
Grant-RoleIfMissing -Role 'Cognitive Services OpenAI User' -Scope $openAi.id
Grant-RoleIfMissing -Role 'Cognitive Services Speech User' -Scope $speech.id

$openAiEndpoint = $openAi.properties.endpoint
if (-not $openAiEndpoint) { throw "Azure returned no endpoint for '$OpenAIAccountName'." }
$azureEnv = @"
AZURE_OPENAI_ENDPOINT=$openAiEndpoint
AZURE_OPENAI_API_KEY=
AZURE_OPENAI_API_VERSION=2024-10-21
AZURE_OPENAI_CHAT_DEPLOYMENT=$ChatDeploymentName
AZURE_OPENAI_DETECT_DEPLOYMENT=$DetectDeploymentName
AZURE_OPENAI_EMBEDDING_DEPLOYMENT=$EmbeddingDeploymentName

AZURE_SPEECH_KEY=
AZURE_SPEECH_REGION=$($speech.location)
AZURE_SPEECH_RESOURCE_ID=$($speech.id)
"@
$envContent = @"
# Generated by scripts/provision-azure.ps1. Authentication: Microsoft Entra ID only.
# Keep both key variables empty, including when merging into an existing .env.
$azureEnv

PORT=3978
ALLOWED_ORIGINS=http://localhost:5173
VITE_API_BASE=
"@
$envPath = Join-Path $repoRoot '.env'
$outputPath = $envPath
if (Test-Path -LiteralPath $envPath) {
  $outputPath = Join-Path $repoRoot '.env.generated'
  Write-Warning ".env already exists and was not overwritten. Merge the Azure settings from '$outputPath' into it."
}
[IO.File]::WriteAllText($outputPath, "$envContent`n", (New-Object Text.UTF8Encoding($false)))

Write-Host ''
Write-Host 'Azure resources and model deployments are provisioned for Entra ID.'
Write-Host "Resource group: $ResourceGroup"
Write-Host "Azure OpenAI:  $($openAi.id)"
Write-Host "Azure Speech:  $($speech.id)"
Write-Host "Configuration saved to '$outputPath'."
Write-Host ''
Write-Host "Add or replace these values in '$envPath' (leave both key fields empty):"
Write-Host $azureEnv
Write-Host ''
Write-Host 'Role assignments can take several minutes to propagate. Keep az login active for the local backend.'
Write-Host 'Next: install dependencies and start the server/client as described in README.md.'