#requires -Version 5.1
<#
  Removes the Gemini x DeepSeek Flash bridge from DeepSeek Harness and Antigravity.
  Uses explicit UTF-8 reads/writes so non-ASCII profile comments survive.
#>
[CmdletBinding()]
param(
  [string]$DshHome = (Join-Path $env:USERPROFILE '.dsh'),
  [string]$GeminiHome = (Join-Path $env:USERPROFILE '.gemini')
)
$ErrorActionPreference = 'Stop'
$nl = [Environment]::NewLine
$utf8 = New-Object System.Text.UTF8Encoding($false)

function Write-Step($m) { Write-Host "==> $m" -ForegroundColor Cyan }
function Read-Utf8([string]$Path) { return [System.IO.File]::ReadAllText($Path, $utf8) }
function Write-Utf8NoBom([string]$Path, [string]$Text) {
  [System.IO.File]::WriteAllText($Path, $Text, $utf8)
}

$profilePath = Join-Path $DshHome 'profiles\desktop\cordis.patch.yml'
if (Test-Path $profilePath) {
  $yml = Read-Utf8 $profilePath
  $pattern = '(?s)# >>> gemini-dsh-bridge >>>.*?# <<< gemini-dsh-bridge <<<\r?\n?'
  $next = [regex]::Replace($yml, $pattern, '')
  if ($next -ne $yml) {
    Write-Utf8NoBom -Path $profilePath -Text ($next.TrimEnd() + $nl)
    Write-Step "removed bridge entry from $profilePath"
  }
}

$dshDst = Join-Path $DshHome 'plugins\gemini-dsh-bridge'
if (Test-Path $dshDst) { Remove-Item $dshDst -Recurse -Force; Write-Step "removed $dshDst" }

$agDst = Join-Path $GeminiHome 'config\plugins\gemini-dsh-bridge'
if (Test-Path $agDst) { Remove-Item $agDst -Recurse -Force; Write-Step "removed $agDst" }

$cfgPath = Join-Path $GeminiHome 'config\config.json'
if (Test-Path $cfgPath) {
  $cfg = (Read-Utf8 $cfgPath) | ConvertFrom-Json
  if ($cfg.PSObject.Properties['plugins'] -and $cfg.plugins.PSObject.Properties['gemini-dsh-bridge']) {
    $cfg.plugins.PSObject.Properties.Remove('gemini-dsh-bridge')
    Write-Utf8NoBom -Path $cfgPath -Text ($cfg | ConvertTo-Json -Depth 10)
    Write-Step "removed plugin entry from $cfgPath"
  }
}

$endpoint = Join-Path $DshHome 'bridge\endpoint.json'
if (Test-Path $endpoint) { Remove-Item $endpoint -Force; Write-Step "removed stale $endpoint" }

Write-Host ''
Write-Host 'Uninstalled. Restart DeepSeek Harness and Antigravity.' -ForegroundColor Green
