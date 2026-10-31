/**
 * Chunks around the playhead (±30 s prefetch, decoded in a worker) and one sample of every car at
 * any clock time: positions are a smooth curve through the 10-20 Hz rows, so playback stays fluid
 * at any speed.
 */
import type { Chunk, RaceManifest } from "./format";

export interface CarState {
  car: number;
  x: number;
  z: number;
  /** Height (metres). */
  y: number;
  heading: number;
  speed: number;
  throttle: number;
  brake: number;
  steer: number;
  gear: number;
  lap: number;
  pos: number;
  dist: number;
  off: number;
  /** Angle between where the car points and where it travels (radians, + = nose right of travel). */
  slip: number;
  /** Ghosted (drives through other cars): drawn see-through. */
  ghost: boolean;
}

const PREFETCH = 3; // chunks either side of the playhead (more ahead at higher speeds)
const KEEP = 60; // chunks kept in memory either side
/** Timing points per lap: GreMi's 3 sectors x 8 equal parts. */
export const SPLITS = 24;

/** When a car passed one timing point, and the game's own interval to the car ahead then (ms, 0 = none). */
interface Crossing {
  t: number;
  gap: number;
}

export class ChunkStore {
  readonly chunkSeconds: number;
  readonly names: Map<number, string>;
  private chunks = new Map<number, Chunk>();
  private pending = new Set<number>();
  private failed = new Set<number>();
  private worker: Worker | null = null;
  private nextId = 1;
  private waiting = new Map<number, number>();
  /** World bounds of every car seen so far: [minX, minZ, maxX, maxZ]. */
  bounds: [number, number, number, number] | null = null;
  onLoad: (() => void) | null = null;
  private base: string;
  /** Lap length for the timing points; longer than any track when unknown, so progress never runs backwards. */
  lapLength: number;
  /** car -> timing point (lap * SPLITS + split) -> crossing; kept after their chunks are dropped. */
  private crossings = new Map<number, Map<number, Crossing>>();
  /** car -> [from, to] session times it was ghosted (manifest.ghosts; replaced as a live manifest grows). */
  ghosts: Record<string, [number, number][]>;

  constructor(manifest: RaceManifest, base: string) {
    this.base = base;
    this.lapLength = manifest.track_length || 7100;
    this.chunkSeconds = manifest.chunk_seconds || 10;
    this.ghosts = manifest.ghosts ?? {};
    this.names = new Map(
      manifest.chunks.map((name) => [parseInt(name, 10), name] as [number, string]),
    );
  }

  /** Load chunks from somewhere else from now on (a live race once it is on R2). */
  setBase(base: string) {
    this.base = base;
    this.failed.clear();
  }

  /** The decoding worker, started on first use (and again after dispose). */
  private decoder() {
    if (this.worker) return this.worker;
    const w = new Worker(new URL("./chunk.worker.ts", import.meta.url), { type: "module" });
    w.onmessage = (e: MessageEvent<{ id: number; chunk?: Chunk; error?: string }>) => {
      const k = this.waiting.get(e.data.id);
      if (k === undefined) return;
      this.waiting.delete(e.data.id);
      this.pending.delete(k);
      if (e.data.chunk) {
        this.chunks.set(k, e.data.chunk);
        this.grow(e.data.chunk);
        this.time(k, e.data.chunk);
        this.onLoad?.();
      } else this.failed.add(k);
    };
    this.worker = w;
    return w;
  }

  dispose() {
    this.worker?.terminate();
    this.worker = null;
    this.pending.clear();
    this.waiting.clear();
  }

  /** Session time of the newest frame pushed by the live server (null: not a live race). */
  newest: number | null = null;
  /** Chunks built from live pushes that aren't in the manifest yet (the open 10 s). */
  private liveKeys = new Set<number>();

