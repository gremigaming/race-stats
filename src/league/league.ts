import type { DriverData, TelemetrySession } from "../types/telemetry";
import { getFormulaComparisonKey } from "../utils/sessionTypes";

/**
 * GreMi Gang league mode.
 *
 * The upstream viewer is built around one person: the driver whose PC saved
 * the file (`is-player`). Here every lobby race is shared, so the app is
 * re-centred on whichever driver the visitor picks: we move the `is-player`
 * flag to that driver before the normal summary/analysis code runs.
 */

export interface LeagueIndex {
  /** Session files under `league/sessions/`, newest first. */
  files: string[];
  /** Driver key shown when the visitor hasn't picked anyone yet. */
  defaultDriver?: string;
}

export interface LeagueRace {
  file: string;
  session: TelemetrySession;
}

export interface LeagueDriver {
  key: string;
  name: string;
}

/** Driver names can carry non-breaking spaces and odd spacing. */
export function displayName(name: string): string {
  return name.replace(/[\s ]+/g, " ").trim();
}

export function driverKey(name: string): string {
  return displayName(name).toLowerCase();
}

/**
 * Drivers who hide their online name show up as "<team> #<number>", which is
 * neither unique nor stable between races, so they can't have a profile.
 */
export function isNamedDriver(driver: DriverData): boolean {
  const name = displayName(driver["driver-name"] ?? "");
  if (!name) return false;
  if (driver["participant-data"]?.["show-online-names"] === false) return false;
  return !/^\d+ #\d+$/.test(name);
}

export function raceFormulaKey(session: TelemetrySession): string {
  return getFormulaComparisonKey(
    session["session-info"]?.formula,
    session["game-year"],
  );
}

export function isRaceSession(session: TelemetrySession): boolean {
  return /race/i.test(session["session-info"]?.["session-type"] ?? "");
}

export function namedDrivers(session: TelemetrySession): DriverData[] {
  return (session["classification-data"] ?? []).filter(isNamedDriver);
}

/** Everyone with a profile, most races first. */
export function listDrivers(races: LeagueRace[]): LeagueDriver[] {
  const counts = new Map<string, { name: string; races: number }>();
  for (const { session } of races) {
    const seen = new Set<string>();
    for (const d of namedDrivers(session)) {
      const key = driverKey(d["driver-name"]);
      if (seen.has(key)) continue;
      seen.add(key);
      const entry = counts.get(key) ?? {
        name: displayName(d["driver-name"]),
        races: 0,
      };
      entry.races += 1;
      counts.set(key, entry);
    }
  }
  return [...counts.entries()]
    .sort((a, b) => b[1].races - a[1].races || a[1].name.localeCompare(b[1].name))
    .map(([key, v]) => ({ key, name: v.name }));
}

/**
 * The session as seen by `key`: that driver becomes the player. Returns null
 * when the driver wasn't in this session. The original saver's start reaction
 * time is theirs alone, so it is dropped for anyone else.
 */
export function asSeenBy(
  session: TelemetrySession,
  key: string,
): TelemetrySession | null {
  const drivers = session["classification-data"] ?? [];
  const target = drivers.find(
    (d) => isNamedDriver(d) && driverKey(d["driver-name"]) === key,
  );
  if (!target) return null;
  const copy = structuredClone(session);
  let wasPlayer = false;
  for (const d of copy["classification-data"]) {
    const isTarget =
      isNamedDriver(d) && driverKey(d["driver-name"]) === key && !wasPlayer;
    if (isTarget) wasPlayer = d["is-player"];
    d["is-player"] = isTarget;
  }
  if (!wasPlayer) {
    const info = copy["session-info"] as unknown as Record<string, unknown>;
    if ("start-reaction-time" in info) info["start-reaction-time"] = 0;
  }
  return copy;
}

// ---------------------------------------------------------------- results

export interface DriverResult {
  file: string;
  track: string;
  date: string;
  position: number | null;
  grid: number | null;
  status: string;
  points: number;
  bestLapMs: number | null;
  fastestLap: boolean;
  pole: boolean;
  field: number;
}

