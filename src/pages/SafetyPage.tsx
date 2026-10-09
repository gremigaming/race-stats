import { ChevronRight, ListOrdered, ShieldCheck, TimerOff, UserRound } from "lucide-react";
import { useEffect, useRef, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import { cardClass } from "../components/Card";
import { RankLegend, RankTile } from "../components/safety/RankTile";
import { changeClass, SafetyPersonal } from "../components/safety/SafetyPersonal";
import { SectionHeader } from "../components/ui/SectionHeader";
import { SegmentedControl } from "../components/ui/SegmentedControl";
import {
  tableCellClass,
  tableClassLoose,
  tableHeadClass,
  tableRowClass,
} from "../components/ui/table";
import { useTelemetry } from "../context/TelemetryContext";
import { driverKey } from "../league/league";
import { SR_START, signedHalf } from "../league/safety";
import { cn } from "../utils/cn";

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

type Tab = "ranking" | "personal";

export function SafetyPage() {
  const { league } = useTelemetry();
  const [params, setParams] = useSearchParams();
  const highlightRef = useRef<HTMLTableRowElement>(null);
  const tab: Tab = params.get("tab") === "personal" ? "personal" : "ranking";

  useEffect(() => {
    if (tab === "ranking") highlightRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [tab]);

  if (!league?.safetyData) {
    return (
      <div className="flex h-full items-center justify-center text-zinc-500">
        The safety rating isn't available yet.
      </div>
    );
  }
  const rows = league.safetyData.drivers.filter((d) => !d.banned);
  const personalKey = params.get("driver") ?? league.selectedDriver;
  const personalIdx = rows.findIndex((d) => driverKey(d.name) === personalKey);
  const personal = personalIdx >= 0 ? rows[personalIdx] : undefined;
  const openPersonal = (key: string) => {
    setParams({ tab: "personal", driver: key });
    window.scrollTo({ top: 0 });
  };

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
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
        <SegmentedControl
          value={tab}
          onChange={(t) =>
            setParams(t === "ranking" ? {} : { tab: "personal", driver: personalKey })
          }
          ariaLabel="Safety rating view"
          options={[
            { value: "ranking", label: "Ranking", icon: ListOrdered },
            { value: "personal", label: "Personal", icon: UserRound },
          ]}
        />
      </div>

      {tab === "personal" ? (
        <>
          <label className="flex items-center gap-2 text-xs text-zinc-500">
            Driver
            <select
              value={personal ? personalKey : ""}
              onChange={(e) => openPersonal(e.target.value)}
              className="h-8 rounded-lg bg-zinc-900/70 px-2 text-sm text-zinc-200 focus:outline-none focus:ring-1 focus:ring-zinc-600"
            >
              {!personal && <option value="">Pick a driver</option>}
              {[...rows]
                .sort((a, b) => a.name.localeCompare(b.name))
                .map((d) => (
                  <option key={d.name} value={driverKey(d.name)}>
                    {d.name}
                  </option>
                ))}
            </select>
          </label>
          {personal ? (
            <SafetyPersonal
              driver={personal}
              data={league.safetyData}
              position={personalIdx + 1}
              of={rows.length}
            />
          ) : (
            <p className={cn(cardClass, "text-sm text-zinc-500")}>
              This driver has no safety rating yet. Pick a driver above, or open the ranking.
            </p>
          )}
        </>
      ) : (
        <section className={cardClass}>
          <SectionHeader title="Ranking" hint="Click a driver to open their personal page" />
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
                  const isMe = key === league.selectedDriver;
                  return (
                    <tr
                      key={key}
                      ref={isMe ? highlightRef : undefined}
                      onClick={() => openPersonal(key)}
                      className={cn(
                        tableRowClass,
                        "cursor-pointer transition-colors hover:bg-white/[0.03]",
                        isMe && "bg-red-500/[0.09] shadow-[inset_3px_0_0_#f87171]",
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
                          className: cn("font-medium", isMe ? "text-red-300" : "text-zinc-100"),
                        })}
                      >
                        {d.name}
                        {isMe && (
                          <span className="ml-2 rounded-full bg-red-500/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-red-300">
                            you
                          </span>
                        )}
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
      )}

      <section className={cardClass}>
        <SectionHeader title="How it works" />
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
