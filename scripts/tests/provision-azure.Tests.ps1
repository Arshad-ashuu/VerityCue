BeforeAll {
  $sourceScript = Join-Path (Split-Path -Parent $PSScriptRoot) 'provision-azure.ps1'
  $global:vcFunctionBackups = @{}
  foreach ($name in @('az', 'winget', 'Start-Process', 'Invoke-WebRequest', 'Get-VerityCueTestArgument', 'New-VerityCueTestAccount')) {
    $existing = Get-Item -LiteralPath "Function:\$name" -ErrorAction SilentlyContinue
    if ($existing) { $global:vcFunctionBackups[$name] = $existing.ScriptBlock }
  }
  $global:vcOriginalPath = $env:Path

  function global:az {
    param([Parameter(ValueFromRemainingArguments)][string[]]$Arguments)
    throw 'Azure CLI must be mocked in provisioning tests.'
  }

  function global:winget {
    param([Parameter(ValueFromRemainingArguments)][string[]]$Arguments)
    throw 'Package installation must be mocked in provisioning tests.'
  }

  function global:Start-Process {
    param([string]$FilePath, [string]$Verb, [switch]$Wait, [switch]$PassThru, [string[]]$ArgumentList)
    if (-not $global:vcAllowMsi -or $FilePath -ne 'msiexec.exe') {
      throw 'Process execution is blocked in provisioning tests.'
    }
    $global:vcCalls.Add(@{ command = 'msiexec'; arguments = $ArgumentList })
    if ($global:vcMsiExitCode -eq 0) { $global:vcCliPresent = $true }
    return [pscustomobject]@{ ExitCode = $global:vcMsiExitCode }
  }

  function global:Invoke-WebRequest {
    param([string]$Uri, [string]$OutFile, [switch]$UseBasicParsing)
    if (-not $global:vcAllowMsi -or $Uri -notlike 'https://aka.ms/installazurecliwindows*') {
      throw 'Network downloads are blocked in provisioning tests.'
    }
    $global:vcInstallerPath = $OutFile
    [IO.File]::WriteAllText($OutFile, 'Offline installer fixture, not an executable.')
  }

  function global:Get-VerityCueTestArgument {
    param([string[]]$Arguments, [string]$Name)
    $index = [Array]::IndexOf($Arguments, $Name)
    if ($index -lt 0) { return '' }
    return $Arguments[$index + 1]
  }

  function global:New-VerityCueTestAccount {
    param([string]$Name, [string]$Kind, [string]$Location)
    return [pscustomobject]@{
      name = $Name
      kind = $Kind
      location = $Location
      id = "/subscriptions/$global:vcSubscription/resourceGroups/rg-veritycue/providers/Microsoft.CognitiveServices/accounts/$Name"
      properties = @{
        endpoint = "https://$Name.cognitiveservices.azure.com/"
        customSubDomainName = $Name
        provisioningState = 'Succeeded'
      }
    }
  }

  function Invoke-TestProvisioning {
    param([hashtable]$Parameters = @{})
    & $global:vcProvisionScript @Parameters 6>&1 | Out-String
  }
}

AfterAll {
  $env:Path = $global:vcOriginalPath
  foreach ($name in @('az', 'winget', 'Start-Process', 'Invoke-WebRequest', 'Get-VerityCueTestArgument', 'New-VerityCueTestAccount')) {
    if ($global:vcFunctionBackups.ContainsKey($name)) {
      Set-Item -LiteralPath "Function:\global:$name" -Value $global:vcFunctionBackups[$name]
    }
    else {
      Remove-Item -LiteralPath "Function:\global:$name" -ErrorAction SilentlyContinue
    }
  }
  Remove-Variable -Scope Global -Name @(
    'vcSubscription', 'vcTenant', 'vcPrincipal', 'vcCalls', 'vcAccounts', 'vcDeployments',
    'vcGroups', 'vcLoginFails', 'vcCatalogFails', 'vcQuotaLimit', 'vcUnavailableRegions',
    'vcRoleFailure', 'vcExistingRoles', 'vcCliPresent', 'vcWingetPresent', 'vcInstallFails',
    'vcAccountState', 'vcModelVersions', 'vcRoot', 'vcProvisionScript', 'vcOriginalPath', 'vcFunctionBackups',
    'vcAllowMsi', 'vcInstallerPath', 'vcMsiExitCode'
  ) -ErrorAction SilentlyContinue
}

