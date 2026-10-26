#requires -Version 5.1
<#
  Installs the Gemini x DeepSeek Flash bridge.

    1. DSH plugin -> %USERPROFILE%\.dsh\plugins\gemini-dsh-bridge
       registered in %USERPROFILE%\.dsh\profiles\desktop\cordis.patch.yml
    2. Antigravity plugin -> %USERPROFILE%\.gemini\config\plugins\gemini-dsh-bridge
       enabled in %USERPROFILE%\.gemini\config\config.json

  Encoding contract: every file written here is UTF-8 WITHOUT BOM, read with the
  explicit UTF-8 encoder (never Get-Content, whose default differs between
  Windows PowerShell 5.1 and PowerShell 7 and corrupts non-ASCII comments).

  Restart DeepSeek Harness afterwards, then Antigravity.
#>
[CmdletBinding()]
param(
  [string]$RepoRoot = '',
  [string]$DshHome = '',
  [string]$GeminiHome = '',
  [string]$NodeExe = ''
)

$ErrorActionPreference = 'Stop'
$nl = [Environment]::NewLine
$utf8 = New-Object System.Text.UTF8Encoding($false)

if (-not $RepoRoot) {
  $scriptDir = if ($PSScriptRoot) { $PSScriptRoot } else { Split-Path -Parent $MyInvocation.MyCommand.Definition }
  $RepoRoot = Split-Path -Parent $scriptDir
}
if (-not $DshHome) { $DshHome = Join-Path $env:USERPROFILE '.dsh' }
if (-not $GeminiHome) { $GeminiHome = Join-Path $env:USERPROFILE '.gemini' }

function Write-Step($m) { Write-Host "==> $m" -ForegroundColor Cyan }
function Read-Utf8([string]$Path) { return [System.IO.File]::ReadAllText($Path, $utf8) }
function Write-Utf8NoBom([string]$Path, [string]$Text) {
  [System.IO.File]::WriteAllText($Path, $Text, $utf8)
}
function Assert-Written([string]$Path, [string]$Expected) {
  $actual = Read-Utf8 $Path
  if ($actual -ne $Expected) { throw "round-trip mismatch after writing $Path (another program may hold it open)" }
  if ($actual.IndexOf([char]0xFFFD) -ge 0) { throw "replacement characters detected in $Path" }
}

if (-not $NodeExe) {
  $cmd = Get-Command node -ErrorAction SilentlyContinue
  if ($cmd) { $NodeExe = $cmd.Source }
  else { $NodeExe = Join-Path $env:ProgramFiles 'nodejs\node.exe' }
}
if (-not (Test-Path $NodeExe)) { throw "node.exe not found. Pass -NodeExe <path>." }

$dshSrc = Join-Path $RepoRoot 'dsh-plugin'
$agSrc  = Join-Path $RepoRoot 'antigravity-plugin'
if (-not (Test-Path $dshSrc)) { throw "missing $dshSrc" }
if (-not (Test-Path $agSrc))  { throw "missing $agSrc" }

# --- 1) DSH plugin ---------------------------------------------------------
$dshDst = Join-Path $DshHome 'plugins\gemini-dsh-bridge'
Write-Step "installing DSH plugin -> $dshDst"
if (Test-Path $dshDst) { Remove-Item $dshDst -Recurse -Force }
New-Item -ItemType Directory -Force -Path (Split-Path $dshDst) | Out-Null
Copy-Item $dshSrc $dshDst -Recurse -Force

$profilePath = Join-Path $DshHome 'profiles\desktop\cordis.patch.yml'
if (-not (Test-Path $profilePath)) { throw "profile not found: $profilePath" }
$yml = Read-Utf8 $profilePath
$backup = $profilePath + '.bak-gemini-bridge'
if (-not (Test-Path $backup)) { Copy-Item $profilePath $backup }

$markerStart = '# >>> gemini-dsh-bridge >>>'
$markerEnd   = '# <<< gemini-dsh-bridge <<<'
$pattern = '(?s)' + [regex]::Escape($markerStart) + '.*?' + [regex]::Escape($markerEnd) + '\r?\n?'
$yml = [regex]::Replace($yml, $pattern, '')
$entryPath = (Join-Path $dshDst 'src\index.js')
$block = $markerStart + $nl +
  '# Gemini <-> DeepSeek Flash bridge. Managed by scripts/install.ps1 / uninstall.ps1.' + $nl +
  '- insert:' + $nl +
  '    - id: gemini-dsh-bridge' + $nl +
  "      name: '" + $entryPath + "'" + $nl +
  '      config:' + $nl +
  '        maxConcurrent: 3' + $nl +
  $markerEnd + $nl
$nextYml = $yml.TrimEnd() + $nl + $nl + $block
Write-Utf8NoBom -Path $profilePath -Text $nextYml
Assert-Written -Path $profilePath -Expected $nextYml
Write-Step "registered in $profilePath"

# --- 2) Antigravity plugin -------------------------------------------------
$agDst = Join-Path $GeminiHome 'config\plugins\gemini-dsh-bridge'
Write-Step "installing Antigravity plugin -> $agDst"
if (Test-Path $agDst) {
  try { Remove-Item $agDst -Recurse -Force -ErrorAction Stop }
  catch { Write-Warning "could not replace $agDst (Antigravity may be running); updating files in place" }
}
if (Test-Path $agDst) {
  Copy-Item (Join-Path $agSrc '*') $agDst -Recurse -Force
} else {
  Copy-Item $agSrc $agDst -Recurse -Force
}

$mcpPath = Join-Path $agDst 'mcp_config.json'
$shimPath = Join-Path $agDst 'bin\shim.cjs'
$mcp = [ordered]@{
  mcpServers = [ordered]@{
    'dsh-bridge' = [ordered]@{
      command = $NodeExe
      args = @($shimPath)
      timeoutSeconds = 600
    }
  }
}
$mcpText = $mcp | ConvertTo-Json -Depth 6
Write-Utf8NoBom -Path $mcpPath -Text $mcpText
Assert-Written -Path $mcpPath -Expected $mcpText
Write-Step "wrote $mcpPath (node: $NodeExe)"

$cfgPath = Join-Path $GeminiHome 'config\config.json'
if (Test-Path $cfgPath) { $cfg = (Read-Utf8 $cfgPath) | ConvertFrom-Json } else { $cfg = [pscustomobject]@{} }
if (-not $cfg.PSObject.Properties['plugins']) {
  $cfg | Add-Member -MemberType NoteProperty -Name plugins -Value ([pscustomobject]@{})
}
$existing = $cfg.plugins.PSObject.Properties['gemini-dsh-bridge']
if ($existing) { $existing.Value.enabled = $true }
else { $cfg.plugins | Add-Member -MemberType NoteProperty -Name 'gemini-dsh-bridge' -Value ([pscustomobject]@{ enabled = $true }) }
$cfgText = $cfg | ConvertTo-Json -Depth 10
Write-Utf8NoBom -Path $cfgPath -Text $cfgText
Assert-Written -Path $cfgPath -Expected $cfgText
Write-Step "enabled plugin in $cfgPath"

Write-Host ''
Write-Host 'Installed. Next steps:' -ForegroundColor Green
Write-Host '  1. Restart DeepSeek Harness  (writes %USERPROFILE%\.dsh\bridge\endpoint.json at boot)'
Write-Host '  2. Restart Antigravity       (the dsh_* MCP tools appear)'
Write-Host '  3. Verify: curl.exe -s http://127.0.0.1:<port>/gemini-bridge/health'
