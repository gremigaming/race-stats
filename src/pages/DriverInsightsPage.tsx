import { BarChart3, Timer } from "lucide-react";
import { Link } from "react-router-dom";
import { buildTrackInsights } from "../analysis/dashboardInsights";
import { getDashboardResultStats } from "../analysis/dashboardResultStats";
import { buildRivalStats } from "../analysis/rivalStats";
import { InsightCard } from "../components/dashboard/InsightCard";
import { QualifyingPaceCard } from "../components/dashboard/QualifyingPaceCard";
import { RaceResultsHero } from "../components/dashboard/RaceResultsHero";
import { RivalCard } from "../components/dashboard/RivalCard";
import {
  type SessionStats,
  buildQualifyingPaceData,
  buildTrackGroups,
} from "../components/dashboard/helpers";
import { SectionHeader } from "../components/ui/SectionHeader";
import { PageFrame } from "../components/ui/PageFrame";
import { PageHeader } from "../components/ui/PageHeader";
import { useTelemetry } from "../context/TelemetryContext";
import {
  areSessionFiltersDefault,
  matchesSessionFilters,
  useSessionFilters,
} from "../hooks/useSessionFilters";
import { useSessionList } from "../hooks/useSessionList";
import { getSessionFormulaScopeKey } from "../utils/formulaScope";
import { isRaceSessionType } from "../utils/sessionTypes";
import { getTrackId, sortTracksByCalendar } from "../utils/tracks";

export function DriverInsightsPage() {
  const { sessions, loading } = useSessionList();
  const { activeFormulaKey, activeFormula, league, scopeKey } = useTelemetry();
  const [filters] = useSessionFilters();

  if (loading) {
    return (
      <div className="flex min-h-80 items-center justify-center text-sm text-zinc-500">
        Loading driver insights...
      </div>
    );
  }

  const dashboardSessions = sessions.filter(
    (session) => session.validLapCount > 0 || session.playerRaceResult != null,
  );
  const visibleSessions = dashboardSessions.filter((session) =>
    matchesSessionFilters(session, filters),
  );
  const stats = getDashboardResultStats(visibleSessions, activeFormulaKey);
  const scopedSessions = stats.scopedSessions;
  const sessionStats: SessionStats[] = scopedSessions.map((session) => ({
    summary: session,
    isRace: isRaceSessionType(session.sessionType),
    bestLapMs: session.bestLapTimeMs ?? 0,
    validLapCount: session.validLapCount,
  }));
  const trackGroups = buildTrackGroups(sessionStats);
  const paceCards = Object.values(buildQualifyingPaceData(trackGroups))
    .sort((a, b) => {
      const [firstTrack] = sortTracksByCalendar(
        [a.track, b.track],
        activeFormulaKey,
      );
      if (a.track !== b.track) return firstTrack === a.track ? -1 : 1;
      return a.formulaLabel.localeCompare(b.formulaLabel);
    })
    .slice(0, 6);
  const insights = buildTrackInsights(stats);
  const rivals = buildRivalStats(
    visibleSessions,
    activeFormulaKey,
    getSessionFormulaScopeKey,
  );
  const resultPositions = stats.resultSessions
    .map((session) => session.playerRaceResult?.position)
    .filter((position): position is number => position != null);
  const bestPosition =
    resultPositions.length > 0 ? Math.min(...resultPositions) : undefined;
  const trackCount = new Set(
    stats.resultSessions.map((session) => getTrackId(session.track)),
  ).size;
  const showHero = stats.starts >= 3 && stats.cleanFinishSessions.length >= 1;
  const scopePath = `/${scopeKey ?? "all"}`;
  const hasAnalysis =
    showHero ||
    insights.length > 0 ||
    rivals.cards.length > 0 ||
    paceCards.length > 0;

  return (
    <PageFrame>
      <PageHeader
        icon={BarChart3}
        eyebrow="Drivers"
        title="Performance insights"
        description="See the patterns behind your results, pace, and battles across the league."
        meta={`${activeFormula?.label ?? "All games"} · ${league?.filterLabel ?? (areSessionFiltersDefault(filters) ? "All available dates" : "Filtered sessions")}`}
        action={
          <Link
            to={`${scopePath}/tracks`}
            className="inline-flex min-h-9 items-center gap-2 rounded-xl border border-white/[0.08] bg-black/20 px-3 text-xs font-medium text-zinc-300 transition hover:border-rose-300/20 hover:bg-white/[0.05] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-red/70"
          >
            Track analysis <span aria-hidden="true">→</span>
          </Link>
        }
      />

      {showHero && (
        <RaceResultsHero
          stats={stats}
          bestPosition={bestPosition}
          trackCount={trackCount}
        />
      )}

      {!hasAnalysis && (
        <section className="rounded-2xl border border-white/[0.07] bg-zinc-900/45 px-5 py-8 text-center">
          <h2 className="text-sm font-semibold text-zinc-200">
            Not enough data for insights yet
          </h2>
          <p className="mx-auto mt-1 max-w-lg text-sm text-zinc-500">
            Keep racing and your pace trends, rival comparisons, and result
            patterns will appear here.
          </p>
        </section>
      )}

      {insights.length > 0 && (
        <section>
          <SectionHeader
            title="Track insights"
            hint="Patterns from your recent race history"
          />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {insights.map((insight) => (
              <InsightCard
                key={`${insight.kind}-${insight.track}`}
                insight={insight}
              />
            ))}
          </div>
        </section>
      )}

      {rivals.cards.length > 0 && (
        <section>
          <SectionHeader
            title="Rivals & teammates"
            hint="Drivers you have raced together"
          />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {rivals.cards.map((card) => (
              <RivalCard key={`${card.kind}-${card.driverName}`} card={card} />
            ))}
          </div>
        </section>
      )}

      {paceCards.length > 0 && (
        <section>
          <SectionHeader
            title="Qualifying pace"
            hint="Your best laps over time"
            action={<Timer className="size-4 text-zinc-500" />}
          />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {paceCards.map((group) => (
              <QualifyingPaceCard key={group.key} data={group} />
            ))}
          </div>
        </section>
      )}
    </PageFrame>
  );
}
