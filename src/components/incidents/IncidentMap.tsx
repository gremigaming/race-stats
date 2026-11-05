import { useEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import type { RaceIncident, RaceManifest } from "../../viewer/format";
import { RaceScene, type MapPin, type Trail } from "../../viewer/scene";
import { ChunkStore, type CarState } from "../../viewer/store";
import { brakePoints } from "./brakes";

/**
 * The incident viewer's map (GreMi, 5 Nov 2026): the full track of one race with a marker per
 * incident. Opening one flies in, plays it with every involved car's line drawn as it drives
 * (the whole path faint, the part driven solid), then zooms back out to the markers.
 */

export const PRE = 4; // s before the first contact
export const POST = 3; // s after the last contact
const STEP = 0.1;
const HOLD = 1.2; // s to hold the last frame before zooming out

/** Distinct colours for the cars in an incident (team colours can be the same for teammates). */
export const CAR_COLORS = ["#ff8a1f", "#4fb6ff", "#a3e635", "#f472b6", "#facc15", "#c084fc"];

/** preview: opened, the cars frozen at the first contact and the camera on that part of the track (click again to play). */
export type Phase = "preview" | "loading" | "playing" | "done";

export interface Clock {
  t: number;
  playing: boolean;
  rate: number;
  /** Bumped to restart the opened incident from the start. */
  run: number;
}

/** What each involved car did through the incident window, every 0.1 s (NaN while not in the data). */
export interface IncidentSeries {
  from: number;
  to: number;
  cars: number[];
  speed: number[][];
  throttle: number[][];
  brake: number[][];
  steer: number[][];
  gear: number[][];
  /** Metres between the first two cars. */
  gap: number[];
}

export function IncidentMap(props: {
  manifest: RaceManifest;
  base: string;
  pins: MapPin[];
  open: RaceIncident | null;
  cars: number[];
  clock: MutableRefObject<Clock>;
  onPin: (id: string) => void;
  onTick: (t: number, playing: boolean, phase: Phase) => void;
  onSeries: (s: IncidentSeries | null) => void;
  /** Screen space the panels cover (px): the camera frames the cars in what's left. */
  inset?: { top: number; right: number; bottom: number; left: number };
}) {
  const { manifest, base } = props;
  const host = useRef<HTMLDivElement>(null);
  const scene = useRef<RaceScene | null>(null);
  const store = useMemo(() => new ChunkStore(manifest, base), [manifest, base]);
  const [mapPct, setMapPct] = useState(0);
  const [tip, setTip] = useState<{ id: string; x: number; y: number } | null>(null);
  const live = useRef({ open: props.open, cars: props.cars, pins: props.pins, onTick: props.onTick, onSeries: props.onSeries, onPin: props.onPin, inset: props.inset });
  live.current = { open: props.open, cars: props.cars, pins: props.pins, onTick: props.onTick, onSeries: props.onSeries, onPin: props.onPin, inset: props.inset };

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const pool: CarState[] = [];
    const one = { car: 0 } as CarState;
    let mapOk = false;
    const giveUp = performance.now() + 15000;
    let lastUi = 0;
    let doneAt = 0; // performance.now() the incident finished
    let phase: Phase = "done";
    let seenRun = -1;
    let seenInc: string | null = null;
    const keyOf = (i: RaceIncident | null) => (i ? `${i.t0}|${i.t1}` : null);
    // the lines: sampled once the chunks are in
    let trails: Trail[] = [];
    let trailsFor: string | null = null;
    const marker = { x: 0, z: 0, strength: 1 };

    const sampleTrails = (inc: RaceIncident, cars: number[]) => {
      const from = inc.t0 - PRE;
      const to = inc.t1 + POST;
      if (!store.loaded(from) || !store.loaded(to)) return false;
      const n = Math.round((to - from) / STEP) + 1;
      const series: IncidentSeries = { from, to, cars, speed: [], throttle: [], brake: [], steer: [], gear: [], gap: [] };
      const pos: number[][] = [];
      trails = cars.map((car, k) => {
        const pts: number[] = [];
        const sp: number[] = [];
        const th: number[] = [];
        const br: number[] = [];
        const st: number[] = [];
        const gr: number[] = [];
        for (let i = 0; i < n; i++) {
          const x = store.sampleCar(from + i * STEP, car, one);
          pts.push(x ? x.x : NaN, x ? x.z : NaN);
          sp.push(x ? x.speed : NaN);
          th.push(x ? x.throttle : NaN);
          br.push(x ? x.brake : NaN);
          st.push(x ? x.steer : NaN);
          gr.push(x ? x.gear : NaN);
        }
        series.speed.push(sp);
        series.throttle.push(th);
        series.brake.push(br);
        series.steer.push(st);
        series.gear.push(gr);
        pos.push(pts);
        return { color: CAR_COLORS[k % CAR_COLORS.length], pts, done: 0 };
      });
      if (pos.length >= 2)
        for (let i = 0; i < n; i++) series.gap.push(Math.hypot(pos[0][i * 2] - pos[1][i * 2], pos[0][i * 2 + 1] - pos[1][i * 2 + 1]));
      trailsFor = keyOf(inc);
      live.current.onSeries(series);
      return true;
    };

    const s = new RaceScene(el, manifest.cars, manifest.track, (dtMs) => {
      if (!mapOk) mapOk = s.mapProgress() >= 1 || performance.now() > giveUp;
      const c = props.clock.current;
      const { open: inc, cars } = live.current;
      const ins = live.current.inset;
      s.inset = ins ? { top: ins.top + 8, right: ins.right + 8, bottom: ins.bottom + 8, left: ins.left + 8 } : { top: 8, right: 8, bottom: 8, left: 8 };
      const now = performance.now();
      const key = keyOf(inc);
      if (key !== seenInc || c.run !== seenRun) {
        const fresh = key !== seenInc;
        seenInc = key;
        seenRun = c.run;
        if (inc) {
          if (trailsFor !== key) {
            trails = [];
            trailsFor = null;
            live.current.onSeries(null);
          }
          if (fresh) {
            // first click: show where it happened, the cars at the first contact
            c.t = inc.t0;
            c.playing = false;
            phase = "preview";
            s.follow(cars, 110);
          } else {
            // play (a second click, Play or Replay): from the start, flown in on its cars
            c.t = inc.t0 - PRE;
            c.playing = true;
            phase = "loading";
            s.follow(cars, 45);
          }
        } else {
          trails = [];
          trailsFor = null;
          phase = "done";
          s.showTrack();
        }
      }
      let states: CarState[] = [];
      if (inc) {
        const from = inc.t0 - PRE;
        const to = inc.t1 + POST;
        store.want(from, 1);
        store.want(Math.min(Math.max(c.t, from), to), 1);
        store.want(to, 1);
        if (trailsFor !== key) sampleTrails(inc, cars);
        const ready = mapOk && store.loaded(c.t) && trailsFor === key;
        if (phase === "loading" && ready) phase = "playing";
        if ((phase === "done" || phase === "preview") && c.t < to - 0.05 && c.playing) {
          // moved back into the incident (the charts): fly in again
          phase = "playing";
          s.follow(cars, 45);
        }
        if (phase === "playing" && c.playing && ready) {
          c.t += (dtMs / 1000) * c.rate;
          if (c.t >= to) {
            c.t = to;
            c.playing = false;
            doneAt = now;
          }
        }
        if (phase === "playing" && !c.playing && c.t >= to && now - doneAt > HOLD * 1000) {
          // played: back out to the whole track and its markers, the lines stay drawn
          phase = "done";
          s.showTrack();
        }
        if (phase !== "done" && store.loaded(c.t)) states = store.sample(c.t, pool);
        // the driven line: every sample up to now, then on to exactly where the car is this frame
        const k = Math.max(0, Math.min(Math.floor((c.t - from) / STEP + 1e-6) + 1, Math.round((to - from) / STEP) + 1));
        const whole = phase === "done" || phase === "preview";
        trails.forEach((tr, i) => {
          tr.done = whole ? tr.pts.length / 2 : k;
          const st = whole ? undefined : states.find((x) => x.car === cars[i]);
          tr.head = st ? { x: st.x, z: st.z } : null;
        });
        s.trails = trails;
        if (c.t >= inc.t0 && c.t <= inc.t1 + 1 && phase !== "done" && phase !== "preview") {
          marker.x = inc.x;
          marker.z = inc.z;
          marker.strength = c.t > inc.t1 + 0.3 ? 1 - (c.t - inc.t1 - 0.3) / 0.7 : 1;
          s.incident = marker;
        } else s.incident = null;
        s.pins = phase === "done" || phase === "preview" ? live.current.pins : [];
      } else {
        s.trails = [];
        s.incident = null;
        s.pins = live.current.pins;
      }
      if (now - lastUi > 100) {
        lastUi = now;
        live.current.onTick(c.t, c.playing, inc ? phase : "done");
      }
      return { t: c.t, states };
    });
    s.bounds = () => manifest.bounds ?? null;
    s.carBounds = () => store.bounds;
    s.conditions = manifest;
    s.inset = { top: 8, right: 8, bottom: 8, left: 8 };
    s.onPin = (id) => live.current.onPin(id);
    s.onPinHover = (id, at) => setTip(id && at ? { id, x: at.x, y: at.y } : null);
    s.showTrack();
    scene.current = s;
    // each corner's usual braking point (two laps of the whole field), once the map is up
    let gone = false;
    window.setTimeout(() => {
      if (!gone)
        void brakePoints(manifest, base).then((b) => {
          if (!gone) s.brakes = b;
        });
    }, 1500);
    const timer = window.setInterval(() => {
      const v = performance.now() > giveUp ? 1 : s.mapProgress();
      setMapPct(v);
      if (v >= 1) window.clearInterval(timer);
    }, 150);
    return () => {
      gone = true;
      window.clearInterval(timer);
      scene.current = null;
      try {
        s.destroy();
      } catch (e) {
        console.error("incident map teardown", e);
      }
      store.dispose();
    };
    // one scene per race
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store]);

  const tipPin = tip ? props.pins.find((p) => p.id === tip.id) : undefined;
  return (
    <div className="relative h-full w-full overflow-hidden bg-[#15181c]">
      <div ref={host} className="absolute inset-0" />
      {mapPct < 1 && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="rounded-lg border border-white/10 bg-[#0c0e11]/85 px-4 py-2.5 text-center backdrop-blur">
            <div className="text-sm font-semibold">Loading track</div>
            <div className="mt-1.5 h-1 w-40 overflow-hidden rounded bg-white/10">
              <div className="h-full bg-red-500 transition-[width] duration-150" style={{ width: `${Math.round(mapPct * 100)}%` }} />
            </div>
          </div>
        </div>
      )}
      {tip && tipPin && (
        <div
          className="pointer-events-none absolute z-10 max-w-[16rem] -translate-x-1/2 -translate-y-full rounded-md border border-white/10 bg-[#0c0e11]/95 px-2 py-1 text-xs shadow-xl"
          style={{ left: tip.x, top: tip.y - tipPin.r - 8 }}
        >
          {tipPin.title ?? tipPin.label}
        </div>
      )}
    </div>
  );
}
