/**
 * The viewer's right-hand column: vertical tabs (Incidents, Driver, Safety, Race stats, Points)
 * that fold away completely for a clean spectator view. On phones the same column sits under
 * the map, with the tabs in a row along its top.
 */
import { BarChart3, ChevronRight, ShieldCheck, Trophy, TriangleAlert, User } from "lucide-react";
import type { ReactNode } from "react";
import { rankOf } from "../league/safety";
import type { Livery } from "./cars";
import { lapTime } from "./DriverCard";
import { TeamBadge } from "./tower";

export type SideTab = "incidents" | "driver" | "safety" | "stats" | "points";

const TABS: { key: SideTab; label: string; icon: typeof User }[] = [
  { key: "incidents", label: "Incidents", icon: TriangleAlert },
  { key: "driver", label: "Driver", icon: User },
  { key: "safety", label: "Safety", icon: ShieldCheck },
  { key: "stats", label: "Race stats", icon: BarChart3 },
  { key: "points", label: "Points", icon: Trophy },
];

export function Sidebar(props: { tab: SideTab; onTab: (t: SideTab) => void; onCollapse: () => void; badge?: Partial<Record<SideTab, number>>; children: ReactNode }) {
  return (
    <aside className="flex h-[45vh] w-full shrink-0 flex-col border-t border-white/10 bg-[#0c0e11] md:h-auto md:w-[22rem] md:flex-row md:border-l md:border-t-0">
      <nav aria-label="Panels" className="flex shrink-0 border-b border-white/10 md:w-14 md:flex-col md:border-b-0 md:border-r">
        {TABS.map(({ key, label, icon: Icon }) => {
          const on = props.tab === key;
          const n = props.badge?.[key];
          return (
            <button
              key={key}
              type="button"
              title={label}
              aria-pressed={on}
              onClick={() => props.onTab(key)}
              className={`relative flex flex-1 flex-col items-center justify-center gap-0.5 py-1.5 text-[9px] font-semibold md:flex-none md:py-2.5 ${on ? "text-white" : "text-zinc-500 hover:text-zinc-200"}`}
            >
              {on && <span className="absolute inset-x-2 bottom-0 h-0.5 rounded-full bg-red-500 md:inset-x-auto md:inset-y-2 md:bottom-auto md:left-0 md:h-auto md:w-0.5" />}
              <Icon className="h-4 w-4" />
              <span className="truncate">{label}</span>
              {!!n && <span className="absolute right-1.5 top-1 rounded-full bg-amber-400/90 px-1 text-[8px] font-bold leading-[12px] text-black md:right-1">{n}</span>}
            </button>
          );
        })}
        <button
          type="button"
          title="Hide this column (H hides everything)"
          aria-label="Hide this column"
          onClick={props.onCollapse}
          className="flex w-10 shrink-0 items-center justify-center text-zinc-500 hover:text-white md:mt-auto md:w-auto md:py-3"
        >
          <ChevronRight className="h-4 w-4 rotate-90 md:rotate-0" />
        </button>
      </nav>
      <div className="min-h-0 min-w-0 flex-1 overflow-y-auto">{props.children}</div>
    </aside>
  );
}

function Head({ title, sub }: { title: string; sub?: string }) {
  return (
    <div className="border-b border-white/10 px-3 py-2">
      <div className="text-sm font-semibold">{title}</div>
      {sub && <div className="text-[11px] text-zinc-500">{sub}</div>}
    </div>
  );
}

export function Empty({ title, text }: { title: string; text: string }) {
  return (
    <>
      <Head title={title} />
      <p className="px-3 py-4 text-xs text-zinc-500">{text}</p>
    </>
  );
}

export interface SafetyRow {
  car: number;
  name: string;
  livery: Livery;
  /** Safety points from this race so far (null: no league record of this race). */
  pts: number | null;
  /** Their safety rating now (null: no rating). */
  sr: number | null;
}

