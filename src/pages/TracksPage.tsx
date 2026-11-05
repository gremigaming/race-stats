import { AlertTriangle, ArrowUpDown, RotateCcw, Route } from "lucide-react";
import { useMemo, useState } from "react";
import { ActionEmptyState } from "../components/ActionEmptyState";
import { SessionListActiveFilters } from "../components/SessionListActiveFilters";
import { SessionListFilterMenu } from "../components/SessionListFilterMenu";
import { TrackOverviewCard } from "../components/dashboard/TrackOverviewCard";
import { Button } from "../components/ui/Button";
import {
  buildTrackRecords,
  isProblemStatus,
  type TrackRecords,
} from "../components/dashboard/helpers";
import { PillSelect, type PillSelectOption } from "../components/ui/PillSelect";
import { buildTrackLapPaceBenchmark } from "../analysis/trackLapPace";
import { useTelemetry } from "../context/TelemetryContext";
import {
  DEFAULT_FILTERS,
  matchesSessionFilters,
  useSessionFilters,
} from "../hooks/useSessionFilters";
import { useSessionList } from "../hooks/useSessionList";
import { useGameScope } from "../hooks/useGameScope";
import { PageFrame } from "../components/ui/PageFrame";
import { PageHeader } from "../components/ui/PageHeader";
import { LoadingSpinner } from "../components/ui/LoadingSpinner";
import type { SessionSummary } from "../types/telemetry";
import { getSessionFormulaScopeKey } from "../utils/formulaScope";
import { getTrackId, sortTracksByCalendar } from "../utils/tracks";

type TrackSort = "default" | "sessions" | "race-result" | "race-pace";

interface TrackCardData {
  id: string;
  track: string;
  sessions: SessionSummary[];
  records: TrackRecords;
  paceGapMs: number | null;
}

const TRACK_SORT_OPTIONS: readonly PillSelectOption[] = [
  { value: "default", label: "Default order" },
  { value: "sessions", label: "Most sessions" },
  { value: "race-result", label: "Best race result" },
  { value: "race-pace", label: "Race pace vs. field" },
];

