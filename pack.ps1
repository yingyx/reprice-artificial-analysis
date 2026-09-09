$ErrorActionPreference = 'Stop'

$manifest = Get-Content manifest.json -Raw | ConvertFrom-Json
$version = $manifest.version
if (-not $version) { throw "manifest.json has no version" }

New-Item -ItemType Directory -Force -Path dist | Out-Null
$out = "dist/repriceaa-v$version.zip"
if (Test-Path $out) { Remove-Item -LiteralPath $out -Force }

Compress-Archive -Path manifest.json, src, LICENSE -DestinationPath $out -Force
Write-Output $out
