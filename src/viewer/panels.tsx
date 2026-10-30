import { Pause, Play, RotateCcw, RotateCw, X } from "lucide-react";
import { useRef, type ReactNode } from "react";
import type { RaceCar, RaceIncident } from "./format";
import type { SurfacePick, TimePick } from "./look";
import type { CarState } from "./store";

export const SPEEDS = [0.25, 0.5, 1, 2, 4, 8];

export function clock(t: number) {
  const s = Math.max(0, t);
  const m = Math.floor(s / 60);
  return `${m}:${Math.floor(s % 60)
    .toString()
    .padStart(2, "0")}`;
}

/** The video-style bar: play, skip, speed, and a scrub bar with lap ticks and incident markers. */
export function PlayerBar(props: {
  t: number;
  start: number;
  end: number;
  playing: boolean;
  rate: number;
  lapStarts: number[];
  incidents: RaceIncident[];
  buffering: boolean;
  onPlay: () => void;
  onSeek: (t: number) => void;
  onRate: (r: number) => void;
  onIncident: (i: number) => void;
  /** The selected driver's colour for incidents they were in, else null. */
  highlight?: (i: number) => string | null;
  /** Track conditions: the race's own (auto) or the viewer's pick. */
  surface?: SurfacePick;
  time?: TimePick;
  onSurface?: (v: SurfacePick) => void;
  onTime?: (v: TimePick) => void;
}) {
  const { t, start, end, playing, rate, lapStarts, incidents } = props;
  const bar = useRef<HTMLDivElement>(null);
  const len = Math.max(end - start, 1);
  const pct = (v: number) => `${Math.min(100, Math.max(0, ((v - start) / len) * 100))}%`;
  const seekAt = (clientX: number) => {
    const r = bar.current?.getBoundingClientRect();
    if (!r) return;
    props.onSeek(start + Math.min(1, Math.max(0, (clientX - r.left) / r.width)) * len);
  };
  const lap = lapStarts.filter((s) => s <= t).length;
  return (
    <div className="pointer-events-auto rounded-xl border border-white/10 bg-[#0c0e11]/85 px-3 pb-2 pt-3 shadow-2xl backdrop-blur">
      <div
        ref={bar}
        className="group relative h-5 cursor-pointer touch-none"
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          seekAt(e.clientX);
        }}
        onPointerMove={(e) => {
          if (e.currentTarget.hasPointerCapture(e.pointerId)) seekAt(e.clientX);
        }}
      >
        <div className="absolute inset-x-0 top-2 h-1 rounded-full bg-white/15 transition-all group-hover:top-1.5 group-hover:h-2" />
        <div className="absolute left-0 top-2 h-1 rounded-full bg-red-500 transition-all group-hover:top-1.5 group-hover:h-2" style={{ width: pct(t) }} />
        {lapStarts.slice(1).map((s, i) => (
          <div key={`lap${i}`} className="absolute top-1 h-3 w-px bg-white/35" style={{ left: pct(s) }} title={`Lap ${i + 2}`} />
        ))}
        {incidents.map((inc, i) => {
          const mine = props.highlight?.(i) ?? null;
          return (
            <button
              key={`inc${i}`}
              type="button"
              title={`Incident, lap ${inc.lap || "?"}`}
              className={`absolute -translate-x-1/2 rotate-45 rounded-[2px] hover:scale-125 ${mine ? "-top-1.5 z-10 h-3.5 w-3.5 ring-2 ring-white" : "-top-1 h-2.5 w-2.5 bg-amber-400"}`}
              style={{ left: pct(inc.t0), background: mine ?? undefined }}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={() => props.onIncident(i)}
            />
          );
        })}
        <div className="absolute top-0.5 h-4 w-4 -translate-x-1/2 rounded-full bg-white shadow" style={{ left: pct(t) }} />
      </div>
      <div className="mt-1 flex items-center gap-1 text-sm">
        <IconButton label="Back 5 s" onClick={() => props.onSeek(t - 5)}>
          <RotateCcw className="h-4 w-4" />
        </IconButton>
        <IconButton label={playing ? "Pause" : "Play"} onClick={props.onPlay}>
          {playing ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5" />}
        </IconButton>
        <IconButton label="Forward 5 s" onClick={() => props.onSeek(t + 5)}>
          <RotateCw className="h-4 w-4" />
        </IconButton>
        <span className="ml-2 font-mono tabular-nums text-zinc-300">
          {clock(t - start)} / {clock(end - start)}
        </span>
        {lapStarts.length > 0 && <span className="ml-3 text-zinc-400">Lap {Math.max(1, lap)}</span>}
        {props.buffering && <span className="ml-3 text-xs text-zinc-500">Loading…</span>}
        {props.onSurface && props.onTime && (
          <div className="ml-auto flex items-center gap-1 text-xs">
            <Cycle label="Track" value={props.surface ?? "auto"} options={["auto", "dry", "wet"]} onChange={props.onSurface} />
            <Cycle label="Light" value={props.time ?? "auto"} options={["auto", "day", "night"]} onChange={props.onTime} />
          </div>
        )}
        <div className={`${props.onSurface ? "ml-2" : "ml-auto"} flex items-center gap-0.5`}>
          {SPEEDS.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => props.onRate(s)}
              className={`rounded px-1.5 py-0.5 font-mono text-xs ${s === rate ? "bg-white/90 text-black" : "text-zinc-400 hover:bg-white/10"}`}
            >
              {s}x
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

/** A small button that steps through its options (Auto, then the overrides). */
function Cycle<T extends string>(props: { label: string; value: T; options: T[]; onChange: (v: T) => void }) {
  const { value, options } = props;
  return (
    <button
      type="button"
      title={`${props.label}: ${value} (click to change)`}
      onClick={() => props.onChange(options[(options.indexOf(value) + 1) % options.length])}
      className={`rounded px-1.5 py-0.5 capitalize ${value === "auto" ? "text-zinc-400 hover:bg-white/10" : "bg-white/90 text-black"}`}
    >
      {props.label} {value}
    </button>
  );
}

export function IconButton(props: { label: string; onClick: () => void; active?: boolean; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-label={props.label}
      title={props.label}
      onClick={props.onClick}
      className={`flex h-8 w-8 items-center justify-center rounded-md ${props.active ? "bg-white/90 text-black" : "text-zinc-200 hover:bg-white/10"}`}
    >
      {props.children}
    </button>
  );
}

export interface Trace {
  throttle: number[];
  brake: number[];
  steer: number[];
}

const TOP = [0, 95, 135, 170, 205, 240, 272, 305, 340]; // rough top speed per gear (km/h), for the rev lights

/** Rev-light share 0..1, guessed from speed within the gear (the chunks carry no rpm). */
function revs(s: CarState | undefined) {
  if (!s || s.gear < 1) return 0;
  const g = Math.min(s.gear, 8);
  const lo = TOP[g - 1] * 0.85;
  return Math.max(0, Math.min(1, (s.speed - lo) / Math.max(TOP[g] - lo, 1)));
}

/** An F1 yoke: carbon body, rubber grips, rev lights across the top, the gear on its screen. */
export function SteeringWheel({ s, small }: { s: CarState | undefined; small?: boolean }) {
  const steer = s?.steer ?? 0;
  const lit = Math.round(revs(s) * 15);
  const leds = Array.from({ length: 15 }, (_, i) => {
    const on = i < lit;
    const col = i < 5 ? "#22c55e" : i < 10 ? "#ef4444" : "#3b82f6";
    return <circle key={i} cx={-21 + i * 3} cy={-15.5} r={1.1} fill={on ? col : "#2a2d33"} />;
  });
  const gear = !s ? "–" : s.gear < 0 ? "R" : s.gear === 0 ? "N" : String(s.gear);
  return (
    // a square box wider than the wheel, so a full lock never clips it
    <svg viewBox="-38 -38 76 76" className={`${small ? "h-12 w-12" : "h-20 w-20"} shrink-0`} aria-label={`Steering ${Math.round(steer * 100)}%`}>
      <g transform={`rotate(${steer * 135})`}>
        {/* grips */}
        <path d="M-31 -8 Q-34 6 -27 17 Q-23 21 -19 17 L-17 -2 Z" fill="#26282d" />
        <path d="M31 -8 Q34 6 27 17 Q23 21 19 17 L17 -2 Z" fill="#26282d" />
        {/* carbon body */}
        <path d="M-27 -12 Q-27 -19 -20 -19 L20 -19 Q27 -19 27 -12 L25 4 Q23 12 14 13 L-14 13 Q-23 12 -25 4 Z" fill="#17181c" stroke="#3a3d44" strokeWidth="0.8" />
        {leds}
        {/* screen */}
        <rect x="-10" y="-11" width="20" height="13" rx="1.5" fill="#05070a" stroke="#2d3036" strokeWidth="0.6" />
        <text x="0" y="-1.5" textAnchor="middle" fontSize="9" fontWeight="700" fill="#f4f4f5" fontFamily="ui-monospace, monospace">
          {gear}
        </text>
        {/* buttons and rotaries */}
        <circle cx="-16" cy="-6" r="2" fill="#ef4444" />
        <circle cx="-16" cy="0" r="2" fill="#f59e0b" />
        <circle cx="16" cy="-6" r="2" fill="#3b82f6" />
        <circle cx="16" cy="0" r="2" fill="#22c55e" />
        <circle cx="-7" cy="8" r="2.4" fill="#2f3238" stroke="#9ca3af" strokeWidth="0.5" />
        <circle cx="7" cy="8" r="2.4" fill="#2f3238" stroke="#9ca3af" strokeWidth="0.5" />
        <rect x="-0.6" y="-19" width="1.2" height="3" fill="#facc15" />
      </g>
    </svg>
  );
}

/** What one driver did in an incident, measured from the chunks (and the recording's wheel surfaces). */
export interface IncidentDriverStats {
  car: number;
  role: string;
  speedAt: number;
  minSpeed: number;
  maxSlide: number;
  maxBrake: number;
  offWheels: number;
  lockup: boolean;
  surfaces?: Record<string, string>;
  /** Speed every 0.1 s over the incident window (NaN while the car isn't in the data). */
  speeds: number[];
}

/** One driver's pedals and steering right now, as bars. */
function InputBars({ s }: { s: CarState | undefined }) {
  const bar = (label: string, v: number, cls: string) => (
    <div className="flex items-center gap-1.5">
      <span className="w-3 text-[9px] font-bold text-zinc-500">{label}</span>
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/10">
        <div className={`h-full ${cls}`} style={{ width: `${Math.round(Math.max(0, Math.min(1, v)) * 100)}%` }} />
      </div>
    </div>
  );
  const steer = s?.steer ?? 0;
  return (
    <div className="mt-1.5 grid grid-cols-3 gap-2">
      {bar("T", s?.throttle ?? 0, "bg-emerald-500")}
      {bar("B", s?.brake ?? 0, "bg-red-500")}
      <div className="flex items-center gap-1.5">
        <span className="w-3 text-[9px] font-bold text-zinc-500">S</span>
        <div className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-white/10">
          <span className="absolute inset-y-0 left-1/2 w-px bg-white/30" />
          <div className="absolute inset-y-0 bg-sky-400" style={{ left: `${50 + Math.min(0, steer) * 50}%`, width: `${Math.abs(steer) * 50}%` }} />
        </div>
      </div>
    </div>
  );
}

/** Everyone's speed through the incident in one chart, in team colours. */
function SpeedChart(props: { stats: IncidentDriverStats[]; color: (car: number) => string; at: number; contact: number }) {
  const all = props.stats.flatMap((d) => d.speeds.filter((v) => Number.isFinite(v)));
  if (!all.length) return null;
  const top = Math.max(100, Math.ceil(Math.max(...all) / 50) * 50);
  const H = 40;
  const path = (vals: number[]) => {
    const n = vals.length;
    let out = "";
    let pen = false;
    vals.forEach((v, i) => {
      if (!Number.isFinite(v)) {
        pen = false;
        return;
      }
      const x = ((i / Math.max(n - 1, 1)) * 100).toFixed(2);
      const y = (H - 1 - (v / top) * (H - 2)).toFixed(2);
      out += `${pen ? "L" : "M"}${x},${y}`;
      pen = true;
    });
    return out;
  };
  return (
    <div className="mb-2">
      <div className="mb-0.5 flex justify-between text-[10px] text-zinc-500">
        <span>Speed</span>
        <span>{top} km/h</span>
      </div>
      <svg viewBox={`0 0 100 ${H}`} preserveAspectRatio="none" className="h-20 w-full rounded bg-white/[0.03]">
        <line x1="0" y1={H / 2} x2="100" y2={H / 2} stroke="rgba(255,255,255,0.06)" strokeWidth="0.4" vectorEffect="non-scaling-stroke" />
        {props.stats.map((d) => (
          <path key={d.car} d={path(d.speeds)} fill="none" stroke={props.color(d.car)} strokeWidth="1.6" vectorEffect="non-scaling-stroke" />
        ))}
        <line x1={props.contact * 100} y1="0" x2={props.contact * 100} y2={H} stroke="#fbbf24" strokeWidth="1" vectorEffect="non-scaling-stroke" />
        {props.at >= 0 && props.at <= 1 && <line x1={props.at * 100} y1="0" x2={props.at * 100} y2={H} stroke="#ffffff" strokeWidth="1.2" vectorEffect="non-scaling-stroke" />}
      </svg>
    </div>
  );
}

const WHEEL = { fl: "front left", fr: "front right", rl: "rear left", rr: "rear right" } as Record<string, string>;

/** The incident deep-dive: one row per involved driver. */
export function IncidentDetail(props: {
  incident: RaceIncident;
  stats: IncidentDriverStats[];
  cars: Record<string, RaceCar>;
  color: (car: number) => string;
  start: number;
  /** The playhead, the window the stats cover, and every car now (for the live pedal bars). */
  t: number;
  from: number;
  to: number;
  states: Map<number, CarState>;
  onClose: () => void;
}) {
  const { incident: inc } = props;
  const span = Math.max(props.to - props.from, 0.1);
  return (
    <div className="rounded-lg border border-amber-400/30 bg-amber-400/[0.04] p-3">
      <div className="mb-2 flex items-center gap-2">
        <span className="h-2.5 w-2.5 rotate-45 rounded-[1px] bg-amber-400" />
        <span className="flex-1 text-sm font-semibold">
          Incident{inc.lap ? `, lap ${inc.lap}` : ""} · {clock(inc.t0 - props.start)}
        </span>
        <IconButton label="Close" onClick={props.onClose}>
          <X className="h-4 w-4" />
        </IconButton>
      </div>
      <SpeedChart stats={props.stats} color={props.color} at={(props.t - props.from) / span} contact={(inc.t0 - props.from) / span} />
      <div className="space-y-2">
        {props.stats.map((d) => {
          const info = props.cars[String(d.car)];
          return (
            <div key={d.car} className="rounded-md bg-black/20 p-2">
              <div className="flex items-center gap-2 text-sm">
                <span className="h-3 w-1 rounded-full" style={{ background: props.color(d.car) }} />
                <span className="min-w-0 flex-1 truncate font-medium">{info?.name ?? `Car ${d.car}`}</span>
                <span className="text-xs text-zinc-500">{d.role}</span>
              </div>
              <div className="mt-1 grid grid-cols-3 gap-x-2 text-[11px] text-zinc-400">
                <span>
                  At contact <b className="font-mono text-zinc-200">{Math.round(d.speedAt)}</b>
                </span>
                <span>
                  Lowest <b className="font-mono text-zinc-200">{Math.round(d.minSpeed)}</b>
                </span>
                <span>
                  Brake <b className="font-mono text-zinc-200">{Math.round(d.maxBrake * 100)}%</b>
                </span>
                <span>
                  Slide <b className={`font-mono ${d.maxSlide >= 9 ? "text-sky-300" : "text-zinc-200"}`}>{d.maxSlide.toFixed(0)}°</b>
                </span>
                <span className="col-span-2">
                  Lock-up{" "}
                  <b className={d.lockup ? "text-red-300" : "text-zinc-200"} title="Estimate: hard braking while sliding">
                    {d.lockup ? "likely (est.)" : "no sign"}
                  </b>
                </span>
              </div>
              <div className="mt-1 text-[11px] text-zinc-400">
                Surface:{" "}
                {d.surfaces && Object.keys(d.surfaces).length
                  ? Object.entries(d.surfaces)
                      .map(([w, v]) => `${WHEEL[w] ?? w} on ${v.toLowerCase()}`)
                      .join(", ")
                  : d.offWheels
                    ? `${d.offWheels} wheel${d.offWheels > 1 ? "s" : ""} off the track`
                    : "all four wheels on track"}
              </div>
              <InputBars s={props.states.get(d.car)} />
            </div>
          );
        })}
        {!props.stats.length && <p className="text-xs text-zinc-500">Loading the cars around this incident…</p>}
      </div>
      <p className="mt-2 text-[10px] text-zinc-600">
        Speeds in km/h. The chart runs 3 s before to 3 s after; the white line is now, the amber line the first contact. Bars: <span className="text-emerald-400">throttle</span>,{" "}
        <span className="text-red-400">brake</span>, <span className="text-sky-400">steering</span>. Slide = angle between where the car points and where it goes.
      </p>
    </div>
  );
}