export function SafetyPanel({ rows, matched, onPick }: { rows: SafetyRow[]; matched: boolean; onPick: (car: number) => void }) {
  const sorted = [...rows].sort((a, b) => (a.pts ?? 0) - (b.pts ?? 0) || (b.sr ?? 0) - (a.sr ?? 0));
  return (
    <>
      <Head title="Safety" sub={matched ? "Safety points this race so far, and each driver's rating now" : "No safety points for this race yet; ratings are today's"} />
      <ul>
        {sorted.map((r) => {
          const rank = r.sr === null ? null : rankOf(r.sr);
          return (
            <li key={r.car}>
              <button type="button" onClick={() => onPick(r.car)} className="flex w-full items-center gap-2 border-b border-white/5 px-3 py-1.5 text-left text-xs hover:bg-white/5">
                <TeamBadge livery={r.livery} size={12} />
                <span className="min-w-0 flex-1 truncate font-medium">{r.name}</span>
                {matched && (
                  <span className={`w-10 text-right font-mono tabular-nums ${r.pts === null ? "text-zinc-600" : r.pts < 0 ? "text-red-300" : r.pts > 0 ? "text-emerald-300" : "text-zinc-400"}`}>
                    {r.pts === null ? "–" : r.pts > 0 ? `+${r.pts.toFixed(1)}` : r.pts.toFixed(1)}
                  </span>
                )}
                <span className="flex w-16 items-center justify-end gap-1">
                  {rank ? (
                    <>
                      <span className="font-mono tabular-nums text-zinc-200">{r.sr!.toFixed(1)}</span>
                      <span className="w-5 rounded-sm text-center text-[9px] font-bold" style={{ color: rank.color, background: `rgba(${rank.rgb},0.15)` }}>
                        {rank.rank}
                      </span>
                    </>
                  ) : (
                    <span className="text-zinc-600">no SR</span>
                  )}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      <p className="px-3 py-2 text-[10px] text-zinc-600">Points show up as the race reaches them. The finish bonus comes in at the flag.</p>
    </>
  );
}

export interface StatsRow {
  car: number;
  name: string;
  livery: Livery;
  grid: number;
  pos: number;
  out: string | null;
  overtakes: number;
  /** null: this race's data has no pit stops. */
  pits: number | null;
  incidents: number;
  best: number | null;
}

export function StatsPanel(props: { rows: StatsRow[]; incidents: number; fastest: { car: number; name: string; ms: number; lap: number } | null; onPick: (car: number) => void }) {
  const { rows } = props;
  const moved = rows.filter((r) => r.grid && r.pos && !r.out).map((r) => ({ r, d: r.grid - r.pos }));
  const up = moved.reduce<(typeof moved)[number] | null>((a, b) => (!a || b.d > a.d ? b : a), null);
  const down = moved.reduce<(typeof moved)[number] | null>((a, b) => (!a || b.d < a.d ? b : a), null);
  const total = (f: (r: StatsRow) => number | null) => rows.reduce((n, r) => n + (f(r) ?? 0), 0);
  const hasPits = rows.some((r) => r.pits !== null);
  const tile = (label: string, value: ReactNode, sub?: ReactNode) => (
    <div className="rounded-md bg-white/[0.04] px-2 py-1.5">
      <div className="text-[10px] uppercase tracking-wide text-zinc-500">{label}</div>
      <div className="font-mono text-sm tabular-nums">{value}</div>
      {sub && <div className="truncate text-[11px] text-zinc-400">{sub}</div>}
    </div>
  );
  return (
    <>
      <Head title="Race stats" sub="So far, up to this moment" />
      <div className="grid grid-cols-2 gap-2 p-3">
        {tile("Fastest lap", props.fastest ? lapTime(props.fastest.ms) : "–", props.fastest ? `${props.fastest.name} · lap ${props.fastest.lap}` : undefined)}
        {tile("Overtakes", total((r) => r.overtakes))}
        {tile("Most places gained", up && up.d > 0 ? `+${up.d}` : "–", up && up.d > 0 ? up.r.name : undefined)}
        {tile("Most places lost", down && down.d < 0 ? `${down.d}` : "–", down && down.d < 0 ? down.r.name : undefined)}
        {hasPits && tile("Pit stops", total((r) => r.pits))}
        {tile("Incidents", props.incidents)}
      </div>
      <table className="w-full text-xs">
        <thead className="text-[10px] uppercase tracking-wide text-zinc-500">
          <tr className="border-b border-white/10">
            <th className="py-1 pl-3 text-left font-medium">Driver</th>
            <th className="font-medium" title="Places gained or lost since the start">+/−</th>
            <th className="font-medium" title="Overtakes">Ovt</th>
            {hasPits && <th className="font-medium">Pit</th>}
            <th className="font-medium" title="Incidents involved in">Inc</th>
            <th className="pr-3 text-right font-medium">Best</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const d = r.grid && r.pos ? r.grid - r.pos : 0;
            return (
              <tr key={r.car} onClick={() => props.onPick(r.car)} className={`cursor-pointer border-b border-white/5 hover:bg-white/5 ${r.out ? "opacity-45" : ""}`}>
                <td className="max-w-0 py-1 pl-3">
                  <span className="flex items-center gap-1.5">
                    <span className="w-5 shrink-0 font-mono text-zinc-500">{r.out ?? (r.pos ? `P${r.pos}` : "–")}</span>
                    <span className="truncate">{r.name}</span>
                  </span>
                </td>
                <td className={`text-center font-mono tabular-nums ${d > 0 ? "text-emerald-400" : d < 0 ? "text-red-400" : "text-zinc-500"}`}>{d > 0 ? `+${d}` : d < 0 ? d : "="}</td>
                <td className="text-center font-mono tabular-nums">{r.overtakes}</td>
                {hasPits && <td className="text-center font-mono tabular-nums">{r.pits ?? "–"}</td>}
                <td className={`text-center font-mono tabular-nums ${r.incidents ? "text-amber-300" : "text-zinc-500"}`}>{r.incidents}</td>
                <td className={`pr-3 text-right font-mono tabular-nums ${props.fastest?.car === r.car ? "text-purple-300" : "text-zinc-400"}`}>{lapTime(r.best)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </>
  );
}

export interface PointsRow {
  car: number;
  pos: number;
  name: string;
  livery: Livery;
  pts: number;
  out: string | null;
}

export function PointsPanel({ rows, onPick }: { rows: PointsRow[]; onPick: (car: number) => void }) {
  return (
    <>
      <Head title="Points" sub="What everyone scores if the race ended now" />
      <ul>
        {rows.map((r) => (
          <li key={r.car}>
            <button type="button" onClick={() => onPick(r.car)} className={`flex w-full items-center gap-2 border-b border-white/5 px-3 py-1.5 text-left text-xs hover:bg-white/5 ${r.out ? "opacity-45" : ""}`}>
              <span className="w-6 font-mono text-zinc-500">{r.out ?? (r.pos ? `P${r.pos}` : "–")}</span>
              <TeamBadge livery={r.livery} size={12} />
              <span className="min-w-0 flex-1 truncate font-medium">{r.name}</span>
              <span className={`font-mono tabular-nums ${r.pts ? "font-semibold text-zinc-100" : "text-zinc-600"}`}>{r.pts}</span>
            </button>
          </li>
        ))}
      </ul>
    </>
  );
}
