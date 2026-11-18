$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$exe = Join-Path $root "dist\RustScanNeon\RustScanNeon.exe"
if (Test-Path -LiteralPath $exe) {
    Start-Process -FilePath $exe -WorkingDirectory (Split-Path -Parent $exe)
    exit 0
}
$env:Path = "$env:USERPROFILE\.cargo\bin;$env:Path"
Push-Location $root
try {
    cargo run --manifest-path src-tauri\Cargo.toml
} finally {
    Pop-Location
}
