/**
 * The broadcast pieces around the map: the TV-style input strip under the cars (tabs when several
 * drivers are picked), the incident feed in the right-hand column, the 5 start lights and the
 * picture-in-picture replay of a live incident.
 */
import { X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { RaceCar, RaceIncident } from "./format";
import { clock, IconButton, SteeringWheel, type Trace } from "./panels";
import { RaceScene } from "./scene";
import type { ChunkStore, CarState } from "./store";

const gearText = (s: CarState | undefined) => (!s ? "–" : s.gear < 0 ? "R" : s.gear === 0 ? "N" : String(s.gear));

/** Throttle, brake and steering over the last 10 s, Pits n' Giggles style (no speed). */
export function InputTrace({ trace, height = 56 }: { trace: Trace | undefined; height?: number }) {
  if (!trace || trace.throttle.length < 2) return <div className="rounded bg-white/[0.03]" style={{ height }} />;
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
        <polyline points={line(trace.steer, (v) => 20 - v * 18)} fill="none" stroke="#60a5fa" strokeWidth="1.2" vectorEffect="non-scaling-stroke" />
        <polyline points={line(trace.throttle, pedal)} fill="none" stroke="#22c55e" strokeWidth="1.8" vectorEffect="non-scaling-stroke" />
        <polyline points={line(trace.brake, pedal)} fill="none" stroke="#ef4444" strokeWidth="1.8" vectorEffect="non-scaling-stroke" />
      </svg>
      <div className="mt-1 flex justify-between text-[10px] text-zinc-500">
        <span>−10 s</span>
        <span>
          <span className="text-emerald-400">throttle</span> · <span className="text-red-400">brake</span> · <span className="text-sky-400">steering</span>
        </span>
        <span>now</span>
      </div>
    </div>
  );
}

export interface StripDriver {
  car: number;
  name: string;
  color: string;
  s: CarState | undefined;
  gap: string;
}

/** The TV strip under the cars: one picked driver's inputs, tabs to switch between several. Click it for the 10 s trace. */
export function TvStrip(props: { drivers: StripDriver[]; focus: number; trace: Trace | undefined; onFocus: (car: number) => void; onClose: () => void }) {
  const [open, setOpen] = useState(false);
  const d = props.drivers.find((x) => x.car === props.focus) ?? props.drivers[0];
  if (!d) return null;
  const s = d.s;
  const pct = (v: number | undefined) => `${Math.round(Math.max(0, Math.min(1, v ?? 0)) * 100)}%`;
  return (
    <div className="pointer-events-auto w-[24rem] max-w-[calc(100vw-1.5rem)] overflow-hidden rounded-lg border border-white/10 bg-[#0c0e11]/90 shadow-xl backdrop-blur">
      {props.drivers.length > 1 && (
        <div className="flex border-b border-white/10 text-[11px]">
          {props.drivers.map((x) => (
            <button
              key={x.car}
              type="button"
              onClick={() => props.onFocus(x.car)}
              className={`flex min-w-0 flex-1 items-center gap-1 px-2 py-1 ${x.car === d.car ? "bg-white/10 text-white" : "text-zinc-400 hover:bg-white/5"}`}
              style={x.car === d.car ? { boxShadow: `inset 0 -2px 0 ${x.color}` } : undefined}
            >
              <span className="h-2 w-2 shrink-0 rounded-sm" style={{ background: x.color }} />
              <span className="truncate">{x.name}</span>
            </button>
          ))}
        </div>
      )}
      <div className="flex items-center gap-2 p-2">
        <button type="button" onClick={() => setOpen((o) => !o)} className="flex min-w-0 flex-1 items-center gap-2 text-left" title="Show the last 10 s">
          <span className="h-9 w-1 shrink-0 rounded-full" style={{ background: d.color }} />
          <span className="w-24 min-w-0">
            <span className="block truncate text-sm font-semibold">
              <span className="font-mono tabular-nums">{s?.pos ? `P${s.pos}` : "–"}</span> {d.name}
            </span>
            <span className="block font-mono text-[11px] tabular-nums text-zinc-400">{d.gap}</span>
          </span>
          <SteeringWheel s={s} small />
          <span className="flex flex-1 flex-col gap-1.5">
            <span className="block h-2 overflow-hidden rounded bg-white/10">
              <span className="block h-full bg-emerald-500" style={{ width: pct(s?.throttle) }} />
            </span>
            <span className="block h-2 overflow-hidden rounded bg-white/10">
              <span className="block h-full bg-red-500" style={{ width: pct(s?.brake) }} />
            </span>
          </span>
          <span className="w-6 text-center font-mono text-2xl font-bold tabular-nums">{gearText(s)}</span>
        </button>
        <IconButton label="Back to the broadcast camera" onClick={props.onClose}>
          <X className="h-4 w-4" />
        </IconButton>
      </div>
      {open && (
        <div className="px-2 pb-2">
          <InputTrace trace={props.trace} height={52} />
        </div>
      )}
    </div>
  );
}

