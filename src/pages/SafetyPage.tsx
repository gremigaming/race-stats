import { ChevronDown, ChevronRight, ShieldCheck, TimerOff, TriangleAlert } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { cardClass } from "../components/Card";
import { RankLegend, RankTile } from "../components/safety/RankTile";
import { SectionHeader } from "../components/ui/SectionHeader";
import {
  tableCellClass,
  tableClassLoose,
  tableHeadClass,
  tableRowClass,
} from "../components/ui/table";
import { useTelemetry } from "../context/TelemetryContext";
import { driverKey } from "../league/league";
import {
  rankOf,
  SR_RANKS,
  SR_START,
  signedHalf,
  type SafetyDriver,
  type SafetySession,
} from "../league/safety";
import { cn } from "../utils/cn";
import { toSlug } from "../utils/parseFilename";
import { sessionPath } from "../utils/routes";

const changeClass = (n: number) =>
  n > 0 ? "text-emerald-300" : n < 0 ? "text-red-300" : "text-zinc-500";

/** "Race_Silverstone_2026_10_07_20_33_05.json" -> "Race · Silverstone" */
function sessionLabel(file: string): string {
  const base = file.replace(/_Just_in_case/, "").replace(/_\d{4}_\d{2}_\d{2}_.*$/, "");
  const quali = /Qualifying/.test(base);
  const track = base.replace(/^(One_Shot_)?Qualifying_|^Race_/, "").replace(/_/g, " ");
  return `${quali ? "Quali" : "Race"} · ${track}`;
}

