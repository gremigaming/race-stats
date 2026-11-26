import { Gauge, ListOrdered, Swords, UserRound } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import { cardClass, interactiveFocusClass } from "../components/Card";
import { DriverSearchSelect } from "../components/DriverSearchSelect";
import { PrBadge, PrRankLegend } from "../components/performance/PrBadge";
import { PageFrame } from "../components/ui/PageFrame";
import { PageHeader } from "../components/ui/PageHeader";
import { SectionHeader } from "../components/ui/SectionHeader";
import { SegmentedControl } from "../components/ui/SegmentedControl";
import { sortRows, useSort, type SortDir } from "../components/ui/SortHeader";
import { useTelemetry } from "../context/TelemetryContext";
import { driverKey } from "../league/league";
import {
  PR_CATEGORIES,
  scoreColor,
  SCORE_GRADIENT,
  prRankName,
  TELL_KIND,
  type PerfCategory,
  type PerfData,
  type PerfDriver,
} from "../league/performance";
import { formatShortDate } from "../utils/format";
import { isoDay } from "../league/filter";
import { cn } from "../utils/cn";

type Tab = "ranking" | "driver" | "battle";
type SortKey = "pos" | "name" | "pr" | PerfCategory | "trend" | "races";

const median = (a: number[]) => {
  const s = [...a].sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length === 0 ? 0 : s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/** Pace trend: the last 6 races against the ones before (gap to the fastest, in %). */
const trendOf = (d: PerfDriver) =>
  d.older == null || d.recent == null ? null : d.older - d.recent;

/** Ranking columns: # | PR + SR | driver | six scores | PR. On phones the scores go on a second line. */
const RANK_GRID =
  "grid items-center gap-x-2 px-1 grid-cols-[1.5rem_3.25rem_minmax(0,1fr)_3rem] md:grid-cols-[1.75rem_3.5rem_minmax(0,1fr)_repeat(6,minmax(0,4.25rem))_3.25rem]";

const CAT_SHORT: Record<PerfCategory, string> = {
  pace: "Pace",
  onelap: "1 lap",
  consistency: "Consist.",
  overtaking: "Overtake",
  defending: "Defend",
  awareness: "Discipline",
};

/** One score: the number in white with a coloured line under it (GreMi, 25 Nov 2026: version 11b, scale 1). */
function ScoreCell({ v, label, dim, title }: { v: number; label: string; dim?: boolean; title: string }) {
  return (
    <span role="cell" className={cn("min-w-0 text-center", dim && "opacity-50")} title={title}>
      <span className="block truncate text-[9.5px] text-zinc-500 md:hidden">{label}</span>
      <span className="font-mono text-[15px] font-bold tabular-nums text-zinc-50">
        {dim ? "~" : ""}
        {v.toFixed(1)}
      </span>
      <span className="mx-1 mt-1 block h-1.5 overflow-hidden rounded-full bg-white/[0.07]">
        <span className="block h-full rounded-full" style={{ width: `${v * 10}%`, background: scoreColor(v) }} />
      </span>
    </span>
  );
}

function SortButton({
  k,
  first = "desc",
  sort,
  toggle,
  className,
  title,
  children,
}: {
  k: SortKey;
  first?: SortDir;
  sort: { key: SortKey; dir: SortDir } | null;
  toggle: (key: SortKey, firstDir: SortDir) => void;
  className?: string;
  title?: string;
  children: ReactNode;
}) {
  const active = sort?.key === k;
  return (
    <button
      type="button"
      role="columnheader"
      title={title}
      aria-sort={active ? (sort?.dir === "asc" ? "ascending" : "descending") : "none"}
      onClick={() => toggle(k, first)}
      className={cn(
        "flex items-center gap-0.5 whitespace-nowrap rounded-sm hover:text-zinc-300",
        active && "text-zinc-200",
        interactiveFocusClass,
        className,
      )}
    >
      {children}
      {active && <span aria-hidden="true">{sort?.dir === "asc" ? "▲" : "▼"}</span>}
    </button>
  );
}

export function PerformancePage() {
  const { league } = useTelemetry();
  const [params, setParams] = useSearchParams();
  const { sort, toggle } = useSort<SortKey>();
  // Same switch as the Safety rating ranking: everyone, or only the drivers of the last stream
  const [scope, setScope] = useState<"all" | "last-stream">("all");
  const highlightRef = useRef<HTMLTableRowElement>(null);
  const data = league?.performanceData ?? null;
  const tabParam = params.get("tab");
  const tab: Tab = tabParam === "driver" || tabParam === "battle" ? tabParam : "ranking";

  useEffect(() => {
    if (tab === "ranking") highlightRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [tab]);

  const drivers = data?.drivers ?? [];
  const pickList = useMemo(() => drivers.map((d) => ({ key: driverKey(d.name), name: d.name })), [drivers]);
  const byKey = useMemo(() => new Map(drivers.map((d) => [driverKey(d.name), d])), [drivers]);

  if (!league) return null;
  if (!data || drivers.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-zinc-500">
        The performance rating isn&apos;t available yet.
      </div>
    );
  }

  const me = league.selectedDriver;
  const fallback = byKey.has(me) ? me : driverKey(drivers[0].name);
  const driverParam = params.get("driver") ?? fallback;
  const current = byKey.get(driverParam) ?? byKey.get(fallback)!;
  const vsParam = params.get("vs");
  const opponent =
    (vsParam && byKey.get(vsParam)) ||
    drivers[drivers.indexOf(current) > 0 ? drivers.indexOf(current) - 1 : 1] ||
    drivers[0];
  const go = (next: Record<string, string>) => {
    setParams(next);
    window.scrollTo({ top: 0 });
  };
  // Drivers of the last stream, from the safety rating's stream list (both ratings use the same races)
  const streams = league.safetyData?.streams ?? [];
  const lastStream = streams.length - 1;
  const lastStreamDate = streams[lastStream]?.date;
  const lastStreamIsToday = lastStreamDate === isoDay(new Date());
  const lastStreamKeys = new Set(
    (league.safetyData?.drivers ?? [])
      .filter((x) => x.sessions.some((session) => session.stream === lastStream))
      .map((x) => driverKey(x.name)),
  );
  const lastStreamRows = drivers.filter((d) => lastStreamKeys.has(driverKey(d.name)));
  const lastStreamAvailable = lastStream >= 0;
  const showingLastStream = scope === "last-stream" && lastStreamAvailable;
  const lastStreamLabel = lastStreamIsToday
    ? "today's stream"
    : `the last stream (${lastStreamDate ? formatShortDate(lastStreamDate) : ""})`;
  const sorted = sortRows(showingLastStream ? lastStreamRows : drivers, sort, (d, k) =>
    k === "pos" ? drivers.indexOf(d) : k === "name" ? d.name : k === "pr" ? d.pr : k === "trend" ? trendOf(d) : k === "races" ? d.races : d.cat[k],
  );

  return (
    <PageFrame className="space-y-6">
      <PageHeader
        icon={Gauge}
        eyebrow="Drivers"
        title="Performance rating"
        description={
          tab === "battle"
            ? "Pick yourself and the car ahead or behind to see what to expect in the fight."
            : tab === "driver"
              ? "One driver's pace and racecraft, and the battle tells that make them stand out."
              : "Pace and racecraft for every league driver, from Bronze I to Gold III."
        }
        meta={`Not filtered by date · Races since ${formatShortDate(data.since)} · ${drivers.length} drivers with ${data.min_races}+ races`}
        action={
          <SegmentedControl
            value={tab}
            onChange={(t) =>
              go(
                t === "ranking"
                  ? {}
                  : t === "driver"
                    ? { tab: "driver", driver: driverKey(current.name) }
                    : { tab: "battle", driver: driverKey(current.name), vs: driverKey(opponent.name) },
              )
            }
            ariaLabel="Performance rating view"
            options={[
              { value: "ranking", label: "Ranking", icon: ListOrdered },
              { value: "driver", label: "Driver", icon: UserRound },
              { value: "battle", label: "Battle preview", mobileLabel: "Battle", icon: Swords },
            ]}
          />
        }
      />

      {tab === "ranking" && (
        <section className={cardClass}>
          <SectionHeader
            title="Ranking"
            hint={
              showingLastStream
                ? `${lastStreamRows.length} ${lastStreamRows.length === 1 ? "driver" : "drivers"} in ${lastStreamLabel} · # is the league position · select a driver to open their profile`
                : "Select a driver to open their profile and battle tells · select a column name to sort"
            }
            action={
              lastStreamAvailable ? (
                <SegmentedControl
                  size="sm"
                  value={scope}
                  onChange={setScope}
                  ariaLabel="Drivers in ranking"
                  options={[
                    { value: "all", label: "All drivers", meta: drivers.length },
                    {
                      value: "last-stream",
                      label: lastStreamIsToday ? "Today's stream" : "Last stream",
                      meta: lastStreamRows.length,
                    },
                  ]}
                />
              ) : undefined
            }
          />
          <div role="table" aria-label="Performance rating ranking" className="text-sm">
            <div role="row" className={cn(RANK_GRID, "border-b border-white/[0.06] pb-2 text-[11px] text-zinc-500")}>
              <SortButton k="pos" first="asc" sort={sort} toggle={toggle} className="justify-end">#</SortButton>
              <span role="columnheader" />
              <SortButton k="name" first="asc" sort={sort} toggle={toggle}>Driver</SortButton>
              {PR_CATEGORIES.map((c) => (
                <SortButton key={c.key} k={c.key} sort={sort} toggle={toggle} className="hidden justify-center md:flex" title={c.label}>
                  {CAT_SHORT[c.key]}
                </SortButton>
              ))}
              <SortButton k="pr" sort={sort} toggle={toggle} className="justify-end">PR</SortButton>
            </div>
            {sorted.length === 0 && showingLastStream && (
              <p className="px-3 py-8 text-center text-sm text-zinc-500">
                No ranked drivers in {lastStreamLabel} yet.
              </p>
            )}
            {sorted.map((d) => {
              const key = driverKey(d.name);
              const isMe = key === me;
              const open = () => go({ tab: "driver", driver: key });
              return (
                <div
                  role="row"
                  key={key}
                  ref={isMe ? highlightRef : undefined}
                  tabIndex={0}
                  onClick={open}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") open();
                  }}
                  className={cn(
                    RANK_GRID,
                    "cursor-pointer border-b border-white/[0.04] py-2 transition-colors hover:bg-white/[0.03]",
                    interactiveFocusClass,
                    isMe && "bg-red-500/[0.09] shadow-[inset_3px_0_0_#f87171]",
                  )}
                >
                  <span role="cell" className="text-right font-mono text-zinc-500">
                    {drivers.indexOf(d) + 1}
                  </span>
                  <span role="cell" className="flex items-center">
                    <PrBadge pr={d.pr} size={26} />
                  </span>
                  <span role="cell" className={cn("min-w-0 truncate font-medium", isMe ? "text-red-300" : "text-zinc-100")} title={`${d.name} · ${prRankName(d.pr)} · ${d.races} races`}>
                    {d.name}
                    {isMe && (
                      <span className="ml-2 rounded-full bg-red-500/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-red-300">
                        you
                      </span>
                    )}
                  </span>
                  <div className="col-span-full row-start-2 grid grid-cols-6 gap-1 md:contents">
                    {PR_CATEGORIES.map((c) => (
                      <ScoreCell
                        key={c.key}
                        v={d.cat[c.key]}
                        label={CAT_SHORT[c.key]}
                        dim={(c.key === "defending" && d.def_n < 5) || (c.key === "overtaking" && d.att_n < 5)}
                        title={`${c.label}: ${d.cat[c.key].toFixed(1)} · ${c.raw(d)}`}
                      />
                    ))}
                  </div>
                  <span role="cell" className="row-start-1 col-start-4 text-right font-mono text-base font-bold tabular-nums text-zinc-50 md:col-start-10">
                    {d.pr.toFixed(1)}
                  </span>
                </div>
              );
            })}
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-zinc-500">
            <span
              className="inline-block h-2 w-40 rounded-full"
              style={{ background: SCORE_GRADIENT }}
            />
            <span>Line colour and length: the score from 1.0 (red) to 10.0 (green)</span>
          </div>
          <PrRankLegend className="mt-4" />
        </section>
      )}

      {tab === "driver" && (
        <DriverView
          d={current}
          data={data}
          pickList={pickList}
          onPick={(key) => go({ tab: "driver", driver: key })}
          onBattle={() => go({ tab: "battle", driver: me && byKey.has(me) && me !== driverKey(current.name) ? me : driverKey(current.name), vs: me && byKey.has(me) && me !== driverKey(current.name) ? driverKey(current.name) : driverKey(opponent.name) })}
        />
      )}

      {tab === "battle" && (
        <BattleView
          a={current}
          o={opponent}
          data={data}
          pickList={pickList}
          onPick={(a, o) => setParams({ tab: "battle", driver: a, vs: o })}
        />
      )}

      <HowItWorks />
    </PageFrame>
  );
}

