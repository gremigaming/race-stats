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
