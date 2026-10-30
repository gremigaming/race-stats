import { ArrowLeft, ChevronLeft, Compass, Eye, EyeOff, Hand, Maximize, Minus, Navigation, PanelRight, Plus, RotateCcw, RotateCw, Tv, Video } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link, useParams } from "react-router-dom";
import { useTelemetry } from "../context/TelemetryContext";
import { driverKey, RACE_POINTS } from "../league/league";
import { liveryOf, loadLiveries, type Livery } from "../viewer/cars";
import { IncidentFeed, IncidentPip, StartLights, TvStrip } from "../viewer/broadcast";
import { DriverCard } from "../viewer/DriverCard";
import { Director } from "../viewer/director";
import { incidentsOf, loadManifest, type RaceIncident, type RaceManifest } from "../viewer/format";
import type { SurfacePick, TimePick } from "../viewer/look";
import { IconButton, IncidentDetail, PlayerBar, type IncidentDriverStats, type Trace } from "../viewer/panels";
import { bits, RaceScene, type CameraMode } from "../viewer/scene";
import { Empty, PointsPanel, SafetyPanel, Sidebar, StatsPanel, type SafetyRow, type SideTab, type StatsRow } from "../viewer/sidebar";
import { readShared, ShareMenu } from "../viewer/share";
import { ChunkStore, type CarState } from "../viewer/store";
import { TimingTower, type TowerRow } from "../viewer/tower";

const MAX_SELECTED = 4;
const BAR_SPACE = 96; // px the player bar covers at the bottom of the map
const TOP_SPACE = 56; // the title row
const TOWER_SPACE = 252; // the timing tower on the left (wide screens)
const LIGHT_STEP = 1; // seconds between start lights coming on
const STATUS: Record<number, string> = { 4: "DNF", 5: "DSQ", 6: "NC", 7: "DNF" };
const SIDE_KEY = "race-viewer-side";

/** The right-hand column's last state (open, tab), remembered per browser. */
function readSide(): { open: boolean; tab: SideTab } {
  const phone = window.innerWidth < 768;
  try {
    const v = JSON.parse(localStorage.getItem(SIDE_KEY) ?? "null") as { open?: boolean; tab?: SideTab } | null;
    return { open: phone ? false : (v?.open ?? true), tab: v?.tab ?? "incidents" };
  } catch {
    return { open: !phone, tab: "incidents" };
  }
}

/** The league race file (from the safety rating) for this recording: same track, saved within a few hours of its start. */
function leagueFileOf(files: string[], track: string, started: string) {
  const norm = (x: string) => x.toLowerCase().replace(/[^a-z0-9]/g, "");
  const t0 = Date.parse(`${started}Z`);
  let best: string | null = null;
  let bestD = Infinity;
  for (const f of files) {
    const m = /^Race_(.+)_(\d{4})_(\d\d)_(\d\d)_(\d\d)_(\d\d)_(\d\d)\.json$/.exec(f);
    if (!m || !norm(m[1]).startsWith(norm(track))) continue; // "Suzuka_Just_in_case" is still Suzuka
    const d = Date.UTC(+m[2], +m[3] - 1, +m[4], +m[5], +m[6], +m[7]) - t0;
    if (d < -10 * 60_000 || d > 4 * 3600_000 || Math.abs(d) >= bestD) continue;
    best = f;
    bestD = Math.abs(d);
  }
  return best;
}

/** The Live Race Viewer: one screen, the whole race on a WebGL map (spec v1, phase 2). */
export function RaceViewerPage() {
  const { formulaKey, id } = useParams<{ formulaKey: string; id: string }>();
  const [race, setRace] = useState<{ manifest: RaceManifest; base: string } | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!id) return;
    let alive = true;
    setRace(null);
    setFailed(false);
    loadManifest(id).then((r) => {
      if (!alive) return;
      if (r) setRace(r);
      else setFailed(true);
    });
    return () => {
      alive = false;
    };
  }, [id]);

  const back = `/${formulaKey ?? ""}/race`;
  if (failed)
    return (
      <Shell back={back}>
        <p className="text-zinc-400">This race isn't available (yet).</p>
      </Shell>
    );
  if (!race)
    return (
      <Shell back={back}>
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-zinc-700 border-t-red-500" />
      </Shell>
    );
  return <Viewer key={race.manifest.uid} manifest={race.manifest} base={race.base} back={back} />;
}

function Shell({ back, children }: { back: string; children: ReactNode }) {
  return (
    <div className="fixed inset-0 flex flex-col items-center justify-center gap-4 bg-[#0c0e11] text-zinc-100">
      {children}
      <Link to={back} className="text-sm text-zinc-400 underline">
        All races
      </Link>
    </div>
  );
}

interface View {
  t: number;
  states: CarState[];
  rot: number;
  trace: Trace | undefined;
  lights: { lit: number; fade: number } | null;
}

