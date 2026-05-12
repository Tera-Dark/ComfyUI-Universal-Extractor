param(
    [switch]$RequireClean
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
$Frontend = Join-Path $Root "gallery_ui"

function Get-PyProjectVersion {
    $pyproject = Get-Content -LiteralPath (Join-Path $Root "pyproject.toml") -Raw
    if ($pyproject -notmatch '(?m)^version\s*=\s*"([^"]+)"') {
        throw "Unable to read project version from pyproject.toml"
    }
    return $Matches[1]
}

$projectVersion = Get-PyProjectVersion
$releaseWarnings = New-Object System.Collections.Generic.List[string]
$package = Get-Content -LiteralPath (Join-Path $Frontend "package.json") -Raw | ConvertFrom-Json
$packageLockText = Get-Content -LiteralPath (Join-Path $Frontend "package-lock.json") -Raw

if ($package.version -ne $projectVersion) {
    throw "Version mismatch: pyproject.toml is $projectVersion but gallery_ui/package.json is $($package.version)"
}
$lockVersionMatch = [regex]::Match($packageLockText, '"version"\s*:\s*"([^"]+)"')
$lockRootVersionMatch = [regex]::Match($packageLockText, '(?s)""\s*:\s*\{.*?"version"\s*:\s*"([^"]+)"')
if (-not $lockVersionMatch.Success -or -not $lockRootVersionMatch.Success) {
    throw "Unable to read root versions from package-lock.json"
}
$lockVersion = $lockVersionMatch.Groups[1].Value
$lockRootVersion = $lockRootVersionMatch.Groups[1].Value
if ($lockVersion -ne $projectVersion -or $lockRootVersion -ne $projectVersion) {
    throw "Version mismatch: package-lock.json root version must be $projectVersion"
}

$assetsDir = Join-Path $Frontend "dist\assets"
if (-not (Test-Path -LiteralPath $assetsDir)) {
    throw "Missing gallery_ui/dist/assets. Run npm run build first."
}

$indexHtmlPath = Join-Path $Frontend "dist\index.html"
if (-not (Test-Path -LiteralPath $indexHtmlPath)) {
    throw "Missing gallery_ui/dist/index.html. Run npm run build first."
}
$indexHtml = Get-Content -LiteralPath $indexHtmlPath -Raw
$entryCssMatches = [regex]::Matches($indexHtml, '/gallery/assets/(index-[^"]+\.css)')
$entryJsMatches = [regex]::Matches($indexHtml, '/gallery/assets/(index-[^"]+\.js)')
if ($entryCssMatches.Count -eq 0 -or $entryJsMatches.Count -eq 0) {
    throw "dist/index.html must reference current index-*.css and index-*.js assets"
}
$entryAssets = @()
$entryAssets += $entryCssMatches | ForEach-Object { "dist/assets/$($_.Groups[1].Value)" }
$entryAssets += $entryJsMatches | ForEach-Object { "dist/assets/$($_.Groups[1].Value)" }
foreach ($entryAsset in $entryAssets) {
    $entryPath = Join-Path $Frontend ($entryAsset -replace '/', '\')
    if (-not (Test-Path -LiteralPath $entryPath)) {
        throw "dist/index.html references missing asset $entryAsset"
    }
}

$trackedAssets = git -C $Frontend ls-files "dist/assets/index-*.*" | Where-Object { $_ -match '\.(css|js)$' }
$cssAssets = @($trackedAssets | Where-Object { $_ -like "*.css" })
$jsAssets = @($trackedAssets | Where-Object { $_ -like "*.js" })
if ($cssAssets.Count -eq 0 -or $jsAssets.Count -eq 0) {
    throw "Expected tracked dist compatibility assets for both CSS and JS"
}

foreach ($extension in @("css", "js")) {
    $assets = @($trackedAssets | Where-Object { $_ -like "*.$extension" })
    $fullPaths = $assets | ForEach-Object { Join-Path $Frontend ($_ -replace '/', '\') }
    $entryAsset = [string]@($entryAssets | Where-Object { $_ -like "*.$extension" } | Select-Object -First 1)[0]
    if (-not $entryAsset) {
        throw "dist/index.html does not reference an index-*.$extension asset"
    }
    $entryPath = Join-Path $Frontend ($entryAsset -replace '/', '\')
    $trackedEntryAsset = @($trackedAssets | Where-Object { $_ -eq $entryAsset })
    if ($trackedEntryAsset.Count -eq 0) {
        $releaseWarnings.Add("Current dist entry asset $entryAsset is not tracked by git. Add the new build asset before release.")
    }
    $latestHash = (Get-FileHash -LiteralPath $entryPath -Algorithm SHA256).Hash
    foreach ($asset in $fullPaths) {
        $assetHash = (Get-FileHash -LiteralPath $asset -Algorithm SHA256).Hash
        if ($assetHash -ne $latestHash) {
            throw "Dist compatibility asset $asset does not match current entry $extension asset $entryAsset. Run npm run build or npm run sync-dist."
        }
    }
}

if ($RequireClean) {
    $status = git -C $Root status --short
    if ($status) {
        throw "Working tree is not clean after release verification:`n$status"
    }
}

foreach ($warning in $releaseWarnings) {
    Write-Warning $warning
}
Write-Host "Release checks passed for version $projectVersion."
