# GreMi Gang classification capture (started by RaceUploader.ps1 in every race).
#
# Starts the moment GreMi crosses the finish line (the live standings tower then
# shows the whole grid while the others finish), or when the final
# classification comes in if he didn't finish. Every few seconds it takes a
# screenshot of every monitor, reads it with Windows' own OCR (no install
# needed) and keeps the frames that look like the standings tower (gaps, DNFs)
# or the classification screen (lap times). Each frame is stored with the
# game's live lap data of that moment (position + gap of every car), so a row is
# tied to a car index even if places change later; the final classification
# packet is added when it arrives (up to 60 s of classification frames after
# it). All of it is encrypted with the public key below into one .gmcls file
# next to the telemetry; the uploader sends it to the "telemetry" release.
# scripts/telemetry/classification_ocr.py (site build) decrypts it and names
# the cars with hidden names.
#
# Screenshots stay on this PC (the best one is kept in -KeepDir for checking).
#
# Where the pictures come from (2026-11-13): OBS first. Through OBS's own
# WebSocket server (OBS 28+, Tools > WebSocket Server Settings) it adds a
# temporary Window Capture of the F1 window ("GreMi standings reader",
# off-canvas in the live scene: invisible on stream, no audio) and takes its
# picture, so it doesn't matter what is on GreMi's monitors or which OBS scene
# is live: tabbed out, another app on top or another scene all still give the
# game's picture. The source is deleted again at the end. Port and password
# come from OBS's own settings on this PC, or -ObsPassword (RaceUploader.ps1
# asks once and keeps it). No OBS, or the game minimised (black picture):
# screenshots of every monitor, as before.
#
# Check OBS on its own: -TestObs (saves obs-test.png in -KeepDir).
#
# Test without the game: -ImagePath screen.png (and -Results/-FinishLap) reads that picture.
# Needs Windows PowerShell 5.1 (Windows' OCR is not reachable from PowerShell 7).

param(
    [string]$OutFile = "",
    [object]$Recorder = $null,                            # GmTelemetryRecorder (same process)
    [string]$Results = "",                                # base64 final classification packet
    [string]$Participants = "",                           # base64 participants packet
    [string]$FinishLap = "",                              # base64 lap data packet when GreMi finished
    [double]$FinishTime = 0,                              # session time (s) when GreMi finished
    [string]$Recording = "",
    [string]$KeepDir = "",
    [string]$ImagePath = "",
    [string]$PublicKeyXml = "",
    [int]$Seconds = 900,
    [int]$Every = 3,
    [int]$WantScreens = 4,
    [string]$ObsHost = "127.0.0.1",
    [int]$ObsPort = 0,                                    # 0 = OBS's own setting, else 4455
    [string]$ObsPassword = "",                            # "" = OBS's own setting on this PC
    [string]$ObsSource = "",                              # "" = the Game Capture source
    [string]$GameProcess = '^F1_?\d\d',                  # process name pattern of the game window
    [switch]$NoObs,
    [switch]$TestObs
)

$ErrorActionPreference = "Stop"

# Site build's key (CLASSIFICATION_KEY secret holds the private half). Public: safe to share.
$DefaultKey = "<RSAKeyValue><Modulus>/Pjr1cZaslv+EuUveygfDluabBW1XrFtdqcbEqWeglw1cnv2stPajKcy2PKuy1fW86K3fKiWe45bXC7zliEyE7/unFUS5yBKRjdhUoICjFOXPAPLnCti1KYlNMj4+SEuMwazBb8skzlZN1pFYIQaJal+W/3EBe4vUgmHtBRdu75iCkfuY2Q1Lwm99m9f2DNmy63B6BRmw+sdeZTmFdbb2mHLEA63qbLkuM8hYsmaIQGbZTEGRqnwMXDQAvkUgtnLFDxa3n1Qy+m1Fpkpaf1lcdspiKMsFCGV4a1+F3Yd0QPOJcOVrTCxi3UjyMkNVdwXCaEx8SEEKWIhKIbk5Fbt17n1iXiqW7B4s/6JLg3hA38HCkniUKRv9ckoSOGU9KzTiVPW2+2SFRu0hnIxOMPRyQwaR3NnaVtLEE+6vRRmltK4NzV2E96re/PLtL78nVK8qBKHCom6VanBa12ZQM10Ce6U6AvJhqou9acSSmZHGFAjEUsOhL4jlyXt4Nm9bz3v</Modulus><Exponent>AQAB</Exponent></RSAKeyValue>"
if (-not $PublicKeyXml) { $PublicKeyXml = $DefaultKey }

Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Runtime.WindowsRuntime
if (-not ("GmDpi" -as [type])) {
    Add-Type @"
using System.Runtime.InteropServices;
public static class GmDpi { [DllImport("user32.dll")] public static extern bool SetProcessDPIAware(); }
"@
}
[void][GmDpi]::SetProcessDPIAware()  # real pixels, not Windows' scaled ones

