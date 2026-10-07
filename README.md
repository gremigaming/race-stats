# GreMi Gang Race Stats

Every race from the GreMi Gang lobbies, for every driver: results, lap times,
tyre stints, position charts, a drivers leaderboard and head-to-head.

Live at https://gremigaming.github.io/race-stats/

## How it works

1. Pits n' Giggles saves a JSON file after every race.
2. Those files go in [`races/`](races/).
3. On every push, GitHub Actions turns them into site data
   (`scripts/build-league-data.mjs`) and publishes the site to GitHub Pages.

Pick your name at the top left and the whole app shows your races. Drivers who
hide their online name in the game can't get their own stats.

## Credits

This site is a modified copy of [F1 Telemetry Viewer](https://github.com/linuz90/f1-telemetry-viewer)
by Fabrizio Rinaldi ([@linuz90](https://x.com/linuz90)), MIT licensed (see [LICENSE](LICENSE)),
made for telemetry from [Pits n' Giggles](https://github.com/ashwin-nat/pits-n-giggles)
by Ashwin Natarajan.

Changes for GreMi Gang: league data loading, a driver picker that re-centres the
app on any driver, the leaderboard and head-to-head pages.
