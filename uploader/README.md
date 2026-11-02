# Race uploader

A small Windows script that watches the Pits n' Giggles save folder. With the
live-server token enabled, each finalized session is sent straight to the warm
publisher and appears on the site in seconds; GitHub still receives the archive
copy. The site polls live data every 10 seconds and falls back to its Pages data
when the live service is unavailable. Pages rebuilds still reconcile archive
and code changes on their scheduled run.

Setup on the racing PC:

1. Make a token: github.com > Settings > Developer settings > Personal access
   tokens > Fine-grained tokens > Generate new token. Repository access: Only
   select repositories > `race-stats`. Permissions: Contents > Read and write.
2. Download `RaceUploader.ps1`, `TelemetryRecorder.cs`, and `Start Race Uploader.bat`
   into one folder. The C# file also contains the authenticated live file uploader.
3. Double-click `Start Race Uploader.bat`. The first run finds the save folder,
   asks for the GitHub token and the live-server token, then offers to start
   with Windows. Press Enter at the live-token prompt to keep archive-only mode.

Settings live in `%APPDATA%\GreMiRaceUploader` (delete that folder to start over).

### Driving telemetry

The race uploader also records your own car's detailed telemetry: speed,
throttle, brake, steering, gear, g-forces, wheel slip, suspension, camber,
tyre and brake temperatures and your setup, for every frame the game sends.

1. Download `TelemetryRecorder.cs` into the same folder as `RaceUploader.ps1`
   (and get the newest `RaceUploader.ps1` too), then restart the uploader.
   It should say "Telemetry recorder listening on 127.0.0.1:20778".
2. In Pits n' Giggles: Settings > UDP Forwarding > Target 1 = `127.0.0.1:20778`,
   save and restart Pits n' Giggles.
3. In the game: Settings > Telemetry Settings > UDP Send Rate = 60Hz.

Since 19 Oct 2026 it also keeps short rows for every car in the session
(position, heading, speed, throttle, brake, steering, lap distance, and since
20 Oct 2026 the surface under each wheel: kerb, grass, gravel): 10 per
second, and 30 per second from 5 s before to 3 s after each collision, so the
safety rating can see who was alongside, behind or moving over. The game sends
these for every car, Restricted telemetry included.

Each session (practice, quali, race, time trial) becomes one file in
`%APPDATA%\GreMiRaceUploader\telemetry`, which goes to the `telemetry`
release of this repo and, when live upload is enabled, directly to the warm
publisher. `scripts/telemetry/gmtel.py` turns a file into laps;
`--collisions` shows where both cars were at each contact.

### Standings on screen (hidden names)

Download `ClassificationCapture.ps1` into the same folder (with the newest
`RaceUploader.ps1` and `TelemetryRecorder.cs`) and restart the uploader. The
moment you cross the finish line in a race (or when the results come in, if you
didn't finish), it takes a screenshot every 3 s and reads it with Windows'
built-in OCR: first the live standings tower (the whole grid, while the others
finish), then the final classification screen, stopping 60 s after the results.
Every screenshot is stored with the game's live lap data of that moment, so each
row is tied to a car even if places change later. Only the words (encrypted,
`.gmcls`) go to the `telemetry` release and the live server. The live server
publishes provisional results immediately, then updates hidden names when its
classification decryption key is configured and analysis finishes. The best screenshot of each race stays in
`%APPDATA%\GreMiRaceUploader\classification` for checking (kept 30 days).

- Stay on the game (don't tab out) for a minute after you finish.
- The game must show online names on your screen, and run borderless or windowed
  (exclusive fullscreen can give black screenshots).

## Clip uploader

`ClipUploader.ps1` does the same for OBS clips: every new clip in your OBS clips
folder goes to the private `clip-studio` repo, where new clips get scored and the
best ones edited every night.

1. Make a second token the same way, but with Repository access > Only select
   repositories > `clip-studio`, and Contents > Read and write.
2. Download `ClipUploader.ps1` and `Start Clip Uploader.bat` into the same folder.
3. Double-click `Start Clip Uploader.bat`. The first run asks for the OBS clips
   folder and the token, and offers to start with Windows. Clips already in the
   folder are skipped; only new ones are sent.

Settings live in `%APPDATA%\GreMiClipUploader`.
