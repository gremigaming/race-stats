import { Video, X } from "lucide-react";
import type { ReactNode } from "react";
import type { RaceCar, RaceIncident } from "./format";
import { clock, IconButton } from "./panels";

/** "1:35.912" from milliseconds. */
export function lapTime(ms: number | null | undefined) {
  if (!ms) return "–";
  const m = Math.floor(ms / 60000);
  const s = (ms % 60000) / 1000;
  return `${m}:${s.toFixed(3).padStart(6, "0")}`;
}

/** A driver's stats in this race, up to the playhead: no lifetime totals, no spoilers. Lives in the Driver tab. */
export function DriverCard(props: {
  car: number;
  info: RaceCar | undefined;
  color: string;
  team: string;
  pos: number;
  grid: number;
  lap: number;
  laps: number;
  /** Completed laps so far: [lap, session time, ms]. */
  done: [number, number, number][];
  status: string | null;
  incidents: RaceIncident[];
  cars: Record<string, RaceCar>;
  t: number;
  start: number;
  following: boolean;
  onFollow: () => void;
  onIncident: (i: number) => void;
  onClose: () => void;
}) {
  const name = (c: number) => props.cars[String(c)]?.name ?? `Car ${c}`;
  const gained = props.grid && props.pos ? props.grid - props.pos : null;
  const last = props.done.length ? props.done[props.done.length - 1][2] : null;
  const best = props.done.length ? Math.min(...props.done.map((l) => l[2])) : null;
  const here = props.incidents
    .map((inc, i) => ({ inc, i }))
    .filter(({ inc }) => inc.t0 <= props.t && inc.drivers.some((d) => d.car === props.car))
    .reverse();
  const cell = (label: string, value: ReactNode) => (
    <div className="rounded-md bg-white/[0.04] px-1 py-1.5 text-center">
      <div className="font-mono text-base tabular-nums">{value}</div>
      <div className="text-[10px] uppercase tracking-wide text-zinc-500">{label}</div>
    </div>
  );
  return (
    <div className="p-3 text-sm">
      <div className="flex items-center gap-2">
        <span className="h-6 w-1.5 rounded-full" style={{ background: props.color }} />
        <div className="min-w-0 flex-1">
          <div className="truncate font-semibold">
            {props.info?.number ? `${props.info.number} ` : ""}
            {props.info?.name ?? `Car ${props.car}`}
          </div>
          <div className="truncate text-xs text-zinc-500">{props.team}</div>
        </div>
        <IconButton label={props.following ? "Stop following" : "Follow"} active={props.following} onClick={props.onFollow}>
          <Video className="h-4 w-4" />
        </IconButton>
        <IconButton label="Close" onClick={props.onClose}>
          <X className="h-4 w-4" />
        </IconButton>
      </div>
      <div className="mt-3 grid grid-cols-3 gap-2">
        {cell("Position", props.status ?? (props.pos ? `P${props.pos}` : "–"))}
        {cell(
          "Grid",
          props.grid ? (
            <>
              P{props.grid}{" "}
              {gained !== null && (
                <span className={`text-xs ${gained > 0 ? "text-emerald-400" : gained < 0 ? "text-red-400" : "text-zinc-500"}`}>
                  {gained > 0 ? `▲${gained}` : gained < 0 ? `▼${-gained}` : "="}
                </span>
              )}
            </>
          ) : (
            "–"
          ),
        )}
        {cell("Lap", `${Math.max(1, Math.min(props.lap, props.laps || props.lap))}/${props.laps || "–"}`)}
      </div>
      <div className="mt-2 grid grid-cols-2 gap-2">
        {cell("Last lap", lapTime(last))}
        {cell("Best lap", lapTime(best))}
      </div>
      <div className="mt-3">
        <div className="text-[10px] uppercase tracking-wide text-zinc-500">Collisions this race · {here.length}</div>
        <ul className="mt-1 space-y-0.5 text-xs">
          {here.map(({ inc, i }) => {
            const others = inc.drivers.filter((d) => d.car !== props.car && d.role === "contact").map((d) => name(d.car));
            return (
              <li key={i}>
                <button type="button" onClick={() => props.onIncident(i)} className="flex w-full gap-2 rounded px-1 py-0.5 text-left hover:bg-white/10">
                  <span className="mt-1 h-2 w-2 shrink-0 rotate-45 rounded-[1px] bg-amber-400" />
                  <span className="min-w-0 flex-1 truncate">
                    {inc.lap ? `Lap ${inc.lap} · ` : ""}
                    {clock(inc.t0 - props.start)}
                    {others.length ? ` · with ${others.join(", ")}` : ` · ${inc.drivers.find((d) => d.car === props.car)?.role ?? ""}`}
                  </span>
                </button>
              </li>
            );
          })}
          {!here.length && <li className="text-zinc-500">None so far.</li>}
        </ul>
      </div>
    </div>
  );
}
