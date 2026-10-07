# GreMi Gang race uploader
#
# Watches the Pits n' Giggles save folder (data\<date>\race-info\) and sends
# every new save to gremigaming/race-stats on GitHub. The site rebuilds itself
# a few minutes after each upload.
#
# First run asks for the save folder (found automatically when possible) and a
# GitHub token. Both are stored in %APPDATA%\GreMiRaceUploader, the token
# encrypted for this Windows account only.

$ErrorActionPreference = "Stop"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$Repo = "gremigaming/race-stats"
$Api = "https://api.github.com/repos/$Repo"
$ConfigDir = Join-Path $env:APPDATA "GreMiRaceUploader"
$ConfigFile = Join-Path $ConfigDir "config.json"
$DoneFile = Join-Path $ConfigDir "uploaded.txt"
$CheckEverySeconds = 20

function Say($text, $color = "Gray") {
    Write-Host ("[{0}] {1}" -f (Get-Date -Format "HH:mm:ss"), $text) -ForegroundColor $color
}

# ------------------------------------------------------------------ settings

function Find-DataFolder {
    Say "Looking for the Pits n' Giggles save folder..."
    $roots = @($env:USERPROFILE, $env:LOCALAPPDATA, ${env:ProgramFiles}, ${env:ProgramFiles(x86)}) |
        Where-Object { $_ -and (Test-Path $_) }
    $found = foreach ($root in $roots) {
        Get-ChildItem -Path $root -Directory -Recurse -Depth 7 -Filter "race-info" -ErrorAction SilentlyContinue |
            Where-Object { $_.Parent.Name -match '^\d{4}_\d{2}_\d{2}$' -and $_.Parent.Parent.Name -eq "data" } |
            ForEach-Object { $_.Parent.Parent.FullName }
    }
    $found = @($found | Sort-Object -Unique)
    if ($found.Count -eq 1) { return $found[0] }
    if ($found.Count -gt 1) {
        Write-Host ""
        for ($i = 0; $i -lt $found.Count; $i++) { Write-Host ("  {0}) {1}" -f ($i + 1), $found[$i]) }
        $pick = Read-Host "Several save folders found. Type the number of the one to use"
        return $found[[int]$pick - 1]
    }
    Say "Couldn't find it by myself. Pick the 'data' folder next to Pits n' Giggles." Yellow
    Add-Type -AssemblyName System.Windows.Forms
    $dialog = New-Object System.Windows.Forms.FolderBrowserDialog
    $dialog.Description = "Pick the Pits n' Giggles 'data' folder (it holds folders like 2026_09_30)"
    if ($dialog.ShowDialog() -ne "OK") { throw "No folder picked." }
    return $dialog.SelectedPath
}

function Get-Settings {
    if (Test-Path $ConfigFile) {
        $c = Get-Content $ConfigFile -Raw | ConvertFrom-Json
        $secure = $c.token | ConvertTo-SecureString
        $token = [Runtime.InteropServices.Marshal]::PtrToStringAuto(
            [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure))
        return @{ DataDir = $c.dataDir; Token = $token }
    }
    New-Item -ItemType Directory -Force -Path $ConfigDir | Out-Null
    $dataDir = Find-DataFolder
    Say "Save folder: $dataDir" Green
    Write-Host ""
    Write-Host "Paste your GitHub token (it starts with github_pat_) and press Enter."
    Write-Host "Right-click pastes in this window. The token stays on this PC, encrypted."
    $secure = Read-Host "Token" -AsSecureString
    $token = [Runtime.InteropServices.Marshal]::PtrToStringAuto(
        [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure))
    $token = $token.Trim()
    Test-Token $token
    @{ dataDir = $dataDir; token = ($secure | ConvertFrom-SecureString) } |
        ConvertTo-Json | Set-Content $ConfigFile
    Add-Autostart
    return @{ DataDir = $dataDir; Token = $token }
}

function Test-Token($token) {
    try {
        $r = Invoke-RestMethod -Uri $Api -Headers (Headers $token)
    } catch {
        throw "GitHub didn't accept that token. Run the uploader again and paste a new one."
    }
    if (-not $r.permissions.push) {
        throw "The token can read race-stats but can't upload. Give it Contents: Read and write."
    }
    Say "Token works." Green
}

function Add-Autostart {
    $answer = Read-Host "Start the uploader automatically when Windows starts? (Y/N)"
    if ($answer -notmatch '^[Yy]') { return }
    $startup = [Environment]::GetFolderPath("Startup")
    $bat = Join-Path $startup "GreMi Race Uploader.bat"
    $line = 'start "GreMi Race Uploader" /min powershell -NoProfile -ExecutionPolicy Bypass -File "{0}"' -f $PSCommandPath
    Set-Content -Path $bat -Value $line -Encoding ASCII
    Say "Added to Windows startup." Green
}

# ------------------------------------------------------------------ uploading

function StatusOf($err) {
    $code = $err.Exception.Response.StatusCode
    if ($null -eq $code) { return 0 }
    return [int]$code
}

function Headers($token) {
    @{
        Authorization          = "Bearer $token"
        Accept                 = "application/vnd.github+json"
        "User-Agent"           = "GreMi-Race-Uploader"
        "X-GitHub-Api-Version" = "2022-11-28"
    }
}

function Send-Race($file, $token) {
    $day = $file.Directory.Parent.Name
    $path = "races/$day/" + [Uri]::EscapeDataString($file.Name)
    $url = "$Api/contents/$path"
    try {
        Invoke-RestMethod -Uri ("{0}?ref=main" -f $url) -Headers (Headers $token) | Out-Null
        return "already there"
    } catch {
        if ((StatusOf $_) -ne 404) { throw }
    }
    $body = @{
        message = "race: $($file.Name)"
        content = [Convert]::ToBase64String([IO.File]::ReadAllBytes($file.FullName))
        branch  = "main"
    } | ConvertTo-Json
    Invoke-RestMethod -Method Put -Uri $url -Headers (Headers $token) -Body $body -ContentType "application/json" | Out-Null
    return "uploaded"
}

# ------------------------------------------------------------------ main

$Host.UI.RawUI.WindowTitle = "GreMi Race Uploader"
Write-Host "GreMi Race Uploader. Leave this window open (minimised is fine)." -ForegroundColor Cyan
$settings = Get-Settings
$done = New-Object System.Collections.Generic.HashSet[string]
if (Test-Path $DoneFile) { Get-Content $DoneFile | ForEach-Object { [void]$done.Add($_) } }
Say "Watching $($settings.DataDir)" Cyan
Say "New races go to https://gremigaming.github.io/race-stats/ a few minutes after they're saved."

while ($true) {
    $files = Get-ChildItem -Path $settings.DataDir -Recurse -Filter "*.json" -ErrorAction SilentlyContinue |
        Where-Object { $_.Directory.Name -eq "race-info" -and -not $done.Contains($_.Name) } |
        Sort-Object LastWriteTime
    foreach ($file in $files) {
        # Pits n' Giggles may still be writing it
        if ($file.LastWriteTime -gt (Get-Date).AddSeconds(-15)) { continue }
        try {
            $result = Send-Race $file $settings.Token
            [void]$done.Add($file.Name)
            Add-Content -Path $DoneFile -Value $file.Name
            Say "$($file.Name): $result" Green
        } catch {
            if ((StatusOf $_) -eq 401) {
                Say "GitHub refused the token (expired?). Delete $ConfigFile and start the uploader again." Red
            } else {
                Say "$($file.Name): upload failed, trying again soon ($($_.Exception.Message))" Yellow
            }
        }
    }
    Start-Sleep -Seconds $CheckEverySeconds
}
