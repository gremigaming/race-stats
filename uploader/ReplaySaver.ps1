# GreMi Gang replay saver. DRAFT, NOT WIRED INTO RaceUploader.ps1 YET (14 Nov 2026).
# Online lobbies skipped the results table in the first test (XP page and awards
# on a timer, then the lobby), so the online route to "Save Full Race Replay" still
# has to be found before this is started after each race.
#
# Saves the full race replay from the results screen, so the replays can later be
# opened in Theatre for clean TV-camera shots (thumbnails, highlight replays).
# Found in a test race on 14 Nov 2026: on "RESULTS (OVERALL)" Enter opens a menu
# (Advance / Save Full Race Replay / View Replay / Race Director) with Advance
# highlighted; Down + Enter saves in ~2 s and shows "FULL RACE REPLAY SAVED" with
# an Okay button. The file appears in Documents\My Games\F1 25\replays (.frr).
#
# The game has to be in front to take key presses, so the saver reads the game's
# picture first (PrintWindow, no focus change) and only brings the game forward
# when the results screen is up: about 3 s, then the window that was in front
# gets its focus back. Every key press is checked with Windows' own OCR first,
# because one Enter too many on "Advance" leaves the results screen.
#
# Test without the game: -ImagePath shot.png reads that picture and prints what it
# would do. -DryRun reads the real game but presses nothing (pictures kept in -KeepDir).
# Needs Windows PowerShell 5.1 (Windows' OCR is not reachable from PowerShell 7).

param(
    [string]$Recording = "",                              # telemetry file name of this race
    [string]$ReplaysDir = "",                             # "" = Documents\My Games\F1 25\replays
    [string]$KeepDir = "",                                # pictures of what the saver saw (for checking)
    [string]$LogFile = "",                                # one JSON line per saved replay
    [int]$StartDelay = 15,                                # s after the results packet (standings reader goes first)
    [int]$Seconds = 300,                                  # give up after this long
    [int]$Every = 3,                                      # s between looks at the game
    [int]$MaxPeeks = 10,                                  # focus peeks when the game can't be read in the background
    [string]$GameProcess = '^F1_?\d\d',
    [string]$ImagePath = "",
    [switch]$DryRun
)

$ErrorActionPreference = "Stop"
if (-not $ReplaysDir) { $ReplaysDir = Join-Path ([Environment]::GetFolderPath("MyDocuments")) "My Games\F1 25\replays" }

