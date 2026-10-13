# GreMi Gang clip uploader
#
# Watches the folder where OBS saves your clips and sends every new clip to the
# private gremigaming/clip-studio repo (as a file on its "inbox" release). Every
# night Claude picks up new clips there, scores them and edits the best ones, so
# nothing depends on the laptop being on.
#
# First run asks for the clips folder and a GitHub token. Both are stored in
# %APPDATA%\GreMiClipUploader, the token encrypted for this Windows account only.
# Clips already in the folder on the first run are skipped; only new ones go up.

$ErrorActionPreference = "Stop"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$Repo = "gremigaming/clip-studio"
$Api = "https://api.github.com/repos/$Repo"
$Tag = "inbox"
$ConfigDir = Join-Path $env:APPDATA "GreMiClipUploader"
$ConfigFile = Join-Path $ConfigDir "config.json"
$DoneFile = Join-Path $ConfigDir "uploaded.txt"
$CheckEverySeconds = 30
$Extensions = @(".mp4", ".mkv", ".mov")

function Say($text, $color = "Gray") {
    Write-Host ("[{0}] {1}" -f (Get-Date -Format "HH:mm:ss"), $text) -ForegroundColor $color
}

# ------------------------------------------------------------------ settings

function Pick-ClipsFolder {
    Say "Pick the folder where OBS saves your clips." Yellow
    Add-Type -AssemblyName System.Windows.Forms
    $dialog = New-Object System.Windows.Forms.FolderBrowserDialog
    $dialog.Description = "Pick the folder where OBS saves your vertical clips (OBS Clips)"
    if ($dialog.ShowDialog() -ne "OK") { throw "No folder picked." }
    return $dialog.SelectedPath
}

function Get-Settings {
    if (Test-Path $ConfigFile) {
        $c = Get-Content $ConfigFile -Raw | ConvertFrom-Json
        $secure = $c.token | ConvertTo-SecureString
        $token = [Runtime.InteropServices.Marshal]::PtrToStringAuto(
            [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure))
        return @{ ClipsDir = $c.clipsDir; Token = $token }
    }
    New-Item -ItemType Directory -Force -Path $ConfigDir | Out-Null
    $clipsDir = Pick-ClipsFolder
    Say "Clips folder: $clipsDir" Green
    Write-Host ""
    Write-Host "Paste your GitHub token for clip-studio (it starts with github_pat_) and press Enter."
    Write-Host "Right-click pastes in this window. The token stays on this PC, encrypted."
    $secure = Read-Host "Token" -AsSecureString
    $token = [Runtime.InteropServices.Marshal]::PtrToStringAuto(
        [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure))
    $token = $token.Trim()
    Test-Token $token
    @{ clipsDir = $clipsDir; token = ($secure | ConvertFrom-SecureString) } |
        ConvertTo-Json | Set-Content $ConfigFile
    # Clips that are already there were handled before; only send new ones
    Get-Clips $clipsDir | ForEach-Object { Add-Content -Path $DoneFile -Value $_.Name }
    Add-Autostart
    return @{ ClipsDir = $clipsDir; Token = $token }
}

function Test-Token($token) {
    try {
        $r = Invoke-RestMethod -Uri $Api -Headers (Headers $token)
    } catch {
        throw "GitHub didn't accept that token. Run the uploader again and paste a new one."
    }
    if (-not $r.permissions.push) {
        throw "The token can read clip-studio but can't upload. Give it Contents: Read and write."
    }
    Say "Token works." Green
}

function Add-Autostart {
    $answer = Read-Host "Start the clip uploader automatically when Windows starts? (Y/N)"
    if ($answer -notmatch '^[Yy]') { return }
    $startup = [Environment]::GetFolderPath("Startup")
    $bat = Join-Path $startup "GreMi Clip Uploader.bat"
    $line = 'start "GreMi Clip Uploader" /min powershell -NoProfile -ExecutionPolicy Bypass -File "{0}"' -f $PSCommandPath
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
        "User-Agent"           = "GreMi-Clip-Uploader"
        "X-GitHub-Api-Version" = "2022-11-28"
    }
}

function Get-Clips($dir) {
    Get-ChildItem -Path $dir -File -Recurse -ErrorAction SilentlyContinue |
        Where-Object { $Extensions -contains $_.Extension.ToLower() } |
        Sort-Object LastWriteTime
}

function Get-InboxRelease($token) {
    try {
        return Invoke-RestMethod -Uri "$Api/releases/tags/$Tag" -Headers (Headers $token)
    } catch {
        if ((StatusOf $_) -ne 404) { throw }
    }
    $body = @{ tag_name = $Tag; name = "Clip inbox"; prerelease = $true
               body = "New OBS clips from the racing PC, waiting to be edited." } | ConvertTo-Json
    return Invoke-RestMethod -Method Post -Uri "$Api/releases" -Headers (Headers $token) -Body $body -ContentType "application/json"
}

function Send-Clip($file, $release, $token) {
    $name = ($file.Name -replace '[^A-Za-z0-9._-]', '_')
    $url = "https://uploads.github.com/repos/$Repo/releases/$($release.id)/assets?name=" + [Uri]::EscapeDataString($name)
    $type = if ($file.Extension -eq ".mkv") { "video/x-matroska" } elseif ($file.Extension -eq ".mov") { "video/quicktime" } else { "video/mp4" }
    try {
        Invoke-RestMethod -Method Post -Uri $url -Headers (Headers $token) -InFile $file.FullName -ContentType $type -TimeoutSec 1800 | Out-Null
        return "uploaded"
    } catch {
        if ((StatusOf $_) -eq 422) { return "already there" }
        throw
    }
}

function Is-Finished($file) {
    # OBS (or the Proton Drive sync) may still be writing it
    if ($file.LastWriteTime -gt (Get-Date).AddSeconds(-30)) { return $false }
    try {
        $stream = [IO.File]::Open($file.FullName, "Open", "Read", "None")
        $stream.Close()
        return $true
    } catch {
        return $false
    }
}

# ------------------------------------------------------------------ main

$Host.UI.RawUI.WindowTitle = "GreMi Clip Uploader"
Write-Host "GreMi Clip Uploader. Leave this window open (minimised is fine)." -ForegroundColor Cyan
$settings = Get-Settings
$done = New-Object System.Collections.Generic.HashSet[string]
if (Test-Path $DoneFile) { Get-Content $DoneFile | ForEach-Object { [void]$done.Add($_) } }
Say "Watching $($settings.ClipsDir)" Cyan
Say "New clips get scored and edited overnight; the best ones land in your TikTok drafts in the morning."
$release = $null

while ($true) {
    $files = Get-Clips $settings.ClipsDir | Where-Object { -not $done.Contains($_.Name) }
    foreach ($file in $files) {
        if (-not (Is-Finished $file)) { continue }
        try {
            if ($null -eq $release) { $release = Get-InboxRelease $settings.Token }
            Say "$($file.Name): uploading ($([math]::Round($file.Length / 1MB)) MB)..."
            $result = Send-Clip $file $release $settings.Token
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
