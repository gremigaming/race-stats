import { ArrowLeft, Crosshair, Hand, Maximize, Minus, Plus, Video } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link, useParams } from "react-router-dom";
import { liveryOf, loadLiveries, type Livery } from "../viewer/cars";
import { incidentsOf, loadManifest, type RaceManifest } from "../viewer/format";
import { CarInputs, IconButton, IncidentList, PlayerBar } from "../viewer/panels";
import { RaceScene, type CameraMode } from "../viewer/scene";
import { ChunkStore, type CarState } from "../viewer/store";

const MAX_SELECTED = 4;
const BAR_SPACE = 96; // px the player bar covers at the bottom of the map

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
  const [view, setView] = useState<View>({ t: play.current.t, states: [] });
  const [playing, setPlaying] = useState(false);
  const [rate, setRate] = useState(1);
  const [selected, setSelected] = useState<number[]>([]);
  const [mode, setMode] = useState<CameraMode>("track");
  const [follow, setFollow] = useState<number | null>(null);
  const [activeInc, setActiveInc] = useState<number | null>(null);
  const [incOpen, setIncOpen] = useState(true);
  const [liveries, setLiveries] = useState<Record<string, Livery>>({});
  const lastUi = useRef(0);
  const incidentsRef = useRef(incidents);
  incidentsRef.current = incidents;

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

  // the scene, its clock and the incident marker
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const p = play.current;
    store.wantAll();
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
        s.incident = { cars: i.drivers.map((d) => d.car), x: i.x, z: i.z, strength };
      } else if (s.mode !== "incident") s.incident = null;
      const now = performance.now();
      if (now - lastUi.current > 33) {
        lastUi.current = now;
        setView({ t: p.t, states });
      }
      return states;
    });
    s.bounds = () => store.bounds;
    s.inset = { bottom: BAR_SPACE, right: 0 };
    s.onPick = (car) =>
      setSelected((cur) => (cur.includes(car) ? cur.filter((c) => c !== car) : [...cur, car].slice(-MAX_SELECTED)));
    s.onModeChange = (m) => {
      setMode(m);
      setFollow(s.follow);
    };
    scene.current = s;
    return () => {
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
  const camera = (m: CameraMode, car: number | null = null) => scene.current?.setMode(m, car);
  const pickIncident = (k: number) => {
    const inc = incidents[k];
    if (!inc) return;
    setActiveInc(k);
    seek(inc.t0 - 3);
    setSelected(inc.drivers.map((d) => d.car).slice(0, MAX_SELECTED));
    const s = scene.current;
    if (s) {
      s.incident = { cars: inc.drivers.map((d) => d.car), x: inc.x, z: inc.z, strength: 0 };
      s.setMode("incident", null);
    }
    play.current.playing = true;
    setPlaying(true);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement | null)?.closest("input, textarea, select")) return;
      if (e.code === "Space") {
        e.preventDefault();
        toggle();
      } else if (e.code === "ArrowLeft") seek(play.current.t - 5);
      else if (e.code === "ArrowRight") seek(play.current.t + 5);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggle, seek]);

  const byCar = new Map(view.states.map((s) => [s.car, s]));
  const order = [...view.states].sort((a, b) => (a.pos || 99) - (b.pos || 99));
  const color = (car: number) => liveryOf(liveries, manifest.cars[String(car)]).base;
  const date = manifest.started.slice(0, 10);

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
              {manifest.laps ? ` · ${manifest.laps} laps` : ""}
              {!manifest.finished && <span className="ml-2 font-semibold text-red-400">LIVE</span>}
            </div>
          </div>
          <div className="pointer-events-auto ml-auto flex items-center gap-0.5 rounded-lg border border-white/10 bg-[#0c0e11]/85 p-0.5 backdrop-blur">
            <IconButton label="Full track" active={mode === "track"} onClick={() => camera("track")}>
              <Maximize className="h-4 w-4" />
            </IconButton>
            <IconButton
              label="Follow a driver"
              active={mode === "follow"}
              onClick={() => camera("follow", follow ?? selected[0] ?? order[0]?.car ?? null)}
            >
              <Video className="h-4 w-4" />
            </IconButton>
            <IconButton label="Incident camera" active={mode === "incident"} onClick={() => activeInc !== null && pickIncident(activeInc)}>
              <Crosshair className="h-4 w-4" />
            </IconButton>
            <IconButton label="Free pan and zoom" active={mode === "free"} onClick={() => camera("free")}>
              <Hand className="h-4 w-4" />
            </IconButton>
            <IconButton label="Zoom in" onClick={() => scene.current?.zoom(1.5)}>
              <Plus className="h-4 w-4" />
            </IconButton>
            <IconButton label="Zoom out" onClick={() => scene.current?.zoom(1 / 1.5)}>
              <Minus className="h-4 w-4" />
            </IconButton>
          </div>
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
        {selected.length > 0 ? (
          <div className="space-y-2">
            {selected.map((car) => (
              <CarInputs
                key={car}
                car={manifest.cars[String(car)]}
                color={color(car)}
                s={byCar.get(car)}
                following={mode === "follow" && follow === car}
                onFollow={() => camera("follow", car)}
                onRemove={() => setSelected((cur) => cur.filter((c) => c !== car))}
              />
            ))}
          </div>
        ) : (
          <p className="text-sm text-zinc-500">Click a car or a driver below to see their throttle, brake and steering.</p>
        )}
        <div>
          <div className="py-1 text-xs font-semibold uppercase tracking-wide text-zinc-400">Running order</div>
          <ul>
            {order.map((s) => {
              const info = manifest.cars[String(s.car)];
              const on = selected.includes(s.car);
              return (
                <li key={s.car}>
                  <button
                    type="button"
                    onClick={() =>
                      setSelected((cur) => (on ? cur.filter((c) => c !== s.car) : [...cur, s.car].slice(-MAX_SELECTED)))
                    }
                    className={`flex w-full items-center gap-2 rounded px-2 py-1 text-left text-sm hover:bg-white/10 ${on ? "bg-white/10" : ""}`}
                  >
                    <span className="w-6 font-mono text-xs text-zinc-500">{s.pos || "–"}</span>
                    <span className="h-3 w-1 rounded-full" style={{ background: color(s.car) }} />
                    <span className="min-w-0 flex-1 truncate">{info?.name ?? `Car ${s.car}`}</span>
                    {s.off ? <span className="text-[10px] text-amber-400">OFF</span> : null}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
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