# ------------------------------------------------------------------ OBS

$script:Obs = $null          # open WebSocket to OBS
$script:ObsSrc = $null       # name of the game source
$script:ObsAdded = @()       # off-canvas scene items this capture added: @{scene; id}
$script:ObsCreated = $false   # the "GreMi standings reader" window capture exists
$script:ObsNote = ""         # last OBS result, for the summary line
$script:ObsNext = 0

function Obs-Config {
    $p = Join-Path $env:APPDATA "obs-studio\plugin_config\obs-websocket\config.json"
    if (Test-Path $p) { try { return (Get-Content $p -Raw | ConvertFrom-Json) } catch { } }
    return $null
}

function Obs-Send($obj) {
    $bytes = [Text.Encoding]::UTF8.GetBytes(($obj | ConvertTo-Json -Depth 8 -Compress))
    [void]$script:Obs.SendAsync([ArraySegment[byte]]::new($bytes), [Net.WebSockets.WebSocketMessageType]::Text, $true,
        [Threading.CancellationToken]::None).GetAwaiter().GetResult()
}

function Obs-Receive([int]$timeoutMs = 15000) {
    $buf = New-Object byte[] 262144
    $all = New-Object IO.MemoryStream
    $cts = New-Object Threading.CancellationTokenSource $timeoutMs
    try {
        do {
            $r = $script:Obs.ReceiveAsync([ArraySegment[byte]]::new($buf), $cts.Token).GetAwaiter().GetResult()
            if ($r.MessageType -eq [Net.WebSockets.WebSocketMessageType]::Close) {
                $code = if ($null -ne $script:Obs.CloseStatus) { [int]$script:Obs.CloseStatus } else { 0 }
                if ($code -eq 4009) { throw "OBS WebSocket password is wrong" }
                throw "OBS closed the connection ($code $($script:Obs.CloseStatusDescription))"
            }
            $all.Write($buf, 0, $r.Count)
        } while (-not $r.EndOfMessage)
    } finally { $cts.Dispose() }
    return [Text.Encoding]::UTF8.GetString($all.ToArray())
}

# One request; a screenshot's picture is cut out of the text before ConvertFrom-Json
# (Windows PowerShell's JSON reader stops at 2 MB) and returned as .image (base64).
function Obs-Call($type, $data = @{}) {
    $id = "gm" + (++$script:ObsNext)
    Obs-Send @{ op = 6; d = @{ requestType = $type; requestId = $id; requestData = $data } }
    while ($true) {
        $txt = Obs-Receive
        $img = $null
        $m = [regex]::Match($txt, '"imageData"\s*:\s*"data:image/[a-z]+;base64,([^"]*)"')
        if ($m.Success) {
            $img = $m.Groups[1].Value
            $txt = $txt.Remove($m.Index, $m.Length).Insert($m.Index, '"imageData":""')
        }
        $msg = $txt | ConvertFrom-Json
        if ($msg.op -ne 7 -or $msg.d.requestId -ne $id) { continue }
        if (-not $msg.d.requestStatus.result) {
            throw ("OBS {0} failed: {1} {2}" -f $type, $msg.d.requestStatus.code, $msg.d.requestStatus.comment)
        }
        $out = $msg.d.responseData
        if (-not $out) { $out = New-Object PSObject }
        if ($img) { $out | Add-Member -NotePropertyName image -NotePropertyValue $img -Force }
        return $out
    }
}

