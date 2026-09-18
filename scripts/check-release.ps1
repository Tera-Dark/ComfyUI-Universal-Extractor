param([switch]$RequireClean)
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
python (Join-Path $Root "scripts/check_release.py")
if ($LASTEXITCODE -ne 0) { throw "Release metadata checks failed" }
if ($RequireClean -and (git -C $Root status --short)) { throw "Working tree is not clean" }
