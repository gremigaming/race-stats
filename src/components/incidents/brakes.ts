import { decodeChunk, type Chunk, type RaceManifest } from "../../viewer/format";
import type { BrakeMark } from "../../viewer/scene";

/**
 * The usual braking point of every corner (GreMi, 5 Nov 2026: judge whether someone braked early
 * or late). Read from two racing laps of the whole field: every time a car goes from no brake to
 * a firm press at speed, its lap distance is noted; those cluster per corner and the median of
 * each cluster is the corner's braking point.
 */

const ON = 0.3; // brake share that counts as braking
const OFF = 0.08; // ... after being below this
const MIN_KMH = 110;
const GAP_M = 45; // presses closer than this along the lap are the same corner

async function fetchChunk(url: string): Promise<Chunk | null> {
  try {
    const r = await fetch(url);
    if (!r.ok) return null;
    let buf = await r.arrayBuffer();
    const head = new Uint8Array(buf, 0, 2);
    if (head[0] === 0x1f && head[1] === 0x8b) {
      const stream = new Blob([buf]).stream().pipeThrough(new DecompressionStream("gzip"));
      buf = await new Response(stream).arrayBuffer();
    }
    return decodeChunk(buf);
  } catch {
    return null;
  }
}

export async function brakePoints(m: RaceManifest, base: string): Promise<BrakeMark[]> {
  const starts = m.lap_starts ?? [];
  if (starts.length < 3) return [];
  // laps 2 and 3 (lap 1 is the pack, later laps may be few): two laps of every car
  const from = starts[1];
  const to = starts[Math.min(3, starts.length - 1)];
  const cs = m.chunk_seconds || 10;
  const names = new Map(m.chunks.map((n) => [parseInt(n, 10), n] as [number, string]));
  const keys: number[] = [];
  for (let k = Math.floor(from / cs); k <= Math.floor(to / cs); k++) if (names.has(k)) keys.push(k);
  const chunks: Chunk[] = [];
  for (let i = 0; i < keys.length; i += 4) {
    const got = await Promise.all(keys.slice(i, i + 4).map((k) => fetchChunk(`${base}chunks/${names.get(k)}`)));
    for (const c of got) if (c) chunks.push(c);
  }
  if (!chunks.length) return [];
  chunks.sort((a, b) => a.t0 - b.t0);
  const cars = Math.min(...chunks.map((c) => c.cars));
  const presses: { dist: number; x: number; z: number; h: number }[] = [];
  for (let car = 0; car < cars; car++) {
    if (!m.cars[String(car)]) continue;
    let prev = 1;
    for (const c of chunks)
      for (let f = 0; f < c.n; f++) {
        const i = f * c.cars + car;
        const b = c.brake[i] / 255;
        const kmh = c.speed[i] / 10;
        if (b >= ON && prev <= OFF && kmh >= MIN_KMH && !c.off[i] && c.t[f] >= from && c.t[f] <= to)
          presses.push({ dist: c.dist[i], x: c.x[i], z: c.z[i], h: c.heading[i] / 10000 });
        prev = b;
      }
  }
  presses.sort((a, b) => a.dist - b.dist);
  const groups: (typeof presses)[] = [];
  for (const p of presses) {
    const g = groups[groups.length - 1];
    if (g && p.dist - g[g.length - 1].dist < GAP_M) g.push(p);
    else groups.push([p]);
  }
  const need = Math.max(4, Math.round(cars * 0.4));
  const out: BrakeMark[] = [];
  for (const g of groups) {
    if (g.length < need) continue;
    const mid = g[Math.floor(g.length / 2)];
    // the track normal from the heading; the board goes on the side away from the track's middle
    let nx = -Math.sin(mid.h);
    let nz = Math.cos(mid.h);
    const b = m.bounds;
    if (b) {
      const cx = (b[0] + b[2]) / 2;
      const cz = (b[1] + b[3]) / 2;
      if ((mid.x - cx) * nx + (mid.z - cz) * nz < 0) {
        nx = -nx;
        nz = -nz;
      }
    }
    out.push({ x: mid.x, z: mid.z, nx, nz });
  }
  return out;
}
