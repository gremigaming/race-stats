/**
 * Round 2 layout preview: three ways to lay out the right-hand column (A tabs, B TV strip plus an
 * incident feed, C fixed slots). Every number sits in a fixed-width slot so nothing jumps.
 */
import { useState, type ReactNode } from "react";
import type { RaceCar, RaceIncident } from "./format";
import { clock, SteeringWheel, TagChips, type Trace } from "./panels";
import type { CarTag } from "./scene";
import type { CarState } from "./store";

export type LayoutId = "now" | "A" | "B" | "C";
export const LAYOUTS: { id: LayoutId; label: string }[] = [
  { id: "now", label: "Now" },
  { id: "A", label: "A · Tabs" },
  { id: "B", label: "B · TV strip" },
  { id: "C", label: "C · Slots" },
];

export function LayoutSwitch(props: { value: LayoutId; onChange: (l: LayoutId) => void }) {
  return (
    <div className="pointer-events-auto flex items-center gap-0.5 rounded-lg border border-amber-400/40 bg-[#0c0e11]/85 p-0.5 text-xs backdrop-blur">
      <span className="px-1.5 font-semibold uppercase tracking-wide text-amber-300">Layout</span>
      {LAYOUTS.map((l) => (
        <button
          key={l.id}
          type="button"
          onClick={() => props.onChange(l.id)}
          className={`h-7 rounded-md px-2 ${props.value === l.id ? "bg-white/90 text-black" : "text-zinc-300 hover:bg-white/10"}`}
        >
          {l.label}
        </button>
      ))}
    </div>
  );
}

const gapText = (g: number | null, sign: string) => (g === null ? "–" : `${sign}${g.toFixed(2)}`);
const gearText = (s: CarState | undefined) => (!s ? "–" : s.gear < 0 ? "R" : s.gear === 0 ? "N" : String(s.gear));
const steerText = (s: CarState | undefined) => {
  if (!s) return "–";
  const v = Math.round(s.steer * 100);
  return v === 0 ? "0%" : `${Math.abs(v)}% ${v < 0 ? "L" : "R"}`;
};

/** The facts about one driver everything else hangs off. */
export interface Focus {
  car: number;
  info: RaceCar | undefined;
  color: string;
  team: string;
  s: CarState | undefined;
  ahead: number | null;
  behind: number | null;
  grid: number | null;
  trace: Trace | undefined;
  tags: CarTag[];
}

function GridGain({ f }: { f: Focus }) {
  if (!f.grid || !f.s?.pos) return <>–</>;
  const d = f.grid - f.s.pos;
  return (
    <>
      P{f.grid}{" "}
      <span className={d > 0 ? "text-emerald-400" : d < 0 ? "text-red-400" : "text-zinc-500"}>{d > 0 ? `▲${d}` : d < 0 ? `▼${-d}` : "="}</span>
    </>
  );
}

export function DriverHeader({ f, laps, picker }: { f: Focus; laps: number; picker?: ReactNode }) {
  return (
    <div className="border-b border-white/10 bg-white/[0.04]">
      <div className="flex items-center gap-2.5 px-3 py-2">
        <span className="w-9 font-mono text-xl font-bold tabular-nums">{f.s?.pos ? `P${f.s.pos}` : "–"}</span>
        <span className="h-8 w-1 rounded-full" style={{ background: f.color }} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[15px] font-semibold">{f.info?.name ?? `Car ${f.car}`}</div>
          <div className="truncate text-[11px] text-zinc-400">
            {f.team} · Lap <span className="font-mono tabular-nums">{f.s?.lap || "–"}/{laps || "–"}</span>
          </div>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-px bg-white/10">
        <div className="bg-[#0c0e11] px-3 py-1.5">
          <div className="text-[10px] uppercase tracking-wider text-zinc-500">Ahead</div>
          <div className="w-16 font-mono text-[15px] font-bold tabular-nums">{gapText(f.ahead, "+")}</div>
        </div>
        <div className="bg-[#0c0e11] px-3 py-1.5">
          <div className="text-[10px] uppercase tracking-wider text-zinc-500">Behind</div>
          <div className="w-16 font-mono text-[15px] font-bold tabular-nums">{gapText(f.behind, "−")}</div>
        </div>
      </div>
      {picker}
    </div>
  );
}