Describe 'Entra-only Azure provisioning' {
  BeforeEach {
    $global:vcSubscription = '11111111-2222-3333-4444-555555555555'
    $global:vcTenant = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
    $global:vcPrincipal = '12345678-1234-1234-1234-123456789012'
    $global:vcCalls = [System.Collections.Generic.List[object]]::new()
    $global:vcAccounts = [System.Collections.Generic.List[object]]::new()
    $global:vcDeployments = [System.Collections.Generic.List[object]]::new()
    $global:vcGroups = @()
    $global:vcLoginFails = $false
    $global:vcCatalogFails = $false
    $global:vcQuotaLimit = 20
    $global:vcUnavailableRegions = @()
    $global:vcRoleFailure = $false
    $global:vcExistingRoles = $false
    $global:vcCliPresent = $true
    $global:vcWingetPresent = $true
    $global:vcInstallFails = $false
    $global:vcAccountState = 'Enabled'
    $global:vcModelVersions = @(@{ version = '2025-04-14'; isDefaultVersion = $true })
    $global:vcAllowMsi = $false
    $global:vcMsiExitCode = 0
    $global:vcInstallerPath = $null

    $root = Join-Path $TestDrive ([guid]::NewGuid().ToString('N'))
    $global:vcRoot = $root
    $directory = Join-Path $root 'scripts'
    $null = New-Item -ItemType Directory -Path $directory
    $global:vcProvisionScript = Join-Path $directory 'provision-azure.ps1'
    Copy-Item -LiteralPath $sourceScript -Destination $global:vcProvisionScript

    Mock Get-Command {
      if ($Name -eq 'az' -and $global:vcCliPresent) {
        return [pscustomobject]@{ Name = 'az'; Source = 'mock-az'; CommandType = 'Application' }
      }
      if ($Name -eq 'winget' -and $global:vcWingetPresent) {
        return [pscustomobject]@{ Name = 'winget'; Source = 'mock-winget'; CommandType = 'Application' }
      }
    } -ParameterFilter { $Name -in @('az', 'winget') }

    function global:winget {
      param([Parameter(ValueFromRemainingArguments)][string[]]$Arguments)
      $global:vcCalls.Add(@{ command = 'winget'; arguments = @($Arguments) })
      $global:LASTEXITCODE = 0
      if ($global:vcInstallFails) {
        $global:LASTEXITCODE = 1
        return 'Synthetic package installation failure'
      }
      $global:vcCliPresent = $true
    }

    function global:az {
      param([Parameter(ValueFromRemainingArguments)][string[]]$Arguments)
      $global:vcCalls.Add(@{ command = ($Arguments[0..([Math]::Min(3, $Arguments.Count - 1))] -join ' '); arguments = @($Arguments) })
      $global:LASTEXITCODE = 0
      $command = $Arguments -join ' '
      if ($command -match '\bkeys\b|listKeys') {
        throw 'Provisioning must never request resource keys.'
      }
      $result = $null
      switch -Regex ($command) {
        '^version\b' { return }
        '^login\b' {
          if ($global:vcLoginFails) {
            $global:LASTEXITCODE = 1
            return 'Synthetic login failure'
          }
          return
        }
        '^account set\b' {
          $global:vcSubscription = Get-VerityCueTestArgument $Arguments '--subscription'
          return
        }
        '^account show\b' {
          $result = @{
            id = $global:vcSubscription
            name = 'Test subscription'
            tenantId = $global:vcTenant
            state = $global:vcAccountState
            user = @{ name = 'test@example.invalid'; type = 'user' }
          }
          break
        }
        '^ad signed-in-user show\b' {
          $result = @{ id = $global:vcPrincipal }
          break
        }
        '^provider register\b' { return }
        '^group list\b' { $result = @($global:vcGroups); break }
        '^group create\b' {
          $result = @{ name = 'rg-veritycue'; location = Get-VerityCueTestArgument $Arguments '--location' }
          $global:vcGroups = @($result)
          break
        }
        '^cognitiveservices account list-skus\b' {
          $result = @(@{ name = 'S0'; locations = @('regionone', 'regiontwo'); restrictions = @() })
          break
        }
        '^cognitiveservices account list\b' { $result = $global:vcAccounts.ToArray(); break }
        '^cognitiveservices account deployment list\b' { $result = $global:vcDeployments.ToArray(); break }
        '^cognitiveservices model list\b' {
          if ($global:vcCatalogFails) {
            $global:LASTEXITCODE = 1
            return '(AuthorizationFailed) Synthetic catalog permission failure'
          }
          $region = Get-VerityCueTestArgument $Arguments '--location'
          $result = @()
          if ($region -notin $global:vcUnavailableRegions) {
            $result = @(
              foreach ($model in @('gpt-4.1-mini', 'gpt-4.1-nano', 'text-embedding-3-small')) {
                $sku = if ($model -like 'text-embedding*') { 'Standard' } else { 'GlobalStandard' }
                foreach ($version in $global:vcModelVersions) {
                  @{
                    kind = 'OpenAI'
                    model = @{
                      format = 'OpenAI'
                      name = $model
                      version = $version.version
                      isDefaultVersion = $version.isDefaultVersion
                      skus = @(@{
                        name = $sku
                        usageName = "$sku.$model"
                        capacity = @{ minimum = 1; maximum = 100; step = 1; default = 10 }
                      })
                    }
                  }
                }
              }
            )
          }
          break
        }
        '^cognitiveservices usage list\b' {
          $result = @(
            foreach ($model in @('gpt-4.1-mini', 'gpt-4.1-nano', 'text-embedding-3-small')) {
              $sku = if ($model -like 'text-embedding*') { 'Standard' } else { 'GlobalStandard' }
              @{ name = @{ value = "$sku.$model" }; currentValue = 0; limit = $global:vcQuotaLimit }
            }
          )
          break
        }
        '^cognitiveservices account create\b' {
          $result = New-VerityCueTestAccount `
            -Name (Get-VerityCueTestArgument $Arguments '--name') `
            -Kind (Get-VerityCueTestArgument $Arguments '--kind') `
            -Location (Get-VerityCueTestArgument $Arguments '--location')
          $global:vcAccounts.Add($result)
          break
        }
        '^cognitiveservices account show\b' {
          $name = Get-VerityCueTestArgument $Arguments '--name'
          $result = $global:vcAccounts | Where-Object name -eq $name | Select-Object -First 1
          break
        }
        '^cognitiveservices account update\b' {
          $name = Get-VerityCueTestArgument $Arguments '--name'
          $result = $global:vcAccounts | Where-Object name -eq $name | Select-Object -First 1
          $result.properties.customSubDomainName = Get-VerityCueTestArgument $Arguments '--custom-domain'
          break
        }
        '^cognitiveservices account deployment create\b' {
          $result = @{
            name = Get-VerityCueTestArgument $Arguments '--deployment-name'
            properties = @{
              provisioningState = 'Succeeded'
              model = @{
                name = Get-VerityCueTestArgument $Arguments '--model-name'
                version = Get-VerityCueTestArgument $Arguments '--model-version'
                format = 'OpenAI'
              }
            }
            sku = @{
              name = Get-VerityCueTestArgument $Arguments '--sku-name'
              capacity = [int](Get-VerityCueTestArgument $Arguments '--sku-capacity')
            }
          }
          $global:vcDeployments.Add($result)
          break
        }
        '^role assignment list\b' {
          $result = @()
          if ($global:vcExistingRoles) { $result = @(@{ id = 'existing-role' }) }
          break
        }
        '^role assignment create\b' {
          if ($global:vcRoleFailure) {
            $global:LASTEXITCODE = 1
            return '(AuthorizationFailed) Synthetic role assignment failure'
          }
          return
        }
        '^resource update\b' { return }
        default { throw "Unexpected mocked az command: $command" }
      }
      return ConvertTo-Json -InputObject $result -Depth 20 -Compress
    }
  }

  It 'uses the active account without requiring a subscription parameter' {
    $command = $ExecutionContext.InvokeCommand.GetCommand($global:vcProvisionScript, 'ExternalScript')
    $mandatory = @($command.Parameters['SubscriptionId'].Attributes | Where-Object {
        $_ -is [System.Management.Automation.ParameterAttribute] -and $_.Mandatory
      })
    $mandatory.Count | Should -Be 0
  }

  It 'signs in and prints working Entra-only environment settings' {
    $output = Invoke-TestProvisioning
    $global:vcCalls[0].arguments[0] | Should -Be 'login'
    $output | Should -Match 'AZURE_OPENAI_ENDPOINT=https://'
    $output | Should -Match '(?m)^AZURE_OPENAI_API_KEY=\s*$'
    $output | Should -Match '(?m)^AZURE_SPEECH_KEY=\s*$'
    $output | Should -Match 'AZURE_SPEECH_REGION=regionone'
    $output | Should -Match ([regex]::Escape("AZURE_SPEECH_RESOURCE_ID=/subscriptions/$global:vcSubscription/"))
    $output | Should -Match 'AZURE_OPENAI_CHAT_DEPLOYMENT=gpt-4.1-mini'
    $output | Should -Match 'AZURE_OPENAI_DETECT_DEPLOYMENT=gpt-4.1-nano'
    $output | Should -Match 'AZURE_OPENAI_EMBEDDING_DEPLOYMENT=text-embedding-3-small'
    $global:vcAccounts.Count | Should -Be 2
    $global:vcDeployments.Count | Should -Be 3
    $roleCalls = @($global:vcCalls | Where-Object { $_.command -like 'role assignment create*' })
    $roleCalls.Count | Should -Be 2
    (Get-Content -LiteralPath (Join-Path $global:vcRoot '.env') -Raw) | Should -Match 'AZURE_SPEECH_REGION=regionone'
  }

  It 'selects supported SKUs per model instead of forcing a chat SKU on embeddings' {
    $null = Invoke-TestProvisioning
    ($global:vcDeployments | Where-Object name -eq 'text-embedding-3-small').sku.name | Should -Be 'Standard'
    ($global:vcDeployments | Where-Object name -eq 'gpt-4.1-mini').sku.name | Should -Be 'GlobalStandard'
    ($global:vcDeployments | Where-Object name -eq 'gpt-4.1-mini').sku.capacity | Should -Be 1
    @($global:vcCalls | Where-Object { $_.command -like 'resource update*' }).Count | Should -Be 2
  }

  It 'installs a missing CLI and continues without requiring a new terminal' {
    $global:vcCliPresent = $false
    $null = Invoke-TestProvisioning
    $global:vcCliPresent | Should -BeTrue
    @($global:vcCalls | Where-Object command -eq 'winget').Count | Should -Be 1
    @($global:vcCalls | Where-Object { $_.arguments[0] -eq 'login' }).Count | Should -Be 1
  }

  It 'reports failed CLI installation and does not sign in or provision' {
    $global:vcCliPresent = $false
    $global:vcInstallFails = $true
    { Invoke-TestProvisioning } | Should -Throw '*installation failed*'
    $global:vcAccounts.Count | Should -Be 0
    @($global:vcCalls | Where-Object { $_.arguments[0] -eq 'login' }).Count | Should -Be 0
  }

  It 'uses the official MSI fallback without real downloads or process execution' {
    $global:vcCliPresent = $false
    $global:vcWingetPresent = $false
    $global:vcAllowMsi = $true
    $null = Invoke-TestProvisioning
    @($global:vcCalls | Where-Object command -eq 'msiexec').Count | Should -Be 1
    Test-Path -LiteralPath $global:vcInstallerPath | Should -BeFalse
    $global:vcAccounts.Count | Should -Be 2
  }

  It 'cleans up a failed MSI installer and does not provision resources' {
    $global:vcCliPresent = $false
    $global:vcWingetPresent = $false
    $global:vcAllowMsi = $true
    $global:vcMsiExitCode = 1603
    { Invoke-TestProvisioning } | Should -Throw '*MSI exit code 1603*'
    Test-Path -LiteralPath $global:vcInstallerPath | Should -BeFalse
    $global:vcAccounts.Count | Should -Be 0
  }

  It 'uses natural model version ordering instead of sorting 9 above 10' {
    $global:vcModelVersions = @(
      @{ version = '9'; isDefaultVersion = $false }
      @{ version = '10'; isDefaultVersion = $false }
    )
    $null = Invoke-TestProvisioning
    @($global:vcDeployments | Where-Object { $_.properties.model.version -ne '10' }).Count | Should -Be 0
  }

  It 'prefers the service default model version when one is reported' {
    $global:vcModelVersions = @(
      @{ version = '9'; isDefaultVersion = $true }
      @{ version = '10'; isDefaultVersion = $false }
    )
    $null = Invoke-TestProvisioning
    @($global:vcDeployments | Where-Object { $_.properties.model.version -ne '9' }).Count | Should -Be 0
  }

  It 'rejects key-based provisioning before any CLI operation' {
    { Invoke-TestProvisioning @{ Authentication = 'Keys' } } | Should -Throw '*EntraId*'
    $global:vcCalls.Count | Should -Be 0
  }

  It 'honors an explicit subscription and deployment names' {
    $other = '99999999-8888-7777-6666-555555555555'
    $output = Invoke-TestProvisioning @{
      SubscriptionId = $other
      ChatDeploymentName = 'meeting-answer'
      DetectDeploymentName = 'meeting-detect'
      EmbeddingDeploymentName = 'meeting-embedding'
    }
    $output | Should -Match 'AZURE_OPENAI_CHAT_DEPLOYMENT=meeting-answer'
    $output | Should -Match 'AZURE_OPENAI_DETECT_DEPLOYMENT=meeting-detect'
    $output | Should -Match 'AZURE_OPENAI_EMBEDDING_DEPLOYMENT=meeting-embedding'
    $output | Should -Match ([regex]::Escape("/subscriptions/$other/"))
    foreach ($call in $global:vcCalls | Where-Object { $_.arguments[0] -in @('group', 'provider', 'resource', 'cognitiveservices', 'role') }) {
      (Get-VerityCueTestArgument $call.arguments '--subscription') | Should -Be $other
    }
  }

  It 'tries another discovered region when models are unavailable' {
    $global:vcUnavailableRegions = @('regionone')
    $output = Invoke-TestProvisioning
    $output | Should -Match 'AZURE_SPEECH_REGION=regiontwo'
    @($global:vcAccounts | Where-Object location -eq 'regiontwo').Count | Should -Be 2
  }

  It 'does not silently change an explicitly requested region' {
    $global:vcUnavailableRegions = @('regionone')
    { Invoke-TestProvisioning @{ Location = 'regionone' } } | Should -Throw '*No suitable*'
    $global:vcAccounts.Count | Should -Be 0
    $global:vcGroups.Count | Should -Be 0
  }

  It 'fails before creating billable resources if no model quota is available' {
    $global:vcQuotaLimit = 0
    { Invoke-TestProvisioning } | Should -Throw '*quota*'
    $global:vcAccounts.Count | Should -Be 0
    $global:vcGroups.Count | Should -Be 0
    Test-Path (Join-Path $global:vcRoot '.env') | Should -BeFalse
  }

  It 'does not mistake catalog authorization errors for unavailable models' {
    $global:vcCatalogFails = $true
    { Invoke-TestProvisioning } | Should -Throw '*AuthorizationFailed*'
    $global:vcAccounts.Count | Should -Be 0
  }

  It 'preserves existing env files and uses actual resource regions on reruns' {
    $null = Invoke-TestProvisioning
    $envPath = Join-Path $global:vcRoot '.env'
    $original = "PORT=4999`nCUSTOM_SETTING=keep-this"
    Set-Content -LiteralPath $envPath -Value $original -NoNewline
    $speech = $global:vcAccounts | Where-Object kind -eq 'SpeechServices'
    $speech.location = 'regiontwo'
    $global:vcQuotaLimit = 0
    $global:vcExistingRoles = $true
    $global:vcCalls.Clear()
    $output = Invoke-TestProvisioning
    Get-Content -LiteralPath $envPath -Raw | Should -Be $original
    Get-Content -LiteralPath (Join-Path $global:vcRoot '.env.generated') -Raw | Should -Match 'AZURE_SPEECH_REGION=regiontwo'
    $output | Should -Match 'AZURE_SPEECH_REGION=regiontwo'
    @($global:vcCalls | Where-Object { $_.command -like 'cognitiveservices account create*' }).Count | Should -Be 0
    @($global:vcCalls | Where-Object { $_.command -like 'cognitiveservices account deployment create*' }).Count | Should -Be 0
    @($global:vcCalls | Where-Object { $_.command -like 'role assignment create*' }).Count | Should -Be 0
  }

  It 'rejects conflicting existing model deployments rather than claiming success' {
    $null = Invoke-TestProvisioning
    $global:vcDeployments[0].properties.model.name = 'unexpected-model'
    { Invoke-TestProvisioning } | Should -Throw '*different model*'
  }

  It 'rejects a conflicting capacity request instead of silently ignoring it' {
    $null = Invoke-TestProvisioning
    { Invoke-TestProvisioning @{ ChatCapacity = 10 } } | Should -Throw '*different SKU or capacity*'
  }

  It 'configures the custom subdomain needed for an existing keyless Speech account' {
    $null = Invoke-TestProvisioning
    $speech = $global:vcAccounts | Where-Object kind -eq 'SpeechServices'
    $speech.properties.customSubDomainName = ''
    $null = Invoke-TestProvisioning
    $speech.properties.customSubDomainName | Should -Be $speech.name
  }

  It 'stops clearly on login failure without writing env values' {
    $global:vcLoginFails = $true
    { Invoke-TestProvisioning } | Should -Throw '*Synthetic login failure*'
    $global:vcAccounts.Count | Should -Be 0
    Test-Path (Join-Path $global:vcRoot '.env') | Should -BeFalse
  }

  It 'rejects disabled subscriptions before provisioning' {
    $global:vcAccountState = 'Disabled'
    { Invoke-TestProvisioning } | Should -Throw '*not enabled*'
    $global:vcAccounts.Count | Should -Be 0
  }

  It 'surfaces missing role-assignment permissions instead of printing success' {
    $global:vcRoleFailure = $true
    { Invoke-TestProvisioning } | Should -Throw '*AuthorizationFailed*'
    Test-Path (Join-Path $global:vcRoot '.env') | Should -BeFalse
  }
}
