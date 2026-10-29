import { Video, X } from "lucide-react";
import { useMemo } from "react";
import { useTelemetry } from "../context/TelemetryContext";
import { driverKey, isRaceSession, leaderboard } from "../league/league";
import { rankOf } from "../league/safety";
import type { RaceCar, RaceIncident } from "./format";
import { clock, IconButton } from "./panels";

/** A driver's stats over the viewer: leaderboard, safety rating, recent collisions, this race. */
export function DriverCard(props: {
  car: number;
  info: RaceCar | undefined;
  color: string;
  incidents: RaceIncident[];
  start: number;
  following: boolean;
  onFollow: () => void;
  onIncident: (i: number) => void;
  onClose: () => void;
}) {
  const { league } = useTelemetry();
  const name = props.info?.name ?? `Car ${props.car}`;
  // hidden-name players (Car #N) and AI never get a profile (GreMi's rule)
  const anonymous = !props.info || props.info.ai || /^Car #\d+$/.test(name);
  const key = driverKey(name);
  const row = useMemo(() => {
    if (anonymous || !league) return null;
    const rows = leaderboard(league.allRaces.filter((r) => isRaceSession(r.session)));
    const i = rows.findIndex((r) => r.key === key);
    return i < 0 ? null : { ...rows[i], rank: i + 1 };
  }, [anonymous, league, key]);
  const safety = anonymous ? undefined : league?.safety.get(key);
  const recent = useMemo(
    () =>
      (safety?.sessions ?? [])
        .slice()
        .reverse()
        .flatMap((s) => s.items.filter((i) => i.cat === "contact").map((i) => ({ ...i, file: s.file })))
        .slice(0, 5),
    [safety],
  );
  const here = props.incidents
    .map((inc, i) => ({ inc, i }))
    .filter(({ inc }) => inc.drivers.some((d) => d.car === props.car));
  const rank = safety ? rankOf(safety.sr) : null;

  return (
    <div className="pointer-events-auto w-80 max-w-[calc(100vw-24px)] rounded-xl border border-white/10 bg-[#0c0e11]/92 p-3 text-sm shadow-2xl backdrop-blur">
      <div className="flex items-center gap-2">
        <span className="h-6 w-1.5 rounded-full" style={{ background: props.color }} />
        <div className="min-w-0 flex-1">
          <div className="truncate font-semibold">
            {props.info?.number ? `${props.info.number} ` : ""}
            {name}
          </div>
          <div className="truncate text-xs text-zinc-500">{props.info?.team_name ?? ""}</div>
        </div>
        <IconButton label={props.following ? "Stop following" : "Follow"} active={props.following} onClick={props.onFollow}>
          <Video className="h-4 w-4" />
        </IconButton>
        <IconButton label="Close" onClick={props.onClose}>
          <X className="h-4 w-4" />
        </IconButton>
      </div>
      {anonymous ? (
        <p className="mt-3 text-xs text-zinc-500">No profile: this driver hides their name online (or is an AI car).</p>
      ) : (
        <>
          <div className="mt-3 grid grid-cols-4 gap-2 text-center">
            {[
              ["Rank", row ? `#${row.rank}` : "–"],
              ["Points", row ? String(row.points) : "–"],
              ["Races", row ? String(row.races) : "–"],
              ["Wins", row ? String(row.wins) : "–"],
              ["Podiums", row ? String(row.podiums) : "–"],
              ["Avg finish", row?.avgFinish != null ? row.avgFinish.toFixed(1) : "–"],
              ["Best", row?.bestFinish != null ? `P${row.bestFinish}` : "–"],
              ["DNFs", row ? String(row.dnfs) : "–"],
            ].map(([label, value]) => (
              <div key={label} className="rounded-md bg-white/[0.04] px-1 py-1.5">
                <div className="font-mono text-base tabular-nums">{value}</div>
                <div className="text-[10px] uppercase tracking-wide text-zinc-500">{label}</div>
              </div>
            ))}
          </div>
          <div className="mt-3 flex items-center gap-3 rounded-md bg-white/[0.04] px-3 py-2">
            <span className="text-[10px] uppercase tracking-wide text-zinc-500">Safety rating</span>
            {safety && rank ? (
              <>
                <span className="font-mono text-lg font-bold" style={{ color: rank.color }}>
                  {rank.rank}
                </span>
                <span className="font-mono tabular-nums">{safety.sr.toFixed(1)}</span>
                <span className={`font-mono text-xs ${safety.change >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                  {safety.change >= 0 ? "+" : ""}
                  {safety.change.toFixed(1)}
                </span>
              </>
            ) : (
              <span className="text-zinc-500">–</span>
            )}
          </div>
          <div className="mt-3">
            <div className="text-[10px] uppercase tracking-wide text-zinc-500">Recent collisions</div>
            <ul className="mt-1 space-y-1 text-xs">
              {recent.map((r, i) => (
                <li key={i} className="flex gap-2">
                  <span className={`w-9 shrink-0 font-mono ${r.pts < 0 ? "text-red-400" : "text-zinc-500"}`}>{r.pts > 0 ? `+${r.pts}` : r.pts}</span>
                  <span className="text-zinc-300">{r.text}</span>
                </li>
              ))}
              {!recent.length && <li className="text-zinc-500">None recorded.</li>}
            </ul>
          </div>
        </>
      )}
      <div className="mt-3">
        <div className="text-[10px] uppercase tracking-wide text-zinc-500">In this race</div>
        <ul className="mt-1 space-y-0.5 text-xs">
          {here.map(({ inc, i }) => (
            <li key={i}>
              <button type="button" onClick={() => props.onIncident(i)} className="flex w-full gap-2 rounded px-1 py-0.5 text-left hover:bg-white/10">
                <span className="mt-1 h-2 w-2 shrink-0 rotate-45 rounded-[1px] bg-amber-400" />
                <span>
                  {inc.lap ? `Lap ${inc.lap} · ` : ""}
                  {clock(inc.t0 - props.start)} · {inc.drivers.find((d) => d.car === props.car)?.role}
                </span>
              </button>
            </li>
          ))}
          {!here.length && <li className="text-zinc-500">No incidents.</li>}
        </ul>
      </div>
    </div>
  );
}
