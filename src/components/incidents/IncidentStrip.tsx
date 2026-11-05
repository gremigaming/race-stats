import { useRef, type PointerEvent } from "react";
import { CAR_COLORS, type IncidentSeries } from "./IncidentMap";

/**
 * What the drivers did, at a glance (GreMi, 5 Nov 2026, replaces the per-car charts): live
 * throttle, brake, steering, gear and speed for the two main cars, and one slim timeline with
 * both speeds and the gap between them. The amber line is the first contact; click or drag the
 * timeline to scrub.
 */

const H = 40;

function path(vals: number[], lo: number, hi: number) {
  const n = vals.length;
  let out = "";
  let pen = false;
  vals.forEach((v, i) => {
    if (!Number.isFinite(v)) {
      pen = false;
      return;
    }
    const x = ((i / Math.max(n - 1, 1)) * 100).toFixed(2);
    const y = (H - 1 - ((Math.max(lo, Math.min(hi, v)) - lo) / Math.max(hi - lo, 1e-6)) * (H - 2)).toFixed(2);
    out += `${pen ? "L" : "M"}${x},${y}`;
    pen = true;
  });
  return out;
}

const at = (arr: number[] | undefined, f: number) => (arr && arr.length ? arr[Math.max(0, Math.min(arr.length - 1, Math.round(f * (arr.length - 1))))] : NaN);

/** One car: name, speed, gear and live throttle / brake / steering bars. */
function Driver(props: { name: string; color: string; speed: number; gear: number; throttle: number; brake: number; steer: number }) {
  const th = Number.isFinite(props.throttle) ? props.throttle : 0;
  const br = Number.isFinite(props.brake) ? props.brake : 0;
  const st = Number.isFinite(props.steer) ? Math.max(-1, Math.min(1, props.steer)) : 0;
  const gear = !Number.isFinite(props.gear) ? "" : props.gear < 0 ? "R" : props.gear === 0 ? "N" : String(props.gear);
  return (
    <div className="min-w-0 flex-1">
      <div className="flex items-baseline gap-2">
        <span className="h-2.5 w-2.5 shrink-0 self-center rounded-full" style={{ background: props.color }} />
        <span className="min-w-0 flex-1 truncate text-sm font-semibold">{props.name}</span>
        <span className="font-mono text-lg font-bold tabular-nums leading-none">{Number.isFinite(props.speed) ? Math.round(props.speed) : "–"}</span>
        <span className="text-[10px] text-zinc-500">km/h</span>
        <span className="w-5 rounded bg-white/10 text-center font-mono text-xs font-bold">{gear}</span>
      </div>
      <div className="mt-1.5 grid grid-cols-[3.2rem_1fr] items-center gap-x-2 gap-y-1 text-[10px] text-zinc-500">
        <span>Throttle</span>
        <div className="h-2 overflow-hidden rounded-full bg-white/[0.07]">
          <div className="h-full rounded-full bg-emerald-500" style={{ width: `${th * 100}%` }} />
        </div>
        <span>Brake</span>
        <div className="h-2 overflow-hidden rounded-full bg-white/[0.07]">
          <div className="h-full rounded-full bg-red-500" style={{ width: `${br * 100}%` }} />
        </div>
        <span>Steering</span>
        <div className="relative h-2 rounded-full bg-white/[0.07]">
          <span className="absolute inset-y-0 left-1/2 w-px bg-white/25" />
          <div
            className="absolute inset-y-0 rounded-full bg-sky-400"
            style={st >= 0 ? { left: "50%", width: `${st * 50}%` } : { right: "50%", width: `${-st * 50}%` }}
          />
        </div>
      </div>
    </div>
  );
}

export function IncidentStrip(props: { series: IncidentSeries; names: (car: number) => string; t: number; contact: number; onSeek: (t: number) => void }) {
  const s = props.series;
  const span = Math.max(s.to - s.from, 0.1);
  const f = (props.t - s.from) / span;
  const contact = (props.contact - s.from) / span;
  const drag = useRef(false);
  const seekAt = (e: PointerEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    props.onSeek(s.from + Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * span);
  };
  const two = s.cars.slice(0, 2);
  const speeds = two.flatMap((_, i) => s.speed[i]).filter(Number.isFinite);
  const top = Math.max(100, Math.ceil(Math.max(0, ...speeds) / 50) * 50);
  const gaps = s.gap.filter(Number.isFinite);
  const gapTop = Math.max(10, Math.ceil(Math.min(60, Math.max(0, ...gaps)) / 10) * 10);
  const gapNow = at(s.gap, f);
  const gapArea = (() => {
    const d = path(s.gap, 0, gapTop);
    return d ? `${d}L100,${H}L0,${H}Z` : "";
  })();
  const others = s.cars.slice(2);
  return (
    <div className="space-y-2">
      <div className="flex flex-col gap-3 sm:flex-row sm:gap-5">
        {two.map((car, i) => (
          <Driver
            key={car}
            name={props.names(car)}
            color={CAR_COLORS[i]}
            speed={at(s.speed[i], f)}
            gear={at(s.gear[i], f)}
            throttle={at(s.throttle[i], f)}
            brake={at(s.brake[i], f)}
            steer={at(s.steer[i], f)}
          />
        ))}
      </div>
      {others.length > 0 && (
        <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-zinc-400">
          <span className="text-zinc-600">Also involved:</span>
          {others.map((car, j) => {
            const sp = at(s.speed[j + 2], f);
            return (
              <span key={car} className="inline-flex items-center gap-1">
                <span className="h-2 w-2 rounded-full" style={{ background: CAR_COLORS[(j + 2) % CAR_COLORS.length] }} />
                {props.names(car)}
                <span className="font-mono text-zinc-500">{Number.isFinite(sp) ? `${Math.round(sp)}` : ""}</span>
              </span>
            );
          })}
        </div>
      )}
      <div>
        <div className="mb-0.5 flex justify-between text-[10px] text-zinc-500">
          <span>
            Speed{two.length >= 2 ? " and the gap between them" : ""} · click or drag to scrub
          </span>
          {two.length >= 2 && Number.isFinite(gapNow) && <span className="font-mono text-zinc-300">{gapNow.toFixed(1)} m apart</span>}
        </div>
        <svg
          viewBox={`0 0 100 ${H}`}
          preserveAspectRatio="none"
          className="h-11 w-full cursor-pointer touch-none rounded bg-white/[0.03]"
          onPointerDown={(e) => {
            drag.current = true;
            e.currentTarget.setPointerCapture(e.pointerId);
            seekAt(e);
          }}
          onPointerMove={(e) => drag.current && seekAt(e)}
          onPointerUp={() => (drag.current = false)}
          onPointerCancel={() => (drag.current = false)}
        >
          {two.length >= 2 && gapArea && <path d={gapArea} fill="rgba(255,255,255,0.08)" stroke="rgba(255,255,255,0.28)" strokeWidth="1" vectorEffect="non-scaling-stroke" />}
          {two.map((car, i) => (
            <path key={car} d={path(s.speed[i], 0, top)} fill="none" stroke={CAR_COLORS[i]} strokeWidth="1.6" vectorEffect="non-scaling-stroke" />
          ))}
          <line x1={contact * 100} y1="0" x2={contact * 100} y2={H} stroke="#fbbf24" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
          {f >= 0 && f <= 1 && <line x1={f * 100} y1="0" x2={f * 100} y2={H} stroke="#ffffff" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />}
        </svg>
      </div>
    </div>
  );
}
