# Race uploader

A small Windows script that watches the Pits n' Giggles save folder and sends
every new race file to `races/<date>/` in this repo. Each upload rebuilds the
site, and open pages pick up new races within a minute.

Setup on the racing PC:

1. Make a token: github.com > Settings > Developer settings > Personal access
   tokens > Fine-grained tokens > Generate new token. Repository access: Only
   select repositories > `race-stats`. Permissions: Contents > Read and write.
2. Download `RaceUploader.ps1` and `Start Race Uploader.bat` into one folder.
3. Double-click `Start Race Uploader.bat`. The first run finds the save folder,
   asks for the token and offers to start with Windows.

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
release of this repo. `scripts/telemetry/gmtel.py` turns a file into laps;
`--collisions` shows where both cars were at each contact.

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
