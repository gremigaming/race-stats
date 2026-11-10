# Setup Apply run

Saves the setup versions waiting in `setups/registry.json` ("saved": null) into
F1 25 on GreMi's PC, by computer use. Started by the **Apply** button on the
Setup manager page (staff server `/setup-action`, which fires the Race Control
routine with "Setup Apply run"). Only run it when `apply.requested` is set.

Needs: GreMi's PC on, the Claude desktop app open and connected, the game
closed (or in the Time Trial garage). If the PC can't be reached, tell GreMi in
Discord (#change-requests or a DM) that the Apply run waits for the PC, and stop.

## 1. What waits

    git pull origin main
    python3 scripts/setup-apply/keys.py list

Nothing listed: clear nothing, stop.

## 2. Into the garage

Follow the launch route in the project memory (`f1-setup-menu-route`):
desktop shortcut, Steam "Play F1 25", title, F1 World, Play, Time Trial,
category **F1 2026** (Right x0), team **Red Bull**, track **Australia**
(row 0), garage. Click the game window first: Steam steals focus.

## 3. The plan

    python3 scripts/setup-apply/keys.py plan /tmp/apply 0

Send each file, in order, as one `computer_batch` call (every file stays
under 48 s of waits). Files named `*check*` end on a zoom:

- `switch_check_track-is-X`: the track row must show X. If not, press
  Left/Right until it does, then go on with `confirm`.
- `savelist_check_row-is-EMPTY-N-for-TRACK-KIND-V1`: a new track (the
  reverse layouts). The highlighted row must be the first empty slot after
  the last saved setup (Imola, then the reverse layouts in save order). Enter,
  type "TRACK - KIND - V1", Enter, zoom to check, Esc back to the tabs, then
  `keys.py done "TRACK" KIND 1` (quote names with a space).
- `savelist_check_row-is-TRACK-KIND-Vn`: the highlighted row of the save
  list must be "TRACK - KIND - Vn" (the version being replaced). If not, move
  Up/Down to it. Then:
  1. Enter (overwrites the highlighted slot). Screenshot.
  2. A confirm prompt: pick Okay/Yes. A name box: Ctrl+A, type the new name
     "TRACK - KIND - V<new>", Enter.
  3. If the row still shows the old name: F6 (rename), Ctrl+A, type the new
     name, Enter.
  4. Zoom on the list: the row must show the new name. Esc back to the tabs.
  5. `python3 scripts/setup-apply/keys.py done TRACK KIND V<new>` (for example
     `done AUSTRALIA race 2`).

## 4. Close

Esc x2, Esc (pause), Down x6 End Session, Enter, Up, Enter; results Enter;
Esc x2; Esc, Up, Enter quits. Release the computer-use lock.

    git add setups && git commit -m "Setup Apply run: <n> versions saved in the game" && git push origin main

The push rebuilds the site: the F1-SETUPS cards show the new versions.
Report in one line to GreMi: how many saved, any that failed.