/** Pick which of the selected drivers the column shows. */
export function FocusPicker(props: { cars: number[]; focus: number; name: (c: number) => string; color: (c: number) => string; onPick: (c: number) => void }) {
  if (props.cars.length < 2) return null;
  return (
    <div className="flex flex-wrap gap-1 border-t border-white/10 px-3 py-1.5">
      {props.cars.map((c) => (
        <button
          key={c}
          type="button"
          onClick={() => props.onPick(c)}
          className={`flex max-w-[9rem] items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] ${c === props.focus ? "border-white/80 bg-white/90 text-black" : "border-white/15 text-zinc-300 hover:bg-white/10"}`}
        >
          <span className="h-2 w-2 shrink-0 rounded-sm" style={{ background: props.color(c) }} />
          <span className="truncate">{props.name(c)}</span>
        </button>
      ))}
    </div>
  );
}

/** Throttle, brake and steering over the last 10 s, Pits n' Giggles style (no speed). */
export function InputTrace({ trace, height = 64 }: { trace: Trace | undefined; height?: number }) {
  const box = <div className="rounded bg-white/[0.03]" style={{ height }} />;
  if (!trace || trace.throttle.length < 2) return box;
  const n = trace.throttle.length;
  const X = (i: number) => (i / (n - 1)) * 100;
  const line = (vals: number[], f: (v: number) => number) => vals.map((v, i) => `${X(i).toFixed(2)},${f(v).toFixed(2)}`).join(" ");
  const pedal = (v: number) => 39 - v * 37;
  return (
    <div>
      <svg viewBox="0 0 100 40" preserveAspectRatio="none" className="w-full rounded bg-white/[0.03]" style={{ height }}>
        {[10, 20, 30].map((y) => (
          <line key={y} x1="0" y1={y} x2="100" y2={y} stroke="rgba(255,255,255,0.06)" strokeWidth="0.3" vectorEffect="non-scaling-stroke" />
        ))}
        <polyline points={line(trace.steer, (v) => 20 - v * 18)} fill="none" stroke="#60a5fa" strokeWidth="1.2" vectorEffect="non-scaling-stroke" opacity="0.9" />
        <polyline points={line(trace.throttle, pedal)} fill="none" stroke="#22c55e" strokeWidth="1.8" vectorEffect="non-scaling-stroke" />
        <polyline points={line(trace.brake, pedal)} fill="none" stroke="#ef4444" strokeWidth="1.8" vectorEffect="non-scaling-stroke" />
      </svg>
      <div className="mt-1 flex justify-between text-[10px] text-zinc-600">
        <span>−10 s</span>
        <span>
          <span className="text-emerald-400">throttle</span> · <span className="text-red-400">brake</span> · <span className="text-sky-400">steering</span>
        </span>
        <span>now</span>
      </div>
    </div>
  );
}

function VBar({ v, cls }: { v: number; cls: string }) {
  return (
    <div className="relative h-full w-4 overflow-hidden rounded bg-white/10">
      <div className={`absolute inset-x-0 bottom-0 rounded ${cls}`} style={{ height: `${Math.round(Math.max(0, Math.min(1, v)) * 100)}%` }} />
    </div>
  );
}

/** Option A's inputs: yoke, two pedal bars and the gear, side by side. */
export function InputsYoke({ f }: { f: Focus }) {
  const s = f.s;
  return (
    <div className="flex items-center gap-3">
      <SteeringWheel s={s} />
      <div className="flex h-20 gap-1.5">
        <VBar v={s?.throttle ?? 0} cls="bg-emerald-500" />
        <VBar v={s?.brake ?? 0} cls="bg-red-500" />
      </div>
      <div className="flex flex-col gap-1">
        <div>
          <div className="text-[10px] uppercase tracking-wider text-zinc-500">Gear</div>
          <div className="w-8 font-mono text-3xl font-bold leading-none tabular-nums">{gearText(s)}</div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wider text-zinc-500">Steer</div>
          <div className="w-16 font-mono text-sm tabular-nums">{steerText(s)}</div>
        </div>
      </div>
    </div>
  );
}

