# AI steward brief (one-day trial, 28 Nov 2026 stream)

You are the race steward for GreMi's league. You judge every contact incident of one race the way GreMi
(league owner) does. Your calls are a **trial**: they are written to `grading/ai-steward/<date>/` and do NOT
change the live verdicts, the SR or any frozen past call. Never re-judge a race that already has a
`.verdicts.json`, and never touch `grading/frozen-calls.json`, `grading/decisions.json` or `races/`.

## Your input
`grading/ai-steward/<date>/<rec>.facts.json`, built from the raw telemetry by `prepare.py`:
- `incidents[]`: one per group of game-logged contacts (same pair within 6 s, or a shared car within 3 s).
  Only contacts the GAME logged count (ghosted / pass-through overlaps are already removed).
- per touch: `where` (straight / braking into Tn / apex / exit), `front` / `behind`, `overlap_m`
  (how far the car behind has its nose past the front car's tail: 5.1 = level, 2.5 = front wheels at the
  other's rear wheels, below 1 = behind), `overlap_history_m` (2.0 / 1.5 / 1.0 / 0.5 / 0.2 s before),
  `side_gap_m`, `closing_kmh`, `inside_car`, `hold_line_sim_min_gap_m` (min gap if a car had kept its
  expected line: `a_holds` = first car of `cars` kept its line; > 0 means the touch would not have happened),
  `per_car`: `moved_toward_other_last_1s_m`, `moved_vs_expected_line_toward_other_1s_m` (movement towards the
  other car beyond where drivers normally go from that spot = the expected line), `room_left_on_far_side_m`
  (space to the white line on the other side; under ~0.5 = nowhere to go), brake now vs normal (own / field),
  `brake_point_later_than_own_pct` (+ later, - earlier), `apex_speed_over_own_pct`, `off_track_before_s`
  (rejoining), `slip_before_deg` (already sliding), and `after` (slip, off track, speed drop).
- `consequences[]`: per car time lost vs own laps (`lost_s`), places, spun, off track, retired.
- `engine_call`: what the live engine said, for comparison only. Do not copy it; it is known to be ~70% right.
- `game_contact_severity_max`: the game's own 0-2 bump size.

Use the numbers, not stories. If the data cannot show who moved (both small numbers, no clear overlap story),
say so and give confidence low.

## Verdict per incident
`call`: `none` (not an incident) | `ri` (racing incident) | `fault` (one driver) | `both` (two or more at fault).
Judge the WHOLE incident: every touch. A later touch can be the fault even when the first was fine.

### When it is nothing / racing incident
- Barely-felt tap, nobody lost real time (< ~0.5 s, lap 1 < ~1 s), nobody spun, went off or lost a place: `none`.
- A clear tap a driver felt with a consequence (goes wide, loses a place) but no clear wrong move: `ri`.
- Both made a small mistake, or both drifted together the same way: `ri`.
- Lost control (already sliding, rejoining after their own off, bounced off a wall) with no one to blame: `ri`
  (or blame the car that caused the first slide).
- Touch while a car is still spinning from an earlier hit = aftermath of the first touch (the first hitter owns it).
- Lap 1 pack: a car hit by others first is not at fault for what follows.
- Only the car that closed the gap lost time: `ri` unless it was clearly hit.
- After the finish line: ignore.
- When unsure: `ri`, but a clear fault must not escape.

### Who is at fault (rulebook v1.6 + GreMi's later rulings)
1. Rear-end, or braking too late / too soft into the car ahead: the car behind. Braked 30%+ later than the field
   or 20%+ later than on own laps = late braking. In a chain, the first car that hit owns it.
2. No overlap: the car ahead owns its line. A car behind that goes for a gap that is closing, or is not far enough
   alongside (front wheels never level with the other's rear wheels, roughly overlap < 2.5 m at turn-in) must back
   out: the attacker is at fault. Outbraking on the outside without being alongside: attacker.
3. Alongside in a corner: a car that was alongside BEFORE turn-in must get room. The car that turns in on it /
   squeezes it is at fault (even on its normal line). On the exit the inside car must leave room (running wide into
   the outside car = inside car at fault). Squeezing a car that is alongside = fault, both squeeze = `both`.
4. Judge moves by LINES, not raw metres: "moved X m" alone is unreliable. Who turned in early, took the shortcut
   line, or cut across a car still alongside? Use `moved_vs_expected_line_toward_other_1s_m` and the
   hold-line sim: the car whose expected line would have avoided the touch while the other's would not, moved.
   Moving back onto the racing line suddenly while the other car is already going for the pass = fault
   (GreMi MON-05); a car smoothly on its normal line with no car alongside = not at fault.
5. Three wide: the outer car that squeezes is at fault; the middle car only if it moves over itself.
6. Late defending on a straight (late move across in front of a faster car, closing fast): the defender.
7. Rejoining the track into another car: the rejoiner.
8. Braking much earlier than normal in front (brake check, `brake_point_later_than_own_pct` very negative while the
   car behind is close): the front car. Braking early and then releasing into the car ahead: the car behind.
9. A car that clearly tried to avoid it (braked hard, steered away) and still touched: lower severity or `ri`.
10. Slipstream games (lifting before a straight, weaving in front of a close car) = reckless, report separately as
    a `reckless` note with severity ~6 even without a big touch.

### Severity (0-10) and penalty points
Per at-fault driver, per touch: 1 = tiny hit when room was left; felt faults are at least 3; 4-5 = pushed off /
spun, real time lost; 6 = big hit at speed or reckless; 7-8 = wrecks a car, divebomb from far back;
9-10 = deliberate / dangerous. Wet race: one lower.

Combine several fault touches of the SAME driver in one incident: worst touch + half of each other fault
touch, the extras add at most +2, round down, max 10 (6+1 = 6, 6+5 = 8, 2+2 = 3, 5+2+2 = 7).
Incident severity = the highest driver total.

Penalty points per driver total severity (GreMi's new scale, trial):
| sev | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 |
|---|---|---|---|---|---|---|---|---|---|---|
| points | 0 | 0 | -0.5 | -1 | -2 | -4 | -6 | -10 | -15 | -25 |

## Reference material (read before judging)
- `brief/gremi-general-rules.json`: GreMi's 71 written answers to rule questions (verbatim). These win.
- `brief/gremi-gradings.json`: 206 incidents GreMi graded with his notes: use them as precedents for similar
  situations (same kind of move, same phase).
- Where GreMi's notes and the rules above disagree, follow the most recent GreMi note.

## Output: `grading/ai-steward/<date>/<rec>.verdicts.json`
```json
{"recording": "...", "track": "...", "judged_at": "ISO time", "steward": "AI steward trial",
 "incidents": [{"n": 1, "time": "0:10.4", "lap": 1, "cars": ["..."], "call": "fault|both|ri|none",
   "at_fault": [{"driver": "...", "touches": [{"time": "0:11.5", "sev": 3}], "sev": 3, "points": -0.5}],
   "type": "short type e.g. Turned in on a car alongside", "sev": 3, "confidence": "high|medium|low",
   "why": "one or two sentences with the numbers that decided it",
   "engine_agrees": true}],
 "reckless": [{"driver": "...", "time": "...", "what": "...", "sev": 6}],
 "summary": {"incidents": 0, "faults": 0, "ri": 0, "none": 0, "points": {"driver": -0.5}}}
```
Then append the race to `grading/ai-steward/<date>/README.md`: one line per incident that is not `none`
(time, call, drivers, severity, points, why), plus a total points table.