Add-Type -AssemblyName System.Drawing
if (-not ("GmSaver" -as [type])) {
    Add-Type -ReferencedAssemblies System.Drawing @"
using System; using System.Drawing; using System.Runtime.InteropServices; using System.Threading;
public static class GmSaver {
    [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr h);
    [DllImport("user32.dll")] static extern bool BringWindowToTop(IntPtr h);
    [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr h, int cmd);
    [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
    [DllImport("user32.dll")] static extern bool IsWindow(IntPtr h);
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
    [DllImport("kernel32.dll")] static extern uint GetCurrentThreadId();
    [DllImport("user32.dll")] static extern bool AttachThreadInput(uint a, uint b, bool attach);
    [DllImport("user32.dll")] static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);
    [DllImport("user32.dll")] static extern bool GetClientRect(IntPtr h, out RECT r);
    [DllImport("user32.dll")] static extern bool ClientToScreen(IntPtr h, ref POINT p);
    [DllImport("user32.dll")] static extern bool PrintWindow(IntPtr h, IntPtr hdc, uint flags);
    [DllImport("user32.dll")] static extern uint SendInput(uint n, byte[] inputs, int size);
    [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }
    [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X, Y; }

    public static bool Focus(IntPtr h) {
        if (GetForegroundWindow() == h) return true;
        uint pid;
        uint fgThread = GetWindowThreadProcessId(GetForegroundWindow(), out pid);
        uint me = GetCurrentThreadId();
        bool attached = fgThread != 0 && fgThread != me && AttachThreadInput(me, fgThread, true);
        try {
            if (IsIconic(h)) ShowWindow(h, 9);
            SetForegroundWindow(h); BringWindowToTop(h);
            if (GetForegroundWindow() != h) {
                // Windows only lets the app that had the last input take the focus: a tap of Alt counts
                keybd_event(0x12, 0, 0, UIntPtr.Zero); keybd_event(0x12, 0, 2, UIntPtr.Zero);
                SetForegroundWindow(h); BringWindowToTop(h);
            }
        } finally { if (attached) AttachThreadInput(me, fgThread, false); }
        for (int i = 0; i < 20 && GetForegroundWindow() != h; i++) Thread.Sleep(25);
        return GetForegroundWindow() == h;
    }

    public static void Restore(IntPtr h) {
        if (h == IntPtr.Zero || !IsWindow(h) || GetForegroundWindow() == h) return;
        Focus(h);
    }

    // One key as a hardware scan code (games read scan codes, not virtual keys)
    public static void Key(ushort scan, bool extended) {
        int size = IntPtr.Size == 8 ? 40 : 28, off = IntPtr.Size == 8 ? 8 : 4;
        byte[] buf = new byte[size * 2];
        for (int k = 0; k < 2; k++) {
            int b = k * size;
            BitConverter.GetBytes((uint)1).CopyTo(buf, b);                     // INPUT_KEYBOARD
            BitConverter.GetBytes(scan).CopyTo(buf, b + off + 2);              // wScan
            uint flags = 8u | (extended ? 1u : 0u) | (k == 1 ? 2u : 0u);       // SCANCODE | EXTENDED | KEYUP
            BitConverter.GetBytes(flags).CopyTo(buf, b + off + 4);
        }
        SendInput(1, Sub(buf, 0, size), size);
        Thread.Sleep(60);
        SendInput(1, Sub(buf, size, size), size);
    }
    static byte[] Sub(byte[] a, int o, int n) { byte[] r = new byte[n]; Array.Copy(a, o, r, 0, n); return r; }

    // The game's picture without bringing it forward (PW_RENDERFULLCONTENT)
    public static Bitmap Print(IntPtr h) {
        RECT r; if (!GetClientRect(h, out r) || r.R <= 0 || r.B <= 0) return null;
        Bitmap bmp = new Bitmap(r.R, r.B);
        using (Graphics g = Graphics.FromImage(bmp)) {
            IntPtr dc = g.GetHdc();
            bool ok = PrintWindow(h, dc, 3);   // client area only + full content
            g.ReleaseHdc(dc);
            if (!ok) { bmp.Dispose(); return null; }
        }
        return bmp;
    }

    // The game's client area from the screen (only right while it is in front)
    public static Bitmap Screen(IntPtr h) {
        RECT r; if (!GetClientRect(h, out r) || r.R <= 0 || r.B <= 0) return null;
        POINT p = new POINT(); ClientToScreen(h, ref p);
        Bitmap bmp = new Bitmap(r.R, r.B);
        using (Graphics g = Graphics.FromImage(bmp)) g.CopyFromScreen(p.X, p.Y, 0, 0, new Size(r.R, r.B));
        return bmp;
    }
}
"@
}
[void][GmSaver]::SetProcessDPIAware()

# ------------------------------------------------------------------ OCR (Windows' own)

