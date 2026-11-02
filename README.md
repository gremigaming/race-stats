# GreMi Gang Race Stats

Every race from the GreMi Gang lobbies, for every driver: results, lap times,
tyre stints, position charts, a drivers leaderboard and head-to-head.

Live at https://gremigaming.github.io/race-stats/

## How it works

1. Pits n' Giggles saves a JSON file after every session.
2. The uploader sends each save and its telemetry to the warm live publisher,
   and keeps the archive copy in [`races/`](races/) and the telemetry release.
3. The live server runs the same builders as Pages and publishes versioned data
   to R2. Open pages poll its index every 10 seconds; GitHub Pages remains the
   fallback and scheduled reconciliation path.

Pick your name at the top left and the whole app shows your races. Drivers who
hide their online name in the game can't get their own stats.

## Credits

This site is a modified copy of [F1 Telemetry Viewer](https://github.com/linuz90/f1-telemetry-viewer)
by Fabrizio Rinaldi ([@linuz90](https://x.com/linuz90)), MIT licensed (see [LICENSE](LICENSE)),
made for telemetry from [Pits n' Giggles](https://github.com/ashwin-nat/pits-n-giggles)
by Ashwin Natarajan.

Changes for GreMi Gang: league data loading, a driver picker that re-centres the
app on any driver, the leaderboard and head-to-head pages.
