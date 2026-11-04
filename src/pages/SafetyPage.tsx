import { ChevronRight, ListOrdered, ShieldCheck, TimerOff, UserRound } from "lucide-react";
import { useEffect, useRef, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import { cardClass } from "../components/Card";
import { RankLegend, RankTile } from "../components/safety/RankTile";
import { changeClass, SafetyPersonal } from "../components/safety/SafetyPersonal";
import { SafetyHighlights } from "../components/league/SafetyHighlights";
import { SectionHeader } from "../components/ui/SectionHeader";
import { SortHeader, sortRows, useSort } from "../components/ui/SortHeader";
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
          It's worked out automatically from the race data after every stream, from races since
          19 October. Drivers who hide their name don't get a rating.
        </p>
        <p>
          Your rating shows from your first race. It's marked provisional until you've done 3 races.
        </p>
      </>
    ),
  },
  {
    title: "How you lose points",
    body: li([
      "Every contact is judged from our own telemetry: who moved across, who ran into the back, who rejoined unsafely. The game's own collision penalties are not used.",
      "Contact you caused, by severity (1-10): 1-3 costs 1, 4-5 costs 3, 6-7 costs 6, 8-10 costs 10. Hitting the same car again on purpose costs 20. Not to blame costs nothing.",
      "Track-limit time penalties and crossing the pit exit line: 1.",
      "Quitting a race: 1. Retiring because someone else wrecked you, or after you already finished, doesn't count.",
      "Contacts with AI cars don't count. Staff can change or add a penalty.",
    ]),
  },
  {
    title: "How you gain points",
    body: li([
      "Finishing a race: +0.5, or +1 when there was no qualifying for that race.",
      "Every clean lap: +0.3. A perfect race, every lap clean and no warnings at all: +1 extra.",
      "A clean qualifying lap within 107% of pole: +0.5.",
      "Clean overtakes and close racing without contact.",
      "Your first race of a stream: +1, and +1 more if you share your full telemetry.",
      "At most +4 counts per race, so pace can never make up for a bad safety record.",
    ]),
  },
  {
    title: "From points to SR",
    body: (
      <>
        <p>
          Every race gets a net score: your bonus (max 4) minus half your incident points, minus your track-limit, pit exit and retirement points in full. Your SR is{" "}
          {SR_START} + 25 × your average net score, at most 100, minus your sting, never below 0.
        </p>
        {li([
          "Instant sting: the other half of your incident points comes straight off your SR, shown in red on that race's card. So a 6-point contact costs 3 in that race's net score and 3 SR directly. Track limits, pit exit and retirements have no sting.",
          "History: your last 50 races count. Every 10 races you drive after a race, it counts 20% less, sting included. Only races you drive age your history, so sitting out doesn't wash anything away.",
          "New drivers start with 3 neutral races (net 0) in their history, so a few clean races can't jump you straight to S.",
          "Above 50, every stream you skip moves your SR 10% back towards 50.",
        ])}
      </>
    ),
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
      "Lose 40 points in one race or 80 in one stream and you sit out the rest of that stream.",
      "Drop to 0 and you're no longer welcome in the lobby.",
      "Staff check flagged incidents. If you think a penalty was wrong, let us know.",
    ]),
  },
];

// SR v2.5 (GreMi, 4 Nov 2026): these replace the matching v2.2 topics when safety.json says rules "v2.5"
const HOW_IT_WORKS_V25: Record<string, ReactNode> = {
  "How you lose points": li([
    "Every contact is judged from our own telemetry: who moved across, who ran into the back, who rejoined unsafely. The game's own collision penalties are not used.",
    "Contact you caused, by severity (1-10): 1-3 costs 0.75, 4-5 costs 2.25, 6-7 costs 4.5, 8-10 costs 7.5. Hitting the same car again on purpose costs 15. Shared blame costs half. Not to blame costs nothing.",
    "Track-limit time penalties and crossing the pit exit line: 1.5.",
    "Quitting a race: 1.5. Retiring because someone else wrecked you, or after you already finished, doesn't count.",
    "The higher your SR, the more a penalty costs: x1.2 from SR 60, x1.4 from 70, x1.6 from 80, x1.8 from 90, x2 at 100.",
    "Dirty race: 1 big incident (severity 6+), 2 medium (4-5) or 3 small (1-3). Penalties after that point count x1.5. If your previous race was dirty too, every penalty already counts x1.5 and after the trigger x2, and so on. A clean race resets the streak.",
    "Contacts with AI cars don't count. Staff can change or add a penalty.",
  ]),
  "How you gain points": li([
    "Finishing a race: +1, or +2 when there was no qualifying for that race.",
    "Every clean lap: +0.6. A perfect race, every lap clean and no warnings at all: +2 extra.",
    "A clean qualifying lap within 107% of pole: +1.",
    "Clean overtakes and close racing without contact.",
    "Your first race of a stream: +2, and +2 more if you share your full telemetry.",
    "The higher your SR, the less bonus you get: 10% less for every 10 SR above 50.",
    "A dirty race gets no bonus at all.",
  ]),
  "From points to SR": (
    <>
      <p>
        Every race gets a net score: its bonus minus its penalties (qualifying joins the next race). Your SR is{" "}
        {SR_START} + the net scores of your last 30 races, between 0 and 100.
      </p>
      {li([
        "Your newest 6 races count in full, the 6 before that 80%, then 60%, 40% and 20%. After 30 of your own races a race is gone. Only races you drive age your history, so sitting out doesn't wash anything away.",
        "Gravity: after every league race, above 50, you lose 4% of the distance to 50 if you raced and 2% if you skipped. It's booked on your latest race, so it leaves your history with that race.",
        "Your rating shows from your first race and is marked provisional until you've done 3 races.",
      ])}
    </>
  ),
  "Kicks and bans": li([
    "Lose 30 points in one race or 60 in one stream and you sit out the rest of that stream.",
    "Drop to 0 and you're no longer welcome in the lobby.",
    "Staff check flagged incidents. If you think a penalty was wrong, let us know.",
  ]),
};