function HBar({ label, v, cls, text, centred }: { label: string; v: number; cls: string; text: string; centred?: boolean }) {
  const w = Math.round(Math.min(1, Math.abs(v)) * (centred ? 50 : 100));
  const left = centred ? (v < 0 ? 50 - w : 50) : 0;
  return (
    <div className="grid grid-cols-[3.5rem_1fr_3.5rem] items-center gap-2">
      <span className="text-[10px] uppercase tracking-wider text-zinc-500">{label}</span>
      <div className="relative h-2.5 overflow-hidden rounded bg-white/10">
        {centred && <span className="absolute inset-y-0 left-1/2 w-px bg-white/30" />}
        <div className={`absolute inset-y-0 rounded ${cls}`} style={{ left: `${left}%`, width: `${w}%` }} />
      </div>
      <span className="text-right font-mono text-xs tabular-nums text-zinc-300">{text}</span>
    </div>
  );
}

/** Option C's inputs: three horizontal bars, steering centred. */
export function InputsBars({ f }: { f: Focus }) {
  const s = f.s;
  return (
    <div className="space-y-1.5">
      <HBar label="Throttle" v={s?.throttle ?? 0} cls="bg-emerald-500" text={`${Math.round((s?.throttle ?? 0) * 100)}%`} />
      <HBar label="Brake" v={s?.brake ?? 0} cls="bg-red-500" text={`${Math.round((s?.brake ?? 0) * 100)}%`} />
      <HBar label="Steer" v={s?.steer ?? 0} cls="bg-sky-400" text={steerText(s)} centred />
    </div>
  );
}

export function RaceStatsGrid({ f, laps }: { f: Focus; laps: number }) {
  const cell = (label: string, value: ReactNode) => (
    <div className="min-w-0">
      <div className="text-[10px] uppercase tracking-wider text-zinc-500">{label}</div>
      <div className="font-mono text-sm tabular-nums">{value}</div>
    </div>
  );
  return (
    <div className="grid grid-cols-4 gap-2">
      {cell("Grid", <GridGain f={f} />)}
      {cell("Lap", `${f.s?.lap || "–"}/${laps || "–"}`)}
      {cell("Last", "–")}
      {cell("Best", "–")}
    </div>
  );
}

export function Tags({ f }: { f: Focus }) {
  const all: CarTag[] = ["CONTACT", "OFF TRACK", "SLIDE", "LOCK-UP?"];
  return (
    <div className="flex flex-wrap gap-1">
      {all.map((t) =>
        f.tags.includes(t) ? (
          <TagChips key={t} tags={[t]} />
        ) : (
          <span key={t} className="rounded bg-white/5 px-1.5 py-0.5 text-[10px] font-bold italic text-zinc-600">
            {t}
          </span>
        ),
      )}
    </div>
  );
}

