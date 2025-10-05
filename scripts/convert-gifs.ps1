<#
Convert all GIF story scene assets to optimized MP4 (H.264) and WebM (VP9) loops.

Goals:
  * Preserve / improve perceived quality versus original GIF (GIFs are limited to 256 colors).
  * Great compression, web‑friendly playback (hardware decode, streaming, smaller payload).
  * Flexible quality profiles and optional quality analysis (SSIM / PSNR proxy) for assurance.

Requirements:
  * ffmpeg + ffprobe. If not present in PATH, this script will attempt to auto-download a Windows build
    (essentials zip) into ./tools/ffmpeg and use that locally.

Usage examples (from repo root or scripts folder):
  # Auto FPS (uses source), high quality, keep original width if < MaxWidth
  ./convert-gifs.ps1 -Source "../client/src/assets/sun and moon assets" -QualityProfile high

  # Ultra profile, force overwrite, analyze quality, cap width to 1280
  ./convert-gifs.ps1 -Source "../client/src/assets/sun and moon assets" -QualityProfile ultra -MaxWidth 1280 -Analyze -Force

Parameters overview:
  -QualityProfile   : ultra | high | balanced | speed (sets CRF + preset defaults)
  -CrfH264 / -CrfVp9: Override CRF manually (optional; profile sets default)
  -Fps              : Target FPS (0 = keep original timing)
  -MaxWidth         : Downscale only if source width is larger (0 = keep original width)
  -Analyze          : After encode, compute SSIM/PSNR style metrics (slower)
  -NoMp4 / -NoVp9   : Skip a format
  -Force            : Overwrite existing outputs

Quality profiles mapping (approximate):
  ultra    -> H.264 CRF 16 (preset slow), VP9 CRF 24 two‑pass
  high     -> H.264 CRF 18 (preset slow), VP9 CRF 28 two‑pass
  balanced -> H.264 CRF 20 (preset medium), VP9 CRF 30 single‑pass
  speed    -> H.264 CRF 23 (preset veryfast), VP9 CRF 34 single‑pass

NOTE: VP9 two‑pass is slower but yields smaller files @ quality. Only used for high/ultra.
#>
param(
  [Parameter(Mandatory=$true)][string]$Source,
  [string]$Out = $Source,
  [ValidateSet('ultra','high','balanced','speed')][string]$QualityProfile = 'balanced',
  [switch]$Force,
  [int]$CrfH264 = -1,
  [int]$CrfVp9 = -1,
  [int]$Fps = 0,
  [int]$MaxWidth = 960,
  [switch]$Analyze,
  [switch]$NoMp4,
  [switch]$NoVp9
)

function Resolve-FFmpeg {
  param([switch]$RequireProbe)
  $global:FFMPEG_CMD = 'ffmpeg'
  $global:FFPROBE_CMD = 'ffprobe'

  $haveFfmpeg = Get-Command ffmpeg -ErrorAction SilentlyContinue
  $haveFfprobe = Get-Command ffprobe -ErrorAction SilentlyContinue
  if ($haveFfmpeg -and ($haveFfprobe -or -not $RequireProbe)) { return }

  # Try local tools path
  $localDir = Join-Path (Resolve-Path .).Path 'tools/ffmpeg'
  $binDir = Join-Path $localDir 'bin'
  $localExe = Join-Path $binDir 'ffmpeg.exe'
  $localProbe = Join-Path $binDir 'ffprobe.exe'
  if (Test-Path $localExe -and ((-not $RequireProbe) -or (Test-Path $localProbe))) {
    $env:PATH = "$binDir;$env:PATH"
    $global:FFMPEG_CMD = $localExe
    $global:FFPROBE_CMD = $localProbe
    return
  }

  Write-Host "ffmpeg/ffprobe not found. Attempting auto-download..." -ForegroundColor Yellow
  try {
    if (-not (Test-Path $localDir)) { New-Item -ItemType Directory -Path $localDir | Out-Null }
    $zipUrl = 'https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip'
    $zipPath = Join-Path $localDir 'ffmpeg.zip'
    Write-Host "Downloading $zipUrl" -ForegroundColor Yellow
    Invoke-WebRequest -Uri $zipUrl -OutFile $zipPath -UseBasicParsing
    Write-Host "Expanding archive..." -ForegroundColor Yellow
    Expand-Archive -Path $zipPath -DestinationPath $localDir -Force
    Remove-Item $zipPath -Force
    # Find ffmpeg.exe inside extracted structure
    $foundExe = Get-ChildItem -Path $localDir -Filter ffmpeg.exe -Recurse | Select-Object -First 1
    $foundProbe = Get-ChildItem -Path $localDir -Filter ffprobe.exe -Recurse | Select-Object -First 1
    if ($foundExe) {
      $bin = Split-Path -Parent $foundExe.FullName
      $env:PATH = "$bin;$env:PATH"
      $global:FFMPEG_CMD = $foundExe.FullName
      if ($foundProbe) { $global:FFPROBE_CMD = $foundProbe.FullName }
      Write-Host "ffmpeg resolved at $($foundExe.FullName)" -ForegroundColor Green
    } else {
      Write-Error "Auto-download succeeded but ffmpeg.exe not found in extracted files."; exit 1
    }
  } catch {
    Write-Error "Failed to auto-download ffmpeg: $_"; exit 1
  }
}

