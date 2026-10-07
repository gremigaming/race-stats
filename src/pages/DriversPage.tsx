import { Trophy } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import { cardClass } from "../components/Card";
import { SectionHeader } from "../components/ui/SectionHeader";
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
} from "../league/league";
import { cn } from "../utils/cn";
import { dashboardPath } from "../utils/routes";

const EMBED_ROWS = 15;

const fmt = (n: number | null, digits = 1) =>
  n == null ? "—" : n.toFixed(digits);

export function DriversPage() {
  const { league, activeFormulaKey, activeFormula } = useTelemetry();
  const navigate = useNavigate();
  const location = useLocation();
  // The Discord picture: same table, top 15, with the site address
  const embed = new URLSearchParams(location.search).has("embed");
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
  const rangeLabel = league.filterLabel;
  const allRows = leaderboard(races);
  const rows = embed ? allRows.slice(0, EMBED_ROWS) : allRows;
  const hidden = races.reduce(
    (n, r) =>
      n +
      (r.session["classification-data"] ?? []).filter((d) => !isNamedDriver(d))
        .length,
    0,
  );

  return (
    <div
      id="leaderboard-card"
      data-races={races.length}
      className={cn("mx-auto max-w-5xl space-y-8 p-6", embed && "space-y-6 p-8")}
    >
      <div>
        <h2 className="mb-1 flex items-center gap-2 text-xl font-bold">
          <Trophy className="h-5 w-5 text-amber-400" />
          {embed ? "GreMi Gang Leaderboard" : "Leaderboard"}
        </h2>
        <p className="text-sm text-zinc-500">
          {activeFormula?.label ?? "All"} · {rangeLabel} · {races.length}{" "}
          {races.length === 1 ? "race" : "races"} · {allRows.length} drivers
        </p>
      </div>

      {rows.length === 0 ? (
        <section className={cn(cardClass, "text-center text-sm text-zinc-400")}>
          No races in this period ({rangeLabel}).{" "}
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
          title="Drivers"
          hint={
            embed
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
                <th className={tableCellClass({ align: "right" })}>#</th>
                <th className={tableCellClass()}>Driver</th>
                <th className={tableCellClass({ align: "right" })}>Races</th>
                <th className={tableCellClass({ align: "right" })}>Points</th>
                <th className={tableCellClass({ align: "right" })}>Wins</th>
                <th className={tableCellClass({ align: "right" })}>Podiums</th>
                <th className={tableCellClass({ align: "right" })}>Poles</th>
                <th className={tableCellClass({ align: "right" })}>
                  Fastest laps
                </th>
                <th className={tableCellClass({ align: "right" })}>
                  Avg finish
                </th>
                <th className={tableCellClass({ align: "right" })}>Best</th>
                <th className={tableCellClass({ align: "right" })}>
                  Avg gain
                </th>
                <th className={tableCellClass({ align: "right" })}>DNF</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => {
                const isSelected = !embed && row.key === league.selectedDriver;
                return (
                  <tr
                    key={row.key}
                    onClick={() => {
                      league.setSelectedDriver(row.key);
                      navigate(dashboardPath(activeFormulaKey));
                    }}
                    className={cn(
                      tableRowClass,
                      "cursor-pointer transition-colors hover:bg-white/[0.03]",
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
        {hidden > 0 && !embed && (
          <p className="mt-4 text-xs text-zinc-500">
            {hidden} {hidden === 1 ? "entry is" : "entries are"} left out
            because those drivers hide their online name in the game. Turn on
            "Show online names" to get your own stats.
          </p>
        )}
      </section>
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