/** Incidents the playhead has passed, newest first, with a lap badge and who hit whom. */
export function IncidentFeed(props: {
  incidents: RaceIncident[];
  cars: Record<string, RaceCar>;
  color: (car: number) => string;
  start: number;
  t: number;
  focus: number | null;
  active: number | null;
  compact?: boolean;
  onPick: (i: number) => void;
}) {
  const [mine, setMine] = useState(false);
  const name = (c: number) => props.cars[String(c)]?.name ?? `Car ${c}`;
  const past = props.incidents.map((inc, i) => ({ inc, i })).filter((x) => x.inc.t0 <= props.t);
  const involves = (inc: RaceIncident) => props.focus !== null && inc.drivers.some((d) => d.car === props.focus);
  const shown = (mine && props.focus !== null ? past.filter((x) => involves(x.inc)) : past).reverse();
  const chip = (on: boolean, label: string, onClick: () => void) => (
    <button type="button" onClick={onClick} className={`rounded-full border px-2 py-0.5 text-[11px] ${on ? "border-white/80 bg-white/90 text-black" : "border-white/15 text-zinc-400 hover:bg-white/10"}`}>
      {label}
    </button>
  );
  const Car = ({ c }: { c: number }) => (
    <span className="inline-flex min-w-0 items-center gap-1 font-semibold">
      <span className="h-2 w-2 shrink-0 rounded-sm" style={{ background: props.color(c) }} />
      <span className="truncate">{name(c)}</span>
    </span>
  );
  return (
    <div className="flex min-h-0 flex-col">
      {props.focus !== null && (
        <div className="flex gap-1.5 border-b border-white/10 px-3 py-1.5">
          {chip(!mine, `All · ${past.length}`, () => setMine(false))}
          {chip(mine, `${name(props.focus)} · ${past.filter((x) => involves(x.inc)).length}`, () => setMine(true))}
        </div>
      )}
      <ul>
        {shown.map(({ inc, i }) => {
          const contact = inc.drivers.filter((d) => d.role === "contact").map((d) => d.car);
          const others = inc.drivers.filter((d) => d.role !== "contact");
          const hl = involves(inc);
          return (
            <li key={i}>
              <button
                type="button"
                onClick={() => props.onPick(i)}
                className={`grid w-full grid-cols-[2.75rem_1fr] items-start gap-2 border-b border-white/5 px-3 py-2 text-left text-xs hover:bg-white/5 ${props.active === i ? "bg-white/10" : ""}`}
                style={hl ? { boxShadow: `inset 3px 0 0 ${props.color(props.focus!)}`, background: props.active === i ? undefined : "rgba(255,255,255,0.04)" } : undefined}
              >
                <span className="rounded border border-white/15 py-0.5 text-center font-mono tabular-nums leading-tight">
                  {inc.lap ? `L${inc.lap}` : "–"}
                  {!props.compact && <span className="block text-[9px] text-zinc-500">{clock(inc.t0 - props.start)}</span>}
                </span>
                <span className="min-w-0">
                  <span className="flex min-w-0 flex-wrap items-center gap-x-1.5">
                    {contact[0] !== undefined && <Car c={contact[0]} />}
                    {contact.length > 1 && <span className="text-zinc-500">{props.compact ? "→" : "hit"}</span>}
                    {contact.slice(1).map((c) => (
                      <Car key={c} c={c} />
                    ))}
                  </span>
                  {!props.compact && (
                    <span className="mt-0.5 block truncate text-[11px] text-zinc-500">
                      {inc.contacts.length > 1 && <span className="mr-1 rounded bg-amber-400/15 px-1 font-bold text-amber-300">{inc.contacts.length} CONTACTS</span>}
                      {others.length ? `Also: ${others.map((d) => `${name(d.car)} (${d.role})`).join(", ")}` : `${Math.round(inc.dist)} m into the lap`}
                    </span>
                  )}
                </span>
              </button>
            </li>
          );
        })}
        {!shown.length && <li className="px-3 py-2 text-xs text-zinc-500">No incidents yet at this point of the race.</li>}
      </ul>
    </div>
  );
}

/** Option B: a broadcast-style strip under the map for the focused driver; click it for the trace. */
export function TvStrip({ f }: { f: Focus }) {
  const [open, setOpen] = useState(false);
  const s = f.s;
  return (
    <button
      type="button"
      onClick={() => setOpen((o) => !o)}
      className="pointer-events-auto w-[22rem] max-w-[calc(100vw-1.5rem)] rounded-lg border border-white/10 bg-[#0c0e11]/90 p-2 text-left backdrop-blur"
    >
      <div className="flex items-center gap-2">
        <span className="h-9 w-1 rounded-full" style={{ background: f.color }} />
        <div className="w-24 min-w-0">
          <div className="truncate text-sm font-semibold">
            <span className="font-mono tabular-nums">{s?.pos ? `P${s.pos}` : "–"}</span> {f.info?.name ?? `Car ${f.car}`}
          </div>
          <div className="font-mono text-[11px] tabular-nums text-zinc-400">{gapText(f.ahead, "+")}</div>
        </div>
        <SteeringWheel s={s} small />
        <div className="flex flex-1 flex-col gap-1.5">
          <div className="h-2 overflow-hidden rounded bg-white/10">
            <div className="h-full bg-emerald-500" style={{ width: `${Math.round((s?.throttle ?? 0) * 100)}%` }} />
          </div>
          <div className="h-2 overflow-hidden rounded bg-white/10">
            <div className="h-full bg-red-500" style={{ width: `${Math.round((s?.brake ?? 0) * 100)}%` }} />
          </div>
        </div>
        <span className="w-6 text-center font-mono text-2xl font-bold tabular-nums">{gearText(s)}</span>
      </div>
      {open && (
        <div className="mt-2">
          <InputTrace trace={f.trace} height={52} />
        </div>
      )}
    </button>
  );
}
