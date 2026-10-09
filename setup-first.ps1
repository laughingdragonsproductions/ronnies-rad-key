# First local setup: RCU publish -> library stills -> Rad Key export -> validate
param(
  [switch]$SkipRcuPublish,
  [switch]$Serve,
  [string]$RcuRoot = "G:\LocalAIagent\rcu-universe"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
$Root = $PSScriptRoot
Set-Location $Root

$rcuDb = Join-Path $RcuRoot "data\rcu.sqlite"
if (-not (Test-Path $rcuDb)) {
  Write-Warning "RCU database not found at $rcuDb - run RCU collect/publish first."
}

if (-not $SkipRcuPublish) {
  Write-Host "=== RCU publish (wiki + viewer + sqlite) ===" -ForegroundColor Cyan
  Push-Location $RcuRoot
  try {
    & py -3 -m rcu.cli publish
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
  } finally {
    Pop-Location
  }
}

$env:RCU_DB = $rcuDb
$env:RCU_ROOT = $RcuRoot

Write-Host "=== Sync RCU library stills ===" -ForegroundColor Cyan
& py -3 scripts\sync_rcu_library.py
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host "=== Build Rad Key site/data from RCU ===" -ForegroundColor Cyan
& py -3 scripts\build_from_rcu.py
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

& py -3 scripts\validate_data.py
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host ""
Write-Host "First setup complete." -ForegroundColor Green
Write-Host "  Open http://127.0.0.1:8790/ for the DNA helix site."
Write-Host "  RCU research map: run run-rcu.ps1 -Stage viewer under rcu-universe."
Write-Host ""

if ($Serve) {
  & py -3 scripts\dev_app.py
}
