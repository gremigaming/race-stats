/**
 * The broadcast camera's director: picks what the default TV view shows, like a race director
 * cutting between cameras. Collisions first, then overtakes, then the tightest battles. A shot
 * is held at least MIN_HOLD seconds (collisions may cut in any time) and at most MAX_HOLD while
 * something else is worth showing. On a finished race it knows a collision is coming and cuts
 * there a few seconds before it; live, it cuts when it happens.
 */
import type { RaceEvent, RaceIncident } from "./format";
import type { CarState } from "./store";

export interface Shot {
  key: string;
  kind: "collision" | "overtake" | "battle" | "leader";
  cars: number[];
  score: number;
}

const MIN_HOLD = 8;
const MAX_HOLD = 60;
const LEAD_IN = 4; // seconds a finished race's camera arrives before a collision
const BATTLE_GAP = 1.0; // seconds between cars that count as a battle

export class Director {
  private shot: Shot | null = null;
  private since = 0;
  private lastPick = -Infinity;

  private incidents: () => RaceIncident[];
  private events: () => RaceEvent[];
  private finished: boolean;

  constructor(incidents: () => RaceIncident[], events: () => RaceEvent[], finished: boolean) {
    this.incidents = incidents;
    this.events = events;
    this.finished = finished;
  }

  /** Start over (after a seek). */
  reset() {
    this.shot = null;
    this.lastPick = -Infinity;
  }

  /** The shot to show at race time t. `order` runs P1 first; interval(car) is to the car ahead. */
  update(t: number, order: CarState[], interval: (car: number) => number | null): Shot | null {
    if (this.shot && Math.abs(t - this.lastPick) < 0.5 && t >= this.lastPick) return this.shot;
    if (this.shot && (t < this.lastPick || t - this.lastPick > 30)) this.reset();
    this.lastPick = t;
    const live = new Set(order.map((s) => s.car));
    const options = this.candidates(t, order, interval).filter((c) => c.cars.some((x) => live.has(x)));
    const best = options.reduce<Shot | null>((a, b) => (!a || b.score > a.score ? b : a), null);
    const cur = this.shot ? options.find((o) => o.key === this.shot!.key) : undefined;
    const held = t - this.since;
    let next = this.shot;
    if (!this.shot || !best) next = best;
    else if (best.kind === "collision" && this.shot.kind !== "collision") next = best;
    else if (!cur) next = held >= 4 || this.shot.kind === "collision" ? best : this.shot;
    else if (held >= MAX_HOLD) next = options.filter((o) => o.key !== cur.key && o.score >= 30).sort((a, b) => b.score - a.score)[0] ?? cur;
    else if (held >= MIN_HOLD && best.key !== cur.key && best.score > cur.score * 1.3 + 5) next = best;
    else next = cur; // same shot, cars and score refreshed
    if (next && (!this.shot || next.key !== this.shot.key)) this.since = t;
    this.shot = next;
    return next;
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
        out.push({ key: `bat${run[0].car}`, kind: "battle", cars: run.slice(0, 4).map((s) => s.car), score: 40 + 15 * tight + 3 * (run.length - 1) + front });
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
