import type { ReactNode } from "react";
import { CAR_COLORS, type IncidentSeries } from "./IncidentMap";

/**
 * Inputs side by side through an incident (GreMi, 5 Nov 2026): speed of every car, the distance
 * between the first two, and each driver's throttle, brake and steering, all on one time axis with
 * the playhead and the first contact. Click anywhere to jump there.
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

function Chart(props: { label: string; right?: string; at: number; contact: number; onSeek: (f: number) => void; children: ReactNode; tall?: boolean }) {
  return (
    <div>
      <div className="mb-0.5 flex justify-between text-[10px] text-zinc-500">
        <span>{props.label}</span>
        {props.right && <span>{props.right}</span>}
      </div>
      <svg
        viewBox={`0 0 100 ${H}`}
        preserveAspectRatio="none"
        className={`${props.tall ? "h-20" : "h-10"} w-full cursor-pointer rounded bg-white/[0.03]`}
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          props.onSeek(Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)));
        }}
      >
        <line x1="0" y1={H / 2} x2="100" y2={H / 2} stroke="rgba(255,255,255,0.06)" strokeWidth="0.4" vectorEffect="non-scaling-stroke" />
        {props.children}
        <line x1={props.contact * 100} y1="0" x2={props.contact * 100} y2={H} stroke="#fbbf24" strokeWidth="1" vectorEffect="non-scaling-stroke" />
        {props.at >= 0 && props.at <= 1 && <line x1={props.at * 100} y1="0" x2={props.at * 100} y2={H} stroke="#ffffff" strokeWidth="1.2" vectorEffect="non-scaling-stroke" />}
      </svg>
    </div>
  );
}

const line = (d: string, color: string, w = 1.6, dash?: string) => <path d={d} fill="none" stroke={color} strokeWidth={w} strokeDasharray={dash} vectorEffect="non-scaling-stroke" />;

export function IncidentCharts(props: { series: IncidentSeries; names: (car: number) => string; t: number; contact: number; onSeek: (t: number) => void }) {
  const s = props.series;
  const span = Math.max(s.to - s.from, 0.1);
  const at = (props.t - s.from) / span;
  const contact = (props.contact - s.from) / span;
  const seek = (f: number) => props.onSeek(s.from + f * span);
  const speeds = s.speed.flat().filter(Number.isFinite);
  const top = Math.max(100, Math.ceil(Math.max(0, ...speeds) / 50) * 50);
  const gaps = s.gap.filter(Number.isFinite);
  const gapTop = Math.max(10, Math.ceil(Math.min(60, Math.max(0, ...gaps)) / 10) * 10);
  const k = Math.max(0, Math.min(s.gap.length - 1, Math.round(at * (s.gap.length - 1))));
  const now = (arr: number[]) => arr[Math.max(0, Math.min(arr.length - 1, Math.round(at * (arr.length - 1))))];
  return (
    <div className="space-y-3">
      <Chart label="Speed (km/h)" right={`${top}`} at={at} contact={contact} onSeek={seek} tall>
        {s.cars.map((car, i) => (
          <g key={car}>{line(path(s.speed[i], 0, top), CAR_COLORS[i % CAR_COLORS.length])}</g>
        ))}
      </Chart>
      {s.cars.length >= 2 && (
        <Chart
          label={`Distance between ${props.names(s.cars[0])} and ${props.names(s.cars[1])}`}
          right={Number.isFinite(s.gap[k]) ? `${s.gap[k].toFixed(1)} m now` : undefined}
          at={at}
          contact={contact}
          onSeek={seek}
        >
          {line(path(s.gap, 0, gapTop), "#e4e4e7", 1.4)}
        </Chart>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        {s.cars.map((car, i) => {
          const col = CAR_COLORS[i % CAR_COLORS.length];
          const sp = now(s.speed[i]);
          return (
            <div key={car} className="rounded-lg border border-white/10 bg-black/20 p-2">
              <div className="mb-1 flex items-center gap-2 text-xs font-semibold">
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: col }} />
                <span className="min-w-0 flex-1 truncate">{props.names(car)}</span>
                <span className="font-mono text-zinc-400">{Number.isFinite(sp) ? `${Math.round(sp)} km/h` : ""}</span>
              </div>
              <Chart label="Throttle / brake" at={at} contact={contact} onSeek={seek}>
                {line(path(s.throttle[i], 0, 1), "#22c55e", 1.4)}
                {line(path(s.brake[i], 0, 1), "#ef4444", 1.4)}
              </Chart>
              <div className="mt-1.5" />
              <Chart label="Steering" at={at} contact={contact} onSeek={seek}>
                {line(path(s.steer[i], -1, 1), "#38bdf8", 1.4)}
              </Chart>
            </div>
          );
        })}
      </div>
      <p className="text-[10px] text-zinc-600">
        The amber line is the first contact, the white line is now. <span className="text-emerald-400">Throttle</span>, <span className="text-red-400">brake</span>,{" "}
        <span className="text-sky-400">steering</span> (the middle line is straight ahead). Click a chart to jump there.
      </p>
    </div>
  );
}
