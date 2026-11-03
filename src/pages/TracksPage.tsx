import { useMemo } from "react";
import { SectionHeader } from "../components/ui/SectionHeader";
import { SessionListActiveFilters } from "../components/SessionListActiveFilters";
import { SessionListFilterMenu } from "../components/SessionListFilterMenu";
import { TrackOverviewCard } from "../components/dashboard/TrackOverviewCard";
import { buildTrackRecords } from "../components/dashboard/helpers";
import { useTelemetry } from "../context/TelemetryContext";
import {
  DEFAULT_FILTERS,
  matchesSessionFilters,
  useSessionFilters,
} from "../hooks/useSessionFilters";
import { useSessionList } from "../hooks/useSessionList";
import { useGameScope } from "../hooks/useGameScope";
import type { SessionSummary } from "../types/telemetry";
import { getSessionFormulaScopeKey } from "../utils/formulaScope";
import { getTrackId, sortTracksByCalendar } from "../utils/tracks";

export function TracksPage() {
  const { sessions, loading, error } = useSessionList();
  const { scopeKey, activeFormulaKey, activeFormula, league } = useTelemetry();
  const [filters, setFilters] = useSessionFilters();
  const game = useGameScope();

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

  const tracks = useMemo(
    () => sortTracksByCalendar([...sessionsByTrack.keys()], activeFormulaKey),
    [activeFormulaKey, sessionsByTrack],
  );

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
        <div
          aria-hidden="true"
          className="size-7 animate-spin rounded-full border-2 border-zinc-700 border-t-red-500"
        />
      </div>
    );
  }

  if (error) {
    return (
      <div className="mx-auto max-w-5xl p-6 text-sm text-red-300">
        Tracks could not be loaded: {error}
      </div>
    );
  }

  const isFiltered =
    game.isFiltered || filters.type !== "all" || filters.mode !== "all";

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6">
      <SectionHeader
        title="All tracks"
        hint={`${activeFormula?.label ?? "All games"} · ${league?.filterLabel ?? "All available dates"} · ${tracks.length} ${tracks.length === 1 ? "track" : "tracks"} · ${filteredSessions.length} ${filteredSessions.length === 1 ? "session" : "sessions"}`}
        action={
          <SessionListFilterMenu
            value={filters}
            onChange={setFilters}
            game={game}
            onReset={resetFilters}
          />
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

      {tracks.length ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {tracks.map((trackId) => {
            const trackSessions = sessionsByTrack.get(trackId) ?? [];
            const track = trackSessions[0]?.track ?? trackId;
            return (
              <TrackOverviewCard
                key={trackId}
                track={track}
                sessions={trackSessions}
                scopeKey={scopeKey ?? undefined}
                records={buildTrackRecords(trackSessions)}
              />
            );
          })}
        </div>
      ) : (
        <div className="rounded-2xl bg-zinc-900/50 px-5 py-8 text-center">
          <h2 className="text-sm font-semibold text-zinc-300">
            {isFiltered ? "No tracks match these filters" : "No tracks yet"}
          </h2>
          <p className="mt-1 text-sm text-zinc-500">
            {isFiltered
              ? "Reset the filters to see every track with saved sessions."
              : "Tracks will appear here when you have saved sessions for them."}
          </p>
        </div>
      )}
    </div>
  );
}
