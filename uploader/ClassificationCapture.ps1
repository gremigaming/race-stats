# GreMi Gang classification capture (started by RaceUploader.ps1 after every race).
#
# When the game sends its final classification, this takes a screenshot of every
# monitor every few seconds, reads each one with Windows' own OCR (no install
# needed) and keeps the frames that look like the classification screen (several
# lap times on screen). The words and where they sit, plus the game's results
# and participants packets, are encrypted with the public key below and written
# as one .gmcls file next to the telemetry; the uploader sends it to the
# "telemetry" release. scripts/telemetry/classification_ocr.py (site build)
# decrypts it, ties every row to a car by best lap / gap / position, and so
# knows who drove the cars with hidden names.
#
# Screenshots stay on this PC (the best one is kept in -KeepDir for checking).
#
# Test without the game: -ImagePath screen.png reads that picture instead.
# Needs Windows PowerShell 5.1 (Windows' OCR is not reachable from PowerShell 7).

param(
    [Parameter(Mandatory = $true)][string]$OutFile,
    [Parameter(Mandatory = $true)][string]$Results,       # base64 final classification packet
    [string]$Participants = "",                           # base64 participants packet
    [string]$Recording = "",
    [string]$KeepDir = "",
    [string]$ImagePath = "",
    [string]$PublicKeyXml = "",
    [int]$Seconds = 240,
    [int]$Every = 3,
    [int]$WantScreens = 4
)

$ErrorActionPreference = "Stop"

# Site build's key (CLASSIFICATION_KEY secret holds the private half). Public: safe to share.
$DefaultKey = "<RSAKeyValue><Modulus>/Pjr1cZaslv+EuUveygfDluabBW1XrFtdqcbEqWeglw1cnv2stPajKcy2PKuy1fW86K3fKiWe45bXC7zliEyE7/unFUS5yBKRjdhUoICjFOXPAPLnCti1KYlNMj4+SEuMwazBb8skzlZN1pFYIQaJal+W/3EBe4vUgmHtBRdu75iCkfuY2Q1Lwm99m9f2DNmy63B6BRmw+sdeZTmFdbb2mHLEA63qbLkuM8hYsmaIQGbZTEGRqnwMXDQAvkUgtnLFDxa3n1Qy+m1Fpkpaf1lcdspiKMsFCGV4a1+F3Yd0QPOJcOVrTCxi3UjyMkNVdwXCaEx8SEEKWIhKIbk5Fbt17n1iXiqW7B4s/6JLg3hA38HCkniUKRv9ckoSOGU9KzTiVPW2+2SFRu0hnIxOMPRyQwaR3NnaVtLEE+6vRRmltK4NzV2E96re/PLtL78nVK8qBKHCom6VanBa12ZQM10Ce6U6AvJhqou9acSSmZHGFAjEUsOhL4jlyXt4Nm9bz3v</Modulus><Exponent>AQAB</Exponent></RSAKeyValue>"
if (-not $PublicKeyXml) { $PublicKeyXml = $DefaultKey }

Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Runtime.WindowsRuntime
Add-Type @"
using System.Runtime.InteropServices;
public static class GmDpi { [DllImport("user32.dll")] public static extern bool SetProcessDPIAware(); }
"@
[void][GmDpi]::SetProcessDPIAware()  # real pixels, not Windows' scaled ones

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

function Shots {
    if ($ImagePath) { return , @(, [System.Drawing.Bitmap]::FromFile((Resolve-Path $ImagePath))) }
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
$good = 0
$best = $null; $bestLaps = 0
$started = Get-Date
while ($true) {
    $t = [math]::Round(((Get-Date) - $started).TotalSeconds, 1)
    $si = 0
    foreach ($shot in (Shots)) {
        $kept = $false
        foreach ($v in (Variants $shot)) {
            $words = Read-Bitmap $v[1] $v[2]
            $v[1].Dispose()
            $laps = @($words | Where-Object { $_[0] -match $LapLike }).Count
            if ($laps -ge 4) {
                [void]$frames.Add(@{ t = $t; screen = $si; variant = $v[0]; w = $shot.Width; h = $shot.Height; words = $words })
                $kept = $true
                if ($laps -gt $bestLaps -and $KeepDir) {
                    if ($best) { $best.Dispose() }
                    $best = $shot.Clone(); $bestLaps = $laps
                }
            }
        }
        if ($kept) { $good++ }
        $shot.Dispose()
        $si++
    }
    if ($ImagePath -or $good -ge $WantScreens -or ((Get-Date) - $started).TotalSeconds -ge $Seconds) { break }
    Start-Sleep -Seconds $Every
}

# Payload: the packets and every kept frame's words
$sb = New-Object System.Text.StringBuilder
[void]$sb.Append('{"v":1,"recording":' + (Json-Text $Recording) + ',"captured":"' + (Get-Date).ToString("s") +
    '","results":"' + $Results + '","participants":"' + $Participants + '","frames":[')
for ($i = 0; $i -lt $frames.Count; $i++) {
    $f = $frames[$i]
    if ($i) { [void]$sb.Append(',') }
    [void]$sb.Append('{"t":' + $f.t.ToString([Globalization.CultureInfo]::InvariantCulture) + ',"screen":' + $f.screen +
        ',"variant":"' + $f.variant + '","w":' + $f.w + ',"h":' + $f.h + ',"words":[')
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
}
Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
Write-Output ("Classification: {0} frames from {1} screenshots kept -> {2}" -f $frames.Count, $good, (Split-Path $OutFile -Leaf))
