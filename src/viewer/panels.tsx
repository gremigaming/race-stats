import { ChevronDown, ChevronRight, Pause, Play, RotateCcw, RotateCw, Video, X } from "lucide-react";
import { useRef, type ReactNode } from "react";
import type { RaceCar, RaceIncident } from "./format";
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

/** Throttle and brake bars, a steering wheel, speed and gear for one selected driver. */
export function CarInputs(props: {
  car: RaceCar | undefined;
  color: string;
  s: CarState | undefined;
  following: boolean;
  onFollow: () => void;
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
  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.03] p-3">
      <div className="mb-2 flex items-center gap-2">
        <span className="h-3 w-1 rounded-full" style={{ background: props.color }} />
        <span className="font-mono text-xs text-zinc-400">{s?.pos ? `P${s.pos}` : ""}</span>
        <span className="min-w-0 flex-1 truncate text-sm font-semibold">
          {car?.number ? `${car.number} ` : ""}
          {car?.name ?? "Car"}
        </span>
        <IconButton label="Follow with the camera" active={props.following} onClick={props.onFollow}>
          <Video className="h-4 w-4" />
        </IconButton>
        <IconButton label="Remove" onClick={props.onRemove}>
          <X className="h-4 w-4" />
        </IconButton>
      </div>
      <div className="flex items-center gap-3">
        <div className="flex-1 space-y-1.5">
          {pctBar(s?.throttle ?? 0, "bg-emerald-400", "Throttle")}
          {pctBar(s?.brake ?? 0, "bg-red-500", "Brake")}
        </div>
        <SteeringWheel steer={s?.steer ?? 0} />
      </div>
      <div className="mt-2 flex items-baseline gap-4">
        <span className="font-mono text-xl tabular-nums">
          {s ? Math.round(s.speed) : "–"}
          <span className="ml-1 text-xs text-zinc-500">km/h</span>
        </span>
        <span className="font-mono text-xl tabular-nums">
          {s ? (s.gear < 0 ? "R" : s.gear === 0 ? "N" : s.gear) : "–"}
          <span className="ml-1 text-xs text-zinc-500">gear</span>
        </span>
        {s && s.off ? <span className="ml-auto text-xs text-amber-400">Off track</span> : null}
      </div>
    </div>
  );
}

function SteeringWheel({ steer }: { steer: number }) {
  return (
    <svg viewBox="-20 -20 40 40" className="h-12 w-12 shrink-0" aria-label={`Steering ${Math.round(steer * 100)}%`}>
      <g transform={`rotate(${steer * 120})`}>
        <path d="M-17 -6 Q-17 -14 -9 -14 L9 -14 Q17 -14 17 -6 L17 6 Q17 13 10 13 L-10 13 Q-17 13 -17 6 Z" fill="none" stroke="#d4d4d8" strokeWidth="3" />
        <rect x="-7" y="-5" width="14" height="10" rx="2" fill="#3f3f46" />
        <rect x="-1" y="-14" width="2" height="5" fill="#ef4444" />
      </g>
    </svg>
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