function CategoryBars({ d, data }: { d: PerfDriver; data: PerfData }) {
  const catMed = useMemo(
    () => Object.fromEntries(PR_CATEGORIES.map((c) => [c.key, median(data.drivers.map((x) => x.cat[c.key]))])),
    [data],
  );
  return (
    <div className="mt-4 space-y-3">
      {PR_CATEGORIES.map((c) => {
        const v = d.cat[c.key];
        return (
          <div key={c.key} className="grid grid-cols-[minmax(0,9rem)_1fr_2.5rem] items-center gap-3">
            <div className="min-w-0 text-sm text-zinc-200">
              {c.label}
              <small className="block truncate text-[11px] text-zinc-500">{c.raw(d)}</small>
            </div>
            <div className="relative h-2.5 rounded-full bg-white/[0.07]">
              <b className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${v * 10}%`, background: scoreColor(v) }} />
              <span
                className="absolute -top-1 h-[18px] w-0.5 rounded bg-zinc-300/70"
                style={{ left: `${catMed[c.key] * 10}%` }}
                title={`League middle ${catMed[c.key].toFixed(1)}`}
              />
            </div>
            <div className="text-right font-mono text-sm font-semibold tabular-nums text-zinc-100">{v.toFixed(1)}</div>
          </div>
        );
      })}
      <p className="text-[11px] text-zinc-500">The white mark is the league middle.</p>
    </div>
  );
}

function DriverView({
  d,
  data,
  pickList,
  onPick,
  onBattle,
}: {
  d: PerfDriver;
  data: PerfData;
  pickList: { key: string; name: string }[];
  onPick: (key: string) => void;
  onBattle: () => void;
}) {
  const key = driverKey(d.name);
  const pos = data.drivers.indexOf(d) + 1;
  const f = data.field;
  const bits: string[] = [];
  if (d.brake != null) bits.push(`brake point ${d.brake > 0 ? `${d.brake.toFixed(0)} m earlier` : `${(-d.brake).toFixed(0)} m later`} than the field`);
  if (d.steer != null && f.steer_rev_km != null) bits.push(`${d.steer.toFixed(1)} steering corrections per km (field ${f.steer_rev_km.toFixed(1)})`);
  if (d.offs != null && f.offs_per_10km != null) bits.push(`${d.offs.toFixed(2)} off-tracks per 10 km (field ${f.offs_per_10km.toFixed(2)})`);
  bits.push(`speed trap ${d.trap >= 0 ? "+" : ""}${d.trap.toFixed(1)} km/h against the race middle`);
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <section className={cardClass}>
        <DriverSearchSelect drivers={pickList} value={key} onChange={onPick} ariaLabel="Driver" className="max-w-xs" />
        <div className="mt-5 flex items-center gap-4">
          <PrBadge pr={d.pr} size={64} />
          <div className="min-w-0">
            <div className="font-mono text-3xl font-bold tabular-nums text-zinc-50">{d.pr.toFixed(1)}</div>
            <div className="text-xs text-zinc-400">
              {prRankName(d.pr)} · #{pos} of {data.drivers.length} · {d.races} races
            </div>
          </div>
        </div>
        <CategoryBars d={d} data={data} />
        <button
          type="button"
          onClick={onBattle}
          className="mt-5 inline-flex items-center gap-2 rounded-xl border border-white/[0.08] bg-white/[0.04] px-3 py-2 text-sm font-medium text-zinc-200 transition-colors hover:bg-white/[0.08] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-red/70"
        >
          <Swords className="size-4" />
          Battle preview
        </button>
      </section>
      <section className={cardClass}>
        <SectionHeader title="Battle tells" hint="What makes this driver stand out from the rest of the league" />
        {d.tells.length ? (
          <div className="space-y-3">
            {d.tells.map((t) => (
              <div key={t.title} className="rounded-xl border border-white/[0.06] bg-zinc-950/50 p-3">
                <div className="font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-rose-200/70">
                  {TELL_KIND[t.kind] ?? t.kind}
                </div>
                <div className="mt-0.5 text-sm font-semibold text-zinc-100">{t.title}</div>
                <p className="mt-1 text-sm text-zinc-300">
                  <b className="font-medium text-zinc-200">What it means for you:</b> {t.means}
                </p>
                <p className="mt-1 text-xs text-zinc-500">How we know: {t.how}</p>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-zinc-400">
            Nothing stands out from the rest of the league yet. Expect an all-round, middle-of-the-field driver.
          </p>
        )}
        <p className="mt-4 text-xs text-zinc-500">
          <b className="font-medium text-zinc-400">Raw numbers:</b> {bits.join(" · ")}.
          {d.tel_km < 80 ? " Fewer than 80 km of telemetry so far, so the braking and steering tells are held back." : ` Telemetry from ${d.tel_races} races.`}
        </p>
      </section>
    </div>
  );
}

function BattleView({
  a,
  o,
  data,
  pickList,
  onPick,
}: {
  a: PerfDriver;
  o: PerfDriver;
  data: PerfData;
  pickList: { key: string; name: string }[];
  onPick: (a: string, o: string) => void;
}) {
  const ka = driverKey(a.name);
  const ko = driverKey(o.name);
  const side = (d: PerfDriver, right: boolean) => (
    <div className={cn("flex min-w-0 items-center gap-3", right && "flex-row-reverse text-right")}>
      <PrBadge pr={d.pr} size={44} />
      <div className="min-w-0">
        <div className="truncate font-semibold text-zinc-100">{d.name}</div>
        <div className="text-xs text-zinc-400">
          PR {d.pr.toFixed(1)} · {prRankName(d.pr)}
        </div>
      </div>
    </div>
  );
  // Pace: median lap-time gap in races both finished; fewer than 2 shared races = the usual gap to the leader
  const pair = data.pairs[[a.name, o.name].sort().join("|")];
  let gapS: number;
  let src: string;
  if (pair && pair[1] >= 2) {
    gapS = (a.name < o.name ? pair[0] : -pair[0]) / 1000;
    src = `median of ${pair[1]} races you both finished`;
  } else {
    gapS = ((o.pace_gap - a.pace_gap) / 100) * 90;
    src = "fewer than 2 shared races, so this is an estimate from both drivers' usual gap to the race leader on a 1:30 lap";
  }
  const expect: { h: string; body: ReactNode }[] = [];
  if (a.name === o.name) expect.push({ h: "Pick", body: "Pick a different opponent to compare." });
  else if (Math.abs(gapS) < 0.25)
    expect.push({ h: "Pace", body: `You're on the same pace (within 0.25 s a lap; ${src}). The battle will come down to racecraft.` });
  else if (gapS > 0)
    expect.push({
      h: "Pace",
      body: (
        <>
          You're about <b>{gapS.toFixed(1)} s a lap quicker</b> ({src}). If they're ahead, be patient: the pass should come.
        </>
      ),
    });
  else
    expect.push({
      h: "Pace",
      body: (
        <>
          {o.name} is about <b>{(-gapS).toFixed(1)} s a lap quicker</b> ({src}). If they're behind you, defend where it counts and don't lose time fighting every corner.
        </>
      ),
    });
  const att: string[] = [];
  const def: string[] = [];
  if (a.name !== o.name) {
    if (o.cat.overtaking >= 8 && o.att_n >= 5) att.push(`They turn pace into places: they got past ${o.att_won} of ${o.att_n} slower cars that started ahead. Once they're within a second, cover the inside.`);
    if (o.cat.defending <= 3.6 && o.def_n >= 5) def.push("Quicker cars get past them more easily than usual, so keep the pressure on.");
    if (o.cat.defending >= 7.4 && o.def_n >= 5) def.push("They hold off quicker cars better than most. You'll need a clear pace edge or a clean move.");
    for (const t of o.tells) {
      if ((t.kind === "brake" && t.title.includes("later")) || (t.kind === "start" && t.title.startsWith("Strong"))) att.push(t.means);
      else def.push(t.means);
    }
    if (att.length) expect.push({ h: "When they're behind you", body: <ul className="mt-1 list-disc space-y-1 pl-5">{att.map((x) => <li key={x}>{x}</li>)}</ul> });
    if (def.length) expect.push({ h: "When you're behind them", body: <ul className="mt-1 list-disc space-y-1 pl-5">{def.map((x) => <li key={x}>{x}</li>)}</ul> });
    if (!att.length && !def.length) expect.push({ h: "Style", body: "Nothing stands out from the rest of the league. Expect a straightforward, middle-of-the-field fight." });
  }
  return (
    <section className={cardClass}>
      <SectionHeader title="Battle preview" hint="Pick yourself and the car ahead or behind" />
      <div className="flex flex-wrap items-center gap-2">
        <DriverSearchSelect drivers={pickList} value={ka} onChange={(k) => onPick(k, ko)} ariaLabel="You" className="w-56" />
        <span className="text-xs font-semibold uppercase text-zinc-500">vs</span>
        <DriverSearchSelect drivers={pickList} value={ko} onChange={(k) => onPick(ka, k)} ariaLabel="Opponent" className="w-56" />
      </div>
      <div className="mt-5 grid grid-cols-[1fr_auto_1fr] items-center gap-3">
        {side(a, false)}
        <span className="text-xs font-semibold uppercase text-zinc-500">vs</span>
        {side(o, true)}
      </div>
      <div className="mt-5 space-y-2.5">
        {PR_CATEGORIES.map((c) => {
          const x = a.cat[c.key];
          const y = o.cat[c.key];
          return (
            <div key={c.key} className="grid grid-cols-[2.5rem_1fr_7.5rem_1fr_2.5rem] items-center gap-2 text-sm">
              <span className={cn("text-right font-mono tabular-nums", x >= y ? "font-semibold text-zinc-100" : "text-zinc-500")}>{x.toFixed(1)}</span>
              <div className="flex h-2 justify-end rounded-full bg-white/[0.06]">
                <b className="h-full rounded-full" style={{ width: `${x * 10}%`, background: x >= y ? scoreColor(x) : "#52525b" }} />
              </div>
              <span className="text-center text-xs text-zinc-400">{c.label}</span>
              <div className="h-2 rounded-full bg-white/[0.06]">
                <b className="block h-full rounded-full" style={{ width: `${y * 10}%`, background: y >= x ? scoreColor(y) : "#52525b" }} />
              </div>
              <span className={cn("font-mono tabular-nums", y >= x ? "font-semibold text-zinc-100" : "text-zinc-500")}>{y.toFixed(1)}</span>
            </div>
          );
        })}
      </div>
      <div className="mt-6 rounded-xl border border-white/[0.06] bg-zinc-950/50 p-4">
        <h4 className="text-sm font-semibold text-zinc-100">What to expect</h4>
        <ul className="mt-2 space-y-2 text-sm text-zinc-300">
          {expect.map((e) => (
            <li key={e.h}>
              <b className="font-medium text-zinc-100">{e.h}:</b> {e.body}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function HowItWorks() {
  return (
    <section className={cardClass}>
      <SectionHeader title="How it works" />
      <div className="space-y-2 text-sm text-zinc-400">
        <p>
          <b className="font-medium text-zinc-200">PR</b> = race pace 35% + one lap 15% + consistency 15% + overtaking 15% +
          defending 10% + track discipline 10%. Every part is a score from 1.0 to 10.0.
        </p>
        <p>
          <b className="font-medium text-zinc-200">Ranks</b> run Bronze I (under 2), Bronze II (2+), Bronze III (3+), Silver I (4+),
          Silver II (5+), Silver III (6+), Gold I (7+), Gold II (8+) up to Gold III (9+).
        </p>
        <p>
          Race pace is your typical clean lap against the fastest car in the same race. One lap is your qualifying gap to pole
          (your best race lap when you have fewer than 2 qualifying sessions). Consistency is how much your clean laps differ.
          Overtaking and defending only count real chances, so where you start doesn&apos;t matter. Overtaking: when you&apos;re
          quicker than a car that started ahead of you, did you finish ahead of it? Defending: when a quicker car started behind
          you, did you keep it behind? Both are compared with how often the league manages it with the same pace gap, and
          drivers with few chances stay near the middle. Track discipline counts corner-cutting warnings, penalties and trips
          over the white line.
        </p>
        <p>
          Stream races since 19 Oct 2026, drivers with 5 or more races who raced in the last 30 days. Battle tells from
          telemetry (braking, steering, off-tracks) need at least 80 km of recorded laps.
        </p>
      </div>
    </section>
  );
}
