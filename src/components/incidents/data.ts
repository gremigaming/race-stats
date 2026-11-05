import { useQueries, useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { driverKey } from "../../league/league";
import { incidentsOf, loadManifest, loadRaceIndex, type RaceIncident, type RaceIndexEntry, type RaceManifest } from "../../viewer/format";
import { atFaultOf, carsOf, kindOf, severityOf, type IncidentKind } from "../../viewer/incidentKinds";

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
}

export const raceTime = (r: RaceIndexEntry) => Date.parse(`${r.started}Z`);

/** Every race the viewer knows (newest first). */
export function useRaceIndex() {
  return useQuery({ queryKey: ["race-index"], queryFn: loadRaceIndex, staleTime: 60_000 });
}

/** Races one evening apart are one stream: a new stream starts after a 4 h gap. */
export function streamOf(races: RaceRef[], uid: string): RaceRef[] {
  const asc = [...races].sort((a, b) => raceTime(a) - raceTime(b));
  const groups: RaceRef[][] = [];
  for (const r of asc) {
    const g = groups[groups.length - 1];
    if (g && raceTime(r) - raceTime(g[g.length - 1]) < 4 * 3600_000) g.push(r);
    else groups.push([r]);
  }
  return groups.find((g) => g.some((r) => r.uid === uid)) ?? [];
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

export function rowsOf(race: RaceRef, m: RaceManifest): Row[] {
  const name = (car: number) => m.cars[String(car)]?.name ?? `Car ${car}`;
  const start = m.lap_starts?.[0] ?? chunkStart(m);
  const at = raceTime(race);
  return incidentsOf(m).map((inc, k) => {
    const cars = carsOf(inc);
    const names = cars.map(name);
    const kind = kindOf(inc);
    return {
      id: `${race.uid}:${k}`,
      uid: race.uid,
      race,
      k,
      inc,
      sev: severityOf(inc),
      kind,
      tap: kind === "tap",
      cars,
      names,
      keys: names.map(driverKey),
      fault: atFaultOf(inc).map((c) => driverKey(name(c))),
      start,
      at,
    };
  });
}

export const biggestFirst = (a: Row, b: Row) => b.sev - a.sev || b.cars.length - a.cars.length || a.at - b.at || a.inc.t0 - b.inc.t0;
export const chronological = (a: Row, b: Row) => a.at - b.at || a.inc.t0 - b.inc.t0;
