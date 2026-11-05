/**
 * Race highlights for the viewer's timeline and the "Watch highlights" reel (GreMi, 5 Nov 2026):
 * instead of a dot for every contact, only the moments worth watching. Worked out from what every
 * manifest carries (lap timing, overtake and retirement events, incidents with the fault engine's
 * severity), so it works for live, recorded and older races alike.
 */
import { MAJOR_SEVERITY, type RaceIncident, type RaceManifest } from "./format";
import { carsOf, kindOf, KIND_META, severityOf } from "./incidentKinds";

export type HighlightKind = "start" | "incident" | "battle" | "overtake" | "lead" | "lastlap" | "fastest" | "photo" | "comeback" | "dnf";

export const HIGHLIGHT_META: Record<HighlightKind, { label: string; color: string }> = {
  start: { label: "Lights out", color: "#38bdf8" },
  incident: { label: "Incident", color: "#ef4444" },
  battle: { label: "Battle", color: "#f59e0b" },
  overtake: { label: "Overtake", color: "#22c55e" },
  lead: { label: "Lead change", color: "#facc15" },
  lastlap: { label: "Last-lap pass", color: "#4ade80" },
  fastest: { label: "Fastest lap", color: "#c084fc" },
  photo: { label: "Photo finish", color: "#f4f4f5" },
  comeback: { label: "Comeback drive", color: "#2dd4bf" },
  dnf: { label: "Retirement", color: "#a1a1aa" },
};

export interface Highlight {
  id: string;
  kind: HighlightKind;
  /** Where the marker sits on the timeline. */
  t: number;
  /** The window the reel (and a click) plays. */
  from: number;
  to: number;
  /** A battle's whole run, drawn as a band under the bar. */
  span?: [number, number];
  cars: number[];
  title: string;
  sub: string;
  score: number;
  /** Index into the race's incidents (kind "incident"). */
  inc?: number;
  /** Playback speed the reel uses for this one. */
  rate: number;
}

const MAX_HIGHLIGHTS = 18;
const BATTLE_GAP = 1.0; // s at the line
const PIT_WINDOW = 40; // s: a pass around a pit stop is no overtake

