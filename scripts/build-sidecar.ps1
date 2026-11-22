$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

$python = Join-Path $root '.venv\Scripts\python.exe'
if (-not (Test-Path $python)) {
  throw "Python venv not found: $python. Create it and install sidecar/requirements-gpu.txt first."
}

Write-Output 'Building sidecar with PyInstaller...'
& $python -m PyInstaller --clean --noconfirm `
  --distpath (Join-Path $root 'sidecar-dist') `
  --workpath (Join-Path $root 'sidecar-build') `
  (Join-Path $root 'sidecar.spec')
if ($LASTEXITCODE -ne 0) {
  throw 'PyInstaller failed'
}

# CUDA DLLs are excluded from the PyInstaller analysis and copied explicitly.
$siteNvidia = Join-Path $root '.venv\Lib\site-packages\nvidia'
$destNvidia = Join-Path $root 'sidecar-dist\echo-sidecar\nvidia'
foreach ($component in @('cublas', 'cudnn', 'cuda_runtime', 'cuda_nvrtc')) {
  foreach ($sub in @('bin', 'lib')) {
    $source = Join-Path $siteNvidia "$component\$sub"
    if (Test-Path $source) {
      $target = Join-Path $destNvidia "$component\$sub"
      New-Item -ItemType Directory -Force -Path $target | Out-Null
      Copy-Item -Path (Join-Path $source '*') -Destination $target -Recurse -Force
      Write-Output "copied $component/$sub"
    }
  }
}

# Ship ffmpeg/ffprobe with the app so the installer is self-contained.
$binDir = Join-Path $root 'resources\bin'
New-Item -ItemType Directory -Force -Path $binDir | Out-Null
$ffmpeg = (Get-Command ffmpeg -ErrorAction Stop).Source
$ffprobe = (Get-Command ffprobe -ErrorAction Stop).Source
Copy-Item -LiteralPath $ffmpeg -Destination (Join-Path $binDir 'ffmpeg.exe') -Force
Copy-Item -LiteralPath $ffprobe -Destination (Join-Path $binDir 'ffprobe.exe') -Force
Write-Output "copied ffmpeg/ffprobe to resources\bin"

$exe = Join-Path $root 'sidecar-dist\echo-sidecar\echo-sidecar.exe'
if (-not (Test-Path $exe)) {
  throw "Sidecar executable not found: $exe"
}

$size = [math]::Round((Get-ChildItem (Join-Path $root 'sidecar-dist') -Recurse -File |
  Measure-Object Length -Sum).Sum / 1GB, 2)
Write-Output "sidecar build complete (approx $size GB)"