  /**
   * Frames pushed by the live server (live.ts): a GMLC chunk holding only new frames. Merged into
   * the chunk they belong to, in time order, without duplicates. A chunk the manifest already
   * lists comes over HTTP instead, whole (a push may hold only its last seconds).
   */
  appendLive(c: Chunk) {
    if (!c.n) return;
    const k = Math.round(c.t0 / this.chunkSeconds);
    const last = c.t[c.n - 1];
    if (this.newest === null || last > this.newest) this.newest = last;
    if (this.names.has(k) && !this.liveKeys.has(k)) {
      this.request(k);
      return;
    }
    const old = this.chunks.get(k);
    const merged = old ? mergeChunks(old, c) : c;
    this.liveKeys.add(k);
    this.chunks.set(k, merged);
    this.grow(c);
    this.time(k, merged);
  }

  /** The first and last session time the race has chunks for. */
  span(): [number, number] {
    const keys = [...this.names.keys(), ...this.liveKeys];
    if (!keys.length) return [0, 0];
    return [Math.min(...keys) * this.chunkSeconds, (Math.max(...keys) + 1) * this.chunkSeconds];
  }

  /** Add a chunk name the live manifest gained since load. */
  addNames(names: string[]) {
    for (const n of names) this.names.set(parseInt(n, 10), n);
  }

  private grow(c: Chunk) {
    let [x0, z0, x1, z1] = this.bounds ?? [Infinity, Infinity, -Infinity, -Infinity];
    for (let i = 0; i < c.x.length; i++) {
      const x = c.x[i];
      const z = c.z[i];
      if (x === 0 && z === 0) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (z < z0) z0 = z;
      if (z > z1) z1 = z;
    }
    if (x0 <= x1) this.bounds = [x0, z0, x1, z1];
  }

  /** A car's distance into the race (m): laps done plus lap distance. */
  progress(lap: number, dist: number) {
    return (Math.max(lap, 1) - 1) * this.lapLength + dist;
  }

  /** Record every timing point the cars passed inside chunk k and across its edges with k-1 and k+1. */
  private time(k: number, c: Chunk) {
    for (let i = 0; i + 1 < c.n; i++) this.timePair(c, i, c, i + 1);
    const prev = this.chunks.get(k - 1);
    if (prev && prev.n && c.n) this.timePair(prev, prev.n - 1, c, 0);
    const next = this.chunks.get(k + 1);
    if (next && next.n && c.n) this.timePair(c, c.n - 1, next, 0);
  }

  private timePair(a: Chunk, i: number, b: Chunk, j: number) {
    const step = this.lapLength / SPLITS;
    const cars = Math.min(a.cars, b.cars);
    for (let car = 0; car < cars; car++) {
      const p = i * a.cars + car;
      const q = j * b.cars + car;
      if (!a.pos[p] || !b.pos[q]) continue;
      const p1 = this.progress(a.lap[p], a.dist[p]);
      const p2 = this.progress(b.lap[q], b.dist[q]);
      if (!(p2 > p1) || p2 - p1 > this.lapLength / 4) continue; // standing, a flashback, or a jump
      const k1 = Math.floor(p1 / step);
      const k2 = Math.floor(p2 / step);
      if (k2 <= k1) continue;
      let m = this.crossings.get(car);
      if (!m) this.crossings.set(car, (m = new Map()));
      for (let key = k1 + 1; key <= k2; key++) {
        const f = (key * step - p1) / (p2 - p1);
        m.set(key, { t: a.t[i] + f * (b.t[j] - a.t[i]), gap: b.gap ? b.gap[q] : 0 });
      }
    }
  }

  /** The newest timing point `car` passed at or before t (searching back from its progress now). */
  private lastCrossing(car: number, progressNow: number, t: number): [number, Crossing] | null {
    const m = this.crossings.get(car);
    if (!m) return null;
    const k = Math.floor(progressNow / (this.lapLength / SPLITS));
    for (let key = k + 1; key >= k - SPLITS; key--) {
      const c = m.get(key);
      if (c && c.t <= t + 1e-3) return [key, c];
    }
    return null;
  }

  /**
   * The interval of `car` to `ahead` (s), set each time `car` passes a timing point: the game's
   * own number where the race carries it, else the time between both cars passing that point.
   */
  interval(car: CarState, ahead: CarState, t: number): number | null {
    const mine = this.lastCrossing(car.car, this.progress(car.lap, car.dist), t);
    if (!mine) return null;
    if (mine[1].gap > 0) return mine[1].gap / 1000;
    const theirs = this.crossings.get(ahead.car)?.get(mine[0]);
    if (!theirs || theirs.t > mine[1].t) return null;
    return mine[1].t - theirs.t;
  }

