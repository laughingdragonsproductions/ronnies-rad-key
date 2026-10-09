# Full local workflow: RCU sqlite -> static export -> dev app (API + UI)
param(
  [switch]$SkipBuild,
  [string]$RcuDb = $env:RCU_DB
)

Set-Location $PSScriptRoot

if (-not $RcuDb) {
  $default = "G:\LocalAIagent\rcu-universe\data\rcu.sqlite"
  if (Test-Path $default) { $RcuDb = $default }
}

if ($RcuDb) {
  $env:RCU_DB = $RcuDb
  Write-Host "RCU_DB = $RcuDb"
}

if (-not $SkipBuild) {
  Write-Host "Building site/data from RCU..."
  py -3 scripts\sync_rcu_library.py
  py -3 scripts\build_from_rcu.py
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
  py -3 scripts\validate_data.py
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}

Write-Host ""
py -3 scripts\dev_app.py
