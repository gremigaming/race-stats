# GreMi Gang Race Stats

A modified copy of linuz90's F1 Telemetry Viewer (see README credits), published
on GitHub Pages by `.github/workflows/site.yml`.

- League changes live in `src/league/league.ts`, `src/context/TelemetryContext.tsx`
  ("league" mode), `src/pages/DriversPage.tsx`, `src/pages/HeadToHeadPage.tsx`
  and the driver picker in `src/components/Layout.tsx`.
- Race files go in `races/`; `scripts/build-league-data.mjs` writes
  `public/league/` at build time (not committed).
- Push to `main` only; this repo keeps one branch.
- Run the site workflow by hand with `previews` on to get screenshots of the
  main pages committed to `previews/` (`scripts/screenshots.mjs`).
- New race files arrive from `uploader/RaceUploader.ps1` on the racing PC.
- Keep the in-app “What's new” list in `src/data/changelog.ts` current when
  making user-facing changes. Turn relevant recent commits into concise,
  GreMi Gang Race Stats-specific highlights. Give each row one distinct
  feature or fix, group related details of that feature together, and give
  each row a relevant in-app destination. Omit routine race uploads and
  staff-only or driver-specific corrections. Keep upstream repository and
  author links out of the modal.
