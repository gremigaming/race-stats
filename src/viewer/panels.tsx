import { ChevronDown, ChevronRight, Pause, Play, RotateCcw, RotateCw, Video, X } from "lucide-react";
import { useRef, type ReactNode } from "react";
import type { RaceCar, RaceIncident } from "./format";
import { bits, type CarTag } from "./scene";
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
        {incidents.map((inc, i) => (
          <button
            key={`inc${i}`}
            type="button"
            title={`Incident, lap ${inc.lap || "?"}`}
            className="absolute -top-1 h-2.5 w-2.5 -translate-x-1/2 rotate-45 rounded-[2px] bg-amber-400 hover:scale-125"
            style={{ left: pct(inc.t0) }}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => props.onIncident(i)}
          />
        ))}
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
        <div className="ml-auto flex items-center gap-0.5">
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
  speed: number[];
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
export function SteeringWheel({ s }: { s: CarState | undefined }) {
  const steer = s?.steer ?? 0;
  const lit = Math.round(revs(s) * 15);
  const leds = Array.from({ length: 15 }, (_, i) => {
    const on = i < lit;
    const col = i < 5 ? "#22c55e" : i < 10 ? "#ef4444" : "#3b82f6";
    return <circle key={i} cx={-21 + i * 3} cy={-15.5} r={1.1} fill={on ? col : "#2a2d33"} />;
  });
  const gear = !s ? "–" : s.gear < 0 ? "R" : s.gear === 0 ? "N" : String(s.gear);
  return (
    <svg viewBox="-34 -24 68 48" className="h-16 w-24 shrink-0" aria-label={`Steering ${Math.round(steer * 100)}%`}>
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

/** The last 10 s of speed (white), throttle (green), brake (red) and steering (blue). */
function TraceChart({ trace }: { trace: Trace | undefined }) {
  if (!trace || trace.speed.length < 2) return <div className="h-14 rounded bg-white/[0.03]" />;
  const n = trace.speed.length;
  const X = (i: number) => (i / (n - 1)) * 100;
  const line = (vals: number[], f: (v: number) => number) => vals.map((v, i) => `${X(i).toFixed(1)},${f(v).toFixed(1)}`).join(" ");
  const area = (vals: number[]) => `0,40 ${line(vals, (v) => 40 - v * 38)} 100,40`;
  return (
    <svg viewBox="0 0 100 40" preserveAspectRatio="none" className="h-14 w-full rounded bg-white/[0.03]">
      <polygon points={area(trace.throttle)} fill="rgba(52,211,153,0.28)" />
      <polygon points={area(trace.brake)} fill="rgba(239,68,68,0.45)" />
      <line x1="0" y1="20" x2="100" y2="20" stroke="rgba(255,255,255,0.08)" strokeWidth="0.4" />
      <polyline points={line(trace.steer, (v) => 20 - v * 18)} fill="none" stroke="#60a5fa" strokeWidth="0.8" vectorEffect="non-scaling-stroke" />
      <polyline points={line(trace.speed, (v) => 39 - (Math.min(v, 360) / 360) * 37)} fill="none" stroke="#f4f4f5" strokeWidth="1.2" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

const TAG_STYLE: Record<CarTag, string> = {
  CONTACT: "bg-amber-400/20 text-amber-300",
  "OFF TRACK": "bg-orange-500/20 text-orange-300",
  SLIDE: "bg-sky-500/20 text-sky-300",
  "LOCK-UP?": "bg-red-500/20 text-red-300",
};

export function TagChips({ tags }: { tags: CarTag[] }) {
  return (
    <>
      {tags.map((t) => (
        <span key={t} title={t === "LOCK-UP?" ? "Estimate: hard braking while the car slides (wheel data only exists for GreMi's car)" : undefined} className={`rounded px-1.5 py-0.5 text-[10px] font-bold italic ${TAG_STYLE[t]}`}>
          {t}
        </span>
      ))}
    </>
  );
}

const fmtGap = (g: number | null) => (g === null ? "–" : `${g.toFixed(1)}s`);

/** Everything about one selected driver: yoke, inputs, traces, lap, gaps and event tags. */
export function CarInputs(props: {
  car: RaceCar | undefined;
  color: string;
  s: CarState | undefined;
  trace: Trace | undefined;
  gapAhead: number | null;
  gapBehind: number | null;
  laps: number;
  tags: CarTag[];
  following: boolean;
  onFollow: () => void;
  onCard: () => void;
  onRemove: () => void;
}) {
  const { s, car } = props;
  const pctBar = (v: number, cls: string, label: string) => (
    <div className="flex items-center gap-2">
      <span className="w-12 text-[11px] uppercase tracking-wide text-zinc-500">{label}</span>
      <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-white/10">
        <div className={`h-full rounded-full ${cls}`} style={{ width: `${Math.round((v || 0) * 100)}%` }} />
      </div>
      <span className="w-9 text-right font-mono text-xs tabular-nums text-zinc-300">{Math.round((v || 0) * 100)}%</span>
    </div>
  );
  const slide = s ? Math.abs(s.slip) * (180 / Math.PI) : 0;
  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.03] p-3">
      <div className="mb-2 flex items-center gap-2">
        <span className="h-4 w-1 rounded-full" style={{ background: props.color }} />
        <span className="font-mono text-xs text-zinc-400">{s?.pos ? `P${s.pos}` : ""}</span>
        <button type="button" onClick={props.onCard} className="min-w-0 flex-1 truncate text-left text-sm font-semibold hover:underline">
          {car?.number ? `${car.number} ` : ""}
          {car?.name ?? "Car"}
        </button>
        <IconButton label={props.following ? "Stop following" : "Follow with the camera (adds to the cars followed)"} active={props.following} onClick={props.onFollow}>
          <Video className="h-4 w-4" />
        </IconButton>
        <IconButton label="Remove" onClick={props.onRemove}>
          <X className="h-4 w-4" />
        </IconButton>
      </div>
      <div className="flex items-center gap-2">
        <SteeringWheel s={s} />
        <div className="flex-1">
          <div className="font-mono text-2xl leading-none tabular-nums">
            {s ? Math.round(s.speed) : "–"}
            <span className="ml-1 text-xs text-zinc-500">km/h</span>
          </div>
          <div className="mt-1 text-xs text-zinc-400">
            Lap {s?.lap || "–"}
            {props.laps ? `/${props.laps}` : ""} · {s ? `${Math.round(s.dist)} m` : "–"}
          </div>
          <div className="text-xs text-zinc-400">
            Ahead {fmtGap(props.gapAhead)} · Behind {fmtGap(props.gapBehind)}
          </div>
        </div>
      </div>
      <div className="mt-2 space-y-1.5">
        {pctBar(s?.throttle ?? 0, "bg-emerald-400", "Throttle")}
        {pctBar(s?.brake ?? 0, "bg-red-500", "Brake")}
        <div className="flex items-center gap-2 text-[11px] text-zinc-500">
          <span className="w-12 uppercase tracking-wide">Steer</span>
          <span className="font-mono text-zinc-300">{s ? `${Math.round(s.steer * 100)}%` : "–"}</span>
          <span className="ml-3 uppercase tracking-wide">Slide</span>
          <span className={`font-mono ${slide >= 9 ? "text-sky-300" : "text-zinc-300"}`}>{s ? `${slide.toFixed(0)}°` : "–"}</span>
        </div>
      </div>
      <div className="mt-2">
        <TraceChart trace={props.trace} />
        <div className="mt-1 flex justify-between text-[10px] text-zinc-600">
          <span>−10 s</span>
          <span>speed · throttle · brake · steering</span>
          <span>now</span>
        </div>
      </div>
      {props.tags.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          <TagChips tags={props.tags} />
        </div>
      )}
    </div>
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
  speeds: number[];
}

const WHEEL = { fl: "front left", fr: "front right", rl: "rear left", rr: "rear right" } as Record<string, string>;

/** The incident deep-dive: one row per involved driver. */
export function IncidentDetail(props: {
  incident: RaceIncident;
  stats: IncidentDriverStats[];
  cars: Record<string, RaceCar>;
  color: (car: number) => string;
  start: number;
  onClose: () => void;
}) {
  const { incident: inc } = props;
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
      <div className="space-y-2">
        {props.stats.map((d) => {
          const info = props.cars[String(d.car)];
          const max = Math.max(1, ...d.speeds);
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
              <svg viewBox="0 0 100 20" preserveAspectRatio="none" className="mt-1 h-6 w-full">
                <polyline
                  points={d.speeds.map((v, i) => `${((i / Math.max(d.speeds.length - 1, 1)) * 100).toFixed(1)},${(19 - (v / max) * 18).toFixed(1)}`).join(" ")}
                  fill="none"
                  stroke={props.color(d.car)}
                  strokeWidth="1.2"
                  vectorEffect="non-scaling-stroke"
                />
              </svg>
            </div>
          );
        })}
        {!props.stats.length && <p className="text-xs text-zinc-500">Loading the cars around this incident…</p>}
      </div>
      <p className="mt-2 text-[10px] text-zinc-600">Speeds in km/h, 3 s before to 3 s after. Slide = angle between where the car points and where it goes.</p>
    </div>
  );
}