export function TracksPage() {
  const { sessions, loading, error } = useSessionList();
  const { scopeKey, activeFormulaKey, activeFormula, league } = useTelemetry();
  const [filters, setFilters] = useSessionFilters();
  const game = useGameScope();
  const [trackSort, setTrackSort] = useState<TrackSort>("default");

  const filteredSessions = useMemo(
    () =>
      sessions.filter(
        (session) =>
          (!activeFormulaKey ||
            getSessionFormulaScopeKey(session) === activeFormulaKey) &&
          matchesSessionFilters(session, filters),
      ),
    [activeFormulaKey, filters, sessions],
  );

  const sessionsByTrack = useMemo(() => {
    const grouped = new Map<string, SessionSummary[]>();
    for (const session of filteredSessions) {
      const trackId = getTrackId(session.track);
      const trackSessions = grouped.get(trackId) ?? [];
      trackSessions.push(session);
      grouped.set(trackId, trackSessions);
    }
    return grouped;
  }, [filteredSessions]);

  const calendarTracks = useMemo(
    () => sortTracksByCalendar([...sessionsByTrack.keys()], activeFormulaKey),
    [activeFormulaKey, sessionsByTrack],
  );

  const trackCards = useMemo(() => {
    const cards: TrackCardData[] = calendarTracks.map((id) => {
      const trackSessions = sessionsByTrack.get(id) ?? [];
      return {
        id,
        track: trackSessions[0]?.track ?? id,
        sessions: trackSessions,
        records: buildTrackRecords(trackSessions),
        paceGapMs: buildTrackLapPaceBenchmark(trackSessions)?.gapMs ?? null,
      };
    });

    if (trackSort === "default") return cards;

    const calendarOrder = new Map<string, number>();
    cards.forEach((card, index) => calendarOrder.set(card.id, index));
    return [...cards].sort((a, b) => {
      let comparison = 0;

      if (trackSort === "sessions") {
        comparison = b.sessions.length - a.sessions.length;
      } else if (trackSort === "race-result") {
        const aResult = a.records.race;
        const bResult = b.records.race;
        if (!aResult || !bResult) {
          comparison = aResult ? -1 : bResult ? 1 : 0;
        } else {
          comparison =
            Number(isProblemStatus(aResult.status)) -
            Number(isProblemStatus(bResult.status));
          if (comparison === 0) {
            comparison = aResult.position - bResult.position;
          }
        }
      } else if (trackSort === "race-pace") {
        if (a.paceGapMs == null || b.paceGapMs == null) {
          comparison = a.paceGapMs == null ? (b.paceGapMs == null ? 0 : 1) : -1;
        } else {
          comparison = a.paceGapMs - b.paceGapMs;
        }
      }

      return comparison || calendarOrder.get(a.id)! - calendarOrder.get(b.id)!;
    });
  }, [calendarTracks, sessionsByTrack, trackSort]);

  const resetFilters = () => {
    setFilters(DEFAULT_FILTERS);
    game.setGame("all");
  };

  if (loading) {
    return (
      <div
        role="status"
        aria-label="Loading tracks"
        className="flex h-full items-center justify-center"
      >
        <LoadingSpinner className="size-7 border-2" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="mx-auto flex min-h-80 max-w-6xl items-center justify-center px-4 py-6 sm:px-6 lg:px-8">
        <ActionEmptyState
          icon={AlertTriangle}
          title="Track data could not load"
          message={error}
          className="max-w-lg"
        />
      </div>
    );
  }

  const isFiltered =
    game.isFiltered || filters.type !== "all" || filters.mode !== "all";

  return (
    <PageFrame>
      <PageHeader
        icon={Route}
        eyebrow="Race archive"
        title="Tracks"
        description="Compare your results, pace, and progress at every circuit."
        meta={`${activeFormula?.label ?? "All games"} · ${league?.filterLabel ?? "All available dates"} · ${trackCards.length} ${trackCards.length === 1 ? "track" : "tracks"} · ${filteredSessions.length} ${filteredSessions.length === 1 ? "session" : "sessions"}`}
        action={
          <div className="flex flex-wrap items-center gap-2">
            <PillSelect
              ariaLabel="Sort tracks"
              leadingIcon={ArrowUpDown}
              value={trackSort}
              onChange={(value) => setTrackSort(value as TrackSort)}
              options={TRACK_SORT_OPTIONS}
              size="sm"
            />
            <SessionListFilterMenu
              value={filters}
              onChange={setFilters}
              game={game}
              onReset={resetFilters}
              showGame={false}
            />
          </div>
        }
      />

      {isFiltered && (
        <SessionListActiveFilters
          value={filters}
          gameLabel={game.isFiltered ? game.label : undefined}
          matchingCount={filteredSessions.length}
          totalCount={sessions.length}
          onReset={resetFilters}
        />
      )}

      {trackCards.length ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {trackCards.map(({ id, track, sessions: trackSessions, records }) => (
            <TrackOverviewCard
              key={id}
              track={track}
              sessions={trackSessions}
              scopeKey={scopeKey ?? undefined}
              records={records}
            />
          ))}
        </div>
      ) : (
        <ActionEmptyState
          icon={Route}
          title={isFiltered ? "No tracks match these filters" : "No tracks yet"}
          message={
            isFiltered
              ? "Reset the filters to see every track with saved sessions."
              : "Tracks will appear here when you have saved sessions for them."
          }
          className="max-w-none"
          actions={
            isFiltered && (
              <Button variant="secondary" onClick={resetFilters}>
                <RotateCcw className="size-3.5" />
                Reset filters
              </Button>
            )
          }
        />
      )}
    </PageFrame>
  );
}