  /**
   * Ask for the chunks around time t, nearest first and further ahead the faster it plays (about
   * 30 s of playback ahead), so the clock never waits for a chunk; drop the far ones.
   */
  want(t: number, rate = 1) {
    const k = Math.floor(t / this.chunkSeconds);
    const ahead = Math.max(PREFETCH, Math.ceil((Math.abs(rate) * 30) / this.chunkSeconds));
    this.request(k);
    for (let d = 1; d <= ahead; d++) {
      this.request(k + d);
      if (d <= PREFETCH) this.request(k - d);
    }
    if (this.chunks.size > KEEP * 2) {
      for (const j of this.chunks.keys()) if (Math.abs(j - k) > KEEP) this.chunks.delete(j);
    }
  }

  private request(k: number) {
    const name = this.names.get(k);
    if (!name || this.chunks.has(k) || this.pending.has(k) || this.failed.has(k)) return;
    if (this.pending.size >= 6) return;
    const id = this.nextId++;
    this.pending.add(k);
    this.waiting.set(id, k);
    this.decoder().postMessage({ id, url: `${this.base}chunks/${name}` });
  }

  loaded(t: number) {
    return this.chunks.has(Math.floor(t / this.chunkSeconds));
  }

  /** Frame position of time t: chunk key and the last frame at or before t. */
  private locate(t: number): [Chunk, number] | null {
    const k = Math.floor(t / this.chunkSeconds);
    const c = this.chunks.get(k);
    if (!c || !c.n) return null;
    let lo = 0;
    let hi = c.n - 1;
    if (t < c.t[0]) {
      const prev = this.chunks.get(k - 1);
      return prev && prev.n ? [prev, prev.n - 1] : [c, 0];
    }
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (c.t[mid] <= t) lo = mid;
      else hi = mid - 1;
    }
    return [c, lo];
  }

  /** The frame `d` steps away from (c, i), crossing into the next or previous chunk. */
  private step(c: Chunk, i: number, d: number): [Chunk, number] | null {
    let j = i + d;
    let cur = c;
    while (j >= cur.n) {
      const next = this.chunks.get(Math.round(cur.t0 / this.chunkSeconds) + 1);
      if (!next || !next.n) return null;
      j -= cur.n;
      cur = next;
    }
    while (j < 0) {
      const prev = this.chunks.get(Math.round(cur.t0 / this.chunkSeconds) - 1);
      if (!prev || !prev.n) return null;
      j += prev.n;
      cur = prev;
    }
    return [cur, j];
  }

  /**
   * Every car at time t. Empty while the chunk is still loading. Pass `into` (kept by the caller
   * between frames) to reuse its array and car objects: no garbage per frame, so no GC pauses.
   */
  sample(t: number, into?: CarState[]): CarState[] {
    const out = into ?? [];
    out.length = 0;
    const pool = into ? (this.pools.get(into) ?? this.newPool(into)) : null;
    const f = this.frameAt(t);
    if (!f) return out;
    const cars = Math.min(f.c1.cars, f.c2.cars);
    for (let car = 0; car < cars; car++) {
      let s: CarState | undefined = pool ? pool[car] : undefined;
      if (!s) {
        s = blank(car);
        if (pool) pool[car] = s;
      }
      if (this.fill(f, car, t, s)) out.push(s);
    }
    return out;
  }

  /** One car at time t (the input trace), or null. Allocates nothing. */
  sampleCar(t: number, car: number, into: CarState): CarState | null {
    const f = this.frameAt(t);
    if (!f || car >= Math.min(f.c1.cars, f.c2.cars)) return null;
    return this.fill(f, car, t, into) ? into : null;
  }

  private pools = new WeakMap<CarState[], CarState[]>();
  private newPool(key: CarState[]) {
    const p: CarState[] = [];
    this.pools.set(key, p);
    return p;
  }

  /** The four rows around t (reused object). */
  private fr = { a: null as unknown as Chunk, ai: 0, c1: null as unknown as Chunk, i1: 0, c2: null as unknown as Chunk, i2: 0, n: null as unknown as Chunk, ni: 0, u: 0 };
  private frameAt(t: number) {
    const at = this.locate(t);
    if (!at) return null;
    const [c1, i1] = at;
    const b = this.step(c1, i1, 1);
    const a = this.step(c1, i1, -1) ?? at;
    const d = b ?? at;
    const n2 = this.step(d[0], d[1], 1) ?? d;
    const f = this.fr;
    f.a = a[0];
    f.ai = a[1];
    f.c1 = c1;
    f.i1 = i1;
    f.c2 = d[0];
    f.i2 = d[1];
    f.n = n2[0];
    f.ni = n2[1];
    const ta = c1.t[i1];
    const span = f.c2.t[f.i2] - ta;
    f.u = span > 1e-4 ? Math.min(1, Math.max(0, (t - ta) / span)) : 0;
    return f;
  }

  /** One car on the curve through the four rows; false when the car isn't on track. */
  private fill(f: ChunkStore["fr"], car: number, t: number, s: CarState): boolean {
    const { c1, c2, u } = f;
    const A = f.a;
    const N = f.n;
    const p = f.i1 * c1.cars + car;
    const q = f.i2 * c2.cars + car;
    if (c1.x[p] === 0 && c1.z[p] === 0) return false;
    const gone = c2.x[q] === 0 && c2.z[q] === 0;
    // Hermite curve with tangents from the neighbouring rows (Catmull-Rom on uneven times)
    const pa = f.ai * A.cars + car;
    const pn = f.ni * N.cars + car;
    const tA = A.t[f.ai];
    const ta = c1.t[f.i1];
    const tb = c2.t[f.i2];
    const tN = N.t[f.ni];
    s.car = car;
    s.x = gone ? c1.x[p] : hermite(A.x[pa], c1.x[p], c2.x[q], N.x[pn], tA, ta, tb, tN, u);
    s.z = gone ? c1.z[p] : hermite(A.z[pa], c1.z[p], c2.z[q], N.z[pn], tA, ta, tb, tN, u);
    const h1 = c1.heading[p] / 10000;
    const h2 = gone ? h1 : c2.heading[q] / 10000;
    const dh = wrapPi(h2 - h1);
    // heading and inputs follow the same curve as the position, so turns and pedals stay smooth in slow motion
    const h2u = h1 + dh;
    const h0u = h1 + wrapPi(A.heading[pa] / 10000 - h1);
    const h3u = h2u + wrapPi(N.heading[pn] / 10000 - h2);
    const w = gone ? 0 : u; // the curve at 0 is the row itself
    // direction of travel over this row, for the slide angle
    const mx = c2.x[q] - c1.x[p];
    const mz = c2.z[q] - c1.z[p];
    let slip = 0;
    if (!gone && Math.hypot(mx, mz) > 0.3) slip = wrapPi(h1 + dh / 2 - Math.atan2(mz, mx)); // the chord matches the heading halfway along
    s.y = gone ? c1.y[p] : c1.y[p] + (c2.y[q] - c1.y[p]) * u;
    s.heading = cubic(h0u, h1, h2u, h3u, tA, ta, tb, tN, w);
    s.speed = Math.max(0, cubic(A.speed[pa], c1.speed[p], c2.speed[q], N.speed[pn], tA, ta, tb, tN, w) / 10);
    s.throttle = Math.max(0, Math.min(1, cubic(A.throttle[pa], c1.throttle[p], c2.throttle[q], N.throttle[pn], tA, ta, tb, tN, w) / 255));
    s.brake = Math.max(0, Math.min(1, cubic(A.brake[pa], c1.brake[p], c2.brake[q], N.brake[pn], tA, ta, tb, tN, w) / 255));
    s.steer = Math.max(-1, Math.min(1, cubic(A.steer[pa], c1.steer[p], c2.steer[q], N.steer[pn], tA, ta, tb, tN, w) / 127));
    s.gear = u < 0.5 ? c1.gear[p] : c2.gear[q];
    s.lap = c1.lap[p];
    s.pos = c1.pos[p];
    s.dist = c1.dist[p];
    s.off = c1.off[p];
    s.slip = slip;
    let ghost = false;
    const g = this.ghosts[car];
    if (g) for (let k = 0; k < g.length; k++) if (t >= g[k][0] && t <= g[k][1]) ghost = true;
    s.ghost = ghost;
    return true;
  }
}