/** The race's highlights in time order. */
export function raceHighlights(m: RaceManifest, incidents: RaceIncident[]): Highlight[] {
  const name = (car: number) => m.cars[String(car)]?.name ?? `Car ${car}`;
  const human = (car: number) => !!m.cars[String(car)] && !m.cars[String(car)].ai;
  const timing = m.timing ?? {};
  const cars = Object.keys(timing).map(Number);
  const lapsOf = (car: number) => timing[String(car)]?.laps ?? [];
  const starts = m.lap_starts ?? [];
  const raceStart = starts[0] ?? 0;
  const out: Highlight[] = [];
  const add = (h: Omit<Highlight, "id">) => out.push({ ...h, id: `${h.kind}-${Math.round(h.t * 10)}-${h.cars.join("-")}` });

  // ---- running order at any moment: most laps done, then who crossed the line first
  const crossings = (car: number, by: number) => {
    const done = lapsOf(car).filter((l) => l[1] <= by);
    return { n: done.length, last: done.length ? done[done.length - 1][1] : 0 };
  };
  const grid = (car: number) => timing[String(car)]?.grid || 99;
  const orderAt = (t: number) =>
    [...cars].sort((a, b) => {
      const A = crossings(a, t);
      const B = crossings(b, t);
      if (A.n !== B.n) return B.n - A.n;
      if (A.n === 0) return grid(a) - grid(b);
      return A.last - B.last;
    });
  const posAt = (car: number, t: number) => orderAt(t).indexOf(car) + 1;
  const statusAt = (car: number) => timing[String(car)]?.status ?? [];
  const finishOf = (car: number) => statusAt(car).find(([, c]) => c === 3)?.[0] ?? null;
  const pits = (car: number) => timing[String(car)]?.pits ?? [];
  const nearPit = (car: number, t: number) => pits(car).some((p) => t - p < PIT_WINDOW && p - t < 8);
  const nearIncident = (car: number, t: number) => incidents.some((i) => carsOf(i).includes(car) && t - i.t0 > -2 && t - i.t0 < 8 && severityOf(i) >= 3);

  // ---- lights out, and who gained most on lap 1
  if (starts.length) {
    const lap1 = cars
      .map((c) => {
        const l = lapsOf(c)[0];
        return l ? { car: c, at: l[1] } : null;
      })
      .filter((x): x is { car: number; at: number } => !!x)
      .sort((a, b) => a.at - b.at);
    const gains = lap1.map((x, i) => ({ car: x.car, gain: grid(x.car) - (i + 1), at: x.at })).filter((x) => human(x.car) && grid(x.car) < 99);
    const best = gains.sort((a, b) => b.gain - a.gain)[0];
    add({
      kind: "start",
      t: raceStart,
      from: raceStart - 1,
      to: raceStart + 22,
      cars: [],
      title: "Lights out",
      sub: best && best.gain >= 3 ? `${name(best.car)} gains ${best.gain} places on lap 1` : `${cars.length} cars on the grid`,
      score: 100,
      rate: 1,
    });
  }

  // ---- big incidents (severity 6+)
  incidents.forEach((inc, k) => {
    const sev = severityOf(inc);
    if (sev < MAJOR_SEVERITY) return;
    const involved = carsOf(inc);
    const kind = kindOf(inc);
    add({
      kind: "incident",
      t: inc.t0,
      from: inc.t0 - 4,
      to: inc.t1 + 3,
      cars: involved,
      title: involved.slice(0, 2).map(name).join(" & ") + (involved.length > 2 ? ` +${involved.length - 2}` : ""),
      sub: `${KIND_META[kind].label} · severity ${sev}/10${inc.lap ? ` · lap ${inc.lap}` : ""}`,
      score: 60 + sev * 4,
      inc: k,
      rate: 0.5,
    });
  });

  // ---- overtakes (the game's OVTK events): lead changes, last-lap passes and the best of the rest
  const lastLapAt = starts.length >= 2 ? (starts[Math.max(0, (m.laps || starts.length) - 1)] ?? Infinity) : Infinity;
  const ovtk = m.events.filter((e) => e.code === "OVTK" && e.a !== undefined && e.b !== undefined && e.t > (starts[1] ?? raceStart + 60));
  const passes: Highlight[] = [];
  for (const e of ovtk) {
    const a = e.a!;
    const b = e.b!;
    if (!human(a) && !human(b)) continue;
    if (nearPit(a, e.t) || nearPit(b, e.t) || nearIncident(b, e.t)) continue;
    // swapped straight back (or it flickered): no pass
    if (ovtk.some((o) => o.a === b && o.b === a && o.t > e.t && o.t - e.t < 6)) continue;
    const pos = posAt(b, e.t - 0.5) || posAt(a, e.t);
    const stuck = !ovtk.some((o) => o.a === b && o.b === a && o.t > e.t && o.t - e.t < 60);
    const fought = ovtk.some((o) => o.a === b && o.b === a && o.t < e.t && e.t - o.t < 90);
    const last = e.t >= lastLapAt;
    const lead = pos === 1;
    const kind: HighlightKind = last ? "lastlap" : lead ? "lead" : "overtake";
    passes.push({
      id: `${kind}-${Math.round(e.t * 10)}-${a}-${b}`,
      kind,
      t: e.t,
      from: e.t - 9,
      to: e.t + 4,
      cars: [a, b],
      title: `${name(a)} passes ${name(b)}`,
      sub: `${pos ? `For P${pos}` : "Overtake"}${fought ? " · fought back" : ""}${stuck ? "" : " · swapped back later"}`,
      score: (last ? 85 : lead ? 80 : 30) + Math.max(0, 12 - pos) * 3 + (fought ? 12 : 0) + (stuck ? 8 : 0),
      rate: 1,
    });
  }
  const leads = passes.filter((p) => p.kind === "lead").sort((a, b) => b.score - a.score).slice(0, 4);
  const lastLaps = passes.filter((p) => p.kind === "lastlap" && p.score >= 85 + 3 * 2).sort((a, b) => b.score - a.score).slice(0, 3);
  const others = passes.filter((p) => p.kind === "overtake").sort((a, b) => b.score - a.score).slice(0, 5);
  out.push(...leads, ...lastLaps, ...others);

  // ---- battles: the same two cars within a second at the line for 2+ laps in a row, with a swap or 3+ laps
  const byLap = new Map<number, { car: number; at: number }[]>();
  for (const c of cars) for (const [lap, at] of lapsOf(c)) (byLap.get(lap) ?? byLap.set(lap, []).get(lap)!).push({ car: c, at });
  const runs = new Map<string, { a: number; b: number; laps: { lap: number; at: number; gap: number }[] }[]>();
  for (const [lap, list] of [...byLap.entries()].sort((x, y) => x[0] - y[0])) {
    if (lap < 2) continue;
    list.sort((x, y) => x.at - y.at);
    for (let i = 1; i < list.length; i++) {
      const gap = list[i].at - list[i - 1].at;
      if (gap > BATTLE_GAP) continue;
      const [a, b] = [list[i - 1].car, list[i].car].sort((x, y) => x - y);
      if (!human(a) && !human(b)) continue;
      const key = `${a}-${b}`;
      const rs = runs.get(key) ?? runs.set(key, []).get(key)!;
      const cur = rs[rs.length - 1];
      if (cur && cur.laps[cur.laps.length - 1].lap === lap - 1) cur.laps.push({ lap, at: list[i].at, gap });
      else rs.push({ a, b, laps: [{ lap, at: list[i].at, gap }] });
    }
  }
  const battles: Highlight[] = [];
  for (const rs of runs.values())
    for (const r of rs) {
      if (r.laps.length < 2) continue;
      const first = r.laps[0];
      const lastL = r.laps[r.laps.length - 1];
      const lapLen = (lastL.at - first.at) / Math.max(1, r.laps.length - 1) || 90;
      const span: [number, number] = [first.at - lapLen, lastL.at];
      const swaps = ovtk.filter((o) => ((o.a === r.a && o.b === r.b) || (o.a === r.b && o.b === r.a)) && o.t >= span[0] && o.t <= span[1] + 2);
      const avg = r.laps.reduce((s, l) => s + l.gap, 0) / r.laps.length;
      if (!swaps.length && (r.laps.length < 3 || avg > 0.8)) continue;
      const pos = Math.min(posAt(r.a, lastL.at) || 20, posAt(r.b, lastL.at) || 20);
      // play the hottest moment: the last swap, else the lap they were closest
      const key = swaps.length ? swaps[swaps.length - 1].t : r.laps.reduce((x, y) => (y.gap < x.gap ? y : x)).at;
      battles.push({
        id: `battle-${Math.round(span[0])}-${r.a}-${r.b}`,
        kind: "battle",
        t: span[0],
        from: key - 18,
        to: key + 4,
        span,
        cars: [r.a, r.b],
        title: `${name(r.a)} vs ${name(r.b)}`,
        sub: `${r.laps.length + 1} laps${swaps.length ? `, ${swaps.length} position swap${swaps.length > 1 ? "s" : ""}` : ` within ${avg.toFixed(1)} s`}${pos < 20 ? ` · for P${pos}` : ""}`,
        score: 45 + 5 * r.laps.length + 10 * swaps.length + Math.max(0, 12 - pos) * 2 + (1 - avg) * 10,
        rate: 1,
      });
    }
  out.push(...battles.sort((a, b) => b.score - a.score).slice(0, 4));

  // ---- fastest lap
  let fast: { car: number; at: number; ms: number; lap: number } | null = null;
  for (const c of cars) for (const [lap, at, ms] of lapsOf(c)) if (ms > 0 && (!fast || ms < fast.ms)) fast = { car: c, at, ms, lap };
  if (fast)
    add({
      kind: "fastest",
      t: fast.at - fast.ms / 1000,
      from: fast.at - 25,
      to: fast.at + 2,
      cars: [fast.car],
      title: `Fastest lap: ${name(fast.car)}`,
      sub: `${lapClock(fast.ms)} on lap ${fast.lap}`,
      score: 70,
      rate: 1,
    });

  // ---- the finish: photo finishes and the biggest comeback
  const finishers = cars
    .map((c) => ({ car: c, at: finishOf(c), laps: lapsOf(c).length }))
    .filter((x): x is { car: number; at: number; laps: number } => x.at !== null)
    .sort((a, b) => b.laps - a.laps || a.at - b.at);
  for (let i = 1; i < finishers.length; i++) {
    const A = finishers[i - 1];
    const B = finishers[i];
    const gap = B.at - A.at;
    if (A.laps !== B.laps || gap > 0.5 || (!human(A.car) && !human(B.car))) continue;
    add({
      kind: "photo",
      t: B.at,
      from: B.at - 14,
      to: B.at + 2,
      cars: [A.car, B.car],
      title: `Photo finish for P${i}`,
      sub: `${name(A.car)} beats ${name(B.car)} by ${gap.toFixed(3)} s`,
      score: 90 - i,
      rate: 1,
    });
  }
  const comeback = finishers
    .map((x, i) => ({ ...x, gain: grid(x.car) - (i + 1) }))
    .filter((x) => human(x.car) && grid(x.car) < 99 && x.gain >= 5)
    .sort((a, b) => b.gain - a.gain)[0];
  if (comeback)
    add({
      kind: "comeback",
      t: comeback.at,
      from: comeback.at - 10,
      to: comeback.at + 2,
      cars: [comeback.car],
      title: `${name(comeback.car)}: P${grid(comeback.car)} to P${finishers.indexOf(finishers.find((f) => f.car === comeback.car)!) + 1}`,
      sub: `Comeback drive, ${comeback.gain} places gained`,
      score: 60 + comeback.gain * 2,
      rate: 1,
    });

  // ---- retirements (not the ones a big incident already shows)
  const end = m.duration ?? Infinity;
  for (const c of cars) {
    if (!human(c)) continue;
    const out4 = statusAt(c).find(([, code]) => code === 4 || code === 7);
    if (!out4 || out4[0] > end - 20) continue;
    const at = out4[0];
    if (incidents.some((i) => carsOf(i).includes(c) && at - i.t0 > -2 && at - i.t0 < 45 && severityOf(i) >= MAJOR_SEVERITY)) continue;
    add({ kind: "dnf", t: at, from: at - 10, to: at + 2, cars: [c], title: `${name(c)} retires`, sub: `Lap ${crossings(c, at).n + 1}`, score: 35, rate: 1 });
  }

  // keep the best, never two on top of each other
  const kept: Highlight[] = [];
  for (const h of [...out].sort((a, b) => b.score - a.score)) {
    if (kept.length >= MAX_HIGHLIGHTS) break;
    if (kept.some((k) => Math.abs(k.t - h.t) < 4 && k.cars.some((c) => h.cars.includes(c)))) continue;
    kept.push(h);
  }
  return kept.sort((a, b) => a.t - b.t);
}

function lapClock(ms: number) {
  const m = Math.floor(ms / 60000);
  const s = (ms % 60000) / 1000;
  return `${m}:${s.toFixed(3).padStart(6, "0")}`;
}

/** Roughly how long the reel takes (s of real time). */
export function reelSeconds(hs: Highlight[]) {
  return hs.reduce((s, h) => s + (h.to - h.from) / h.rate, 0);
}
