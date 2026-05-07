param(
    [string]$PythonExe = "D:\comfyui\ComfyUI-aki-v1.5\ComfyUI-aki-v1.5\python\python.exe"
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
$Frontend = Join-Path $Root "gallery_ui"

if (-not (Test-Path -LiteralPath $PythonExe)) {
    $PythonExe = "python"
}

Push-Location $Root
try {
    & $PythonExe -m pytest
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    & $PythonExe -m compileall py\gallery
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}
finally {
    Pop-Location
}

Push-Location $Frontend
try {
    cmd /c npm run typecheck
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    cmd /c npm run lint
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    cmd /c npm run test:run
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    cmd /c npm run build
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}
finally {
    Pop-Location
}