const blank = (car: number): CarState => ({
  car, x: 0, z: 0, y: 0, heading: 0, speed: 0, throttle: 0, brake: 0, steer: 0, gear: 0, lap: 0, pos: 0, dist: 0, off: 0, slip: 0, ghost: false,
});

/** Two chunks of the same 10 s as one: every frame of both in time order (a frame in both is kept once). */
export function mergeChunks(a: Chunk, b: Chunk): Chunk {
  const order: [Chunk, number][] = [];
  let i = 0;
  let j = 0;
  while (i < a.n || j < b.n) {
    const ta = i < a.n ? a.t[i] : Infinity;
    const tb = j < b.n ? b.t[j] : Infinity;
    if (Math.abs(ta - tb) < 1e-3) {
      order.push([b, j++]);
      i++;
    } else if (ta < tb) order.push([a, i++]);
    else order.push([b, j++]);
  }
  const cars = Math.max(a.cars, b.cars);
  const n = order.length;
  const m = n * cars;
  const out: Chunk = {
    t0: a.t0,
    cars,
    n,
    t: new Float32Array(n),
    x: new Float32Array(m),
    z: new Float32Array(m),
    y: new Float32Array(m),
    dist: new Float32Array(m),
    heading: new Int16Array(m),
    speed: new Uint16Array(m),
    throttle: new Uint8Array(m),
    brake: new Uint8Array(m),
    steer: new Int8Array(m),
    gear: new Int8Array(m),
    off: new Uint8Array(m),
    lap: new Uint8Array(m),
    pos: new Uint8Array(m),
    gap: a.gap || b.gap ? new Uint32Array(m) : null,
  };
  const cols = ["x", "z", "y", "dist", "heading", "speed", "throttle", "brake", "steer", "gear", "off", "lap", "pos"] as const;
  order.forEach(([c, f], row) => {
    out.t[row] = c.t[f];
    for (let car = 0; car < c.cars; car++) {
      const from = f * c.cars + car;
      const to = row * cars + car;
      for (const col of cols) out[col][to] = c[col][from];
      if (out.gap && c.gap) out.gap[to] = c.gap[from];
    }
  });
  return out;
}

