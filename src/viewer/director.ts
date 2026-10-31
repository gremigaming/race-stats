/**
 * The broadcast camera's director: picks what the default TV view shows, like a race director
 * cutting between cameras.
 *
 * - Lap 1 opens on one wide pack shot of the whole field through the first corners.
 * - A shot is held at least MIN_HOLD seconds. Nothing cuts in mid-shot, collisions included:
 *   a collision is first in line for the next cut. (Every incident also plays in the PiP.)
 * - A battle keeps one shot identity while its cars reshuffle; when a shot ends early it stays
 *   on a shot with some of the same cars, or on the same cars, until MIN_HOLD is up.
 * - On a finished race it knows a collision is coming: it holds the current shot rather than
 *   starting a new one that would still be running when the collision happens, and arrives a few
 *   seconds early.
 */
import type { RaceEvent, RaceIncident } from "./format";
import type { CarState } from "./store";

export interface Shot {
  key: string;
  kind: "pack" | "collision" | "overtake" | "battle" | "leader";
  cars: number[];
  score: number;
}

export const MIN_HOLD = 12;
const MAX_HOLD = 60;
const LEAD_IN = 4; // seconds a finished race's camera arrives before a collision
const BATTLE_GAP = 1.0; // seconds between cars that count as a battle
const PACK_MIN = 12; // lap 1: the pack shot runs at least this long after lights out...
const PACK_MAX = 22; // ...and at most this long
const PACK_DIST = 800; // metres: past this the leader is through the first corners

const overlap = (a: number[], b: number[]) => a.filter((c) => b.includes(c)).length;

export class Director {
  private shot: Shot | null = null;
  private since = 0;
  private lastPick = -Infinity;

  private incidents: () => RaceIncident[];
  private events: () => RaceEvent[];
  private finished: boolean;
  private raceStart: () => number | undefined;

  constructor(incidents: () => RaceIncident[], events: () => RaceEvent[], finished: boolean, raceStart: () => number | undefined = () => undefined) {
    this.incidents = incidents;
    this.events = events;
    this.finished = finished;
    this.raceStart = raceStart;
  }

  /** Start over (after a seek). */
  reset() {
    this.shot = null;
    this.lastPick = -Infinity;
  }

  /** Incidents whose contact happened in (from, to]: the ones to replay in the PiP. Seeks (big jumps) give none. */
  crossed(from: number, to: number): number[] {
    if (!(to > from) || to - from > 2) return [];
    const out: number[] = [];
    this.incidents().forEach((inc, i) => {
      const at = Math.min(inc.t1, inc.t0 + 3);
      if (at > from && at <= to) out.push(i);
    });
    return out;
  }

  /** The shot to show at race time t. `order` runs P1 first; interval(car) is to the car ahead. */
  update(t: number, order: CarState[], interval: (car: number) => number | null): Shot | null {
    if (this.shot && Math.abs(t - this.lastPick) < 0.5 && t >= this.lastPick) return this.shot;
    if (this.shot && (t < this.lastPick || t - this.lastPick > 30)) this.reset();
    this.lastPick = t;
    const next = this.pick(t, order, interval);
    if (next && (!this.shot || next.key !== this.shot.key)) this.since = t;
    this.shot = next;
    return next;
  }

  private pick(t: number, order: CarState[], interval: (car: number) => number | null): Shot | null {
    const live = new Set(order.map((s) => s.car));
    const pack = this.pack(t, order);
    if (pack) return pack;
    const options = this.candidates(t, order, interval).filter((c) => c.cars.some((x) => live.has(x)));
    const best = options.reduce<Shot | null>((a, b) => (!a || b.score > a.score ? b : a), null);
    const shot = this.shot;
    if (!shot || !best) return best;
    const held = t - this.since;
    const ready = held >= MIN_HOLD;
    const collision = options.filter((o) => o.kind === "collision" && o.key !== shot.key).sort((a, b) => overlap(b.cars, shot.cars) - overlap(a.cars, shot.cars))[0];
    // a collision among the cars already in shot is no cut: the camera is already there
    if (collision && overlap(collision.cars, shot.cars) > 0 && shot.kind !== "pack") return collision;
    if (ready && collision) return collision; // first in line once the shot has run its time
    const cur = this.same(shot, options);
    if (cur) {
      if (!ready) return cur;
      if (this.collisionSoon(t)) return cur; // don't start a shot the collision would have to wait for
      if (held >= MAX_HOLD) return options.filter((o) => o.key !== cur.key && o.score >= 30).sort((a, b) => b.score - a.score)[0] ?? cur;
      if (best.key !== cur.key && best.score > cur.score * 1.3 + 5 && !best.cars.every((c) => cur.cars.includes(c))) return best;
      return cur;
    }
    // the shot is over (battle broke up, overtake done): stay near the same cars
    const near = options.filter((o) => o.kind !== "collision" && overlap(o.cars, shot.cars) > 0).sort((a, b) => b.score - a.score)[0];
    if (!ready) {
      if (near) return { ...near, key: shot.key }; // same shot, cars refreshed
      if (shot.kind !== "pack" && shot.cars.some((c) => live.has(c))) return shot; // hold the same cars
      return best;
    }
    if (this.collisionSoon(t) && shot.cars.some((c) => live.has(c))) return near ? { ...near, key: shot.key } : shot;
    return near ?? best;
  }