Resolve-FFmpeg -RequireProbe
if (-not (Get-Command $FFMPEG_CMD -ErrorAction SilentlyContinue)) { Write-Error "ffmpeg still not available."; exit 1 }
if (-not (Get-Command $FFPROBE_CMD -ErrorAction SilentlyContinue)) { Write-Error "ffprobe still not available."; exit 1 }

if (-not (Test-Path $Source)) { Write-Error "Source path not found: $Source"; exit 1 }
if (-not (Test-Path $Out)) { New-Item -ItemType Directory -Path $Out | Out-Null }

# Apply quality profile defaults unless overridden.
switch ($QualityProfile) {
  'ultra'    { if ($CrfH264 -lt 0) { $CrfH264 = 16 }; if ($CrfVp9 -lt 0) { $CrfVp9 = 24 }; $h264Preset = 'slow';  $vp9TwoPass = $true }
  'high'     { if ($CrfH264 -lt 0) { $CrfH264 = 18 }; if ($CrfVp9 -lt 0) { $CrfVp9 = 28 }; $h264Preset = 'slow';  $vp9TwoPass = $true }
  'balanced' { if ($CrfH264 -lt 0) { $CrfH264 = 20 }; if ($CrfVp9 -lt 0) { $CrfVp9 = 30 }; $h264Preset = 'medium';$vp9TwoPass = $false }
  'speed'    { if ($CrfH264 -lt 0) { $CrfH264 = 23 }; if ($CrfVp9 -lt 0) { $CrfVp9 = 34 }; $h264Preset = 'veryfast';$vp9TwoPass = $false }
}

Write-Host "Profile: $QualityProfile (H.264 CRF $CrfH264 preset $h264Preset, VP9 CRF $CrfVp9 two-pass=$vp9TwoPass)" -ForegroundColor Cyan

$gifs = Get-ChildItem -Path $Source -Filter *.gif -File -Recurse
if (-not $gifs) { Write-Host "No GIF files found in $Source"; exit 0 }

$report = @()