const wrapPi = (a: number) => {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
};

/** Catmull-Rom on uneven times through p1 (at t1) and p2 (at t2), for any value (0 included). */
function cubic(p0: number, p1: number, p2: number, p3: number, t0: number, t1: number, t2: number, t3: number, u: number) {
  const h = t2 - t1;
  if (h <= 1e-4) return p1;
  const m1 = t2 - t0 > 1e-4 ? ((p2 - p0) / (t2 - t0)) * h : p2 - p1;
  const m2 = t3 - t1 > 1e-4 ? ((p3 - p1) / (t3 - t1)) * h : p2 - p1;
  const u2 = u * u;
  const u3 = u2 * u;
  return (2 * u3 - 3 * u2 + 1) * p1 + (u3 - 2 * u2 + u) * m1 + (-2 * u3 + 3 * u2) * p2 + (u3 - u2) * m2;
}

function hermite(p0: number, p1: number, p2: number, p3: number, t0: number, t1: number, t2: number, t3: number, u: number) {
  if (p0 === 0) p0 = p1;
  if (p3 === 0) p3 = p2;
  const h = t2 - t1;
  if (h <= 1e-4) return p1;
  const m1 = t2 - t0 > 1e-4 ? ((p2 - p0) / (t2 - t0)) * h : p2 - p1;
  const m2 = t3 - t1 > 1e-4 ? ((p3 - p1) / (t3 - t1)) * h : p2 - p1;
  const u2 = u * u;
  const u3 = u2 * u;
  return (2 * u3 - 3 * u2 + 1) * p1 + (u3 - 2 * u2 + u) * m1 + (-2 * u3 + 3 * u2) * p2 + (u3 - u2) * m2;
}
