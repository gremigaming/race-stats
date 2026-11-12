import { ArrowLeft, ArrowUpRight, BarChart3, Sparkles } from "lucide-react";
import { useLayoutEffect, useMemo } from "react";
import {
  Link,
  useLocation,
  useNavigationType,
  useParams,
  useSearchParams,
} from "react-router-dom";
import {
  buildDriverDna,
  DRIVER_DNA_STYLES,
  driverDnaSignalLabel,
  type DriverDnaSignal,
} from "../analysis/driverDna";
import {
  DRIVER_DNA_SIGNALS,
  DRIVER_DNA_SIGNAL_INFO,
  DriverDnaLeaderboardLinks,
} from "../components/dna/DriverDnaLeaderboardLinks";
import { PageFrame } from "../components/ui/PageFrame";
import { PageHeader } from "../components/ui/PageHeader";
import { useTelemetry } from "../context/TelemetryContext";
import {
  allowedFiles,
  buildStreams,
  describeFilter,
  type LeagueFilter,
} from "../league/filter";
import { isRaceSession, raceFormulaKey } from "../league/league";
import { cn } from "../utils/cn";
import {
  isLeaderboardSeries,
  leaderboardSeriesLabel,
  seriesForFormula,
} from "../utils/leaderboardSeries";
import {
  driverDnaLeaderboardIndexPath,
  driverDnaPath,
  driverDnaProfilePath,
} from "../utils/routes";

function parseSharedFilter(value: string | null): LeagueFilter | null {
  if (!value) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== "object" || !("kind" in parsed))
      return null;
    const filter = parsed as Record<string, unknown>;
    switch (filter.kind) {
      case "today":
      case "week":
      case "month":
      case "year":
      case "all":
        return { kind: filter.kind };
      case "streams":
        return filter.count === 1 || filter.count === 3
          ? { kind: "streams", count: filter.count }
          : null;
      case "stream":
        return typeof filter.id === "string" && filter.id.length <= 64
          ? { kind: "stream", id: filter.id }
          : null;
      case "custom":
        return typeof filter.from === "string" &&
          typeof filter.to === "string" &&
          /^\d{4}-\d{2}-\d{2}$/.test(filter.from) &&
          /^\d{4}-\d{2}-\d{2}$/.test(filter.to)
          ? { kind: "custom", from: filter.from, to: filter.to }
          : null;
      default:
        return null;
    }
  } catch {
    return null;
  }
}

function signalKeyFromParam(value: string | undefined): DriverDnaSignal | null {
  if (!value) return null;
  return Object.hasOwn(DRIVER_DNA_SIGNAL_INFO, value)
    ? (value as DriverDnaSignal)
    : null;
}