  /** The shot that carries on the current one: same key, or (a battle) most of the same cars after a reshuffle. */
  private same(shot: Shot, options: Shot[]): Shot | undefined {
    const exact = options.find((o) => o.key === shot.key);
    if (exact) return exact;
    if (shot.kind === "pack" || shot.kind === "collision") return undefined;
    const need = Math.min(2, shot.cars.length);
    const m = options
      .filter((o) => (o.kind === "battle" || o.kind === "overtake") && overlap(o.cars, shot.cars) >= need)
      .sort((a, b) => overlap(b.cars, shot.cars) - overlap(a.cars, shot.cars) || b.score - a.score)[0];
    return m ? { ...m, key: shot.key } : undefined;
  }

  /** Finished race: a collision starts its lead-in within the next MIN_HOLD seconds. */
  private collisionSoon(t: number) {
    if (!this.finished) return false;
    return this.incidents().some((inc) => inc.t0 - LEAD_IN > t && inc.t0 - LEAD_IN <= t + MIN_HOLD);
  }

  /** Lap 1: one wide shot of the whole field from the grid through the first corners. */
  private pack(t: number, order: CarState[]): Shot | null {
    if (!order.length) return null;
    const start = this.raceStart();
    const lead = order[0];
    const cars = order.map((s) => s.car);
    const shot: Shot = { key: "pack", kind: "pack", cars, score: 0 };
    if (start === undefined) return lead.lap <= 1 ? shot : null; // live, lights not out yet
    if (t < start) return shot; // on the grid
    const since = t - start;
    if (since >= PACK_MAX || lead.lap > 1) return null;
    if (since < PACK_MIN) return shot;
    return lead.dist > PACK_DIST && lead.dist < 5000 ? null : shot;
  }

  private candidates(t: number, order: CarState[], interval: (car: number) => number | null): Shot[] {
    const out: Shot[] = [];
    this.incidents().forEach((inc, i) => {
      const from = this.finished ? inc.t0 - LEAD_IN : inc.t0;
      if (t >= from && t <= inc.t1 + 2) {
        const cars = [...inc.drivers.filter((d) => d.role === "contact"), ...inc.drivers.filter((d) => d.role !== "contact")].map((d) => d.car);
        out.push({ key: `inc${i}`, kind: "collision", cars: cars.slice(0, 4), score: 100 });
      }
    });
    for (const e of this.events()) {
      if (e.code !== "OVTK" || e.a === undefined || e.b === undefined) continue;
      if (t >= e.t - (this.finished ? 2 : 0) && t <= e.t + 3) {
        const lo = Math.min(e.a, e.b);
        const hi = Math.max(e.a, e.b);
        out.push({ key: `ovt${lo}-${hi}`, kind: "overtake", cars: [e.a, e.b], score: 70 });
      }
    }
    // battles: runs of cars each within BATTLE_GAP of the one ahead
    let run: CarState[] = [];
    const flush = () => {
      if (run.length >= 2) {
        const gaps = run.slice(1).map((s) => interval(s.car) ?? BATTLE_GAP);
        const tight = 1 - Math.min(...gaps) / BATTLE_GAP;
        const front = run[0].pos > 0 && run[0].pos <= 3 ? 8 : run[0].pos <= 10 ? 3 : 0;
        // keyed by the cars (lowest number), not by who leads: the key survives a reshuffle
        const cars = run.slice(0, 4).map((s) => s.car);
        out.push({ key: `bat${Math.min(...cars)}`, kind: "battle", cars, score: 40 + 15 * tight + 3 * (run.length - 1) + front });
      }
      run = [];
    };
    for (const s of order) {
      const gap = run.length ? interval(s.car) : null;
      if (run.length && gap !== null && gap <= BATTLE_GAP) run.push(s);
      else {
        flush();
        run = [s];
      }
    }
    flush();
    if (order.length) out.push({ key: "lead", kind: "leader", cars: order.slice(0, 2).map((s) => s.car), score: 20 });
    return out;
  }
}