/** Incidents the playhead has passed, newest first: lap badge, who hit whom, the picked driver's ones highlighted. */
export function IncidentFeed(props: {
  incidents: RaceIncident[];
  cars: Record<string, RaceCar>;
  color: (car: number) => string;
  start: number;
  t: number;
  focus: number | null;
  active: number | null;
  onPick: (i: number) => void;
}) {
  const [mine, setMine] = useState(false);
  const name = (c: number) => props.cars[String(c)]?.name ?? `Car ${c}`;
  const past = props.incidents.map((inc, i) => ({ inc, i })).filter((x) => x.inc.t0 <= props.t || x.i === props.active);
  const involves = (inc: RaceIncident) => props.focus !== null && inc.drivers.some((d) => d.car === props.focus);
  const shown = (mine && props.focus !== null ? past.filter((x) => involves(x.inc)) : past).reverse();
  const chip = (on: boolean, label: string, onClick: () => void) => (
    <button type="button" onClick={onClick} className={`max-w-[10rem] truncate rounded-full border px-2 py-0.5 text-[11px] ${on ? "border-white/80 bg-white/90 text-black" : "border-white/15 text-zinc-400 hover:bg-white/10"}`}>
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
      <div className="border-b border-white/10 px-3 py-2">
        <div className="text-sm font-semibold">Incidents</div>
        <div className="text-[11px] text-zinc-500">Click one to watch it</div>
      </div>
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
                className={`grid w-full grid-cols-[2.75rem_1fr] items-start gap-2 border-b border-white/5 px-3 py-2 text-left text-xs hover:bg-white/5 ${props.active === i ? "bg-white/10" : hl ? "bg-white/[0.04]" : ""}`}
                style={hl ? { boxShadow: `inset 3px 0 0 ${props.color(props.focus!)}` } : undefined}
              >
                <span className="rounded border border-white/15 py-0.5 text-center font-mono tabular-nums leading-tight">
                  {inc.lap ? `L${inc.lap}` : "–"}
                  <span className="block text-[9px] text-zinc-500">{clock(inc.t0 - props.start)}</span>
                </span>
                <span className="min-w-0">
                  <span className="flex min-w-0 flex-wrap items-center gap-x-1.5">
                    {contact[0] !== undefined && <Car c={contact[0]} />}
                    {contact.length > 1 && <span className="text-zinc-500">hit</span>}
                    {contact.slice(1).map((c) => (
                      <Car key={c} c={c} />
                    ))}
                  </span>
                  <span className="mt-0.5 block truncate text-[11px] text-zinc-500">
                    {inc.kind === "tap" && <span className="mr-1 rounded bg-white/10 px-1 font-bold text-zinc-400">LIGHT CONTACT</span>}
                    {inc.contacts.length > 1 && <span className="mr-1 rounded bg-amber-400/15 px-1 font-bold text-amber-300">{inc.contacts.length} CONTACTS</span>}
                    {others.length ? `Also: ${others.map((d) => `${name(d.car)} (${d.role})`).join(", ")}` : inc.dist ? `${Math.round(inc.dist)} m into the lap` : ""}
                  </span>
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

/** The 5 start lights, centre screen: `lit` lamps on (0..5), fading out once they go out. */
export function StartLights({ lit, fade }: { lit: number; fade: number }) {
  return (
    <div className="pointer-events-none flex gap-3 rounded-xl border border-white/10 bg-black/80 p-3 shadow-2xl transition-opacity" style={{ opacity: fade }} aria-label={`${lit} of 5 start lights on`}>
      {Array.from({ length: 5 }, (_, i) => (
        <div key={i} className="flex flex-col gap-2 rounded-lg bg-[#111317] p-2">
          {[0, 1].map((r) => (
            <span
              key={r}
              className="block h-8 w-8 rounded-full sm:h-10 sm:w-10"
              style={
                i < lit
                  ? { background: "radial-gradient(circle at 40% 35%, #ff8a8a, #e10600 55%, #7a0000)", boxShadow: "0 0 18px 4px rgba(225,6,0,0.65)" }
                  : { background: "radial-gradient(circle at 40% 35%, #2b2e34, #15171b)" }
              }
            />
          ))}
        </div>
      ))}
    </div>
  );
}

/**
 * Picture in picture for a live race: replays one incident at half speed in a small second view
 * while the main camera stays on the live race, then closes. Click it to watch it big.
 */
export function IncidentPip(props: {
  incident: RaceIncident;
  store: ChunkStore;
  cars: Record<string, RaceCar>;
  track: string;
  label: string;
  onDone: () => void;
  onOpen: () => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const done = useRef(props.onDone);
  done.current = props.onDone;
  const { incident: inc, store } = props;
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    let t = inc.t0 - 3;
    const end = inc.t1 + 3;
    let finished = false;
    const s = new RaceScene(el, props.cars, props.track, (dtMs) => {
      if (store.loaded(t)) t += (dtMs / 1000) * 0.5;
      store.want(t);
      if (t >= end && !finished) {
        finished = true;
        window.setTimeout(() => done.current(), 0);
      }
      return { t, states: store.sample(Math.min(t, end)) };
    });
    s.follow(
      inc.drivers.map((d) => d.car),
      45,
    );
    s.incident = Number.isFinite(inc.x) ? { x: inc.x, z: inc.z, strength: 1 } : null;
    return () => s.destroy();
    // one view per incident
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inc]);
  return (
    <div className="pointer-events-auto w-80 max-w-[60vw] overflow-hidden rounded-lg border-2 border-amber-400/70 bg-[#0c0e11] shadow-2xl">
      <div className="flex items-center gap-2 bg-amber-400/15 px-2 py-1 text-xs">
        <span className="h-2 w-2 rotate-45 rounded-[1px] bg-amber-400" />
        <span className="min-w-0 flex-1 truncate font-semibold">Incident replay · {props.label}</span>
        <button type="button" className="text-zinc-300 hover:text-white" onClick={props.onOpen}>
          Watch
        </button>
        <button type="button" aria-label="Close" className="text-zinc-400 hover:text-white" onClick={props.onDone}>
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      <div ref={host} className="relative aspect-video w-full" />
    </div>
  );
}
