import { useQueries, useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { driverKey } from "../../league/league";
import { incidentsOf, loadManifest, startedMs, loadRaceIndex, type RaceIncident, type RaceIndexEntry, type RaceManifest } from "../../viewer/format";
import { atFaultOf, carsOf, kindOf, severityOf, type IncidentKind } from "../../viewer/incidentKinds";
import { loadLeagueJson } from "../../league/liveData";

export type RaceRef = RaceIndexEntry & { base: string };

/** One incident of one race, with everything the incident viewer filters and sorts on. */
export interface Row {
  id: string;
  uid: string;
  race: RaceRef;
  k: number;
  inc: RaceIncident;
  sev: number;
  kind: IncidentKind;
  tap: boolean;
  cars: number[];
  names: string[];
  /** driverKey of each car, same order as cars. */
  keys: string[];
  fault: string[];
  /** Race time (session s) of the race's first lap start: clocks are shown from it. */
  start: number;
  /** When the race started (ms since epoch), for time ranges and chronological order. */
  at: number;
  /** The race file of the league data (for links to the safety rating), when the league call was found. */
  file?: string;
}

export const raceTime = (r: RaceIndexEntry) => startedMs(r.started);

/** Every race the viewer knows (newest first). */
export function useRaceIndex() {
  return useQuery({ queryKey: ["race-index"], queryFn: loadRaceIndex, staleTime: 60_000 });
}

/** Every stream, newest first, each in race order: a new stream starts after a 4 h gap. */
export function streamsOf(races: RaceRef[]): RaceRef[][] {
  const asc = [...races].sort((a, b) => raceTime(a) - raceTime(b));
  const groups: RaceRef[][] = [];
  for (const r of asc) {
    const g = groups[groups.length - 1];
    if (g && raceTime(r) - raceTime(g[g.length - 1]) < 4 * 3600_000) g.push(r);
    else groups.push([r]);
  }
  return groups.reverse();
}

/** The stream (one evening) a race belongs to. */
export function streamOf(races: RaceRef[], uid: string): RaceRef[] {
  return streamsOf(races).find((g) => g.some((r) => r.uid === uid)) ?? [];
}

/** The manifests of these races (cached: a finished race never changes). */
export function useManifests(uids: string[]) {
  const results = useQueries({
    queries: uids.map((uid) => ({
      queryKey: ["race-manifest", uid],
      queryFn: () => loadManifest(uid),
      staleTime: Infinity,
      gcTime: 30 * 60_000,
    })),
  });
  // the same Map until a manifest arrives, so everything built from it stays put between renders
  const stamp = uids.map((u, i) => `${u}@${results[i]?.dataUpdatedAt ?? 0}`).join("|");
  const map = useMemo(() => {
    const out = new Map<string, { manifest: RaceManifest; base: string }>();
    results.forEach((r, i) => {
      if (r.data) out.set(uids[i], r.data);
    });
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stamp]);
  return { map, loading: results.filter((r) => r.isLoading).length };
}

/** Session time where the race's chunks begin (the race viewer counts ?inc= from here). */
export function chunkStart(m: RaceManifest) {
  const ks = m.chunks.map((n) => parseInt(n, 10)).filter(Number.isFinite);
  return ks.length ? Math.min(...ks) * (m.chunk_seconds || 10) : 0;
}

/** One collision of league/incidents.json (scripts/safety_rating.py): the FINAL call per driver,
 * with staff calls, grades and precedents applied ([points, "severity N/10, to blame (R..) ..; why"]). */
export interface LeagueCall {
  file: string;
  lap: number | null;
  type?: string;
  names: string[];
  lines: Record<string, [number, string]>;
  /** Race viewer link: ?inc= is the contact on the recording's clock (the manifests' clock). */
  watch?: string;
}

/** league/incidents.json: the calls the safety rating uses, so the viewer shows the same severity and blame. */
export function useLeagueCalls() {
  return useQuery({
    queryKey: ["league-calls"],
    queryFn: () => loadLeagueJson<{ incidents: LeagueCall[] }>("incidents.json").then((d) => d.incidents ?? []),
    staleTime: 60_000,
  });
}

const norm = (x: string) => x.toLowerCase().replace(/[^a-z0-9]/g, "");
const FILE_RE = /^Race_(.+)_(\d{4})_(\d\d)_(\d\d)_(\d\d)_(\d\d)_(\d\d)\.json$/;

/** The calls of one race: same track, race file saved up to 4 h after the race started. */
export function callsOfRace(race: RaceRef, calls: LeagueCall[] | undefined): LeagueCall[] {
  if (!calls?.length) return [];
  const rt = raceTime(race);
  return calls.filter((c) => {
    const m = FILE_RE.exec(c.file);
    if (!m || !norm(m[1]).startsWith(norm(race.track))) return false;
    const d = Date.UTC(+m[2], +m[3] - 1, +m[4], +m[5], +m[6], +m[7]) - rt;
    return d > -10 * 60_000 && d < 4 * 3600_000;
  });
}

const TYPE_KIND: Record<string, IncidentKind> = {
  "Rear-end": "rear", "Moved across alongside": "side", "Late lunge / divebomb": "lunge", "Unsafe rejoin": "rejoin",
  "Blocking / brake-check": "block", Retaliation: "retaliation", "Lost control": "control", "Chain reaction": "control",
  "Racing incident": "racing", "Not an incident": "tap",
};

/** The final call on this incident (staff call, grade or precedent over the rulebook), when the league data has it. */
function finalCall(inc: RaceIncident, names: string[], calls: LeagueCall[], cs: number) {
  const keys = new Set(names.map(driverKey));
  let best: LeagueCall | null = null;
  let bestD = 3;
  for (const c of calls) {
    const t = Number(/[?&]inc=([\d.]+)/.exec(c.watch ?? "")?.[1]);
    if (!Number.isFinite(t)) continue;
    const d = Math.min(Math.abs(t - inc.t0), Math.abs(t + cs - inc.t0));
    if (d >= bestD || !c.names.some((n) => keys.has(driverKey(n)))) continue;
    best = c;
    bestD = d;
  }
  if (!best) return null;
  const lines = Object.entries(best.lines);
  const sevOf = (t: string) => Number(/severity (\d+)\/10/.exec(t)?.[1] ?? 0);
  const fault = lines.filter(([, [p]]) => p < 0);
  const sev = Math.max(0, ...(fault.length ? fault : lines).map(([, [, t]]) => sevOf(t)));
  const why = lines.map(([, [, t]]) => t.split("; ").slice(1).join("; ")).find(Boolean) ?? "";
  return { call: best, fault: fault.map(([n]) => n), sev, why };
}

export function rowsOf(race: RaceRef, m: RaceManifest, calls: LeagueCall[] = []): Row[] {
  const name = (car: number) => m.cars[String(car)]?.name ?? `Car ${car}`;
  const start = m.lap_starts?.[0] ?? chunkStart(m);
  const at = raceTime(race);
  return incidentsOf(m).map((inc0, k) => {
    const cars = carsOf(inc0);
    const names = cars.map(name);
    // GreMi, 6 Nov 2026: the viewer shows the same call as the safety rating and the staff page
    const fc = calls.length ? finalCall(inc0, names, calls, chunkStart(m)) : null;
    let inc = inc0;
    if (fc && inc0.verdict) {
      const carOf = (n: string) => cars[names.findIndex((x) => driverKey(x) === driverKey(n))];
      const faultCars = fc.fault.map(carOf).filter((c): c is number => c !== undefined);
      inc = {
        ...inc0,
        verdict: {
          ...inc0.verdict,
          severity: fc.sev || inc0.verdict.severity,
          at_fault: faultCars[0] ?? null,
          rule: faultCars.length > 1 ? "R8" : inc0.verdict.rule,
          verdict: fc.fault.length ? `${fc.fault.join(" + ")} at fault` : inc0.verdict.at_fault == null ? inc0.verdict.verdict : "Nobody at fault",
          why: fc.why || inc0.verdict.why,
        },
      };
    }
    const kind = (fc?.call.type && TYPE_KIND[fc.call.type]) || kindOf(inc);
    return {
      id: `${race.uid}:${k}`,
      uid: race.uid,
      race,
      k,
      inc,
      sev: kind === "tap" ? Math.min(severityOf(inc), 1) : severityOf(inc),
      kind,
      tap: kind === "tap",
      cars,
      names,
      keys: names.map(driverKey),
      fault: fc ? fc.fault.map(driverKey) : atFaultOf(inc).map((c) => driverKey(name(c))),
      start,
      at,
      file: fc?.call.file,
    };
  });
}

export const biggestFirst = (a: Row, b: Row) => b.sev - a.sev || b.cars.length - a.cars.length || a.at - b.at || a.inc.t0 - b.inc.t0;
export const chronological = (a: Row, b: Row) => a.at - b.at || a.inc.t0 - b.inc.t0;
