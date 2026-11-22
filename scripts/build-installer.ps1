$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

$sidecarExe = Join-Path $root 'sidecar-dist\echo-sidecar\echo-sidecar.exe'
if (-not (Test-Path $sidecarExe)) {
  Write-Output 'Sidecar bundle missing; building it first...'
  & (Join-Path $PSScriptRoot 'build-sidecar.ps1')
}

Write-Output 'Building Electron renderer/main...'
npm run build
if ($LASTEXITCODE -ne 0) {
  throw 'electron-vite build failed'
}

if (-not $env:ELECTRON_BUILDER_BINARIES_MIRROR) {
  $env:ELECTRON_BUILDER_BINARIES_MIRROR = 'https://npmmirror.com/mirrors/electron-builder-binaries/'
}

Write-Output 'Building NSIS installer...'
npx electron-builder --win nsis
if ($LASTEXITCODE -ne 0) {
  throw 'electron-builder failed'
}

Write-Output 'Installer written to release/'