foreach ($g in $gifs) {
  $base = [IO.Path]::GetFileNameWithoutExtension($g.Name).Replace(' ','_')
  $mp4 = Join-Path $Out "$base.mp4"
  $webm = Join-Path $Out "$base.webm"

  # Detect source width + fps if needed.
  $probeJson = & $FFPROBE_CMD -v error -select_streams v:0 -show_streams -of json $g.FullName | ConvertFrom-Json
  $stream = $probeJson.streams | Where-Object { $_.codec_type -eq 'video' } | Select-Object -First 1
  $srcW = [int]$stream.width
  $avgFrameRate = $stream.avg_frame_rate
  $srcFps = 0
  if ($avgFrameRate -and $avgFrameRate -ne '0/0') {
    $parts = $avgFrameRate -split '/'
    if ($parts.Length -eq 2 -and [int]$parts[1] -ne 0) { $srcFps = [math]::Round([double]$parts[0]/[double]$parts[1]) }
  }
  if ($srcFps -le 0) { $srcFps = 30 }
  $targetFps = if ($Fps -gt 0) { [math]::Min($Fps,$srcFps) } else { $srcFps }

  # Decide scaling expression. If MaxWidth == 0 keep original. If original <= MaxWidth keep original.
  if ($MaxWidth -le 0 -or $srcW -le $MaxWidth) {
    $scaleExpr = "fps=$targetFps,format=rgba"  # no scale
  } else {
    $scaleExpr = "fps=$targetFps,scale='min($MaxWidth,iw)':-2:flags=lanczos,format=rgba"
  }

  # H.264 encode
  if (-not $NoMp4) {
    if ((Test-Path $mp4) -and -not $Force) {
      Write-Host "[Skip] $mp4 exists" -ForegroundColor DarkYellow
    } else {
      Write-Host "[MP4]  $($g.Name) -> $mp4 (fps $targetFps, scaleExpr=$($scaleExpr))" -ForegroundColor Cyan
  & $FFMPEG_CMD -v error -y -i $g.FullName -vf $scaleExpr -an -c:v libx264 -profile:v high -pix_fmt yuv420p -crf $CrfH264 -preset $h264Preset -movflags +faststart $mp4
    }
  }

  # VP9 encode
  if (-not $NoVp9) {
    if ((Test-Path $webm) -and -not $Force) {
      Write-Host "[Skip] $webm exists" -ForegroundColor DarkYellow
    } else {
      Write-Host "[VP9]  $($g.Name) -> $webm (fps $targetFps, two-pass=$vp9TwoPass)" -ForegroundColor Green
      if ($vp9TwoPass) {
  $null = & $FFMPEG_CMD -v error -y -i $g.FullName -vf $scaleExpr -an -c:v libvpx-vp9 -b:v 0 -crf $CrfVp9 -pass 1 -row-mt 1 -speed 4 -f webm NUL
  & $FFMPEG_CMD -v error -y -i $g.FullName -vf $scaleExpr -an -c:v libvpx-vp9 -b:v 0 -crf $CrfVp9 -pass 2 -row-mt 1 -speed 1 $webm
        Remove-Item -ErrorAction SilentlyContinue .\ffmpeg2pass-0.log
      } else {
  & $FFMPEG_CMD -v error -y -i $g.FullName -vf $scaleExpr -an -c:v libvpx-vp9 -b:v 0 -crf $CrfVp9 -row-mt 1 -cpu-used 2 $webm
      }
    }
  }

  $origSize = (Get-Item $g.FullName).Length
  # PowerShell 5.1 compatibility: no ternary operator
  if (Test-Path $mp4) { $mp4Size = (Get-Item $mp4).Length } else { $mp4Size = 0 }
  if (Test-Path $webm) { $webmSize = (Get-Item $webm).Length } else { $webmSize = 0 }

  $qualityNote = ''
  if ($Analyze -and (Test-Path $mp4)) {
    # Compute SSIM vs original (rough – frame timing differences may affect metric).
  $ssimOutput = & $FFMPEG_CMD -v error -i $mp4 -i $g.FullName -lavfi "[0:v]format=yuv420p[mp4];[1:v]format=yuv420p[gif];[mp4][gif]ssim" -f null - 2>&1
    if ($ssimOutput -match 'All:\s*([0-9\.]+)') { $qualityNote = "SSIM=$($Matches[1])" }
  }

  $report += [PSCustomObject]@{
    File = $g.Name
    SrcKB = [math]::Round($origSize/1kb,1)
    Mp4KB = if ($mp4Size -gt 0) { [math]::Round($mp4Size/1kb,1) } else { 0 }
    WebmKB = if ($webmSize -gt 0) { [math]::Round($webmSize/1kb,1) } else { 0 }
    FPS = $targetFps
    Quality = $qualityNote
  }
}

Write-Host "\nConversion complete." -ForegroundColor Cyan
if ($report) {
  Write-Host "Summary (KB):" -ForegroundColor Magenta
  $report | Sort-Object SrcKB -Descending | Format-Table -AutoSize | Out-String | Write-Host
  $totalSrc = ($report | Measure-Object -Property SrcKB -Sum).Sum
  $totalMp4 = ($report | Measure-Object -Property Mp4KB -Sum).Sum
  $totalWebm = ($report | Measure-Object -Property WebmKB -Sum).Sum
  Write-Host ("Total Source: {0} KB | MP4: {1} KB | WebM: {2} KB | Reduction MP4={3:P1} WebM={4:P1}" -f $totalSrc,$totalMp4,$totalWebm, (1-($totalMp4/$totalSrc)), (1-($totalWebm/$totalSrc))) -ForegroundColor DarkCyan
}

Write-Host "Next steps:" -ForegroundColor Cyan
Write-Host "  1. Replace <img src=...gif> with <LoopingVideo mp4=... webm=...>." -ForegroundColor Gray
Write-Host "  2. Remove legacy GIF imports to prevent bundling heavy assets." -ForegroundColor Gray
Write-Host "  3. Rebuild and measure Lighthouse (expect large savings)." -ForegroundColor Gray
