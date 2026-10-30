/**
 * The Live Race Viewer's data: a race manifest plus 10 s chunks of every car, written by the
 * live server (gremigaming/race-control-stats, live/race.py) and, for recorded races, by
 * scripts/telemetry/race_bundles.py. Both use the same "GMLC" chunk format.
 */

export interface RaceCar {
  name: string;
  team: number | null;
  team_name?: string | null;
  number: number;
  ai: boolean;
}

export interface RaceEvent {
  t: number;
  code: string;
  a?: number;
  b?: number;
  car?: number;
  /** STLG: how many start lights are on. */
  lights?: number;
}

export interface RaceIncident {
  t0: number;
  t1: number;
  lap: number;
  dist: number;
  x: number;
  z: number;
  /** "tap": a contact after which nobody slowed, slid or went off (bundle v5+). */
  kind?: "incident" | "tap";
  contacts: { t: number; a: number; b: number; severity: number }[];
  /** surfaces: what each wheel (rl, rr, fl, fr) touched off the tarmac around the incident. */
  drivers: { car: number; role: string; verdict?: string; rules?: string[]; surfaces?: Record<string, string> }[];
}

export interface RaceManifest {
  v: number;
  uid: string;
  started: string;
  track: string;
  session: string;
  laps: number;
  chunk_seconds: number;
  chunks: string[];
  cars: Record<string, RaceCar>;
  events: RaceEvent[];
  finished: boolean;
  duration?: number;
  lap_starts?: number[];
  track_length?: number;
  incidents?: RaceIncident[];
  /** Per car: when it was ghosted [from, to] (session time). The game sends no flag: read from the motion. */
  ghosts?: Record<string, [number, number][]>;
  /** Per car: grid slot, completed laps [lap, session time, ms], result status changes [time, status]. */
  timing?: Record<string, CarTiming>;
}

export interface RaceIndexEntry {
  uid: string;
  started: string;
  track: string;
  session: string;
  laps: number;
  cars: number;
  incidents?: number;
}

export interface CarTiming {
  grid: number;
  laps: [number, number, number][];
  /** 2 active, 3 finished, 4 DNF, 5 DSQ, 6 not classified, 7 retired */
  status: [number, number][];
}

/** One decoded chunk: frame-major columns (frame 0 car 0, frame 0 car 1, ...). */
export interface Chunk {
  t0: number;
  cars: number;
  n: number;
  t: Float32Array;
  x: Float32Array;
  z: Float32Array;
  dist: Float32Array;
  heading: Int16Array;
  speed: Uint16Array;
  throttle: Uint8Array;
  brake: Uint8Array;
  steer: Int8Array;
  gear: Int8Array;
  off: Uint8Array;
  lap: Uint8Array;
  pos: Uint8Array;
  /** The game's interval to the car ahead (ms), chunk version 2 only. */
  gap: Uint32Array | null;
}

/** Decode a GMLC chunk (see live/race.py). The buffer must start at byte 0 of its ArrayBuffer. */
export function decodeChunk(buf: ArrayBuffer): Chunk {
  const dv = new DataView(buf);
  const magic = String.fromCharCode(dv.getUint8(0), dv.getUint8(1), dv.getUint8(2), dv.getUint8(3));
  if (magic !== "GMLC") throw new Error("not a race chunk");
  const version = dv.getUint8(4);
  const cars = dv.getUint8(5);
  const n = dv.getUint16(6, true);
  const t0 = dv.getFloat64(8, true);
  const m = n * cars;
  let pos = 16;
  const f32 = (count: number) => {
    const v = new Float32Array(buf, pos, count);
    pos += count * 4;
    return v;
  };
  const t = f32(n);
  const x = f32(m);
  const z = f32(m);
  f32(m); // height, not drawn
  const dist = f32(m);
  const heading = new Int16Array(buf, pos, m);
  pos += m * 2;
  const speed = new Uint16Array(buf, pos, m);
  pos += m * 2;
  const u8 = () => {
    const v = new Uint8Array(buf, pos, m);
    pos += m;
    return v;
  };
  const throttle = u8();
  const brake = u8();
  const steer = new Int8Array(buf, pos, m);
  pos += m;
  const gear = new Int8Array(buf, pos, m);
  pos += m;
  const off = u8();
  const lap = u8();
  const place = u8();
  // version 2 adds the game's interval in 10 ms units; copied, since it may sit at an odd offset
  let gap: Uint32Array | null = null;
  if (version >= 2 && pos + m * 2 <= buf.byteLength) {
    gap = new Uint32Array(m);
    for (let i = 0; i < m; i++) gap[i] = dv.getUint16(pos + i * 2, true) * 10;
  }
  return { t0, cars, n, t, x, z, dist, heading, speed, throttle, brake, steer, gear, off, lap, pos: place, gap };
}

/** Where races are read from: Cloudflare R2 (the live server publishes there), then this site. */
export const RACE_SOURCES = [
  "https://replays.gremigaming.com/",
  `${import.meta.env.BASE_URL}league/races/`,
];

async function getJson<T>(url: string): Promise<T | null> {
  try {
    const r = await fetch(url, { cache: "no-cache" });
    return r.ok ? ((await r.json()) as T) : null;
  } catch {
    return null;
  }
}

/** Every race from every source, newest first, each with the source it lives in. */
export async function loadRaceIndex(): Promise<(RaceIndexEntry & { base: string })[]> {
  const lists = await Promise.all(
    RACE_SOURCES.map(async (base) => {
      const idx = await getJson<{ races: RaceIndexEntry[] }>(`${base}index.json`);
      return (idx?.races ?? []).map((r) => ({ ...r, base }));
    }),
  );
  const seen = new Set<string>();
  return lists
    .flat()
    .filter((r) => (seen.has(r.uid) ? false : (seen.add(r.uid), true)))
    .sort((a, b) => b.started.localeCompare(a.started));
}

/** The manifest of one race and the base URL its chunks come from. */
export async function loadManifest(uid: string): Promise<{ manifest: RaceManifest; base: string } | null> {
  for (const base of RACE_SOURCES) {
    const manifest = await getJson<RaceManifest>(`${base}${encodeURIComponent(uid)}/manifest.json`);
    if (manifest) return { manifest, base: `${base}${encodeURIComponent(uid)}/` };
  }
  return null;
}

/** A live manifest has no grouped incidents yet: one per game contact, so the bar still shows them. */
export function incidentsOf(m: RaceManifest): RaceIncident[] {
  if (m.incidents) return m.incidents;
  return m.events
    .filter((e) => e.code === "COLL" && e.a !== undefined && e.b !== undefined)
    .map((e) => ({
      t0: e.t,
      t1: e.t,
      lap: 0,
      dist: 0,
      x: NaN,
      z: NaN,
      contacts: [{ t: e.t, a: e.a!, b: e.b!, severity: 0 }],
      drivers: [
        { car: e.a!, role: "contact" },
        { car: e.b!, role: "contact" },
      ],
    }));
}
