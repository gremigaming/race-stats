import type { DriverData } from "../types/telemetry";
import {
  displayName,
  driverKey,
  isNamedDriver,
  isRaceSession,
  raceDate,
  type LeagueRace,
} from "./league";

/**
 * GreMi Gang safety rating (SR), 0 to 99, everyone starts at 50 (tier C),
 * the same scale the old Signupbot rating used.
 *
 * Every race gives incident points (IP): 2 per contact (one per other car per
 * lap), 1 per corner-cutting or other warning, 2 per time penalty, 4 per
 * drive-through, 6 per stop-go. Races are compared with the league's typical
 * rate (TARGET_IP_PER_LAP, the median over the first ~2,000 driver-races):
 * cleaner than that and SR goes up, messier and it goes down. Longer races
 * count more. Gains shrink near the top and losses near the bottom, so a
 * rating has to be earned and nobody gets stuck at 0. Who caused a contact
 * isn't in the data, so both cars get it, like in iRacing.
 */
export const SR_START = 50;
const SR_MAX = 99;
const TARGET_IP_PER_LAP = 1.8;
const MAX_GAIN = 4;
const MAX_LOSS = 6;

const PENALTY_POINTS: Record<string, number> = {
  "Corner Cutting Warning": 1,
  "Other Warning": 1,
  "Time Penalty": 2,
  "Dt Penalty": 4,
  "Sg Penalty": 6,
};

export const SR_TIERS = [
  { tier: "A", min: 75, color: "text-emerald-300", ring: "ring-emerald-400/30 bg-emerald-500/10" },
  { tier: "B", min: 60, color: "text-sky-300", ring: "ring-sky-400/30 bg-sky-500/10" },
  { tier: "C", min: 45, color: "text-amber-300", ring: "ring-amber-400/30 bg-amber-500/10" },
  { tier: "D", min: 30, color: "text-orange-300", ring: "ring-orange-400/30 bg-orange-500/10" },
  { tier: "E", min: 0, color: "text-red-300", ring: "ring-red-400/30 bg-red-500/10" },
] as const;

export type SrTier = (typeof SR_TIERS)[number];

export function tierOf(sr: number): SrTier {
  return SR_TIERS.find((t) => sr >= t.min) ?? SR_TIERS[SR_TIERS.length - 1];
}

export interface RaceIncidents {
  file: string;
  date: Date | null;
  laps: number;
  contacts: number;
  warnings: number;
  penalties: number;
  points: number;
  srBefore: number;
  srAfter: number;
}

export interface SafetyRow {
  key: string;
  name: string;
  sr: number;
  races: number;
  laps: number;
  points: number;
  contacts: number;
  warnings: number;
  penalties: number;
  history: RaceIncidents[];
}

interface Collisions {
  "collision-pairs"?: {
    "driver-1-name": string;
    "driver-2-name": string;
    collisions?: {
      "driver-1-name": string;
      "driver-1-lap": number;
      "driver-2-lap": number;
    }[];
  }[];
}

function incidents(d: DriverData) {
  const me = driverKey(d["driver-name"]);
  const laps = (d["session-history"]?.["lap-history-data"] ?? []).filter(
    (l) => l["lap-time-in-ms"] > 0,
  ).length;
  // One contact per other car per lap: a long scrape logs many collisions
  const contacts = new Set<string>();
  const pairs = (d as unknown as { collisions?: Collisions }).collisions?.["collision-pairs"] ?? [];
  for (const p of pairs) {
    const a = driverKey(p["driver-1-name"]);
    const b = driverKey(p["driver-2-name"]);
    if (a !== me && b !== me) continue;
    const other = a === me ? b : a;
    for (const c of p.collisions ?? []) {
      const lap = driverKey(c["driver-1-name"]) === me ? c["driver-1-lap"] : c["driver-2-lap"];
      contacts.add(`${other}@${lap}`);
    }
  }
  let warnings = 0;
  let penalties = 0;
  let penaltyPoints = 0;
  for (const e of d["warning-penalty-history"] ?? []) {
    const pts = PENALTY_POINTS[e["entry-type"]] ?? 0;
    if (/warning/i.test(e["entry-type"])) warnings += 1;
    else if (pts) penalties += 1;
    penaltyPoints += pts;
  }
  return {
    laps,
    contacts: contacts.size,
    warnings,
    penalties,
    points: contacts.size * 2 + penaltyPoints,
  };
}

/** SR change for one race, starting from `sr`. */
export function srChange(sr: number, points: number, laps: number): number {
  if (laps <= 0) return 0;
  const rate = points / laps;
  const weight = Math.min(laps, 10) / 5;
  const delta = Math.max(
    -MAX_LOSS,
    Math.min(MAX_GAIN, 3 * weight * (1 - rate / TARGET_IP_PER_LAP)),
  );
  return delta > 0
    ? (delta * (SR_MAX - sr)) / (SR_MAX - SR_START)
    : (delta * sr) / SR_START;
}

/**
 * Everyone's SR, replaying every race in date order. Always over all races
 * (a rating carries over), whatever the site filter shows.
 */
export function safetyRatings(races: LeagueRace[]): Map<string, SafetyRow> {
  const ordered = races
    .filter((r) => isRaceSession(r.session))
    .map((r) => ({ race: r, date: raceDate(r.file) }))
    .sort((a, b) => (a.date?.getTime() ?? 0) - (b.date?.getTime() ?? 0));
  const rows = new Map<string, SafetyRow>();
  for (const { race, date } of ordered) {
    const seen = new Set<string>();
    for (const d of race.session["classification-data"] ?? []) {
      if (!isNamedDriver(d)) continue;
      const key = driverKey(d["driver-name"]);
      if (seen.has(key)) continue;
      seen.add(key);
      const inc = incidents(d);
      if (inc.laps === 0) continue;
      const row = rows.get(key) ?? {
        key,
        name: displayName(d["driver-name"]),
        sr: SR_START,
        races: 0,
        laps: 0,
        points: 0,
        contacts: 0,
        warnings: 0,
        penalties: 0,
        history: [],
      };
      const before = row.sr;
      row.sr = Math.max(0, Math.min(SR_MAX, row.sr + srChange(row.sr, inc.points, inc.laps)));
      row.name = displayName(d["driver-name"]);
      row.races += 1;
      row.laps += inc.laps;
      row.points += inc.points;
      row.contacts += inc.contacts;
      row.warnings += inc.warnings;
      row.penalties += inc.penalties;
      row.history.push({ file: race.file, date, ...inc, srBefore: before, srAfter: row.sr });
      rows.set(key, row);
    }
  }
  return rows;
}

/** SR change over the races in `files` (the site filter). */
export function srChangeIn(row: SafetyRow, files: Set<string>): number | null {
  const inside = row.history.filter((h) => files.has(h.file));
  if (!inside.length) return null;
  return inside[inside.length - 1].srAfter - inside[0].srBefore;
}