export function DriverDnaLeaderboardPage() {
  const { league, scopeKey, activeFormulaKey, activeFormula } = useTelemetry();
  const { signalKey } = useParams<{ signalKey: string }>();
  const [params] = useSearchParams();
  const location = useLocation();
  const navigationType = useNavigationType();
  const signal = signalKeyFromParam(signalKey);
  const dnaSeriesParam = params.get("dnaSeries");
  const dnaSeries = isLeaderboardSeries(dnaSeriesParam) ? dnaSeriesParam : null;

  useLayoutEffect(() => {
    if (navigationType !== "POP") {
      document.querySelector<HTMLElement>("main.overflow-y-auto")?.scrollTo({
        top: 0,
      });
    }
  }, [location.key, navigationType]);

  const sharedFilter = useMemo(
    () => parseSharedFilter(params.get("dnaFilter")),
    [params],
  );
  const allStreams = useMemo(
    () => buildStreams(league?.allRaces ?? []),
    [league?.allRaces],
  );
  const selectedRaces = useMemo(() => {
    if (!league?.races) return [];
    if (!sharedFilter) return league.races;
    const races = league.allRaces ?? league.races;
    const files = allowedFiles(sharedFilter, races, allStreams);
    return files ? races.filter((race) => files.has(race.file)) : races;
  }, [league?.allRaces, league?.races, sharedFilter, allStreams]);
  const formulaRaces = useMemo(
    () =>
      activeFormulaKey
        ? selectedRaces.filter(
            (race) => raceFormulaKey(race.session) === activeFormulaKey,
          )
        : dnaSeries
          ? selectedRaces.filter(
              (race) =>
                seriesForFormula(raceFormulaKey(race.session)) === dnaSeries,
            )
          : selectedRaces,
    [selectedRaces, activeFormulaKey, dnaSeries],
  );
  const cards = useMemo(() => buildDriverDna(formulaRaces), [formulaRaces]);
  const eligibleCounts = useMemo(
    () =>
      Object.fromEntries(
        DRIVER_DNA_SIGNALS.map((candidate) => [
          candidate,
          cards.filter((card) =>
            card.signalMetrics.some((metric) => metric.signal === candidate),
          ).length,
        ]),
      ) as Record<DriverDnaSignal, number>,
    [cards],
  );
  const rankedDrivers = useMemo(() => {
    if (!signal) return [];
    return cards
      .flatMap((card) => {
        const metric = card.signalMetrics.find(
          (candidate) => candidate.signal === signal,
        );
        return metric ? [{ card, metric }] : [];
      })
      .sort(
        (a, b) =>
          b.metric.percentile - a.metric.percentile ||
          b.metric.score - a.metric.score ||
          b.card.races - a.card.races ||
          a.card.name.localeCompare(b.card.name),
      );
  }, [cards, signal]);

  if (!league) {
    return (
      <PageFrame>
        <section className="rounded-2xl bg-zinc-900/70 p-5 text-sm text-zinc-400">
          Driver DNA leaderboards need the league race data.
        </section>
      </PageFrame>
    );
  }

  const backParams = new URLSearchParams(location.search);
  backParams.delete("profile");
  backParams.delete("driver");
  backParams.delete("embed");
  if (activeFormulaKey) backParams.delete("dnaSeries");
  const browseHref = `${driverDnaPath(scopeKey)}${backParams.size ? `?${backParams.toString()}` : ""}`;
  const leaderboardIndexHref = `${driverDnaLeaderboardIndexPath(scopeKey)}${backParams.size ? `?${backParams.toString()}` : ""}`;
  const formulaLabel = activeFormulaKey
    ? (activeFormula?.label ?? activeFormulaKey)
    : dnaSeries
      ? leaderboardSeriesLabel(dnaSeries)
      : "All games";
  const raceCount = formulaRaces.filter((race) =>
    isRaceSession(race.session),
  ).length;
  const filterLabel = sharedFilter
    ? describeFilter(sharedFilter, allStreams)
    : league.filterLabel;
  const titleMeta = signal
    ? `${formulaLabel} · ${filterLabel} · ${rankedDrivers.length} drivers ranked · ${raceCount} ${raceCount === 1 ? "race" : "races"}`
    : `${formulaLabel} · ${filterLabel} · ${DRIVER_DNA_SIGNALS.length} stats · ${cards.length} driver cards · ${raceCount} ${raceCount === 1 ? "race" : "races"}`;

  if (signalKey && !signal) {
    return (
      <PageFrame>
        <PageHeader
          icon={Sparkles}
          eyebrow="Driver DNA"
          title="Leaderboard not found"
          description="That racing signal is not available. Choose a statistic from a Driver DNA card."
          action={
            <LeaderboardPageActions
              browseHref={browseHref}
              indexHref={leaderboardIndexHref}
            />
          }
        />
      </PageFrame>
    );
  }

  if (!signal) {
    return (
      <PageFrame>
        <PageHeader
          icon={BarChart3}
          eyebrow="Driver DNA"
          title="Stat leaderboards"
          description="Explore every race signal across the selected game and date range. Each ranking shows how drivers compare with their peers."
          meta={titleMeta}
          action={
            <Link
              to={browseHref}
              className="inline-flex min-h-9 items-center gap-2 rounded-xl border border-white/[0.08] bg-black/20 px-3 text-xs font-medium text-zinc-300 transition hover:border-white/[0.16] hover:bg-white/[0.05] hover:text-white"
            >
              <ArrowLeft className="size-3.5" /> Browse cards
            </Link>
          }
        />

        <section
          aria-labelledby="leaderboard-directory-title"
          className="space-y-3"
        >
          <div className="flex items-end justify-between gap-3 px-1">
            <div>
              <h2
                id="leaderboard-directory-title"
                className="text-base font-semibold text-zinc-100"
              >
                Choose a statistic
              </h2>
              <p className="mt-0.5 text-xs text-zinc-500">
                Driver counts reflect the data needed to rank each signal.
              </p>
            </div>
            <span className="font-mono text-[11px] tabular-nums text-zinc-500">
              {DRIVER_DNA_SIGNALS.length} leaderboards
            </span>
          </div>

          <DriverDnaLeaderboardLinks
            scopeKey={scopeKey}
            search={backParams.toString()}
            counts={eligibleCounts}
          />
        </section>
      </PageFrame>
    );
  }

  const label = driverDnaSignalLabel(signal);
  const baseProfileParams = new URLSearchParams(location.search);
  baseProfileParams.delete("driver");
  baseProfileParams.delete("embed");
  const profileHref = (driverKey: string) => {
    const profileParams = new URLSearchParams(baseProfileParams);
    profileParams.set("profile", driverKey);
    return `${driverDnaProfilePath(scopeKey, driverKey).split("?")[0]}?${profileParams.toString()}`;
  };

  return (
    <PageFrame>
      <PageHeader
        icon={Sparkles}
        eyebrow="Driver DNA leaderboard"
        title={label}
        description={DRIVER_DNA_SIGNAL_INFO[signal]}
        meta={titleMeta}
        action={
          <LeaderboardPageActions
            browseHref={browseHref}
            indexHref={leaderboardIndexHref}
          />
        }
      />

      <section aria-label={`${label} rankings`} className="space-y-2">
        <div className="flex items-end justify-between gap-3 px-1">
          <div>
            <h2 className="text-base font-semibold text-zinc-100">
              Driver rankings
            </h2>
            <p className="mt-0.5 text-xs text-zinc-500">
              Higher peer rank means a stronger result for this statistic.
            </p>
          </div>
          <p className="font-mono text-[11px] tabular-nums text-zinc-500">
            {rankedDrivers.length} ranked
          </p>
        </div>

        {rankedDrivers.length ? (
          <ol className="overflow-hidden rounded-2xl border border-white/[0.08] bg-zinc-950/50">
            {rankedDrivers.map(({ card, metric }, index) => {
              const topPercent = Math.max(
                1,
                100 - Math.round(metric.percentile * 100),
              );
              const style = DRIVER_DNA_STYLES[card.style];
              return (
                <li
                  key={card.key}
                  className={cn(
                    "grid grid-cols-[2.25rem_minmax(0,1fr)] items-center gap-x-3 gap-y-1 px-3 py-3 sm:grid-cols-[2.5rem_minmax(0,1.2fr)_minmax(12rem,1fr)_6rem] sm:gap-4 sm:px-4",
                    index > 0 && "border-t border-white/[0.06]",
                    index === 0 && "bg-cyan-300/[0.035]",
                  )}
                >
                  <span className="row-span-2 inline-flex size-8 items-center justify-center rounded-lg bg-white/[0.04] font-mono text-xs font-semibold tabular-nums text-zinc-400 sm:row-span-1">
                    {index + 1}
                  </span>
                  <Link
                    to={profileHref(card.key)}
                    className="group min-w-0 rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300"
                  >
                    <span className="flex min-w-0 items-center gap-1.5">
                      <span className="truncate text-sm font-semibold text-zinc-100 transition group-hover:text-cyan-200">
                        {card.name}
                      </span>
                      <ArrowUpRight className="size-3.5 shrink-0 text-zinc-600 transition group-hover:text-cyan-200" />
                    </span>
                    <span className="block truncate text-[11px] text-zinc-500">
                      {card.team || "Unknown team"} · {style.label}
                    </span>
                  </Link>
                  <div className="col-start-2 min-w-0 sm:col-start-auto">
                    <p className="truncate text-xs font-medium text-zinc-200">
                      {metric.value}
                    </p>
                    <p className="truncate text-[10px] text-zinc-500">
                      {metric.sample}
                    </p>
                  </div>
                  <span className="col-start-2 row-start-3 font-mono text-[11px] font-semibold tabular-nums text-cyan-300 sm:col-start-auto sm:row-start-auto sm:text-right">
                    Top {topPercent}%
                  </span>
                </li>
              );
            })}
          </ol>
        ) : (
          <div className="rounded-2xl border border-white/[0.08] bg-zinc-950/50 px-5 py-10 text-center">
            <Sparkles className="mx-auto size-6 text-zinc-500" />
            <p className="mt-3 text-sm font-medium text-zinc-200">
              No drivers have enough data for this statistic yet.
            </p>
            <p className="mt-1 text-xs text-zinc-500">
              Try another game or date range from the Driver DNA cards.
            </p>
          </div>
        )}
      </section>
    </PageFrame>
  );
}

function LeaderboardPageActions({
  browseHref,
  indexHref,
}: {
  browseHref: string;
  indexHref: string;
}) {
  const linkClassName =
    "inline-flex min-h-9 items-center gap-2 rounded-xl border border-white/[0.08] bg-black/20 px-3 text-xs font-medium text-zinc-300 transition hover:border-white/[0.16] hover:bg-white/[0.05] hover:text-white";

  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      <Link to={indexHref} className={linkClassName}>
        <BarChart3 className="size-3.5" /> All leaderboards
      </Link>
      <Link to={browseHref} className={linkClassName}>
        <ArrowLeft className="size-3.5" /> Browse cards
      </Link>
    </div>
  );
}
