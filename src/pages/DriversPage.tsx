import { Trophy } from "lucide-react";
import { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { cardClass } from "../components/Card";
import { LeagueHighlights } from "../components/league/LeagueHighlights";
import { SectionHeader } from "../components/ui/SectionHeader";
import { SegmentedControl } from "../components/ui/SegmentedControl";
import { SortHeader, sortRows, useSort } from "../components/ui/SortHeader";
import {
  tableCellClass,
  tableClassLoose,
  tableHeadClass,
  tableRowClass,
} from "../components/ui/table";
import { useTelemetry } from "../context/TelemetryContext";
import {
  isNamedDriver,
  isRaceSession,
  leaderboard,
  raceFormulaKey,
  teamLeaderboard,
} from "../league/league";
import { cn } from "../utils/cn";
import { dashboardPath } from "../utils/routes";

const EMBED_ROWS = 15;

type SortKey =
  | "pos"
  | "name"
  | "races"
  | "points"
  | "wins"
  | "podiums"
  | "poles"
  | "fastestLaps"
  | "avgFinish"
  | "bestFinish"
  | "avgGain"
  | "dnfs";

type LeaderboardSeries = "f1-26" | "f1-25" | "f2";

const SERIES_OPTIONS: { value: LeaderboardSeries; label: string }[] = [
  { value: "f1-26", label: "F1 26" },
  { value: "f1-25", label: "F1 25" },
  { value: "f2", label: "F2" },
];

function seriesForFormula(key: string): LeaderboardSeries | null {
  if (key === "f1-26") return "f1-26";
  if (key === "f1-25" || key === "f1-modern") return "f1-25";
  if (key.startsWith("f2")) return "f2";
  return null;
}

const fmt = (n: number | null, digits = 1) =>
  n == null ? "—" : n.toFixed(digits);

export function DriversPage() {
  const { league, scopeKey, activeFormulaKey, activeFormula } = useTelemetry();
  const navigate = useNavigate();
  const location = useLocation();
  const [mode, setMode] = useState<"drivers" | "teams">("drivers");
  const [selectedSeries, setSelectedSeries] =
    useState<LeaderboardSeries>("f1-26");
  // The Discord picture: same table, top 15, with the site address
  const embed = new URLSearchParams(location.search).has("embed");
  const activeMode = embed ? "drivers" : mode;
  const { sort, toggle } = useSort<SortKey>();
  if (!league) {
    return (
      <div className="flex h-full items-center justify-center text-zinc-500">
        The leaderboard needs the league race data.
      </div>
    );
  }
  const races = league.races.filter(
    (r) =>
      isRaceSession(r.session) &&
      (!activeFormulaKey || raceFormulaKey(r.session) === activeFormulaKey),
  );
  const selectedFormulaSeries = embed
    ? null
    : activeFormulaKey
      ? seriesForFormula(activeFormulaKey)
      : selectedSeries;
  const visibleRaces = selectedFormulaSeries
    ? races.filter(
        (r) =>
          seriesForFormula(raceFormulaKey(r.session)) === selectedFormulaSeries,
      )
    : races;
  const formulaLabel =
    selectedFormulaSeries
      ? SERIES_OPTIONS.find(
          (option) => option.value === selectedFormulaSeries,
        )?.label
      : activeFormula?.label;
  const rangeLabel = league.filterLabel;
  const driverRows = leaderboard(visibleRaces);
  const allRows =
    activeMode === "drivers" ? driverRows : teamLeaderboard(visibleRaces);
  const rows = embed ? allRows.slice(0, EMBED_ROWS) : allRows;
  const position = new Map(allRows.map((r, i) => [r.key, i]));
  const sortedRows = sortRows(rows, sort, (r, k) =>
    k === "pos" ? position.get(r.key) : k === "bestFinish" ? r.bestFinish || null : r[k],
  );
  const sortProps = { sort, toggle };
  const hidden = visibleRaces.reduce(
    (n, r) =>
      n +
      (r.session["classification-data"] ?? []).filter((d) => !isNamedDriver(d))
        .length,
    0,
  );

  return (
    <div
      id="leaderboard-card"
      data-races={visibleRaces.length}
      className={cn("mx-auto max-w-5xl space-y-8 p-6", embed && "space-y-6 p-8")}
    >
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
        <div>
          <h2 className="mb-1 flex items-center gap-2 text-xl font-bold">
            <Trophy className="h-5 w-5 text-amber-400" />
            {embed ? "GreMi Gang Leaderboard" : "Leaderboard"}
          </h2>
          <p className="text-sm text-zinc-500">
            {formulaLabel ?? "All games"} · {rangeLabel} · {visibleRaces.length}{" "}
            {visibleRaces.length === 1 ? "race" : "races"} · {allRows.length}{" "}
            {activeMode === "drivers" ? "drivers" : "teams"}
          </p>
        </div>
        {!embed && (
          <div className="flex flex-wrap items-center justify-end gap-2">
            <SegmentedControl<"drivers" | "teams">
              size="sm"
              ariaLabel="Leaderboard standings"
              value={activeMode}
              onChange={setMode}
              options={[
                { value: "drivers", label: "Drivers" },
                { value: "teams", label: "Teams" },
              ]}
            />
            {!activeFormulaKey && (
              <SegmentedControl<LeaderboardSeries>
                size="sm"
                ariaLabel="Leaderboard series"
                value={selectedSeries}
                onChange={setSelectedSeries}
                options={SERIES_OPTIONS}
              />
            )}
          </div>
        )}
      </div>

      {rows.length === 0 ? (
        <section className={cn(cardClass, "text-center text-sm text-zinc-400")}>
          No {activeMode} in this period ({rangeLabel}).{" "}
          {league.filter.kind !== "all" && (
            <button
              type="button"
              onClick={() => league.setFilter({ kind: "all" })}
              className="font-medium text-red-300 hover:text-red-200"
            >
              Show all time
            </button>
          )}
        </section>
      ) : (
      <section className={cardClass}>
        <SectionHeader
          title={activeMode === "drivers" ? "Drivers" : "Teams"}
          hint={
            activeMode === "teams"
              ? "Points as awarded in the lobby · team totals include every classified car"
              : embed
                ? allRows.length > rows.length
                  ? `Top ${rows.length} · full standings at gremigaming.github.io/race-stats`
                  : "Full stats at gremigaming.github.io/race-stats"
                : "Points as awarded in the lobby · click a driver to see their stats"
          }
        />
        <div className="overflow-x-auto">
          <table className={tableClassLoose}>
            <thead className={tableHeadClass}>
              <tr>
                <SortHeader column="pos" firstDir="asc" {...sortProps}>#</SortHeader>
                <SortHeader column="name" firstDir="asc" align="left" {...sortProps}>
                  {activeMode === "drivers" ? "Driver" : "Team"}
                </SortHeader>
                <SortHeader column="races" {...sortProps}>Races</SortHeader>
                <SortHeader column="points" {...sortProps}>Points</SortHeader>
                <SortHeader column="wins" {...sortProps}>Wins</SortHeader>
                <SortHeader column="podiums" {...sortProps}>Podiums</SortHeader>
                <SortHeader column="poles" {...sortProps}>Poles</SortHeader>
                <SortHeader column="fastestLaps" {...sortProps}>Fastest laps</SortHeader>
                <SortHeader column="avgFinish" firstDir="asc" {...sortProps}>Avg finish</SortHeader>
                <SortHeader column="bestFinish" firstDir="asc" {...sortProps}>Best</SortHeader>
                <SortHeader column="avgGain" {...sortProps}>Avg gain</SortHeader>
                <SortHeader column="dnfs" firstDir="asc" {...sortProps}>DNF</SortHeader>
              </tr>
            </thead>
            <tbody>
              {sortedRows.map((row) => {
                const i = position.get(row.key) ?? 0;
                const isSelected =
                  activeMode === "drivers" &&
                  !embed &&
                  row.key === league.selectedDriver;
                return (
                  <tr
                    key={row.key}
                    onClick={
                      activeMode === "drivers"
                        ? () => {
                            league.setSelectedDriver(row.key);
                            navigate(dashboardPath(scopeKey));
                          }
                        : undefined
                    }
                    className={cn(
                      tableRowClass,
                      "transition-colors hover:bg-white/[0.03]",
                      activeMode === "drivers" && "cursor-pointer",
                      isSelected && "bg-red-500/[0.07]",
                    )}
                  >
                    <td
                      className={tableCellClass({
                        align: "right",
                        mono: true,
                        className: i < 3 ? "text-amber-300" : "text-zinc-500",
                      })}
                    >
                      {i + 1}
                    </td>
                    <td
                      className={tableCellClass({
                        className: cn(
                          "font-medium",
                          isSelected ? "text-red-300" : "text-zinc-100",
                        ),
                      })}
                    >
                      {row.name}
                    </td>
                    <Num v={row.races} />
                    <Num v={row.points} strong />
                    <Num v={row.wins} />
                    <Num v={row.podiums} />
                    <Num v={row.poles} />
                    <Num v={row.fastestLaps} purple={row.fastestLaps > 0} />
                    <Num v={fmt(row.avgFinish)} />
                    <Num v={row.bestFinish ? `P${row.bestFinish}` : "—"} />
                    <Num
                      v={
                        row.avgGain == null
                          ? "—"
                          : `${row.avgGain > 0 ? "+" : ""}${fmt(row.avgGain)}`
                      }
                      green={(row.avgGain ?? 0) > 0}
                      red={(row.avgGain ?? 0) < 0}
                    />
                    <Num v={row.dnfs} />
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {hidden > 0 && !embed && activeMode === "drivers" && (
          <p className="mt-4 text-xs text-zinc-500">
            {hidden} {hidden === 1 ? "entry is" : "entries are"} left out
            because those drivers hide their online name in the game. Turn on
            "Show online names" to get your own stats.
          </p>
        )}
      </section>
      )}

      {!embed && activeMode === "drivers" && rows.length > 0 && (
        <LeagueHighlights rows={allRows} />
      )}
    </div>
  );
}

function Num({
  v,
  strong,
  purple,
  green,
  red,
}: {
  v: number | string;
  strong?: boolean;
  purple?: boolean;
  green?: boolean;
  red?: boolean;
}) {
  return (
    <td
      className={tableCellClass({
        align: "right",
        mono: true,
        className: cn(
          "tabular-nums",
          strong ? "font-semibold text-zinc-100" : "text-zinc-300",
          purple && "text-purple-300",
          green && "text-emerald-300",
          red && "text-red-300",
        ),
      })}
    >
      {v}
    </td>
  );
}
