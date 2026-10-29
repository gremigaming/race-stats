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
}

const PREFETCH = 3; // chunks either side of the playhead
const KEEP = 60; // chunks kept in memory either side

export class ChunkStore {
  readonly chunkSeconds: number;
  readonly names: Map<number, string>;
  private chunks = new Map<number, Chunk>();
  private pending = new Set<number>();
  private failed = new Set<number>();
  private worker: Worker | null = null;
  private nextId = 1;
  private waiting = new Map<number, number>();
  private all = false;
  /** World bounds of every car seen so far: [minX, minZ, maxX, maxZ]. */
  bounds: [number, number, number, number] | null = null;
  onLoad: (() => void) | null = null;
  private base: string;

  constructor(manifest: RaceManifest, base: string) {
    this.base = base;
    this.chunkSeconds = manifest.chunk_seconds || 10;
    this.names = new Map(
      manifest.chunks.map((name) => [parseInt(name, 10), name] as [number, string]),
    );
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
        this.onLoad?.();
      } else this.failed.add(k);
      if (this.all) this.wantAll();
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

  /** The first and last session time the race has chunks for. */
  span(): [number, number] {
    const keys = [...this.names.keys()];
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

  /** Ask for the chunks around time t; drop the far ones. */
  want(t: number) {
    const k = Math.floor(t / this.chunkSeconds);
    for (let d = 0; d <= PREFETCH; d++) {
      for (const j of d ? [k + d, k - d] : [k]) this.request(j);
    }
    if (this.chunks.size > KEEP * 2) {
      for (const j of this.chunks.keys()) if (Math.abs(j - k) > KEEP) this.chunks.delete(j);
    }
  }

  /** Load every chunk in the background (finished races: makes the whole-track bounds right). */
  wantAll() {
    if (this.names.size > KEEP * 2) return; // long races: only around the playhead
    this.all = true;
    for (const j of this.names.keys()) this.request(j);
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

  /** Every car at time t. Empty while the chunk is still loading. */
  sample(t: number): CarState[] {
    const at = this.locate(t);
    if (!at) return [];
    const [c1, i1] = at;
    const b = this.step(c1, i1, 1);
    const a = this.step(c1, i1, -1) ?? at;
    const [c2, i2] = b ?? at;
    const d = b ?? at;
    const n2 = this.step(d[0], d[1], 1) ?? d;
    const ta = c1.t[i1];
    const tb = c2.t[i2];
    const span = tb - ta;
    const u = span > 1e-4 ? Math.min(1, Math.max(0, (t - ta) / span)) : 0;
    const out: CarState[] = [];
    const cars = Math.min(c1.cars, c2.cars);
    for (let car = 0; car < cars; car++) {
      const p = i1 * c1.cars + car;
      const q = i2 * c2.cars + car;
      if (c1.x[p] === 0 && c1.z[p] === 0) continue;
      const gone = c2.x[q] === 0 && c2.z[q] === 0;
      // Hermite curve with tangents from the neighbouring rows (Catmull-Rom on uneven times)
      const pa = a[1] * a[0].cars + car;
      const pn = n2[1] * n2[0].cars + car;
      const tA = a[0].t[a[1]];
      const tN = n2[0].t[n2[1]];
      const x = gone ? c1.x[p] : hermite(a[0].x[pa], c1.x[p], c2.x[q], n2[0].x[pn], tA, ta, tb, tN, u);
      const z = gone ? c1.z[p] : hermite(a[0].z[pa], c1.z[p], c2.z[q], n2[0].z[pn], tA, ta, tb, tN, u);
      const h1 = c1.heading[p] / 10000;
      const h2 = gone ? h1 : c2.heading[q] / 10000;
      let dh = h2 - h1;
      if (dh > Math.PI) dh -= Math.PI * 2;
      if (dh < -Math.PI) dh += Math.PI * 2;
      const lerp = (v1: number, v2: number) => v1 + (gone ? 0 : (v2 - v1) * u);
      // direction of travel over this row, for the slide angle
      const mx = c2.x[q] - c1.x[p];
      const mz = c2.z[q] - c1.z[p];
      let slip = 0;
      if (!gone && Math.hypot(mx, mz) > 0.3) {
        slip = h1 + dh / 2 - Math.atan2(mz, mx); // the chord matches the heading halfway along
        while (slip > Math.PI) slip -= Math.PI * 2;
        while (slip < -Math.PI) slip += Math.PI * 2;
      }
      out.push({
        car,
        x,
        z,
        heading: h1 + dh * u,
        speed: lerp(c1.speed[p], c2.speed[q]) / 10,
        throttle: lerp(c1.throttle[p], c2.throttle[q]) / 255,
        brake: lerp(c1.brake[p], c2.brake[q]) / 255,
        steer: lerp(c1.steer[p], c2.steer[q]) / 127,
        gear: (u < 0.5 ? c1 : c2).gear[u < 0.5 ? p : q],
        lap: c1.lap[p],
        pos: c1.pos[p],
        dist: c1.dist[p],
        off: c1.off[p],
        slip,
      });
    }
    return out;
  }
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