type Tab = "ranking" | "personal";
type SortKey = "pos" | "rank" | "name" | "sr" | "change" | "races";

export function SafetyPage() {
  const { league } = useTelemetry();
  const [params, setParams] = useSearchParams();
  const highlightRef = useRef<HTMLTableRowElement>(null);
  // ?embed: the Discord picture, the full ranking with the site address
  const embed = params.has("embed");
  const { sort, toggle } = useSort<SortKey>();
  const tab: Tab = !embed && params.get("tab") === "personal" ? "personal" : "ranking";

  useEffect(() => {
    if (tab === "ranking" && !embed) highlightRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [tab, embed]);

  if (!league?.safetyData) {
    return (
      <div className="flex h-full items-center justify-center text-zinc-500">
        The safety rating isn't available yet.
      </div>
    );
  }
  const rows = league.safetyData.drivers.filter((d) => !d.banned);
  const sortedRows = sortRows(rows, sort, (d, k) =>
    k === "pos" ? rows.indexOf(d) : k === "rank" ? d.sr : d[k],
  );
  const sortProps = { sort, toggle };
  const personalKey = params.get("driver") ?? league.selectedDriver;
  const personalIdx = rows.findIndex((d) => driverKey(d.name) === personalKey);
  const personal = personalIdx >= 0 ? rows[personalIdx] : undefined;
  const openPersonal = (key: string) => {
    setParams({ tab: "personal", driver: key });
    window.scrollTo({ top: 0 });
  };

  return (
    <div
      id="safety-card"
      className={cn("mx-auto max-w-5xl space-y-6 p-6", embed && "p-8")}
    >
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="mb-1 flex items-center gap-2 text-xl font-bold">
            <ShieldCheck className="h-5 w-5 text-emerald-400" />
            {embed ? "GreMi Gang Safety Rating" : "Safety rating"}
          </h2>
          <p className="flex flex-wrap items-center gap-2 text-sm text-zinc-500">
            {!embed && (
            <span className="inline-flex items-center gap-1 rounded-full border border-zinc-700 px-2 py-0.5 text-[11px] text-zinc-400">
              <TimerOff className="h-3 w-3" />
              not filtered by date
            </span>
            )}
            Live rating over each driver's last 80 races · {rows.length} drivers
          </p>
        </div>
        {!embed && (
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
        )}
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
          <SectionHeader
            title="Ranking"
            hint={
              embed
                ? "Your own rating and every incident at gremigaming.github.io/race-stats"
                : "Click a driver to open their personal page"
            }
          />
          <div className="overflow-x-auto">
            <table className={tableClassLoose}>
              <thead className={tableHeadClass}>
                <tr>
                  <SortHeader column="pos" firstDir="asc" {...sortProps}>#</SortHeader>
                  <SortHeader column="rank" align="left" {...sortProps}>Rank</SortHeader>
                  <SortHeader column="name" firstDir="asc" align="left" {...sortProps}>Driver</SortHeader>
                  <SortHeader column="sr" {...sortProps}>SR</SortHeader>
                  <SortHeader column="change" {...sortProps}>Last stream</SortHeader>
                  <SortHeader column="races" {...sortProps}>Races</SortHeader>
                </tr>
              </thead>
              <tbody>
                {sortedRows.map((d) => {
                  const i = rows.indexOf(d);
                  const key = driverKey(d.name);
                  const isMe = !embed && key === league.selectedDriver;
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

      {tab === "ranking" && !embed && <SafetyHighlights drivers={rows} />}

      {!embed && (
      <section className={cardClass}>
        <SectionHeader title="How it works" />
        <div className="space-y-1.5">
          {HOW_IT_WORKS.map((t) =>
            league.safetyData?.rules === "v2.5" && HOW_IT_WORKS_V25[t.title] ? { ...t, body: HOW_IT_WORKS_V25[t.title] } : t,
          ).map((topic) => (
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
      )}
    </div>
  );
}
