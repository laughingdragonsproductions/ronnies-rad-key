# Production-like preview: static site/ only (no /api — same as Cloudflare Pages)
Set-Location $PSScriptRoot
Write-Host "Static Rad Key (Pages preview) -> http://127.0.0.1:8790/"
Write-Host "No local API — search and moment shards load from site/data/*.json"
py -3 -m http.server 8790 --directory site