/** What the camera did before an incident was opened, to go back to once it has played. */
interface Restore {
  mode: CameraMode;
  cars: number[];
  rate: number;
  inc: number;
}

function Viewer({ manifest: initial, base, back }: { manifest: RaceManifest; base: string; back: string }) {
  const [manifest, setManifest] = useState(initial);
  const host = useRef<HTMLDivElement>(null);
  const scene = useRef<RaceScene | null>(null);
  const store = useMemo(() => new ChunkStore(initial, base), [initial, base]);
  const incidents = useMemo(() => incidentsOf(manifest), [manifest]);
  const [start, spanEnd] = store.span();
  const end = manifest.duration ?? spanEnd;
  const lapStarts = manifest.lap_starts ?? [];
  const raceStart = lapStarts[0] ?? start;
  const play = useRef({ t: raceStart, playing: false, rate: 1 });
  /** The start lights: when the sequence began (performance.now) and how long until they go out (ms). */
  const lights = useRef<{ at: number; out: number } | null>(null);
  const lightsShown = useRef(false);
  const [view, setView] = useState<View>({ t: play.current.t, states: [], rot: 0, trace: undefined, lights: null });
  const [playing, setPlaying] = useState(false);
  const [rate, setRate] = useState(1);
  const [surface, setSurface] = useState<SurfacePick>("auto");
  const [timePick, setTimePick] = useState<TimePick>("auto");
  const [selected, setSelected] = useState<number[]>([]);
  const [focusPick, setFocusPick] = useState<number | null>(null);
  const [mode, setMode] = useState<CameraMode>("tv");
  const [followed, setFollowed] = useState<number[]>([]);
  const [autoRotate, setAutoRotate] = useState(false);
  const [activeInc, setActiveInc] = useState<number | null>(null);
  const [cardCar, setCardCar] = useState<number | null>(null);
  const [towerOpen, setTowerOpen] = useState(() => window.innerWidth >= 768);
  const [side, setSideState] = useState(readSide);
  const setSide = (next: Partial<typeof side>) =>
    setSideState((cur) => {
      const v = { ...cur, ...next };
      try {
        localStorage.setItem(SIDE_KEY, JSON.stringify(v));
      } catch {
        // private window: just not remembered
      }
      return v;
    });
  /** Everything hidden but the map and the player bar (H). */
  const [clean, setClean] = useState(false);
  const { league } = useTelemetry();
  const [liveries, setLiveries] = useState<Record<string, Livery>>({});
  const [loads, setLoads] = useState(0);
  const [pip, setPip] = useState<number[]>([]);
  const lastUi = useRef(0);
  const lastTrace = useRef(0);
  const incidentsRef = useRef(incidents);
  incidentsRef.current = incidents;
  const manifestRef = useRef(manifest);
  manifestRef.current = manifest;
  const restore = useRef<Restore | null>(null);
  const endIncidentRef = useRef<() => void>(() => {});
  const pickRef = useRef<(car: number, add: boolean) => void>(() => {});
  const focusCar = focusPick !== null && selected.includes(focusPick) ? focusPick : (selected[selected.length - 1] ?? null);
  const focusRef = useRef(focusCar);
  focusRef.current = focusCar;
  const director = useMemo(
    () =>
      new Director(
        () => incidentsRef.current,
        () => manifestRef.current.events,
        initial.finished,
      ),
    [initial],
  );

  useEffect(() => {
    void loadLiveries().then(setLiveries);
  }, []);

  // a race still running: pick up new chunks every few seconds (phase 3 swaps this for the socket)
  useEffect(() => {
    if (initial.finished) return;
    const timer = window.setInterval(async () => {
      const r = await loadManifest(initial.uid);
      if (r) {
        store.addNames(r.manifest.chunks);
        if (r.manifest.ghosts) store.ghosts = r.manifest.ghosts;
        if (r.manifest.track_length) store.lapLength = r.manifest.track_length;
        setManifest(r.manifest);
      }
    }, 5000);
    return () => window.clearInterval(timer);
  }, [initial, store]);

  // live races: a new incident pops up as a picture-in-picture replay
  const seenInc = useRef(incidents.length);
  useEffect(() => {
    if (manifest.finished) return;
    const n = incidents.length;
    if (n > seenInc.current) {
      const fresh = Array.from({ length: n - seenInc.current }, (_, i) => seenInc.current + i);
      seenInc.current = n;
      setPip((q) => [...q, ...fresh]);
    }
  }, [incidents, manifest.finished]);

  /** The interval of `car` to the car ahead in `order` (s): the timing points, else distance over speed. */
  const intervalIn = useCallback(
    (order: CarState[], car: number, t: number) => {
      const i = order.findIndex((s) => s.car === car);
      if (i <= 0) return null;
      const me = order[i];
      const ahead = order[i - 1];
      const v = store.interval(me, ahead, t);
      if (v !== null) return v;
      const d = store.progress(ahead.lap, ahead.dist) - store.progress(me.lap, me.dist);
      return Math.max(0, d / Math.max(me.speed / 3.6, 10));
    },
    [store],
  );

  // the scene, its clock, the start lights, the broadcast director, the incident marker and the trace
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const p = play.current;
    store.wantAll();
    let loadTimer = 0;
    store.onLoad = () => {
      if (!loadTimer) loadTimer = window.setTimeout(() => ((loadTimer = 0), setLoads((n) => n + 1)), 300);
    };
    const s = new RaceScene(el, initial.cars, initial.track, (dtMs) => {
      const now = performance.now();
      // start lights: the clock waits while they come on, and runs the moment they go out
      const L = lights.current;
      let lit: View["lights"] = null;
      if (L) {
        const ms = now - L.at;
        if (ms < L.out) lit = { lit: Math.min(5, Math.floor(ms / (LIGHT_STEP * 1000)) + 1), fade: 1 };
        else if (ms < L.out + 1200) lit = { lit: 0, fade: 1 - (ms - L.out) / 1200 };
        else lights.current = null;
      }
      const holding = !!L && now - L.at < L.out;
      if (p.playing && !holding && store.loaded(p.t)) {
        p.t += (dtMs / 1000) * p.rate;
        if (p.t >= end) {
          p.t = end;
          p.playing = false;
          setPlaying(false);
        }
      }
      if (!L && !p.playing && !lightsShown.current && Math.abs(p.t - raceStart) < 0.05) lit = { lit: 0, fade: 1 };
      if (!manifestRef.current.finished) {
        const ev = manifestRef.current.events;
        const on = ev.filter((e) => e.code === "STLG").length;
        if (on && !ev.some((e) => e.code === "LGOT")) lit = { lit: Math.min(5, on), fade: 1 };
      }
      store.want(p.t);
      const states = store.sample(p.t);
      const order = [...states].sort((a, b) => (a.pos || 99) - (b.pos || 99));
      // the broadcast camera
      if (s.mode === "tv") {
        const shot = director.update(p.t, order, (car) => intervalIn(order, car, p.t));
        if (shot) {
          const idx = shot.cars.map((c) => order.findIndex((o) => o.car === c)).filter((i) => i >= 0);
          const around = idx.length ? [order[Math.min(...idx) - 1], order[Math.max(...idx) + 1]].filter((o): o is CarState => !!o).map((o) => o.car) : [];
          s.shoot(shot.cars, around);
        }
      }
      // the incident marker: on the track only from the moment of contact
      const incs = incidentsRef.current;
      const k = incs.findIndex((i) => p.t >= i.t0 && p.t <= i.t1 + 1);
      if (k >= 0) {
        const i = incs[k];
        s.incident = { x: i.x, z: i.z, strength: p.t > i.t1 + 0.3 ? 1 - (p.t - i.t1 - 0.3) / 0.7 : 1 };
      } else s.incident = null;
      // an opened incident has played (or the user went elsewhere): back to what the camera did before
      const R = restore.current;
      if (R) {
        const inc = incs[R.inc];
        if (!inc || p.t > inc.t1 + 3 || p.t < inc.t0 - 6) window.setTimeout(() => endIncidentRef.current(), 0);
      }
      if (now - lastUi.current > 33) {
        lastUi.current = now;
        setView((v) => {
          let trace = v.trace;
          const car = focusRef.current;
          if (now - lastTrace.current > 150) {
            lastTrace.current = now;
            trace = undefined;
            if (car !== null) {
              const tr: Trace = { throttle: [], brake: [], steer: [] };
              for (let k2 = 40; k2 >= 0; k2--) {
                const x = store.sample(p.t - k2 * 0.25).find((c) => c.car === car);
                tr.throttle.push(x?.throttle ?? 0);
                tr.brake.push(x?.brake ?? 0);
                tr.steer.push(x?.steer ?? 0);
              }
              trace = tr;
            }
          }
          return { t: p.t, states, rot: s.rotation, trace, lights: lit };
        });
      }
      return { t: p.t, states };
    });
    s.bounds = () => store.bounds;
    s.conditions = initial;
    s.onPick = (car, add) => pickRef.current(car, add);
    s.onModeChange = (m, cars) => {
      setMode(m);
      setFollowed([...cars]);
    };
    s.tv();
    scene.current = s;
    return () => {
      window.clearTimeout(loadTimer);
      store.onLoad = null;
      s.destroy();
      scene.current = null;
      store.dispose();
    };
    // the scene lives as long as this race is open
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store]);

  useEffect(() => {
    if (scene.current) scene.current.selected = new Set(selected);
  }, [selected]);

  useEffect(() => {
    const s = scene.current;
    if (!s) return;
    s.conditions = manifest;
    s.surface = surface;
    s.time = timePick;
  }, [manifest, surface, timePick]);

  const stripOn = selected.length > 0 && activeInc === null && !clean;
  const towerShown = towerOpen && !clean;
  // keep the camera clear of the title row, the timing tower, the TV strip and the player bar
  useEffect(() => {
    const s = scene.current;
    if (s)
      s.inset = {
        top: TOP_SPACE,
        bottom: BAR_SPACE + (stripOn ? 72 : 0),
        left: towerShown && window.innerWidth >= 768 ? TOWER_SPACE : 0,
        right: 0,
      };
  }, [towerShown, stripOn, view.states.length > 0]);

  const seek = useCallback(
    (t: number) => {
      play.current.t = Math.min(end, Math.max(start, t));
      if (play.current.t <= raceStart + 0.05) lightsShown.current = false;
      director.reset();
      setView((v) => ({ ...v, t: play.current.t }));
    },
    [start, end, raceStart, director],
  );
  const toggle = useCallback(() => {
    const p = play.current;
    if (!p.playing && p.t >= end - 0.05) p.t = start;
    p.playing = !p.playing;
    // from the grid: five lights, one a second, then out after a random hold
    if (p.playing && manifestRef.current.finished && !lightsShown.current && Math.abs(p.t - raceStart) < 0.05) {
      lightsShown.current = true;
      lights.current = { at: performance.now(), out: 4000 + 700 + Math.random() * 1500 };
    }
    setPlaying(p.playing);
  }, [start, end, raceStart]);
  const changeRate = (r: number) => {
    play.current.rate = r;
    setRate(r);
  };

  /** Open an incident: 3 s before, half speed, camera closer in and locked on everyone involved. */
  const pickIncident = (k: number) => {
    const inc = incidents[k];
    const s = scene.current;
    if (!inc || !s) return;
    if (restore.current) restore.current.inc = k;
    else restore.current = { mode: s.mode, cars: [...s.followCars], rate: play.current.rate, inc: k };
    setActiveInc(k);
    setSide({ tab: "incidents" });
    seek(inc.t0 - 3);
    changeRate(0.5);
    s.follow(
      inc.drivers.map((d) => d.car),
      45,
    );
    play.current.playing = true;
    setPlaying(true);
  };
  /** Back to the picked driver(s) or the broadcast camera, at the speed from before. */
  const endIncident = () => {
    const R = restore.current;
    restore.current = null;
    setActiveInc(null);
    if (!R) return;
    changeRate(R.rate);
    const s = scene.current;
    if (!s) return;
    if (R.mode === "follow" && R.cars.length) s.follow(R.cars);
    else if (R.mode === "track") s.showTrack();
    else if (R.mode === "free") s.free();
    else s.tv();
  };
  endIncidentRef.current = endIncident;

  /** Pick a driver (tower or map): the camera follows them; Shift adds more; picking the only one again goes back to the broadcast camera. */
  const pickDriver = (car: number, add: boolean) => {
    const s = scene.current;
    if (restore.current) {
      changeRate(restore.current.rate);
      restore.current = null;
      setActiveInc(null);
    }
    const next = add
      ? selected.includes(car)
        ? selected.filter((c) => c !== car)
        : [...selected, car].slice(-MAX_SELECTED)
      : selected.length === 1 && selected[0] === car
        ? []
        : [car];
    setSelected(next);
    setFocusPick(next.includes(car) ? car : null);
    // the Driver tab shows the one just picked; dropping the last pick closes it
    if (next.includes(car)) {
      setCardCar(car);
      setSide({ tab: "driver" });
    } else if (!next.length || cardCar === car) setCardCar(next[next.length - 1] ?? null);
    if (!s) return;
    if (next.length) s.follow(next);
    else s.tv();
  };
  pickRef.current = pickDriver;
  const clearDrivers = () => {
    setSelected([]);
    setCardCar(null);
    scene.current?.tv();
  };
  const toggleFollow = (car: number) => {
    const s = scene.current;
    if (!s) return;
    const cur = s.mode === "follow" ? s.followCars : [];
    if (cur.includes(car)) {
      const rest = cur.filter((c) => c !== car);
      if (rest.length) s.follow(rest);
      else s.tv();
    } else s.follow([...cur, car]);
  };
  const setAuto = (on: boolean) => {
    setAutoRotate(on);
    if (scene.current) scene.current.autoRotate = on;
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement | null)?.closest("input, textarea, select")) return;
      if (e.code === "Space") {
        e.preventDefault();
        toggle();
      } else if (e.code === "ArrowLeft") seek(play.current.t - 5);
      else if (e.code === "ArrowRight") seek(play.current.t + 5);
      else if (e.key === "q") scene.current?.rotateBy(-Math.PI / 12);
      else if (e.key === "e") scene.current?.rotateBy(Math.PI / 12);
      else if (e.key === "n") scene.current?.resetRotation();
      else if (e.key === "h") setClean((c) => !c);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggle, seek]);

  // a shared link (?car=, ?inc=, ?t=): follow those drivers, then open the incident or go to the moment
  useEffect(() => {
    const sh = readShared(window.location.search);
    const s = scene.current;
    if (!s) return;
    const cars = sh.cars.filter((c) => manifest.cars[String(c)]).slice(-MAX_SELECTED);
    if (cars.length) {
      setSelected(cars);
      setFocusPick(cars[cars.length - 1]);
      setCardCar(cars[cars.length - 1]);
      s.follow(cars);
    }
    if (sh.inc !== null) {
      const at = start + sh.inc;
      let k = -1;
      incidents.forEach((i, n) => {
        if (Math.abs(i.t0 - at) < 3 && (k < 0 || Math.abs(i.t0 - at) < Math.abs(incidents[k].t0 - at))) k = n;
      });
      if (k >= 0) pickIncident(k);
      else seek(at - 3);
    } else if (sh.t !== null) seek(start + sh.t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ------------------------------------------------------------------ timing tower

  const t = view.t;
  const byCar = new Map(view.states.map((s) => [s.car, s]));
  const order = [...view.states].sort((a, b) => (a.pos || 99) - (b.pos || 99));
  const livery = (car: number) => liveryOf(liveries, manifest.cars[String(car)]);
  const color = (car: number) => livery(car).base;
  const name = (car: number) => manifest.cars[String(car)]?.name ?? `Car ${car}`;
  const timing = (car: number) => manifest.timing?.[String(car)];
  const statusAt = (car: number) => {
    const st = timing(car)?.status ?? [];
    let code = 2;
    for (const [at, c] of st) if (at <= t) code = c;
    return code;
  };
  const finishAt = (car: number) => timing(car)?.status.find(([, c]) => c === 3)?.[0] ?? null;
  const lapsDone = (car: number, by = t) => (timing(car)?.laps ?? []).filter((l) => l[1] <= by);
  const finished = order.filter((s) => statusAt(s.car) === 3).map((s) => ({ car: s.car, at: finishAt(s.car) ?? Infinity }));
  const winner = finished.length ? finished.reduce((a, b) => (b.at < a.at ? b : a)) : null;
  const running = order.filter((s) => !STATUS[statusAt(s.car)]);
  const gapText = (s: CarState, i: number): string => {
    if (statusAt(s.car) === 3 && winner) {
      if (s.car === winner.car) return "Winner";
      const mine = finishAt(s.car);
      const down = lapsDone(winner.car, winner.at).length - lapsDone(s.car, mine ?? t).length;
      if (down >= 1) return `+${down} LAP${down > 1 ? "S" : ""}`;
      return mine !== null ? `+${(mine - winner.at).toFixed(1)}` : "";
    }
    if (i === 0) return "Leader";
    const ahead = running[i - 1];
    const behind = store.progress(ahead.lap, ahead.dist) - store.progress(s.lap, s.dist);
    if (behind > store.lapLength && store.lapLength < 7000) {
      const n = Math.floor(behind / store.lapLength);
      return `+${n} LAP${n > 1 ? "S" : ""}`;
    }
    const v = intervalIn(running, s.car, t);
    return v === null ? "" : `+${v.toFixed(1)}`;
  };
  const rows: TowerRow[] = [
    ...running.map((s, i) => ({ car: s.car, pos: s.pos, name: name(s.car), livery: livery(s.car), gap: gapText(s, i), finished: statusAt(s.car) === 3, out: null, off: bits(s.off) >= 2 })),
    ...order
      .filter((s) => STATUS[statusAt(s.car)])
      .map((s) => ({ car: s.car, pos: s.pos, name: name(s.car), livery: livery(s.car), gap: "", finished: false, out: STATUS[statusAt(s.car)], off: false })),
  ];
  const gapOf = (car: number) => rows.find((r) => r.car === car)?.out ?? rows.find((r) => r.car === car)?.gap ?? "";
  const leaderLap = order[0]?.lap ?? 0;

  // the incident deep-dive, measured from the chunks around it (recomputed as chunks arrive)
  const incStats = useMemo<IncidentDriverStats[]>(() => {
    const inc = activeInc === null ? null : incidents[activeInc];
    if (!inc) return [];
    const out = new Map<number, IncidentDriverStats>();
    for (const d of inc.drivers)
      out.set(d.car, {
        car: d.car,
        role: d.role,
        speedAt: 0,
        minSpeed: Infinity,
        maxSlide: 0,
        maxBrake: 0,
        offWheels: 0,
        lockup: false,
        surfaces: d.surfaces,
        speeds: [],
      });
    let any = false;
    for (let at = inc.t0 - 3; at <= inc.t1 + 3; at += 0.1) {
      const now = new Map(store.sample(at).map((x) => [x.car, x]));
      for (const d of out.values()) {
        const x = now.get(d.car);
        d.speeds.push(x?.speed ?? NaN);
        if (!x) continue;
        any = true;
        const slide = Math.abs(x.slip) * (180 / Math.PI);
        if (Math.abs(at - inc.t0) < 0.06) d.speedAt = x.speed;
        if (at >= inc.t0) d.minSpeed = Math.min(d.minSpeed, x.speed);
        if (x.speed > 40) d.maxSlide = Math.max(d.maxSlide, slide);
        if (at >= inc.t0 - 1.5 && at <= inc.t1 + 1.5) d.maxBrake = Math.max(d.maxBrake, x.brake);
        d.offWheels = Math.max(d.offWheels, bits(x.off));
        if (x.speed > 40 && x.brake >= 0.8 && slide >= 4) d.lockup = true;
      }
    }
    if (!any) return [];
    return [...out.values()].map((d) => ({ ...d, minSpeed: Number.isFinite(d.minSpeed) ? d.minSpeed : d.speedAt }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeInc, incidents, store, loads]);

  // ------------------------------------------------------------------ side panels

  const passed = incidents.filter((inc) => inc.t0 <= t);
  const leagueFile = useMemo(() => {
    const files = new Set<string>();
    for (const d of league?.safetyData?.drivers ?? []) for (const x of d.sessions) if (x.race) files.add(x.file);
    return leagueFileOf([...files], manifest.track, manifest.started);
  }, [league?.safetyData, manifest.track, manifest.started]);
  const raceOver = t >= end - 0.5;
  const safetyRows: SafetyRow[] = rows.map((r) => {
    const d = league?.safety.get(driverKey(r.name));
    const mine = leagueFile ? d?.sessions.find((x) => x.file === leagueFile) : undefined;
    const done = raceOver || statusAt(r.car) >= 3;
    const lap = byCar.get(r.car)?.lap ?? 0;
    const pts = mine ? mine.items.filter((i) => (i.lap !== null ? i.lap < lap || done : done)).reduce((n, i) => n + i.pts, 0) : null;
    return { car: r.car, name: r.name, livery: r.livery, pts, sr: d && !d.banned ? d.sr : null };
  });
  const statsRows: StatsRow[] = rows.map((r) => {
    const tm = timing(r.car);
    const laps = lapsDone(r.car);
    return {
      car: r.car,
      name: r.name,
      livery: r.livery,
      grid: tm?.grid ?? 0,
      pos: r.pos,
      out: r.out,
      overtakes: manifest.events.filter((e) => e.code === "OVTK" && e.a === r.car && e.t <= t).length,
      pits: tm?.pits ? tm.pits.filter((x) => x <= t).length : null,
      incidents: passed.filter((inc) => inc.drivers.some((d) => d.car === r.car)).length,
      best: laps.length ? Math.min(...laps.map((l) => l[2])) : null,
    };
  });
  const fastest = statsRows.reduce<{ car: number; name: string; ms: number; lap: number } | null>((a, r) => {
    if (r.best === null || (a && a.ms <= r.best)) return a;
    const lap = lapsDone(r.car).find((l) => l[2] === r.best)?.[0] ?? 0;
    return { car: r.car, name: r.name, ms: r.best, lap };
  }, null);
  const pointsRows = rows.map((r) => ({ car: r.car, pos: r.pos, name: r.name, livery: r.livery, out: r.out, pts: r.out || !r.pos ? 0 : (RACE_POINTS[r.pos - 1] ?? 0) }));
  const pickFromPanel = (car: number) => {
    if (selected.length === 1 && selected[0] === car) {
      setCardCar(car);
      setSide({ tab: "driver" });
    } else pickDriver(car, false);
  };
  const sideShown = side.open && !clean;

  const rotDeg = (view.rot * 180) / Math.PI;
  const date = manifest.started.slice(0, 10);
  const inc: RaceIncident | null = activeInc === null ? null : (incidents[activeInc] ?? null);
  const pipInc = pip.length > 0 && activeInc === null ? incidents[pip[0]] : undefined;
  const cardTiming = cardCar === null ? undefined : timing(cardCar);

  const panel = (() => {
    if (side.tab === "driver")
      return cardCar === null ? (
        <Empty title="Driver" text="Pick a driver on the map or in the timing tower to see their race so far." />
      ) : (
        <DriverCard
          car={cardCar}
          info={manifest.cars[String(cardCar)]}
          color={color(cardCar)}
          team={manifest.cars[String(cardCar)]?.team_name?.replace(/ '\d\d$/, "") ?? ""}
          pos={byCar.get(cardCar)?.pos ?? 0}
          grid={cardTiming?.grid ?? 0}
          lap={byCar.get(cardCar)?.lap ?? 0}
          laps={manifest.laps}
          done={lapsDone(cardCar)}
          status={STATUS[statusAt(cardCar)] ?? (statusAt(cardCar) === 3 ? `P${byCar.get(cardCar)?.pos ?? "–"} FIN` : null)}
          incidents={incidents}
          cars={manifest.cars}
          t={t}
          start={start}
          following={mode === "follow" && followed.includes(cardCar)}
          onFollow={() => toggleFollow(cardCar)}
          onIncident={pickIncident}
          onClose={() => setCardCar(null)}
        />
      );
    if (side.tab === "safety") return <SafetyPanel rows={safetyRows} matched={!!leagueFile} onPick={pickFromPanel} />;
    if (side.tab === "stats") return <StatsPanel rows={statsRows} incidents={passed.length} fastest={fastest} onPick={pickFromPanel} />;
    if (side.tab === "points") return <PointsPanel rows={pointsRows} onPick={pickFromPanel} />;
    return (
      <>
        {inc && (
          <div className="p-3">
            <IncidentDetail
              incident={inc}
              stats={incStats}
              cars={manifest.cars}
              color={color}
              start={start}
              t={t}
              from={inc.t0 - 3}
              to={inc.t1 + 3}
              states={byCar}
              onClose={endIncident}
            />
          </div>
        )}
        <IncidentFeed incidents={incidents} cars={manifest.cars} color={color} start={start} t={t} focus={focusCar} active={activeInc} onPick={pickIncident} />
      </>
    );
  })();

  return (
    <div className="fixed inset-0 flex flex-col bg-[#0c0e11] text-zinc-100 md:flex-row">
      <div className="relative min-h-0 min-w-0 flex-1 overflow-hidden">
        <div ref={host} className="absolute inset-0" />
        <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start gap-2 p-2 md:p-3">
          <Link
            to={back}
            aria-label="All races"
            className="pointer-events-auto flex h-9 shrink-0 items-center gap-1 rounded-lg border border-white/10 bg-[#0c0e11]/85 px-2 text-sm text-zinc-300 backdrop-blur hover:text-white"
          >
            <ArrowLeft className="h-4 w-4" /> <span className="hidden sm:inline">Races</span>
          </Link>
          <div className="min-w-0 rounded-lg border border-white/10 bg-[#0c0e11]/85 px-2.5 py-1 backdrop-blur md:px-3 md:py-1.5">
            <div className="truncate text-xs font-semibold md:text-sm">
              {manifest.track}
              <span className="hidden sm:inline"> · {manifest.session}</span>
              {!manifest.finished && <span className="ml-2 font-semibold text-red-400 sm:hidden">LIVE</span>}
            </div>
            <div className="hidden text-xs text-zinc-500 sm:block">
              {date}
              {!manifest.finished && <span className="ml-2 font-semibold text-red-400">LIVE</span>}
            </div>
          </div>
          <div className="pointer-events-auto ml-auto flex shrink-0 items-center justify-end gap-0.5 rounded-lg border border-white/10 bg-[#0c0e11]/85 p-0.5 backdrop-blur">
            <IconButton label="Broadcast camera: follows the action" active={mode === "tv"} onClick={() => scene.current?.tv()}>
              <Tv className="h-4 w-4" />
            </IconButton>
            <IconButton label="Full track" active={mode === "track"} onClick={() => scene.current?.showTrack()}>
              <Maximize className="h-4 w-4" />
            </IconButton>
            <IconButton
              label="Follow the selected drivers"
              active={mode === "follow"}
              onClick={() => scene.current?.follow(selected.length ? selected : order[0] ? [order[0].car] : [])}
            >
              <Video className="h-4 w-4" />
            </IconButton>
            {/* pinch, wheel and drag do all of this on a phone */}
            <span className="hidden md:contents">
              <IconButton label="Free pan and zoom" active={mode === "free"} onClick={() => scene.current?.free()}>
                <Hand className="h-4 w-4" />
              </IconButton>
              <IconButton label="Zoom in" onClick={() => scene.current?.zoom(1.5)}>
                <Plus className="h-4 w-4" />
              </IconButton>
              <IconButton label="Zoom out" onClick={() => scene.current?.zoom(1 / 1.5)}>
                <Minus className="h-4 w-4" />
              </IconButton>
              <span className="mx-0.5 h-5 w-px bg-white/10" />
              <IconButton label="Rotate left (Q, or Shift+drag)" onClick={() => scene.current?.rotateBy(-Math.PI / 12)}>
                <RotateCcw className="h-4 w-4" />
              </IconButton>
            </span>
            <IconButton label="North up (N)" active={Math.abs(rotDeg) > 0.5} onClick={() => scene.current?.resetRotation()}>
              <Compass className="h-4 w-4" style={{ transform: `rotate(${rotDeg}deg)` }} />
            </IconButton>
            <span className="hidden md:contents">
              <IconButton label="Rotate right (E, or Shift+drag)" onClick={() => scene.current?.rotateBy(Math.PI / 12)}>
                <RotateCw className="h-4 w-4" />
              </IconButton>
              <IconButton label="Car points up (follow mode)" active={autoRotate} onClick={() => setAuto(!autoRotate)}>
                <Navigation className="h-4 w-4" />
              </IconButton>
            </span>
            <span className="mx-0.5 h-5 w-px bg-white/10" />
            <ShareMenu
              t={t - start}
              incident={inc ? Math.round((inc.t0 - start) * 10) / 10 : null}
              cars={mode === "follow" && followed.length ? followed : selected}
              names={name}
            />
            <IconButton label={clean ? "Show the panels again (H)" : "Clean view: hide every panel (H)"} active={clean} onClick={() => setClean((c) => !c)}>
              {clean ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
            </IconButton>
            <span className="md:hidden">
              <IconButton label={side.open ? "Hide the panels" : "Show the panels"} active={sideShown} onClick={() => (clean ? (setClean(false), setSide({ open: true })) : setSide({ open: !side.open }))}>
                <PanelRight className="h-4 w-4 rotate-90" />
              </IconButton>
            </span>
          </div>
        </div>
        {!clean && (
          <div className="pointer-events-none absolute left-2 top-[52px] md:left-3 md:top-[60px]">
            <TimingTower
              rows={rows}
              lap={leaderLap}
              laps={manifest.laps}
              reserved={TOP_SPACE + BAR_SPACE + 16}
              selected={selected}
              followed={mode === "follow" ? followed : []}
              open={towerOpen}
              onToggle={() => setTowerOpen((o) => !o)}
              onPick={pickDriver}
            />
          </div>
        )}
        {!clean && (
          <button
            type="button"
            onClick={() => setSide({ open: !side.open })}
            aria-label={side.open ? "Hide the side panels" : "Show the side panels"}
            title={side.open ? "Hide the side panels" : "Show the side panels"}
            className="absolute right-0 top-1/2 hidden h-14 w-5 -translate-y-1/2 items-center justify-center rounded-l-md border border-r-0 border-white/10 bg-[#0c0e11]/85 text-zinc-400 backdrop-blur hover:text-white md:flex"
          >
            <ChevronLeft className={`h-4 w-4 transition-transform ${side.open ? "rotate-180" : ""}`} />
          </button>
        )}
        {view.lights && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <StartLights lit={view.lights.lit} fade={view.lights.fade} />
          </div>
        )}
        {stripOn && focusCar !== null && (
          <div className="pointer-events-none absolute inset-x-0 flex justify-center px-2 md:px-3" style={{ bottom: BAR_SPACE + 8 }}>
            <TvStrip
              drivers={selected.map((c) => ({ car: c, name: name(c), color: color(c), s: byCar.get(c), gap: gapOf(c) }))}
              focus={focusCar}
              trace={view.trace}
              onFocus={setFocusPick}
              onClose={clearDrivers}
            />
          </div>
        )}
        {pipInc && !clean && (
          <div className="pointer-events-none absolute right-2 flex justify-end md:right-3" style={{ bottom: BAR_SPACE + 8 }}>
            <IncidentPip
              key={pip[0]}
              incident={pipInc}
              store={store}
              cars={manifest.cars}
              track={manifest.track}
              label={pipInc.drivers
                .filter((d) => d.role === "contact")
                .map((d) => name(d.car))
                .join(" & ")}
              onDone={() => setPip((q) => q.slice(1))}
              onOpen={() => {
                const k = pip[0];
                setPip([]);
                pickIncident(k);
              }}
            />
          </div>
        )}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 p-2 md:p-3">
          <PlayerBar
            t={t}
            start={start}
            end={end}
            playing={playing}
            rate={rate}
            lapStarts={lapStarts}
            incidents={incidents}
            buffering={!view.states.length}
            onPlay={toggle}
            onSeek={seek}
            onRate={changeRate}
            onIncident={pickIncident}
            surface={surface}
            time={timePick}
            onSurface={setSurface}
            onTime={setTimePick}
            highlight={(i) => (focusCar !== null && incidents[i]?.drivers.some((d) => d.car === focusCar) ? color(focusCar) : null)}
          />
        </div>
      </div>
      {sideShown && (
        <Sidebar tab={side.tab} onTab={(tab) => setSide({ tab })} onCollapse={() => setSide({ open: false })} badge={{ incidents: passed.length || undefined }}>
          {panel}
        </Sidebar>
      )}
    </div>
  );
}
