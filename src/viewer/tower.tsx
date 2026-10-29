/**
 * The running order, top left, like the game's timing tower: team logo, interval updated at the
 * 24 timing points, a chequered flag once a driver has finished (then the gap to the winner) and
 * DNF / DSQ badges with those drivers greyed out at the bottom. Rows shrink to fit the screen
 * height, so the list never scrolls.
 */
import { ChevronDown, ChevronRight, Video } from "lucide-react";
import { useEffect, useState } from "react";
import { inkOn, type Livery } from "./cars";

export interface TowerRow {
  car: number;
  pos: number;
  name: string;
  livery: Livery;
  /** "+0.8", "+1 LAP", "Leader" ... */
  gap: string;
  finished: boolean;
  /** "DNF", "DSQ" or "NC": shown instead of the gap, row greyed out. */
  out: string | null;
  off: boolean;
}

/** The team's logo when we have one, else its code in team colours. */
export function TeamBadge({ livery, size }: { livery: Livery; size: number }) {
  const [broken, setBroken] = useState(false);
  if (livery.logo && !broken)
    return (
      <img
        src={`${import.meta.env.BASE_URL}${livery.logo}`}
        alt={livery.code ?? ""}
        onError={() => setBroken(true)}
        className="shrink-0 object-contain"
        style={{ width: size * 1.4, height: size }}
      />
    );
  return (
    <span
      className="flex shrink-0 items-center justify-center rounded-[3px] font-bold leading-none tracking-tight"
      style={{ width: size * 1.4, height: size, background: livery.base, color: inkOn(livery.base), fontSize: Math.max(7, size * 0.5), boxShadow: `inset 0 -2px 0 ${livery.accent}` }}
    >
      {livery.code ?? ""}
    </span>
  );
}

/** A chequered flag, drawn small. */
function Chequered({ size }: { size: number }) {
  const n = 4;
  const c = size / n;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="shrink-0 rounded-[2px]" aria-label="Finished">
      {Array.from({ length: n * n }, (_, i) => (
        <rect key={i} x={(i % n) * c} y={Math.floor(i / n) * c} width={c} height={c} fill={(i + Math.floor(i / n)) % 2 ? "#0c0e11" : "#f4f4f5"} />
      ))}
    </svg>
  );
}

function useViewportHeight() {
  const [h, setH] = useState(() => window.innerHeight);
  useEffect(() => {
    const on = () => setH(window.innerHeight);
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, []);
  return h;
}

export function TimingTower(props: {
  rows: TowerRow[];
  lap: number;
  laps: number;
  /** Screen height the tower may not use (title row above, player bar below). */
  reserved: number;
  selected: number[];
  followed: number[];
  open: boolean;
  onToggle: () => void;
  onPick: (car: number, add: boolean) => void;
}) {
  const vh = useViewportHeight();
  const n = Math.max(props.rows.length, 1);
  const row = Math.max(12, Math.min(24, Math.floor((vh - props.reserved - 30) / n)));
  const font = Math.max(9, Math.min(12, Math.round(row * 0.5)));
  return (
    <div className="pointer-events-auto w-60 overflow-hidden rounded-lg border border-white/10 bg-[#0c0e11]/88 shadow-xl backdrop-blur" style={{ fontSize: font }}>
      <button type="button" onClick={props.onToggle} className="flex w-full items-center gap-1 bg-white/5 px-2 py-1.5 text-xs font-semibold uppercase tracking-wide text-zinc-300">
        {props.open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        Lap {Math.max(1, Math.min(props.lap, props.laps || props.lap))}
        {props.laps ? ` / ${props.laps}` : ""}
        <span className="ml-auto font-normal normal-case text-zinc-500">Interval</span>
      </button>
      {props.open && (
        <ul aria-label="Running order">
          {props.rows.map((r) => {
            const on = props.selected.includes(r.car);
            return (
              <li key={r.car}>
                <button
                  type="button"
                  onClick={(e) => props.onPick(r.car, e.shiftKey || e.ctrlKey || e.metaKey)}
                  className={`flex w-full items-center gap-1.5 pr-2 text-left hover:bg-white/10 ${on ? "bg-white/10" : ""} ${r.out ? "opacity-45" : ""}`}
                  style={{ height: row }}
                >
                  <span className="flex shrink-0 items-center justify-center self-stretch bg-white/90 font-mono font-bold text-black" style={{ width: row + 2 }}>
                    {r.out ? "–" : r.pos || "–"}
                  </span>
                  <TeamBadge livery={r.livery} size={Math.max(9, row - 8)} />
                  <span className="min-w-0 flex-1 truncate font-semibold uppercase tracking-wide">{r.name}</span>
                  {props.followed.includes(r.car) && <Video className="h-3 w-3 shrink-0 text-zinc-400" />}
                  {r.off && !r.out && <span className="text-[9px] font-bold text-orange-300">OFF</span>}
                  {r.finished && <Chequered size={Math.max(9, row - 10)} />}
                  {r.out ? (
                    <span className="w-12 shrink-0 rounded-sm bg-red-500/20 text-center font-bold text-red-300">{r.out}</span>
                  ) : (
                    <span className="w-12 shrink-0 text-right font-mono tabular-nums text-zinc-400">{r.gap}</span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
