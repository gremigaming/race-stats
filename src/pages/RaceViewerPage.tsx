import { ArrowLeft, Compass, Hand, Maximize, Minus, Navigation, Plus, RotateCcw, RotateCw, Video } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link, useParams } from "react-router-dom";
import { liveryOf, loadLiveries, type Livery } from "../viewer/cars";
import { incidentsOf, loadManifest, type RaceManifest } from "../viewer/format";
import { DriverCard } from "../viewer/DriverCard";
import {
  CarInputs,
  IconButton,
  IncidentDetail,
  IncidentList,
  PlayerBar,
  TimingTower,
  type IncidentDriverStats,
  type Trace,
} from "../viewer/panels";
import { bits, RaceScene, tagsOf, type CameraMode } from "../viewer/scene";
import { ChunkStore, type CarState } from "../viewer/store";

const MAX_SELECTED = 4;
const BAR_SPACE = 96; // px the player bar covers at the bottom of the map
const TOP_SPACE = 56; // the title row
const TOWER_SPACE = 236; // the timing tower on the left (wide screens)

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
  traces: Record<number, Trace>;
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
  const play = useRef({ t: lapStarts[0] ?? start, playing: false, rate: 1 });
  const [view, setView] = useState<View>({ t: play.current.t, states: [], rot: 0, traces: {} });
  const [playing, setPlaying] = useState(false);
  const [rate, setRate] = useState(1);
  const [selected, setSelected] = useState<number[]>([]);
  const [mode, setMode] = useState<CameraMode>("track");
  const [followed, setFollowed] = useState<number[]>([]);
  const [autoRotate, setAutoRotate] = useState(false);
  const [activeInc, setActiveInc] = useState<number | null>(null);
  const [cardCar, setCardCar] = useState<number | null>(null);
  const [incOpen, setIncOpen] = useState(true);
  const [towerOpen, setTowerOpen] = useState(() => window.innerWidth >= 768);
  const [liveries, setLiveries] = useState<Record<string, Livery>>({});
  const [loads, setLoads] = useState(0);
  const lastUi = useRef(0);
  const lastTrace = useRef(0);
  const incidentsRef = useRef(incidents);
  incidentsRef.current = incidents;
  const selectedRef = useRef(selected);
  selectedRef.current = selected;

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
        setManifest(r.manifest);
      }
    }, 5000);
    return () => window.clearInterval(timer);
  }, [initial, store]);

  // the scene, its clock, the incident marker and the 10 s traces of the selected drivers
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
      if (p.playing && store.loaded(p.t)) {
        p.t += (dtMs / 1000) * p.rate;
        if (p.t >= end) {
          p.t = end;
          p.playing = false;
          setPlaying(false);
        }
      }
      store.want(p.t);
      const states = store.sample(p.t);
      const incs = incidentsRef.current;
      const k = incs.findIndex((i) => p.t >= i.t0 - 3 && p.t <= i.t1 + 3);
      if (k >= 0) {
        const i = incs[k];
        const strength = p.t < i.t0 ? 1 - (i.t0 - p.t) / 3 : p.t > i.t1 + 1.5 ? 1 - (p.t - i.t1 - 1.5) / 1.5 : 1;
        s.incident = { x: i.x, z: i.z, strength };
      } else s.incident = null;
      const now = performance.now();
      if (now - lastUi.current > 33) {
        lastUi.current = now;
        setView((v) => {
          let traces = v.traces;
          if (now - lastTrace.current > 150) {
            lastTrace.current = now;
            traces = {};
            const cars = selectedRef.current;
            if (cars.length) {
              for (const c of cars) traces[c] = { speed: [], throttle: [], brake: [], steer: [] };
              for (let k2 = 40; k2 >= 0; k2--) {
                const at = new Map(store.sample(p.t - k2 * 0.25).map((x) => [x.car, x]));
                for (const c of cars) {
                  const x = at.get(c);
                  const tr = traces[c];
                  tr.speed.push(x?.speed ?? 0);
                  tr.throttle.push(x?.throttle ?? 0);
                  tr.brake.push(x?.brake ?? 0);
                  tr.steer.push(x?.steer ?? 0);
                }
              }
            }
          }
          return { t: p.t, states, rot: s.rotation, traces };
        });
      }
      return { t: p.t, states };
    });
    s.bounds = () => store.bounds;
    s.contacts = initial.events
      .filter((e) => e.code === "COLL" && e.a !== undefined && e.b !== undefined)
      .map((e) => ({ t: e.t, a: e.a!, b: e.b! }));
    s.onPick = (car, add) => {
      setSelected((cur) => (cur.includes(car) ? cur : [...cur, car].slice(-MAX_SELECTED)));
      s.follow(add ? [...s.followCars, car] : [car]);
    };
    s.onModeChange = (m, cars) => {
      setMode(m);
      setFollowed([...cars]);
    };
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

  // keep the camera clear of the title row, the timing tower and the player bar
  useEffect(() => {
    const s = scene.current;
    if (s) s.inset = { top: TOP_SPACE, bottom: BAR_SPACE, left: towerOpen && window.innerWidth >= 768 ? TOWER_SPACE : 0, right: 0 };
  }, [towerOpen, view.states.length > 0]);

  const seek = useCallback(
    (t: number) => {
      play.current.t = Math.min(end, Math.max(start, t));
      setView((v) => ({ ...v, t: play.current.t }));
    },
    [start, end],
  );
  const toggle = useCallback(() => {
    const p = play.current;
    if (!p.playing && p.t >= end - 0.05) p.t = start;
    p.playing = !p.playing;
    setPlaying(p.playing);
  }, [start, end]);
  const changeRate = (r: number) => {
    play.current.rate = r;
    setRate(r);
  };
  /** Jump to an incident: 3 s before, half speed, camera locked on everyone involved at ~70 m. */
  const pickIncident = (k: number) => {
    const inc = incidents[k];
    if (!inc) return;
    setActiveInc(k);
    seek(inc.t0 - 3);
    changeRate(0.5);
    const cars = inc.drivers.map((d) => d.car);
    setSelected(cars.slice(0, MAX_SELECTED));
    scene.current?.follow(cars, 70);
    play.current.playing = true;
    setPlaying(true);
  };
  const toggleFollow = (car: number) => {
    const s = scene.current;
    if (!s) return;
    const cur = s.mode === "follow" ? s.followCars : [];
    if (cur.includes(car)) {
      const rest = cur.filter((c) => c !== car);
      if (rest.length) s.follow(rest);
      else s.showTrack();
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
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggle, seek]);

  const byCar = new Map(view.states.map((s) => [s.car, s]));
  const order = [...view.states].sort((a, b) => (a.pos || 99) - (b.pos || 99));
  const color = (car: number) => liveryOf(liveries, manifest.cars[String(car)]).base;
  const date = manifest.started.slice(0, 10);
  const trackLen = manifest.track_length || Math.max(1000, ...view.states.map((s) => s.dist));
  const progress = (s: CarState) => (Math.max(s.lap, 1) - 1) * trackLen + s.dist;
  const gapTo = (a: CarState | undefined, b: CarState | undefined) =>
    a && b ? Math.max(0, (progress(a) - progress(b)) / Math.max(b.speed / 3.6, 10)) : null;
  const neighbours = (car: number) => {
    const i = order.findIndex((s) => s.car === car);
    return { ahead: i > 0 ? order[i - 1] : undefined, behind: i >= 0 ? order[i + 1] : undefined, me: order[i] };
  };
  const touched = (car: number) =>
    manifest.events.some((e) => e.code === "COLL" && (e.a === car || e.b === car) && view.t >= e.t - 0.2 && view.t <= e.t + 1.2);
  const leaderLap = order[0]?.lap ?? 0;

  // the incident deep-dive, measured from the chunks around it (recomputed as chunks arrive)
  const incStats = useMemo<IncidentDriverStats[]>(() => {
    const inc = activeInc === null ? null : incidents[activeInc];
    if (!inc) return [];
    const out = new Map<number, IncidentDriverStats>();
    for (const d of inc.drivers)
      out.set(d.car, { car: d.car, role: d.role, speedAt: 0, minSpeed: Infinity, maxSlide: 0, maxBrake: 0, offWheels: 0, lockup: false, surfaces: d.surfaces, speeds: [] });
    let any = false;
    for (let t = inc.t0 - 3; t <= inc.t1 + 3; t += 0.1) {
      for (const x of store.sample(t)) {
        const d = out.get(x.car);
        if (!d) continue;
        any = true;
        const slide = Math.abs(x.slip) * (180 / Math.PI);
        d.speeds.push(x.speed);
        if (Math.abs(t - inc.t0) < 0.06) d.speedAt = x.speed;
        if (t >= inc.t0) d.minSpeed = Math.min(d.minSpeed, x.speed);
        if (x.speed > 40) d.maxSlide = Math.max(d.maxSlide, slide);
        if (t >= inc.t0 - 1.5 && t <= inc.t1 + 1.5) d.maxBrake = Math.max(d.maxBrake, x.brake);
        d.offWheels = Math.max(d.offWheels, bits(x.off));
        if (x.speed > 40 && x.brake >= 0.8 && slide >= 4) d.lockup = true;
      }
    }
    if (!any) return [];
    return [...out.values()].map((d) => ({ ...d, minSpeed: Number.isFinite(d.minSpeed) ? d.minSpeed : d.speedAt }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeInc, incidents, store, loads]);

  const rotDeg = (view.rot * 180) / Math.PI;

  return (
    <div className="fixed inset-0 flex flex-col bg-[#0c0e11] text-zinc-100 md:flex-row">
      <div className="relative min-h-0 min-w-0 flex-1">
        <div ref={host} className="absolute inset-0" />
        <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start gap-2 p-3">
          <Link
            to={back}
            className="pointer-events-auto flex h-9 items-center gap-1 rounded-lg border border-white/10 bg-[#0c0e11]/85 px-2 text-sm text-zinc-300 backdrop-blur hover:text-white"
          >
            <ArrowLeft className="h-4 w-4" /> Races
          </Link>
          <div className="rounded-lg border border-white/10 bg-[#0c0e11]/85 px-3 py-1.5 backdrop-blur">
            <div className="text-sm font-semibold">
              {manifest.track} · {manifest.session}
            </div>
            <div className="text-xs text-zinc-500">
              {date}
              {!manifest.finished && <span className="ml-2 font-semibold text-red-400">LIVE</span>}
            </div>
          </div>
          <div className="pointer-events-auto ml-auto flex flex-wrap items-center justify-end gap-0.5 rounded-lg border border-white/10 bg-[#0c0e11]/85 p-0.5 backdrop-blur">
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
            <IconButton label="North up (N)" active={Math.abs(rotDeg) > 0.5} onClick={() => scene.current?.resetRotation()}>
              <Compass className="h-4 w-4" style={{ transform: `rotate(${rotDeg}deg)` }} />
            </IconButton>
            <IconButton label="Rotate right (E, or Shift+drag)" onClick={() => scene.current?.rotateBy(Math.PI / 12)}>
              <RotateCw className="h-4 w-4" />
            </IconButton>
            <IconButton label="Car points up (follow mode)" active={autoRotate} onClick={() => setAuto(!autoRotate)}>
              <Navigation className="h-4 w-4" />
            </IconButton>
          </div>
        </div>
        <div className="pointer-events-none absolute left-3 top-[60px] flex items-start gap-2">
          <TimingTower
            order={order}
            cars={manifest.cars}
            color={color}
            interval={(car) => {
              const n = neighbours(car);
              return gapTo(n.ahead, n.me);
            }}
            lap={leaderLap}
            laps={manifest.laps}
            selected={selected}
            followed={mode === "follow" ? followed : []}
            open={towerOpen}
            onToggle={() => setTowerOpen((o) => !o)}
            onPick={(car) => {
              setCardCar(car);
              setSelected((cur) => (cur.includes(car) ? cur : [...cur, car].slice(-MAX_SELECTED)));
            }}
          />
          {cardCar !== null && (
            <DriverCard
              car={cardCar}
              info={manifest.cars[String(cardCar)]}
              color={color(cardCar)}
              incidents={incidents}
              start={start}
              following={mode === "follow" && followed.includes(cardCar)}
              onFollow={() => toggleFollow(cardCar)}
              onIncident={pickIncident}
              onClose={() => setCardCar(null)}
            />
          )}
        </div>
        <div className="pointer-events-none absolute inset-x-0 bottom-0 p-3">
          <PlayerBar
            t={view.t}
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
          />
        </div>
      </div>
      <aside className="flex h-[42vh] w-full shrink-0 flex-col gap-3 overflow-y-auto border-t border-white/10 p-3 md:h-auto md:w-80 md:border-l md:border-t-0">
        {activeInc !== null && incidents[activeInc] && (
          <IncidentDetail
            incident={incidents[activeInc]}
            stats={incStats}
            cars={manifest.cars}
            color={color}
            start={start}
            onClose={() => setActiveInc(null)}
          />
        )}
        {selected.length > 0 ? (
          <div className="space-y-2">
            {selected.map((car) => {
              const n = neighbours(car);
              const st = byCar.get(car);
              return (
                <CarInputs
                  key={car}
                  car={manifest.cars[String(car)]}
                  color={color(car)}
                  s={st}
                  trace={view.traces[car]}
                  gapAhead={gapTo(n.ahead, n.me)}
                  gapBehind={gapTo(n.me, n.behind)}
                  laps={manifest.laps}
                  tags={st ? tagsOf(st, touched(car)) : []}
                  following={mode === "follow" && followed.includes(car)}
                  onFollow={() => toggleFollow(car)}
                  onCard={() => setCardCar(car)}
                  onRemove={() => setSelected((cur) => cur.filter((c) => c !== car))}
                />
              );
            })}
          </div>
        ) : (
          <p className="text-sm text-zinc-500">
            Click a car to follow it and see its telemetry (Shift+click adds more cars to follow). Click a driver in the timing tower for their stats.
          </p>
        )}
        <IncidentList
          incidents={incidents}
          cars={manifest.cars}
          start={start}
          active={activeInc}
          open={incOpen}
          onToggle={() => setIncOpen((o) => !o)}
          onPick={pickIncident}
        />
      </aside>
    </div>
  );
}