$null = [Windows.Storage.StorageFile, Windows.Storage, ContentType = WindowsRuntime]
$null = [Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType = WindowsRuntime]
$null = [Windows.Foundation.IAsyncOperation`1, Windows.Foundation, ContentType = WindowsRuntime]
$null = [Windows.Graphics.Imaging.SoftwareBitmap, Windows.Foundation, ContentType = WindowsRuntime]
$null = [Windows.Graphics.Imaging.BitmapDecoder, Windows.Foundation, ContentType = WindowsRuntime]
$null = [Windows.Storage.Streams.RandomAccessStream, Windows.Storage.Streams, ContentType = WindowsRuntime]
$null = [Windows.Globalization.Language, Windows.Globalization, ContentType = WindowsRuntime]
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$awaiter = [WindowsRuntimeSystemExtensions].GetMember("GetAwaiter") |
    Where-Object { $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' } | Select-Object -First 1
function Await($op, [Type]$type) { $awaiter.MakeGenericMethod($type).Invoke($null, @($op)).GetResult() }
$engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage([Windows.Globalization.Language]::new("en-US"))
if (-not $engine) { $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages() }
if (-not $engine) { throw "Windows OCR has no language installed (Settings > Time & language > Language: add English)" }
$maxDim = [int][Windows.Media.Ocr.OcrEngine]::MaxImageDimension

$tmp = Join-Path $env:TEMP ("gmsave_" + [guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Force -Path $tmp | Out-Null

# Lines of text: @{ text; x; y; w; h } in the picture's pixels. The menu text is big,
# so the picture is shrunk to fit Windows OCR's size limit instead of tiled.
function Read-Lines($bmp) {
    $scale = [math]::Min(1.0, $maxDim / [double][math]::Max($bmp.Width, $bmp.Height))
    $src = $bmp
    if ($scale -lt 1) {
        $src = New-Object System.Drawing.Bitmap ([int]($bmp.Width * $scale)), ([int]($bmp.Height * $scale))
        $g = [System.Drawing.Graphics]::FromImage($src)
        $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
        $g.DrawImage($bmp, 0, 0, $src.Width, $src.Height)
        $g.Dispose()
    }
    $path = Join-Path $tmp "look.png"
    $src.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
    if ($src -ne $bmp) { $src.Dispose() }
    $file = Await ([Windows.Storage.StorageFile]::GetFileFromPathAsync($path)) ([Windows.Storage.StorageFile])
    $stream = Await ($file.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
    try {
        $decoder = Await ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
        $sb = Await ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
        $result = Await ($engine.RecognizeAsync($sb)) ([Windows.Media.Ocr.OcrResult])
    } finally { $stream.Dispose() }
    $lines = @()
    foreach ($line in $result.Lines) {
        $x0 = 1e9; $y0 = 1e9; $x1 = 0; $y1 = 0
        foreach ($w in $line.Words) {
            $r = $w.BoundingRect
            $x0 = [math]::Min($x0, $r.X); $y0 = [math]::Min($y0, $r.Y)
            $x1 = [math]::Max($x1, $r.X + $r.Width); $y1 = [math]::Max($y1, $r.Y + $r.Height)
        }
        $lines += , @{ text = $line.Text.ToLowerInvariant(); x = $x0 / $scale; y = $y0 / $scale; w = ($x1 - $x0) / $scale; h = ($y1 - $y0) / $scale }
    }
    return , $lines
}

# Mean brightness of the menu row around a line (the highlighted row is a light box)
function Row-Light($bmp, $line) {
    $x0 = [int][math]::Max(0, $line.x - $line.h); $x1 = [int][math]::Min($bmp.Width - 1, $line.x + $line.w + $line.h)
    $y0 = [int][math]::Max(0, $line.y - $line.h * 0.4); $y1 = [int][math]::Min($bmp.Height - 1, $line.y + $line.h * 1.4)
    $sum = 0.0; $n = 0
    for ($y = $y0; $y -le $y1; $y += 3) {
        for ($x = $x0; $x -le $x1; $x += 3) {
            $c = $bmp.GetPixel($x, $y); $sum += 0.3 * $c.R + 0.59 * $c.G + 0.11 * $c.B; $n++
        }
    }
    if ($n -eq 0) { return 0 }
    return $sum / $n
}

function Is-Blank($bmp) {
    if (-not $bmp) { return $true }
    $lit = 0
    for ($y = 0; $y -lt $bmp.Height; $y += [math]::Max(1, [int]($bmp.Height / 24))) {
        for ($x = 0; $x -lt $bmp.Width; $x += [math]::Max(1, [int]($bmp.Width / 32))) {
            $c = $bmp.GetPixel($x, $y); if ($c.R + $c.G + $c.B -gt 60) { $lit++ }
        }
    }
    return $lit -lt 8
}

$MenuItems = @("advance", "save full race replay", "view replay", "race director")

# What the game shows: saved / menu (+ highlighted row) / results / other
function Screen-State($bmp) {
    $lines = Read-Lines $bmp
    $all = ($lines | ForEach-Object { $_.text }) -join " | "
    if ($all -match 'replay saved') { return @{ kind = "saved"; text = $all } }
    if ($all -match 'replay' -and $all -match 'not enough|unable|failed|error|full\b.*storage') { return @{ kind = "error"; text = $all } }
    $rows = @{}
    foreach ($l in $lines) {
        for ($i = 0; $i -lt $MenuItems.Count; $i++) {
            if ($l.text -eq $MenuItems[$i] -or ($i -eq 1 -and $l.text -match 'save full race replay')) { $rows[$i] = $l }
        }
    }
    if ($rows.ContainsKey(1) -and $rows.Count -ge 3) {
        $best = -1; $bestLight = -1.0
        foreach ($i in $rows.Keys) { $v = Row-Light $bmp $rows[$i]; if ($v -gt $bestLight) { $bestLight = $v; $best = $i } }
        return @{ kind = "menu"; selected = $best; text = $all }
    }
    if ($all -match 'results' -and $all -match '\bpos\b|driver' -and $all -match 'best|time|pts') { return @{ kind = "results"; text = $all } }
    return @{ kind = "other"; text = $all }
}

$Scan = @{ enter = @(0x1C, $false); down = @(0x50, $true); up = @(0x48, $true) }

function Press($name) {
    if ($DryRun -or $ImagePath) { Write-Output "  (would press $name)"; return }
    [GmSaver]::Key([uint16]$Scan[$name][0], [bool]$Scan[$name][1])
    Start-Sleep -Milliseconds 350
}

function Keep($bmp, $tag) {
    if (-not $KeepDir -or -not $bmp) { return }
    New-Item -ItemType Directory -Force -Path $KeepDir | Out-Null
    $name = "replay-{0}-{1}.jpg" -f (Get-Date -Format "yyyyMMdd-HHmmss"), $tag
    try { $bmp.Save((Join-Path $KeepDir $name), [System.Drawing.Imaging.ImageFormat]::Jpeg) } catch { }
}

function Game-Window {
    $p = Get-Process -ErrorAction SilentlyContinue |
        Where-Object { $_.ProcessName -match $GameProcess -and $_.MainWindowHandle -ne [IntPtr]::Zero } | Select-Object -First 1
    if ($p) { return $p.MainWindowHandle }
    return [IntPtr]::Zero
}

# ------------------------------------------------------------------ test on a picture

if ($ImagePath) {
    $bmp = [System.Drawing.Bitmap]::FromFile((Resolve-Path $ImagePath))
    $s = Screen-State $bmp
    Write-Output ("{0}{1}: {2}" -f $s.kind, $(if ($s.kind -eq "menu") { " (highlighted: " + $MenuItems[$s.selected] + ")" } else { "" }), $s.text)
    Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
    return
}

# ------------------------------------------------------------------ the race's results screen

$before = @{}
if (Test-Path $ReplaysDir) { Get-ChildItem $ReplaysDir -Filter *.frr | ForEach-Object { $before[$_.Name] = $true } }

Start-Sleep -Seconds $StartDelay
$deadline = (Get-Date).AddSeconds($Seconds)
$peeks = 0; $printOk = $true; $result = "results screen not seen"; $saved = $false; $lastKind = ""

try {
    while ((Get-Date) -lt $deadline -and -not $saved) {
        $h = Game-Window
        if ($h -eq [IntPtr]::Zero) { $result = "game not running"; break }
        if ([GmSaver]::IsIconic($h)) { Start-Sleep -Seconds $Every; continue }   # minimised: nothing to read

        # 1. look without taking the focus
        $front = [GmSaver]::GetForegroundWindow() -eq $h
        $bmp = if ($front -and -not $DryRun) { [GmSaver]::Screen($h) } elseif ($printOk) { [GmSaver]::Print($h) } else { $null }
        if (($DryRun -or -not $front) -and $printOk -and (Is-Blank $bmp)) { $printOk = $false; if ($bmp) { $bmp.Dispose() }; $bmp = $null }
        $state = if ($bmp) { Screen-State $bmp } else { @{ kind = "unknown"; text = "" } }
        if ($state.kind -ne $lastKind) { Keep $bmp $state.kind; $lastKind = $state.kind }
        if ($bmp) { $bmp.Dispose() }

        # Without a picture from PrintWindow (some games draw black there), peek: take the
        # focus for one short look, at most $MaxPeeks times.
        if ($state.kind -eq "other") { Start-Sleep -Seconds $Every; continue }
        if ($state.kind -eq "unknown") {
            if ($DryRun) { $result = "dry run: PrintWindow gives no picture of the game"; break }
            if (++$peeks -gt $MaxPeeks) { $result = "results screen not seen (game picture only readable in front)"; break }
        }

        # 2. results / menu / saved dialog (or a peek): bring the game forward, act, give the focus back
        if ($DryRun) { $result = "dry run: game shows '$($state.kind)'"; break }
        $prev = [GmSaver]::GetForegroundWindow()
        if (-not [GmSaver]::Focus($h)) { $result = "couldn't bring the game forward"; Start-Sleep -Seconds $Every; continue }
        try {
            $go = $true
            for ($step = 0; $step -lt 8 -and $go -and -not $saved; $step++) {
                Start-Sleep -Milliseconds 250
                $bmp = [GmSaver]::Screen($h)
                $s = Screen-State $bmp
                if ($s.kind -ne $lastKind) { Keep $bmp $s.kind; $lastKind = $s.kind }
                $bmp.Dispose()
                if ($s.kind -eq "results") { Press "enter" }                       # opens the menu (Advance highlighted)
                elseif ($s.kind -eq "menu") {
                    if ($s.selected -eq 1) { Press "enter" }                       # Save Full Race Replay
                    elseif ($s.selected -lt 1) { Press "down" }
                    else { for ($k = $s.selected; $k -gt 1; $k--) { Press "up" } }
                }
                elseif ($s.kind -eq "saved") { Press "enter"; $saved = $true; $result = "saved" }
                elseif ($s.kind -eq "error") { Press "enter"; $result = "game said: " + $s.text; $deadline = Get-Date; $go = $false }
                else { $go = $false }                                              # not the results (any more)
            }
        } finally {
            [GmSaver]::Restore($prev)
        }
        if (-not $saved) { Start-Sleep -Seconds $Every }
    }
} finally {
    Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
}

# ------------------------------------------------------------------ which file it became

$file = $null
if ($saved) {
    for ($i = 0; $i -lt 20 -and -not $file; $i++) {
        Start-Sleep -Milliseconds 500
        $file = Get-ChildItem $ReplaysDir -Filter *.frr -ErrorAction SilentlyContinue |
            Where-Object { -not $before.ContainsKey($_.Name) } | Sort-Object LastWriteTime -Descending | Select-Object -First 1
    }
    if ($file -and $LogFile) {
        $row = @{ replay = $file.Name; bytes = $file.Length; telemetry = $Recording; saved = (Get-Date).ToString("o") } | ConvertTo-Json -Compress
        Add-Content -Path $LogFile -Value $row -Encoding UTF8
    }
}

if ($saved -and $file) { Write-Output "Replay saved: $($file.Name) ($([math]::Round($file.Length / 1MB)) MB)" }
elseif ($saved) { Write-Output "Replay saved (file not found in $ReplaysDir yet)" }
else { Write-Output "Replay not saved: $result$(if (-not $printOk) { ' (game picture only readable in front)' })" }