/** The running order, top left, like the game's timing tower. */
export function TimingTower(props: {
  order: CarState[];
  cars: Record<string, RaceCar>;
  color: (car: number) => string;
  interval: (car: number) => number | null;
  lap: number;
  laps: number;
  selected: number[];
  followed: number[];
  open: boolean;
  onToggle: () => void;
  onPick: (car: number) => void;
}) {
  return (
    <div className="pointer-events-auto w-56 overflow-hidden rounded-lg border border-white/10 bg-[#0c0e11]/88 text-xs shadow-xl backdrop-blur">
      <button type="button" onClick={props.onToggle} className="flex w-full items-center gap-1 bg-white/5 px-2 py-1.5 font-semibold uppercase tracking-wide text-zinc-300">
        {props.open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        Lap {Math.max(1, props.lap)}
        {props.laps ? ` / ${props.laps}` : ""}
        <span className="ml-auto font-normal normal-case text-zinc-500">Interval</span>
      </button>
      {props.open && (
        <ul aria-label="Running order" className="max-h-[52vh] overflow-y-auto py-0.5">
          {props.order.map((s, i) => {
            const info = props.cars[String(s.car)];
            const on = props.selected.includes(s.car);
            const gap = i === 0 ? null : props.interval(s.car);
            return (
              <li key={s.car}>
                <button
                  type="button"
                  onClick={() => props.onPick(s.car)}
                  className={`flex h-6 w-full items-center gap-1.5 pr-2 text-left hover:bg-white/10 ${on ? "bg-white/10" : ""}`}
                >
                  <span className="flex h-6 w-6 items-center justify-center bg-white/90 font-mono text-[11px] font-bold text-black">{s.pos || "–"}</span>
                  <span className="h-4 w-1 rounded-sm" style={{ background: props.color(s.car) }} />
                  <span className="min-w-0 flex-1 truncate font-semibold uppercase tracking-wide">{info?.name ?? `Car ${s.car}`}</span>
                  {props.followed.includes(s.car) && <Video className="h-3 w-3 text-zinc-400" />}
                  {bits(s.off) >= 2 && <span className="text-[9px] font-bold text-orange-300">OFF</span>}
                  <span className="w-11 text-right font-mono tabular-nums text-zinc-400">{i === 0 ? "Leader" : gap === null ? "" : `+${gap.toFixed(1)}`}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/** The incident list: every grouped incident, a click jumps the clock and the camera to it. */
export function IncidentList(props: {
  incidents: RaceIncident[];
  cars: Record<string, RaceCar>;
  start: number;
  active: number | null;
  open: boolean;
  onToggle: () => void;
  onPick: (i: number) => void;
}) {
  const name = (c: number) => props.cars[String(c)]?.name ?? `Car ${c}`;
  return (
    <div>
      <button type="button" onClick={props.onToggle} className="flex w-full items-center gap-1 py-1 text-xs font-semibold uppercase tracking-wide text-zinc-400">
        {props.open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        Incidents ({props.incidents.length})
      </button>
      {props.open && (
        <ul className="mt-1 space-y-1">
          {props.incidents.map((inc, i) => {
            const contact = inc.drivers.filter((d) => d.role === "contact");
            const others = inc.drivers.filter((d) => d.role !== "contact");
            return (
              <li key={i}>
                <button
                  type="button"
                  onClick={() => props.onPick(i)}
                  className={`w-full rounded-md px-2 py-1.5 text-left text-sm hover:bg-white/10 ${props.active === i ? "bg-white/10" : ""}`}
                >
                  <div className="flex items-center gap-2 text-xs text-zinc-500">
                    <span className="h-2 w-2 rotate-45 rounded-[1px] bg-amber-400" />
                    {inc.lap ? `Lap ${inc.lap} · ` : ""}
                    {clock(inc.t0 - props.start)}
                    {inc.contacts.length > 1 ? ` · ${inc.contacts.length} contacts` : ""}
                  </div>
                  <div className="truncate">{contact.map((d) => name(d.car)).join(", ")}</div>
                  {others.length > 0 && (
                    <div className="truncate text-xs text-zinc-500">
                      Also involved: {others.map((d) => `${name(d.car)} (${d.role})`).join(", ")}
                    </div>
                  )}
                </button>
              </li>
            );
          })}
          {!props.incidents.length && <li className="px-2 text-sm text-zinc-500">No contacts in this race.</li>}
        </ul>
      )}
    </div>
  );
}
