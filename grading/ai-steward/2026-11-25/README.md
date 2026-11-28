# AI steward TEST on 25 Nov Monza – calls do not change live verdicts or SR

Trial run of the AI steward (scripts/ai_steward/STEWARD.md) on the 25 Nov 2026 Monza race. The live verdicts for this race stay frozen; nothing here touches SR, grading/frozen-calls.json or grading/decisions.json.

## Monza – 2026-11-25_20-01-53_Monza

51 incidents judged: 9 fault, 0 both, 11 racing incident, 31 not an incident. Full calls: `2026-11-25_20-01-53_Monza.verdicts.json`.

| # | Time | Lap | Call | Drivers | Sev | Points | Why |
|---|---|---|---|---|---|---|---|
| 5 | 0:14.7 | 1 | ri | #8 Stepino81, #58 NEX, #13 Jakubm18_F1, #8 ItzH1ddegam1ng | – | – | Chain of three taps at 18-19 km/h closing: Hidde onto NEX (moved 2.84 m vs his line), Jakub 12.9 m off his line, Stepino onto Hidde (moved 4.47 m vs his line, took the place). Nobody lost time (all within ±0.6 s), lap 1 buffer, so racing incident. |
| 8 | 0:25.7 | 1 | fault | #21 EthanMoonski | 4 | -1 | Lap 1 run to Roggia at 310 km/h: niet_Lars123 pulled out (moved 2.09 m away from Ethan), Ethan moved 1.41 m towards him off his expected line as Lars's nose reached his rear (overlap -1.2 -> 0.45 m in 0.5 s). Hold-line sim: if Ethan had kept his line, no touch (+0.76 m). Lars went off for 5 s, lost 3.78 s and 9 places. Ethan's slide into DevilDriver at 0:28.6 is aftermath of the same move; the 0:30.0 tap was nothing. |
| 9 | 0:28.6 | 1 | fault | #8 Stepino81 | 3 | -0.5 | Hidde passed Stepino on the brakes into Roggia; at the apex Stepino was only 0.68 m past Hidde's tail (under 2.5 m) and moved 1.36 m towards him off his line (4.2 m raw). Hold-line sim: Stepino keeping his line avoids it (+0.58 m), Hidde's does not. Hidde slid 18° and lost 1.09 s (lap 1). |
| 10 | 0:31.3 | 1 | fault | #95 Fentzy | 3 | -0.5 | Lap 1 into Roggia: Fentzy braked 31% earlier than his own laps and moved 2.67 m towards Jakub under braking while Jakub had 0.26 m left to the edge. Hold-line sim: Fentzy keeping his line avoids it (+2.35 m), Jakub's does not. Jakub went off 3.5 s (-1.13 s). Jakub's closing 35 km/h from 1.8 m overlap is a doubt. Later touches (Car #25/Jakub, NEX/Hidde 27 km/h, Fentzy/NEX) are lap 1 knock-on with mixed moves: no extra blame. |
| 12 | 0:50.8 | 1 | fault | #8 niet_Lars123 | 2 | 0 | Lap 1 Lesmo apex: niet_Lars123 came from behind (overlap -0.47 m, closing 14 km/h) into Fentzy, who was on his line (moved -0.05 m). Fentzy lost 0.50 s and the place to Lars. Light tap, both continue: sev 2. |
| 14 | 0:59.7 | 1 | ri | Car #25 (hidden name, slot 5), #50 DevilDriver2396 | – | – | Car #25 passed DevilDriver into Ascari and drifted 1.15 m towards him with Devil at the edge (-0.03 m room). Devil (braked 31% earlier than own) lost 0.58 s and 2 places. Neither line alone avoids the touch in the sim, move under the 1.5 m mark: racing incident. |
| 16 | 1:15.2 | 1 | fault | Car #2 (hidden name, slot 14) | 3 | -0.5 | Into Parabolica, Car #2 (slot 14) was 1.7 m past GreMi's tail (under 2.5 m) and moved 2.16 m towards him off his line (4.1 m raw) under full braking, closing 20 km/h; GreMi moved only 0.34 m. Car #2 spun (slip 87°), lost 2.93 s and 11 places. Only he lost time, but the move was his (G1). The 1:16.8 touch is the spin itself. |
| 19 | 1:35.7 | 2 | ri | #8 Stepino81, #58 NEX, Car #25 (hidden name, slot 5) | – | – | Into Rettifilo, Stepino came from the slipstream on the outside, never alongside (overlap -0.09 m), already 0.91 m past the white line, closing 24 km/h. Car #25 drifted only 0.30 m. Stepino went off (6.5 s) and lost 1.36 s; Car #25 lost nothing. No clear wrong move by either. The 1:38.4 NEX/Car #25 touch was nothing. |
| 22 | 1:56.5 | 2 | fault | #13 Jakubm18_F1 | 2 | 0 | Roggia apex: Car #25 was alongside on the inside (overlap 4.02 m) and moved 2.65 m away; Jakub moved 1.35 m towards him off his line. Hold-line sim: Jakub keeping his line avoids it (+0.21 m). Car #25 slid 19° and lost 0.47 s and a place: light, sev 2. The 1:57.5 NEX/Jakub touch was game-logged only. |
| 23 | 1:58.6 | 2 | fault | #8 Stepino81 | 4 | -1 | Roggia: Stepino came up the inside (overlap 2.43 m), already sliding 13° and with no room left on his side (-0.07 m), and moved 1.25 m into Hidde, who was moving away (1.11 m) with 7.2 m to spare. Hidde slid 42°, lost 3.63 s and 3 places; Stepino gained 2. A battle mistake that hits a car leaving room is the mistake-maker's (Q29). |
| 24 | 2:07.7 | 2 | ri | #8 Stepino81, Car #25 (hidden name, slot 5) | – | – | Stepino dropped back from alongside and moved 1.45 m towards Car #25; game bump size 0. Only Stepino lost time (0.84 s); Car #25 gained 1.39 s. |
| 25 | 2:13.1 | 2 | ri | #8 niet_Lars123, #95 Fentzy, Car #2 (hidden name, slot 14) | – | – | Three wide: Car #2 (slot 14) inside, coming back from 2.35 m past the inside line and braking 29% earlier than own, moved 1.26 m at niet_Lars123; Lars (middle) moved 1.94 m towards Fentzy, who moved away. niet_Lars123 spun (46°) and lost 5.0 s. The sim cannot split it (no single line avoids either touch). Possible fault for Car #2/14 rejoining, staff should check. |
| 32 | 3:07.7 | 3 | ri | #8 ItzH1ddegam1ng, Car #2 (hidden name, slot 14) | – | – | Side by side through the Rettifilo (overlap 3.7 m): Car #2 (slot 14) inside braking hard at the apex (1.0 vs 0 normal), Hidde moved 0.71 m towards him. Both lines together avoid it (+0.23 m), neither alone. Car #2/14 spun and lost 1.66 s. |
| 35 | 4:03.8 | 3 | ri | #3 TTV/GreMi_Gaming, #50 DevilDriver2396 | – | – | Level through Parabolica (overlap 4.98 m); DevilDriver (inside) drifted 1.31 m towards GreMi (sim: Devil holding avoids it, +1.73 m). Game bump size 0, GreMi lost 0.29 s and 2 places. Under the 1.5 m mark: racing incident. |
| 39 | 4:43.6 | 4 | fault | #21 EthanMoonski | 3 | -0.5 | Roggia: EthanMoonski came from behind round the outside and never got alongside (overlap 0.45 m, -7.6 m 2 s before), closing 10 km/h; Car #9 was on his normal line (0.44 m away from it). Car #9 spun (80°), lost 2.13 s and 4 places. Ethan braked at the apex (0.25) and steered away: sev 3, not 4. |
| 40 | 5:25.1 | 4 | ri | #8 Stepino81, Car #9 (hidden name, slot 6) | – | – | Stepino alongside on the outside (overlap 3.77 m) at the start of braking, closing 44 km/h because Car #9 braked 0.97 vs 0.47 on his own laps. Car #9 drifted 0.67 m towards him. Both lost under 0.75 s, no slide. The 5:26.1 tap on the straight was nothing. Stepino's brake point (-252%) is a bad number. |
| 42 | 5:50.4 | 5 | fault | Car #9 (hidden name, slot 6) | 3 | -0.5 | Into Rettifilo Car #9 came up the inside from behind (overlap 0.23 m, -4.2 m 1 s before), braking 16% later than his own laps and closing 35 km/h into Stepino's rear corner. Stepino was on his line (0.32 m) and lost 1.22 s and the place to Car #9. |
| 44 | 6:03.4 | 5 | ri | #13 Jakubm18_F1, #95 Fentzy | – | – | Jakub pulled out of Fentzy's slipstream closing 28 km/h and touched his rear corner (overlap 0.25 m); Fentzy moved away. Fentzy lost 0.25 s and the place (would have gone anyway). Light tap from behind with a closing speed over 15 km/h: racing incident. |
| 48 | 6:37.3 | 5 | ri | #8 Stepino81, Car #9 (hidden name, slot 6) | – | – | Stepino sat 1.2-1.7 m into Car #9's flank at 315 km/h, then moved 2.44 m towards him while Car #9 moved 1.72 m away. Stepino slid 35° and lost 0.82 s; Car #9 lost nothing. The sim cannot show either line avoiding it, so no clear fault. |
| 49 | 6:50.3 | 5 | ri | #8 ItzH1ddegam1ng, Car #2 (hidden name, slot 14) | – | – | Both cars moved away from each other (0.68 / 0.78 m) but touched at 330 km/h before Ascari; both lost 1.4-1.8 s and swapped places, no slide. No wrong move shown. |

### Total points (trial scale)

| Driver | Points |
|---|---|
| #21 EthanMoonski | -1.5 |
| #8 Stepino81 | -1.5 |
| #95 Fentzy | -0.5 |
| Car #2 (hidden name, slot 14) | -0.5 |
| Car #9 (hidden name, slot 6) | -0.5 |
| #8 niet_Lars123 | 0 |
| #13 Jakubm18_F1 | 0 |

Reckless notes: none. The facts file has no lift-off or weaving data, so slipstream games cannot be seen from it.