function sessionDate(file: string): string {
  const m = file.match(/(\d{4})_(\d{2})_(\d{2})_(\d{2})_(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}` : "";
}

function finished(status: string): boolean {
  return status === "FINISHED" || status === "ACTIVE" || status === "";
}

/** One result per named driver per race. */
export function raceResults(race: LeagueRace): Map<string, DriverResult> {
  const { session, file } = race;
  const drivers = session["classification-data"] ?? [];
  const fastest = session.records?.fastest?.lap;
  const out = new Map<string, DriverResult>();
  for (const d of drivers) {
    if (!isNamedDriver(d)) continue;
    const key = driverKey(d["driver-name"]);
    if (out.has(key)) continue;
    const fc = d["final-classification"];
    const best = fc?.["best-lap-time-ms"] ?? 0;
    out.set(key, {
      file,
      track: session["session-info"]?.["track-id"] ?? "",
      date: sessionDate(file),
      position: fc?.position ?? null,
      grid: fc?.["grid-position"] ?? null,
      status: fc?.["result-status"] ?? "",
      points: fc?.points ?? 0,
      bestLapMs: best > 0 ? best : null,
      fastestLap:
        fastest != null &&
        driverKey(fastest["driver-name"] ?? "") === key,
      pole: fc?.["grid-position"] === 1,
      field: drivers.length,
    });
  }
  return out;
}

export interface LeaderboardRow {
  key: string;
  name: string;
  races: number;
  wins: number;
  podiums: number;
  poles: number;
  fastestLaps: number;
  points: number;
  avgFinish: number | null;
  bestFinish: number | null;
  avgGain: number | null;
  dnfs: number;
}

export function leaderboard(races: LeagueRace[]): LeaderboardRow[] {
  const rows = new Map<string, LeaderboardRow & { finishes: number[]; gains: number[] }>();
  for (const race of races) {
    if (!isRaceSession(race.session)) continue;
    const names = new Map(
      namedDrivers(race.session).map((d) => [
        driverKey(d["driver-name"]),
        displayName(d["driver-name"]),
      ]),
    );
    for (const [key, r] of raceResults(race)) {
      const row =
        rows.get(key) ??
        {
          key,
          name: names.get(key) ?? key,
          races: 0,
          wins: 0,
          podiums: 0,
          poles: 0,
          fastestLaps: 0,
          points: 0,
          avgFinish: null,
          bestFinish: null,
          avgGain: null,
          dnfs: 0,
          finishes: [],
          gains: [],
        };
      row.races += 1;
      row.points += r.points;
      if (r.pole) row.poles += 1;
      if (r.fastestLap) row.fastestLaps += 1;
      if (!finished(r.status)) row.dnfs += 1;
      else if (r.position != null) {
        row.finishes.push(r.position);
        if (r.position === 1) row.wins += 1;
        if (r.position <= 3) row.podiums += 1;
        if (r.grid != null && r.grid > 0) row.gains.push(r.grid - r.position);
      }
      rows.set(key, row);
    }
  }
  const avg = (xs: number[]) =>
    xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
  return [...rows.values()]
    .map(({ finishes, gains, ...row }) => ({
      ...row,
      avgFinish: avg(finishes),
      bestFinish: finishes.length ? Math.min(...finishes) : null,
      avgGain: avg(gains),
    }))
    .sort(
      (a, b) =>
        b.points - a.points ||
        b.wins - a.wins ||
        (a.avgFinish ?? 99) - (b.avgFinish ?? 99),
    );
}

export interface HeadToHeadRace {
  file: string;
  track: string;
  date: string;
  a: DriverResult;
  b: DriverResult;
}

export interface HeadToHead {
  races: HeadToHeadRace[];
  aAhead: number;
  bAhead: number;
  aFasterLap: number;
  bFasterLap: number;
}

/** Races both drivers were in, and who came out ahead. */
export function headToHead(races: LeagueRace[], a: string, b: string): HeadToHead {
  const shared: HeadToHeadRace[] = [];
  for (const race of races) {
    if (!isRaceSession(race.session)) continue;
    const results = raceResults(race);
    const ra = results.get(a);
    const rb = results.get(b);
    if (!ra || !rb) continue;
    shared.push({ file: race.file, track: ra.track, date: ra.date, a: ra, b: rb });
  }
  shared.sort((x, y) => y.date.localeCompare(x.date));
  const rank = (r: DriverResult) =>
    finished(r.status) && r.position != null ? r.position : 1000;
  let aAhead = 0;
  let bAhead = 0;
  let aFasterLap = 0;
  let bFasterLap = 0;
  for (const r of shared) {
    if (rank(r.a) < rank(r.b)) aAhead += 1;
    else if (rank(r.b) < rank(r.a)) bAhead += 1;
    if (r.a.bestLapMs && r.b.bestLapMs) {
      if (r.a.bestLapMs < r.b.bestLapMs) aFasterLap += 1;
      else if (r.b.bestLapMs < r.a.bestLapMs) bFasterLap += 1;
    }
  }
  return { races: shared, aAhead, bAhead, aFasterLap, bFasterLap };
}

export function formatLap(ms: number | null): string {
  if (!ms) return "—";
  const m = Math.floor(ms / 60000);
  const s = ((ms % 60000) / 1000).toFixed(3).padStart(6, "0");
  return `${m}:${s}`;
}

export function formatStatus(r: DriverResult): string {
  if (finished(r.status) && r.position != null) return `P${r.position}`;
  if (r.status === "DID_NOT_FINISH") return "DNF";
  if (r.status === "DISQUALIFIED") return "DSQ";
  return r.status ? r.status.replace(/_/g, " ").toLowerCase() : "—";
}
