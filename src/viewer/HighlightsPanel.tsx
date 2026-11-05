import { Play, Sparkles, Square, TriangleAlert } from "lucide-react";
import { Link } from "react-router-dom";
import type { RaceCar } from "./format";
import { HIGHLIGHT_META, reelSeconds, type Highlight } from "./highlights";
import { clock } from "./panels";

/** The viewer's Highlights tab: the race's best moments, the reel button and the way to every incident. */
export function HighlightsPanel(props: {
  highlights: Highlight[];
  cars: Record<string, RaceCar>;
  color: (car: number) => string;
  start: number;
  t: number;
  active: string | null;
  reelOn: boolean;
  onReel: () => void;
  onPick: (h: Highlight) => void;
  incidents: number;
  incidentsLink: string;
}) {
  const mins = Math.max(1, Math.round(reelSeconds(props.highlights) / 60));
  return (
    <div className="flex min-h-0 flex-col">
      <div className="border-b border-white/10 px-3 py-2">
        <div className="text-sm font-semibold">Highlights</div>
        <div className="text-[11px] text-zinc-500">The moments worth watching. Click one to jump to it.</div>
      </div>
      {props.highlights.length > 0 && (
        <div className="border-b border-white/10 p-3">
          <button
            type="button"
            onClick={props.onReel}
            className={`flex w-full items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold ${props.reelOn ? "bg-amber-400 text-black" : "bg-white/10 text-white hover:bg-white/15"}`}
          >
            {props.reelOn ? <Square className="h-4 w-4" /> : <Sparkles className="h-4 w-4 text-amber-300" />}
            {props.reelOn ? "Stop the highlights" : `Watch highlights · ~${mins} min`}
          </button>
        </div>
      )}
      <ul>
        {props.highlights.map((h) => {
          const meta = HIGHLIGHT_META[h.kind];
          const on = props.active === h.id;
          const seen = h.t <= props.t;
          return (
            <li key={h.id}>
              <button
                type="button"
                onClick={() => props.onPick(h)}
                className={`grid w-full grid-cols-[2.75rem_1fr_auto] items-center gap-2 border-b border-white/5 px-3 py-2 text-left text-xs hover:bg-white/5 ${on ? "bg-white/10" : ""}`}
                style={on ? { boxShadow: `inset 3px 0 0 ${meta.color}` } : undefined}
              >
                <span className={`font-mono tabular-nums ${seen ? "text-zinc-300" : "text-zinc-500"}`}>{clock(h.t - props.start)}</span>
                <span className="min-w-0">
                  <span className="flex items-center gap-1.5">
                    <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: meta.color }} />
                    <span className="text-[10px] font-bold uppercase tracking-wide" style={{ color: meta.color }}>
                      {meta.label}
                    </span>
                  </span>
                  <span className="mt-0.5 flex min-w-0 items-center gap-1 font-semibold">
                    {h.cars.slice(0, 2).map((c) => (
                      <span key={c} className="h-2 w-1 shrink-0 rounded-full" style={{ background: props.color(c) }} />
                    ))}
                    <span className="truncate">{h.title}</span>
                  </span>
                  <span className="block truncate text-[11px] text-zinc-500">{h.sub}</span>
                </span>
                <Play className="h-3.5 w-3.5 text-zinc-500" />
              </button>
            </li>
          );
        })}
        {!props.highlights.length && <li className="px-3 py-6 text-center text-xs text-zinc-500">No highlights yet.</li>}
      </ul>
      <Link
        to={props.incidentsLink}
        className="m-3 flex items-center gap-2 rounded-lg border border-white/10 px-3 py-2 text-xs text-zinc-300 hover:bg-white/5 hover:text-white"
      >
        <TriangleAlert className="h-4 w-4 text-amber-300" />
        <span className="flex-1">
          Every incident of this race ({props.incidents}) in the <b>incident viewer</b>
        </span>
      </Link>
    </div>
  );
}