function Obs-Connect {
    $cfg = Obs-Config
    $port = if ($ObsPort) { $ObsPort } elseif ($cfg -and $cfg.server_port) { [int]$cfg.server_port } else { 4455 }
    $pw = if ($ObsPassword) { $ObsPassword } elseif ($cfg) { [string]$cfg.server_password } else { "" }
    $ws = New-Object Net.WebSockets.ClientWebSocket
    $ws.Options.AddSubProtocol("obswebsocket.json")
    $cts = New-Object Threading.CancellationTokenSource 3000
    try {
        [void]$ws.ConnectAsync([Uri]("ws://{0}:{1}" -f $ObsHost, $port), $cts.Token).GetAwaiter().GetResult()
    } catch {
        $ws.Dispose()
        throw "OBS isn't running, or its WebSocket server is off (OBS: Tools > WebSocket Server Settings > Enable)"
    } finally { $cts.Dispose() }
    $script:Obs = $ws
    $hello = (Obs-Receive 5000) | ConvertFrom-Json
    $ident = @{ rpcVersion = 1; eventSubscriptions = 0 }
    if ($hello.d.authentication) {
        if (-not $pw) { throw "OBS asks for its WebSocket password" }
        $sha = [Security.Cryptography.SHA256]::Create()
        $secret = [Convert]::ToBase64String($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($pw + $hello.d.authentication.salt)))
        $ident.authentication = [Convert]::ToBase64String($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($secret + $hello.d.authentication.challenge)))
    }
    Obs-Send @{ op = 1; d = $ident }
    $ok = (Obs-Receive 5000) | ConvertFrom-Json
    if ($ok.op -ne 2) { throw "OBS didn't accept the connection" }
}

function Obs-Disconnect {
    if ($script:Obs) { try { $script:Obs.Dispose() } catch { } }
    $script:Obs = $null
}

