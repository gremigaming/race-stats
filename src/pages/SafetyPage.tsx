import { ChevronDown, ChevronRight, ShieldCheck, TimerOff, TriangleAlert } from "lucide-react";
import { useState, type ReactNode } from "react";
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

const li = (items: string[]) => (
  <ul className="list-disc space-y-1 pl-5">
    {items.map((t) => (
      <li key={t}>{t}</li>
    ))}
  </ul>
);

const HOW_IT_WORKS: { title: string; body: ReactNode }[] = [
  {
    title: "What is the safety rating?",
    body: (
      <>
        <p>
          Every driver gets a safety rating (SR) from 0 to 100, and everyone starts at {SR_START}.
          It's worked out automatically from the race data after every stream, in races and
          qualifying. Drivers who hide their name don't get a rating.
        </p>
        <p>
          A rating is provisional until you've done 3 races. The rating is never filtered by
          date: it always shows where you stand right now.
        </p>
      </>
    ),
  },
  {
    title: "How you lose SR",
    body: li([
      "Causing contact. Light touches cost nothing on their own; medium and heavy hits do, and more when the other driver loses places, time or gets damage. One incident costs at most 25.",
      "Shared contact that harms someone costs a bit as well. Small touches where nobody loses anything are free, unless the game blames you.",
      "Hitting a car that was already damaged costs half, and contacts with a driver in their first 3 races don't count against you, unless the game blames you.",
      "Track-limit time penalties (1, extreme cuts 2), drive-throughs (4), stop-go's (6) and disqualifications (10). Warnings and invalid qualifying laps cost nothing.",
      "Quitting a race (1). Retiring because someone else wrecked you, or after you already finished, doesn't count.",
      "On the wrong tyres for the weather, game penalties that don't involve anyone else are free, but contacts still count.",
    ]),
  },
  {
    title: "How you gain SR",
    body: li([
      "A clean race: +2 with no warnings at all, +1 with 0 penalty points.",
      "A clean qualifying lap within 107% of pole: +0.5.",
      "Clean overtakes: +0.5 for every 3 passes in a row on different cars without contact, up to +1.5 per race.",
      "Close racing: +0.2 for every sector you start and end within half a second of another car without an incident.",
      "Your first race of a stream: +1, and +1 more if you share your full telemetry, because that lets us judge incidents better.",
    ]),
  },
  {
    title: "Older races and staying on top",
    body: li([
      "Only your last 80 races count: the newest 20 in full, then 75%, 50% and 25%.",
      `Above ${SR_START}, you lose 10% of the part above ${SR_START} after every stream, so 100 drops to 95 and 60 to 59. To stay at the top you have to keep driving clean.`,
      `Below ${SR_START}, nothing changes while you're away, so you can't wait out your penalties.`,
    ]),
  },
  {
    title: "Ranks",
    body: (
      <>
        <RankLegend />
        <p className="text-xs text-zinc-500">S+ is only for a perfect 100.</p>
      </>
    ),
  },
  {
    title: "Kicks and bans",
    body: li([
      "Lose 20 SR in one race or 40 SR in one stream and you sit out the rest of that stream.",
      "Drop below 0 and you're no longer welcome in the lobby.",
      "Staff check flagged incidents. If you think a penalty was wrong, let us know.",
    ]),
  },
];

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
        <SectionHeader title="How it works" hint="Tap a topic to open it" />
        <div className="space-y-1.5">
          {HOW_IT_WORKS.map((topic) => (
            <details
              key={topic.title}
              className="group rounded-md border border-zinc-800/80 bg-zinc-950/60"
            >
              <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-sm text-zinc-200 [&::-webkit-details-marker]:hidden">
                <ChevronRight className="h-4 w-4 text-zinc-500 transition-transform group-open:rotate-90" />
                {topic.title}
              </summary>
              <div className="space-y-1.5 border-t border-zinc-800/80 px-3 py-2.5 text-sm text-zinc-400">
                {topic.body}
              </div>
            </details>
          ))}
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