export function SafetyPage() {
  const { league } = useTelemetry();
  if (!league?.safetyData) {
    return (
      <div className="flex h-full items-center justify-center text-zinc-500">
        The safety rating isn't available yet.
      </div>
    );
  }
  const rows = league.safetyData.drivers.filter((d) => !d.banned);
  const mine = league.safety.get(league.selectedDriver);

  return (
    <div className="mx-auto max-w-5xl space-y-8 p-6">
      <div>
        <h2 className="mb-1 flex items-center gap-2 text-xl font-bold">
          <ShieldCheck className="h-5 w-5 text-emerald-400" />
          Safety rating
        </h2>
        <p className="flex flex-wrap items-center gap-2 text-sm text-zinc-500">
          <span className="inline-flex items-center gap-1 rounded-full border border-zinc-700 px-2 py-0.5 text-[11px] text-zinc-400">
            <TimerOff className="h-3 w-3" />
            not filtered by date
          </span>
          Live rating over each driver's last 80 races · {rows.length} drivers
        </p>
      </div>

      {mine && !mine.banned && <DriverCard driver={mine} />}

      <section className={cardClass}>
        <SectionHeader title="Ranking" hint="Click a driver to see where their points came from" />
        <div className="overflow-x-auto">
          <table className={tableClassLoose}>
            <thead className={tableHeadClass}>
              <tr>
                <th className={tableCellClass({ align: "right" })}>#</th>
                <th className={tableCellClass()}>Rank</th>
                <th className={tableCellClass()}>Driver</th>
                <th className={tableCellClass({ align: "right" })}>SR</th>
                <th className={tableCellClass({ align: "right" })}>Last stream</th>
                <th className={tableCellClass({ align: "right" })}>Races</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((d, i) => {
                const key = driverKey(d.name);
                const isSelected = key === league.selectedDriver;
                return (
                  <tr
                    key={key}
                    onClick={() => {
                      league.setSelectedDriver(key);
                      window.scrollTo({ top: 0, behavior: "smooth" });
                    }}
                    className={cn(
                      tableRowClass,
                      "cursor-pointer transition-colors hover:bg-white/[0.03]",
                      isSelected && "bg-red-500/[0.07]",
                    )}
                  >
                    <td className={tableCellClass({ align: "right", mono: true, className: "text-zinc-500" })}>
                      {i + 1}
                    </td>
                    <td className={tableCellClass()}>
                      <RankTile sr={d.sr} />
                    </td>
                    <td
                      className={tableCellClass({
                        className: cn("font-medium", isSelected ? "text-red-300" : "text-zinc-100"),
                      })}
                    >
                      {d.name}
                      {d.provisional && (
                        <span className="ml-2 text-[11px] font-normal text-zinc-500">provisional</span>
                      )}
                    </td>
                    <td className={tableCellClass({ align: "right", mono: true, className: "font-semibold text-zinc-200" })}>
                      {d.sr.toFixed(1)}
                    </td>
                    <td className={tableCellClass({ align: "right", mono: true, className: changeClass(d.change) })}>
                      {signedHalf(d.change)}
                    </td>
                    <td className={tableCellClass({ align: "right", mono: true, className: "text-zinc-300" })}>
                      {d.races}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <RankLegend className="mt-4" />
      </section>

      <section className={cardClass}>
        <SectionHeader title="How it works" />
        <div className="space-y-2 text-sm text-zinc-400">
          <p>
            Everyone starts at {SR_START}. Causing contact that costs someone places, time or
            damage takes points off, and so do game penalties and quitting a race. Clean races,
            clean qualifying, clean overtakes and close racing add points.
          </p>
          <p>
            Your last 80 races count: the newest 20 in full, then 75%, 50% and 25%. Above{" "}
            {SR_START} you lose 10% of the part above {SR_START} every stream, so staying at the
            top takes clean driving. Losing 20 in one race or 40 in one stream means sitting out
            the rest of that stream; below 0 means no longer welcome.
          </p>
          <p className="text-xs text-zinc-500">
            Ranks: {SR_RANKS.map((r) => `${r.rank} ${r.label}`).join(" · ")}. A rating stays
            provisional until 3 races.
          </p>
        </div>
      </section>
    </div>
  );
}

function DriverCard({ driver }: { driver: SafetyDriver }) {
  const rank = rankOf(driver.sr);
  const recent = [...driver.sessions].reverse().filter((s) => s.items.length > 0);
  return (
    <section className={cardClass}>
      <SectionHeader title={driver.name} hint={`${driver.races} races`} />
      <div className="mb-4 flex flex-wrap items-center gap-x-5 gap-y-2">
        <RankTile rank={rank} size={44} />
        <span className="font-mono text-4xl font-bold tabular-nums text-zinc-100">
          {driver.sr.toFixed(1)}
        </span>
        <span className={cn("text-sm", changeClass(driver.change))}>
          {signedHalf(driver.change)} last stream
        </span>
        {driver.provisional && (
          <span className="rounded-full border border-zinc-700 px-2 py-0.5 text-xs text-zinc-400">
            provisional until 3 races
          </span>
        )}
      </div>
      {driver.flags.length > 0 && (
        <div className="mb-4 space-y-1 rounded-lg bg-amber-500/10 p-3 text-xs text-amber-300">
          {driver.flags.map((f) => (
            <p key={f} className="flex items-center gap-2">
              <TriangleAlert className="h-3.5 w-3.5 shrink-0" />
              {f}
            </p>
          ))}
        </div>
      )}
      <SrChart driver={driver} />
      <div className="mt-4 space-y-1.5">
        {recent.map((s) => (
          <SessionRow key={s.file} session={s} />
        ))}
      </div>
    </section>
  );
}

function SessionRow({ session }: { session: SafetySession }) {
  const { scopeKey } = useTelemetry();
  const [open, setOpen] = useState(false);
  const date = session.file.match(/(\d{4})_(\d{2})_(\d{2})/);
  return (
    <div className="rounded-md border border-zinc-800/80 bg-zinc-950/60">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm"
      >
        {open ? (
          <ChevronDown className="h-4 w-4 text-zinc-500" />
        ) : (
          <ChevronRight className="h-4 w-4 text-zinc-500" />
        )}
        <span className="text-zinc-200">{sessionLabel(session.file)}</span>
        {date && (
          <span className="font-mono text-xs text-zinc-500">{`${date[1]}-${date[2]}-${date[3]}`}</span>
        )}
        <span className={cn("ml-auto font-mono", changeClass(session.total))}>
          {signedHalf(session.total)}
        </span>
      </button>
      {open && (
        <div className="space-y-1 border-t border-zinc-800/80 px-3 py-2 text-xs">
          {session.items.map((it, i) => (
            <p key={i} className="flex gap-3">
              <span className={cn("w-10 shrink-0 text-right font-mono", changeClass(it.pts))}>
                {signedHalf(it.pts)}
              </span>
              <span className="text-zinc-400">
                {it.lap != null && <span className="text-zinc-300">Lap {it.lap} · </span>}
                {it.text}
              </span>
            </p>
          ))}
          <Link
            to={sessionPath(scopeKey ?? "all", toSlug(session.file))}
            className="mt-1 inline-block text-red-300 hover:text-red-200"
          >
            Open this session
          </Link>
        </div>
      )}
    </div>
  );
}

/** SR after each stream, over rank-coloured bands. */
function SrChart({ driver }: { driver: SafetyDriver }) {
  const pts = [{ sr: SR_START, date: "start" }, ...driver.history];
  if (pts.length < 2) return null;
  const W = 600;
  const H = 120;
  const lo = Math.min(0, ...pts.map((p) => p.sr));
  const y = (v: number) => H - ((v - lo) / (100 - lo)) * H;
  const x = (i: number) => (i / (pts.length - 1)) * W;
  const bands = SR_RANKS.map((r, i) => ({
    r,
    top: i === 0 ? 100 : SR_RANKS[i - 1].min,
    bottom: Math.max(lo, Number.isFinite(r.min) ? r.min : lo),
  }));
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-28 w-full" preserveAspectRatio="none">
      {bands.map((b) => (
        <rect
          key={b.r.rank}
          x={0}
          width={W}
          y={y(b.top)}
          height={Math.max(0, y(b.bottom) - y(b.top))}
          fill={`rgba(${b.r.rgb},.06)`}
        />
      ))}
      <polyline
        points={pts.map((p, i) => `${x(i)},${y(p.sr)}`).join(" ")}
        fill="none"
        stroke="#e4e4e7"
        strokeWidth={2}
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