# The F1 game's window as OBS writes it in a Window Capture: "title:class:exe" (":" as "#3A")
if (-not ("GmWin" -as [type])) {
    Add-Type @"
using System; using System.Text; using System.Runtime.InteropServices;
public static class GmWin { [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetClassName(IntPtr h, StringBuilder s, int n); }
"@
}
function F1-Window {
    $p = Get-Process -ErrorAction SilentlyContinue |
        Where-Object { $_.ProcessName -match $GameProcess -and $_.MainWindowHandle -ne [IntPtr]::Zero } | Select-Object -First 1
    if (-not $p) { return $null }
    $sb = New-Object Text.StringBuilder 256
    [void][GmWin]::GetClassName($p.MainWindowHandle, $sb, 256)
    return "{0}:{1}:{2}.exe" -f ($p.MainWindowTitle -replace ':', '#3A'), ($sb.ToString() -replace ':', '#3A'), $p.ProcessName
}

# The game source. GreMi's stream shows the game through Display Capture (the whole
# monitor), which shows whatever is on that monitor, and OBS's Game Capture only follows
# the app in front. So the capture makes its own Window Capture of the F1 window
# (Windows' own window capture: no hook in the game, keeps reading a window that is
# covered or in the background, only not a minimised one). It sits off-canvas in the
# live scene (invisible on stream, no audio) and is deleted again at the end.
# -ObsSource names an existing source instead.
$ObsReaderName = "GreMi standings reader"
function Obs-Prepare {
    if ($ObsSource) { $script:ObsSrc = $ObsSource; return }
    $win = F1-Window
    if (-not $win) { throw "F1 isn't running" }
    try { [void](Obs-Call "RemoveInput" @{ inputName = $ObsReaderName }) } catch { }   # left over from a crash
    $scene = Obs-ProgramScene
    $id = (Obs-Call "CreateInput" @{ sceneName = $scene; inputName = $ObsReaderName; inputKind = "window_capture"
        inputSettings = @{ window = $win; method = 2; priority = 2; cursor = $false; client_area = $true }
        sceneItemEnabled = $false }).sceneItemId
    $script:ObsCreated = $true
    $script:ObsSrc = $ObsReaderName
    Obs-Hide $scene $id
}

function Obs-ProgramScene {
    $r = Obs-Call "GetCurrentProgramScene"
    if ($r.sceneName) { return $r.sceneName }
    return $r.currentProgramSceneName
}

# a scene item far outside the canvas, locked, then switched on: nothing shows on stream
function Obs-Hide($scene, $id) {
    $script:ObsAdded += , @{ scene = $scene; id = $id }
    [void](Obs-Call "SetSceneItemTransform" @{ sceneName = $scene; sceneItemId = $id
        sceneItemTransform = @{ positionX = -90000.0; positionY = -90000.0 } })
    [void](Obs-Call "SetSceneItemLocked" @{ sceneName = $scene; sceneItemId = $id; sceneItemLocked = $true })
    [void](Obs-Call "SetSceneItemEnabled" @{ sceneName = $scene; sceneItemId = $id; sceneItemEnabled = $true })
}

# OBS only keeps a source fresh while it is showing: after a scene switch, put the source
# (off-canvas) in the new live scene too.
function Obs-Show {
    if ((Obs-Call "GetSourceActive" @{ sourceName = $script:ObsSrc }).videoShowing) { return }
    $scene = Obs-ProgramScene
    if (-not $scene -or @($script:ObsAdded | Where-Object { $_.scene -eq $scene }).Count) { return }
    $id = (Obs-Call "CreateSceneItem" @{ sceneName = $scene; sourceName = $script:ObsSrc; sceneItemEnabled = $false }).sceneItemId
    Obs-Hide $scene $id
}

function Obs-Cleanup {
    if ($script:ObsCreated -or $script:ObsAdded.Count) {
        try {
            if (-not $script:Obs -or $script:Obs.State -ne [Net.WebSockets.WebSocketState]::Open) { Obs-Disconnect; Obs-Connect }
            if ($script:ObsCreated) {
                [void](Obs-Call "RemoveInput" @{ inputName = $ObsReaderName })   # takes its scene items with it
            } else {
                foreach ($a in $script:ObsAdded) {
                    try { [void](Obs-Call "RemoveSceneItem" @{ sceneName = $a.scene; sceneItemId = $a.id }) } catch { }
                }
            }
        } catch { }
        $script:ObsCreated = $false
        $script:ObsAdded = @()
    }
    Obs-Disconnect
}

# A capture that has no picture is pure black; a night race (Jeddah, Vegas) is dark but
# never all zero, so look at 1600 points and only call it blank when every one is ~black.
function Is-Blank($bmp) {
    for ($i = 0; $i -lt 40; $i++) {
        for ($j = 0; $j -lt 40; $j++) {
            $c = $bmp.GetPixel([int](($bmp.Width - 1) * ($i + 0.5) / 40), [int](($bmp.Height - 1) * ($j + 0.5) / 40))
            if ($c.R + $c.G + $c.B -gt 12) { return $false }
        }
    }
    return $true
}

# The game's picture from OBS, or $null (no OBS, no game, black picture)
function Obs-Shot {
    if ($NoObs) { return $null }
    try {
        if (-not $script:Obs -or $script:Obs.State -ne [Net.WebSockets.WebSocketState]::Open) {
            Obs-Disconnect
            Obs-Connect
        }
        if (-not $script:ObsSrc) { Obs-Prepare }
        Obs-Show
        $r = Obs-Call "GetSourceScreenshot" @{ sourceName = $script:ObsSrc; imageFormat = "png" }
        if (-not $r.image) { throw "OBS sent no picture" }
        $ms = New-Object IO.MemoryStream (, [Convert]::FromBase64String($r.image))
        $png = [System.Drawing.Bitmap]::FromStream($ms)
        $bmp = New-Object System.Drawing.Bitmap $png.Width, $png.Height, ([System.Drawing.Imaging.PixelFormat]::Format24bppRgb)
        $g = [System.Drawing.Graphics]::FromImage($bmp)
        $g.Clear([System.Drawing.Color]::Black)
        $g.DrawImage($png, 0, 0, $png.Width, $png.Height)
        $g.Dispose(); $png.Dispose(); $ms.Dispose()
        if ($bmp.Width -lt 320 -or (Is-Blank $bmp)) {
            $bmp.Dispose()
            $script:ObsNote = "the F1 picture in OBS is black (game minimised, or not captured yet)"
            return $null
        }
        $script:ObsNote = "ok"
        return $bmp
    } catch {
        $script:ObsNote = $_.Exception.Message -replace '^Exception calling "\w+" with "\d+" argument\(s\): ', ''
        if ($script:ObsNote -match 'Failed to render') { $script:ObsNote = "OBS has no F1 picture yet (game minimised?)" }
        if ($script:ObsNote -notmatch 'F1 isn.t running') { Obs-Disconnect }
        return $null
    }
}

if ($TestObs) {
    $shot = $null
    try {
        for ($i = 0; $i -lt 6 -and -not $shot; $i++) {   # a new window capture needs a moment for its first frame
            $shot = Obs-Shot
            if (-not $shot) { if ($script:ObsNote -notmatch 'black|no F1 picture') { break }; Start-Sleep -Seconds 1 }
        }
    } finally { Obs-Cleanup }
    if ($shot) {
        if ($KeepDir) {
            New-Item -ItemType Directory -Force -Path $KeepDir | Out-Null
            $shot.Save((Join-Path $KeepDir "obs-test.png"), [System.Drawing.Imaging.ImageFormat]::Png)
        }
        Write-Output ("OBS ok: reading the F1 window ({0}x{1})" -f $shot.Width, $shot.Height)
        $shot.Dispose()
    } elseif ($script:ObsNote -match 'F1 isn.t running') {
        Write-Output "OBS ok: connected (F1 isn't running, so the game picture is checked after your next race)"
    } else {
        Write-Output ("OBS not used: {0}" -f $script:ObsNote)
    }
    return
}
if (-not $OutFile) { throw "-OutFile is needed (or -TestObs)" }

$null = [Windows.Storage.StorageFile, Windows.Storage, ContentType = WindowsRuntime]
$null = [Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType = WindowsRuntime]
$null = [Windows.Foundation.IAsyncOperation`1, Windows.Foundation, ContentType = WindowsRuntime]
$null = [Windows.Graphics.Imaging.SoftwareBitmap, Windows.Foundation, ContentType = WindowsRuntime]
$null = [Windows.Graphics.Imaging.BitmapDecoder, Windows.Foundation, ContentType = WindowsRuntime]
$null = [Windows.Storage.Streams.RandomAccessStream, Windows.Storage.Streams, ContentType = WindowsRuntime]
$null = [Windows.Globalization.Language, Windows.Globalization, ContentType = WindowsRuntime]

$awaiter = [WindowsRuntimeSystemExtensions].GetMember("GetAwaiter") |
    Where-Object { $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' } | Select-Object -First 1
function Await($op, [Type]$type) { $awaiter.MakeGenericMethod($type).Invoke($null, @($op)).GetResult() }

$engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage([Windows.Globalization.Language]::new("en-US"))
if (-not $engine) { $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages() }
if (-not $engine) { throw "Windows OCR has no language installed (Settings > Time & language > Language: add English)" }
$maxDim = [int][Windows.Media.Ocr.OcrEngine]::MaxImageDimension

$tmp = Join-Path $env:TEMP ("gmcls_" + [guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Force -Path $tmp | Out-Null
$LapLike = '^\d{1,2}[:.]\d{2}[.,:]\d{3}$'
$GapLike = '^(\+\d{1,3}[.,]\d{3}|DNF|DSQ)$'

# OCR of one picture file -> words @(text, x, y, w, h) in that picture's pixels
function Read-File($path) {
    $file = Await ([Windows.Storage.StorageFile]::GetFileFromPathAsync($path)) ([Windows.Storage.StorageFile])
    $stream = Await ($file.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
    try {
        $decoder = Await ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
        $bitmap = Await ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
        $result = Await ($engine.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult])
    } finally { $stream.Dispose() }
    $out = New-Object System.Collections.ArrayList
    foreach ($line in $result.Lines) {
        foreach ($w in $line.Words) {
            $r = $w.BoundingRect
            [void]$out.Add(@($w.Text, $r.X, $r.Y, $r.Width, $r.Height))
        }
    }
    return , $out
}

# Windows OCR reads at most $maxDim pixels a side: big pictures go in overlapping
# tiles, and a word counts for the tile whose own part holds its centre.
function Spans($size) {
    if ($size -le $maxDim) { return , @(, @(0, $size, 0, $size)) }
    $n = [math]::Max(2, [math]::Ceiling($size / ($maxDim / 2)) - 1)
    $stride = ($size - $maxDim) / ($n - 1)
    $spans = @()
    for ($i = 0; $i -lt $n; $i++) {
        $a = [int]($i * $stride)
        $ownA = if ($i -eq 0) { 0 } else { ($a + [int](($i - 1) * $stride) + $maxDim) / 2 }
        $ownB = if ($i -eq $n - 1) { $size } else { ([int](($i + 1) * $stride) + $a + $maxDim) / 2 }
        $spans += , @($a, $maxDim, $ownA, $ownB)
    }
    return , $spans
}

function Read-Bitmap($bmp, $scale) {
    $words = New-Object System.Collections.ArrayList
    foreach ($sx in (Spans $bmp.Width)) {
        foreach ($sy in (Spans $bmp.Height)) {
            $rect = New-Object System.Drawing.Rectangle $sx[0], $sy[0], ([math]::Min($sx[1], $bmp.Width - $sx[0])), ([math]::Min($sy[1], $bmp.Height - $sy[0]))
            $tile = $bmp.Clone($rect, $bmp.PixelFormat)
            $path = Join-Path $tmp "tile.png"
            $tile.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
            $tile.Dispose()
            foreach ($w in (Read-File $path)) {
                $cx = $w[1] + $sx[0] + $w[3] / 2
                $cy = $w[2] + $sy[0] + $w[4] / 2
                if ($cx -lt $sx[2] -or $cx -ge $sx[3] -or $cy -lt $sy[2] -or $cy -ge $sy[3]) { continue }
                [void]$words.Add(@($w[0], [math]::Round(($w[1] + $sx[0]) / $scale, 1), [math]::Round(($w[2] + $sy[0]) / $scale, 1),
                    [math]::Round($w[3] / $scale, 1), [math]::Round($w[4] / $scale, 1)))
            }
        }
    }
    return , $words
}

# Two versions of each screenshot: enlarged (small text reads better), and the
# same in inverted grey with more contrast (white-on-colour rows read better).
function Variants($shot) {
    $scale = if ($shot.Height -le 1440) { 2 } else { 1 }
    $big = New-Object System.Drawing.Bitmap ($shot.Width * $scale), ($shot.Height * $scale)
    $g = [System.Drawing.Graphics]::FromImage($big)
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.DrawImage($shot, 0, 0, $big.Width, $big.Height)
    $g.Dispose()
    $inv = New-Object System.Drawing.Bitmap $big.Width, $big.Height
    $g = [System.Drawing.Graphics]::FromImage($inv)
    # out = 1.15 - 1.5 * grey: white text turns black, dark and coloured rows turn light
    $r = [single](-1.5 * 0.30); $gr = [single](-1.5 * 0.59); $bl = [single](-1.5 * 0.11); $o = [single]1.15
    $m = New-Object System.Drawing.Imaging.ColorMatrix (, [single[][]]@(
        [single[]]@($r, $r, $r, 0, 0), [single[]]@($gr, $gr, $gr, 0, 0), [single[]]@($bl, $bl, $bl, 0, 0),
        [single[]]@(0, 0, 0, 1, 0), [single[]]@($o, $o, $o, 0, 1)))
    $attr = New-Object System.Drawing.Imaging.ImageAttributes
    $attr.SetColorMatrix($m)
    $g.DrawImage($big, (New-Object System.Drawing.Rectangle 0, 0, $inv.Width, $inv.Height), 0, 0, $big.Width, $big.Height,
        [System.Drawing.GraphicsUnit]::Pixel, $attr)
    $g.Dispose()
    return @(@("plain", $big, $scale), @("invert", $inv, $scale))
}

$script:FromObs = 0; $script:FromScreen = 0; $script:ShotSrc = "file"
function Shots {
    if ($ImagePath) { return , @(, [System.Drawing.Bitmap]::FromFile((Resolve-Path $ImagePath))) }
    $o = Obs-Shot
    if ($o) { $script:FromObs++; $script:ShotSrc = "obs"; return , @(, $o) }
    $script:FromScreen++; $script:ShotSrc = "screen"
    $list = @()
    foreach ($s in [System.Windows.Forms.Screen]::AllScreens) {
        $b = $s.Bounds
        $bmp = New-Object System.Drawing.Bitmap $b.Width, $b.Height
        $g = [System.Drawing.Graphics]::FromImage($bmp)
        $g.CopyFromScreen($b.Location, [System.Drawing.Point]::Empty, $b.Size)
        $g.Dispose()
        $list += , $bmp
    }
    return , $list
}

function Json-Text($s) {
    $sb = New-Object System.Text.StringBuilder
    [void]$sb.Append('"')
    foreach ($ch in $s.ToCharArray()) {
        $code = [int]$ch
        if ($ch -eq '"') { [void]$sb.Append('\"') }
        elseif ($ch -eq '\') { [void]$sb.Append('\\') }
        elseif ($code -lt 32) { [void]$sb.Append(('\u{0:x4}' -f $code)) }
        else { [void]$sb.Append($ch) }
    }
    [void]$sb.Append('"')
    return $sb.ToString()
}

$frames = New-Object System.Collections.ArrayList
$good = 0; $goodFinal = 0
$best = $null; $bestScore = 0
$first = $null   # the first picture, kept for checking when nothing could be read
$started = Get-Date
# Everything is tied to this race's session id: packets of the next session (the lobby moved
# on) are never mixed in, and a new session ends the capture.
function UidOf($b) { if ($b -and $b.Length -ge 15) { [BitConverter]::ToUInt64($b, 7) } else { [uint64]0 } }
$sessionUid = if ($FinishLap) { UidOf ([Convert]::FromBase64String($FinishLap)) }
              elseif ($Recorder) { UidOf $Recorder.LatestLap } else { [uint64]0 }
$startParts = if ($Recorder -and (UidOf $Recorder.LatestParticipants) -eq $sessionUid) { $Recorder.LatestParticipants } else { $null }
$resultsSince = $null
$lapSeen = $null; $lapSince = Get-Date   # the game's latest lap packet and when it last changed
$inv = [Globalization.CultureInfo]::InvariantCulture
try {
while ($true) {
    $t = [math]::Round(((Get-Date) - $started).TotalSeconds, 1)
    if ($Recorder -and $sessionUid -and (UidOf $Recorder.LatestLap) -ne $sessionUid) { break }   # next session started
    # the game stopped sending (left to the menu, closed or crashed): nothing more will come
    if ($Recorder) {
        if (-not [object]::ReferenceEquals($Recorder.LatestLap, $lapSeen)) { $lapSeen = $Recorder.LatestLap; $lapSince = Get-Date }
        elseif (((Get-Date) - $lapSince).TotalSeconds -ge 45) { break }
    }
    # the live standings as the game sees them right now: the anchor for the tower rows
    $lap = if ($Recorder -and $Recorder.LatestLap) { [Convert]::ToBase64String($Recorder.LatestLap) } else { $FinishLap }
    $st = if ($Recorder -and $Recorder.LatestLap) { [BitConverter]::ToSingle($Recorder.LatestLap, 15) } else { $FinishTime }
    $final = $Recorder -and $sessionUid -and (UidOf $Recorder.ResultsPacket) -eq $sessionUid
    if ($final -and -not $resultsSince) { $resultsSince = Get-Date }
    $si = 0
    foreach ($shot in (Shots)) {
        $kept = $false
        foreach ($v in (Variants $shot)) {
            $words = Read-Bitmap $v[1] $v[2]
            $v[1].Dispose()
            # classification screen: lap times; standings tower: gaps (+1.234) and DNFs
            $laps = @($words | Where-Object { $_[0] -match $LapLike }).Count
            $gaps = @($words | Where-Object { $_[0] -match $GapLike }).Count
            if ($laps -ge 4 -or $gaps -ge 4) {
                [void]$frames.Add(@{ t = $t; st = $st; lap = $lap; screen = $si; src = $script:ShotSrc; variant = $v[0]; w = $shot.Width; h = $shot.Height; words = $words })
                $kept = $true
                if ($laps + $gaps -gt $bestScore -and $KeepDir) {
                    if ($best) { $best.Dispose() }
                    $best = $shot.Clone(); $bestScore = $laps + $gaps
                }
            }
        }
        if ($kept) { $good++; if ($final) { $goodFinal++ } }
        if (-not $first -and $KeepDir) { $first = $shot.Clone() }
        $shot.Dispose()
        $si++
    }
    $elapsed = ((Get-Date) - $started).TotalSeconds
    if ($ImagePath -or $elapsed -ge $Seconds) { break }
    if (-not $Recorder -and $good -ge $WantScreens) { break }
    # after the results packet: a few frames of the classification screen, or 60 s, then stop
    if ($resultsSince -and ($goodFinal -ge $WantScreens -or ((Get-Date) - $resultsSince).TotalSeconds -ge 60)) { break }
    Start-Sleep -Seconds $Every
}
} finally { Obs-Cleanup }   # take the off-canvas game source out of OBS again

if ($Recorder) {
    if ((UidOf $Recorder.ResultsPacket) -eq $sessionUid) { $Results = [Convert]::ToBase64String($Recorder.ResultsPacket) }
    if ((UidOf $Recorder.LatestParticipants) -eq $sessionUid) { $startParts = $Recorder.LatestParticipants }
    if ($startParts) { $Participants = [Convert]::ToBase64String($startParts) }
}

# Payload: the packets and every kept frame's words
$sb = New-Object System.Text.StringBuilder
[void]$sb.Append('{"v":2,"recording":' + (Json-Text $Recording) + ',"captured":"' + (Get-Date).ToString("s") +
    '","finish_time":' + $FinishTime.ToString($inv) + ',"finish_lap":"' + $FinishLap +
    '","results":"' + $Results + '","participants":"' + $Participants + '","frames":[')
for ($i = 0; $i -lt $frames.Count; $i++) {
    $f = $frames[$i]
    if ($i) { [void]$sb.Append(',') }
    [void]$sb.Append('{"t":' + $f.t.ToString($inv) + ',"st":' + ([double]$f.st).ToString($inv) + ',"lap":"' + $f.lap +
        '","screen":' + $f.screen + ',"src":"' + $f.src + '","variant":"' + $f.variant + '","w":' + $f.w + ',"h":' + $f.h + ',"words":[')
    for ($j = 0; $j -lt $f.words.Count; $j++) {
        $w = $f.words[$j]
        if ($j) { [void]$sb.Append(',') }
        $nums = ($w[1..4] | ForEach-Object { ([double]$_).ToString([Globalization.CultureInfo]::InvariantCulture) }) -join ','
        [void]$sb.Append('[' + (Json-Text $w[0]) + ',' + $nums + ']')
    }
    [void]$sb.Append(']}')
}
[void]$sb.Append(']}')
$plain = [Text.Encoding]::UTF8.GetBytes($sb.ToString())

# Encrypt: RSA-OAEP wraps a fresh AES-256 key + HMAC key; AES-CBC, HMAC-SHA256 over IV + data
$keys = New-Object byte[] 64
[Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($keys)
$rsa = New-Object Security.Cryptography.RSACryptoServiceProvider
$rsa.FromXmlString($PublicKeyXml)
$wrapped = $rsa.Encrypt($keys, $true)
$aes = New-Object Security.Cryptography.AesManaged
$aes.KeySize = 256; $aes.Mode = "CBC"; $aes.Padding = "PKCS7"
$aes.Key = [byte[]]$keys[0..31]
$aes.GenerateIV()
$ct = $aes.CreateEncryptor().TransformFinalBlock($plain, 0, $plain.Length)
$hm = New-Object Security.Cryptography.HMACSHA256 (, [byte[]]$keys[32..63])
$ms = New-Object IO.MemoryStream
$ms.Write($aes.IV, 0, 16); $ms.Write($ct, 0, $ct.Length)
$tag = $hm.ComputeHash($ms.ToArray())

$out = New-Object IO.MemoryStream
$magic = [Text.Encoding]::ASCII.GetBytes("GMCLS1`n")
$out.Write($magic, 0, $magic.Length)
$out.Write([BitConverter]::GetBytes([uint16]$wrapped.Length), 0, 2)
$out.Write($wrapped, 0, $wrapped.Length)
$body = $ms.ToArray(); $out.Write($body, 0, $body.Length)
$out.Write($tag, 0, $tag.Length)
New-Item -ItemType Directory -Force -Path (Split-Path $OutFile) | Out-Null
[IO.File]::WriteAllBytes("$OutFile.part", $out.ToArray())
Move-Item -Force "$OutFile.part" $OutFile

if ($best) {
    New-Item -ItemType Directory -Force -Path $KeepDir | Out-Null
    $best.Save((Join-Path $KeepDir ([IO.Path]::GetFileNameWithoutExtension($OutFile) + ".png")), [System.Drawing.Imaging.ImageFormat]::Png)
    $best.Dispose()
} elseif ($first) {
    # nothing readable: keep what the first picture showed, to see why
    New-Item -ItemType Directory -Force -Path $KeepDir | Out-Null
    $first.Save((Join-Path $KeepDir ([IO.Path]::GetFileNameWithoutExtension($OutFile) + "-nothing-read.png")), [System.Drawing.Imaging.ImageFormat]::Png)
}
if ($first) { $first.Dispose() }
Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
$via = if ($script:FromObs) { "OBS $($script:FromObs)x" } else { "" }
if ($script:FromScreen) { $via = ($via + ", monitors $($script:FromScreen)x").TrimStart(", ") }
if ($script:FromScreen -and $script:ObsNote -and $script:ObsNote -ne "ok") { $via += " (OBS: $($script:ObsNote))" }
$line = "Classification: {0} frames from {1} screenshots kept -> {2} [{3}]" -f $frames.Count, $good, (Split-Path $OutFile -Leaf), $via
if ($KeepDir) {   # also in a log next to the pictures, in case the uploader window doesn't show it
    try { Add-Content -Path (Join-Path $KeepDir "capture-log.txt") -Value ("[{0}] {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $line) } catch { }
}
Write-Output $line
