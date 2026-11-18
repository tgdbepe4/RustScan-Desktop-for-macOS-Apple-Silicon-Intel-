$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$env:Path = "$env:USERPROFILE\.cargo\bin;$env:Path"

$vsdev = "C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\Common7\Tools\VsDevCmd.bat"
if (Test-Path -LiteralPath $vsdev) {
    $lines = & cmd /c "`"$vsdev`" -arch=x64 >nul && set"
    foreach ($line in $lines) {
        if ($line -match '^([^=]+)=(.*)$') {
            [Environment]::SetEnvironmentVariable($matches[1], $matches[2], 'Process')
        }
    }
}

Push-Location $root
try {
    cargo build --release -j 2 --manifest-path src-tauri\Cargo.toml
    if ($LASTEXITCODE -ne 0) { throw "cargo build failed with exit code $LASTEXITCODE" }

    $exe = Join-Path $root "src-tauri\target\release\rustscan-neon.exe"
    if (-not (Test-Path -LiteralPath $exe)) { throw "release exe not found: $exe" }

    $outDir = Join-Path $root "dist\RustScanNeon"
    New-Item -ItemType Directory -Force -Path $outDir | Out-Null
    Copy-Item -LiteralPath $exe -Destination (Join-Path $outDir "RustScanNeon.exe") -Force
    Copy-Item -LiteralPath (Join-Path $root "README.md") -Destination $outDir -Force
    Copy-Item -LiteralPath (Join-Path $root "engine\LICENSE") -Destination (Join-Path $outDir "LICENSE-RustScan.txt") -Force
    Copy-Item -LiteralPath (Join-Path $root "ui\assets\fonts\LICENSES.md") -Destination (Join-Path $outDir "LICENSE-FONTS.md") -Force

    $zip = Join-Path $root "dist\rustscan-neon-2.4.1-win64.zip"
    if (Test-Path -LiteralPath $zip) { Remove-Item -LiteralPath $zip -Force }
    Compress-Archive -Path (Join-Path $outDir "*") -DestinationPath $zip -CompressionLevel Optimal

    $size = [math]::Round((Get-Item -LiteralPath (Join-Path $outDir "RustScanNeon.exe")).Length / 1MB, 2)
    Write-Output "BUILD OK"
    Write-Output "exe : $outDir\RustScanNeon.exe ($size MB)"
    Write-Output "zip : $zip"
} finally {
    Pop-Location
}
