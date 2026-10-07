# Race files

Pits n' Giggles race files (`*.json`) go in this folder, one subfolder per day
(`2026_09_30/`), the same layout as the app's own `data/<date>/race-info/`.
The uploader in `uploader/` puts them here by itself. Every file shows up on
the stats site after the next build (a few minutes).

`aliases.json` merges drivers who changed their online name: each old name
maps to the current one.
