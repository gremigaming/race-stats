@echo off
rem Pits n' Giggles with the brake helper overlay.
rem Put this file in the SAME folder as your normal Pits n' Giggles exe (where png_config.json is),
rem so the modified build uses your existing settings. Close normal Pits n' Giggles first.
rem Each start checks for a newer build and downloads it (about 100 MB, only when it changed).
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$ErrorActionPreference='Stop';" ^
  "$base='https://github.com/gremigaming/race-stats/releases/download/brake-helper';" ^
  "try {" ^
  "  $remote=(Invoke-WebRequest -UseBasicParsing \"$base/version.txt\").Content.Trim();" ^
  "  $local=''; if (Test-Path 'brake-helper-version.txt') { $local=(Get-Content 'brake-helper-version.txt' -Raw).Trim() };" ^
  "  if ($remote -ne $local -or -not (Test-Path 'PitsNGiggles-BrakeHelper.exe')) {" ^
  "    Write-Host 'Downloading the latest brake helper build...';" ^
  "    Invoke-WebRequest -UseBasicParsing \"$base/PitsNGiggles-BrakeHelper.exe\" -OutFile 'PitsNGiggles-BrakeHelper.exe.part';" ^
  "    Move-Item -Force 'PitsNGiggles-BrakeHelper.exe.part' 'PitsNGiggles-BrakeHelper.exe';" ^
  "    Set-Content 'brake-helper-version.txt' $remote;" ^
  "    Unblock-File 'PitsNGiggles-BrakeHelper.exe' } else { Write-Host 'Brake helper build is up to date.' }" ^
  "} catch { Write-Host ('Could not check for updates: ' + $_.Exception.Message) }"
if not exist "png_config.json" echo Note: no png_config.json here, so Pits n' Giggles starts with default settings. Move this file next to your normal Pits n' Giggles exe to keep your settings.
if not exist "PitsNGiggles-BrakeHelper.exe" (
  echo The brake helper build could not be downloaded. Check your internet connection and try again.
  pause
  exit /b 1
)
if "%~1"=="--no-start" exit /b 0
start "" "PitsNGiggles-BrakeHelper.exe"
