import { ShieldCheck } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { cardClass } from "../components/Card";
import { TrackFlag } from "../components/TrackFlag";
import { SectionHeader } from "../components/ui/SectionHeader";
import {
  tableCellClass,
  tableClassLoose,
  tableHeadClass,
  tableRowClass,
} from "../components/ui/table";
import { useTelemetry } from "../context/TelemetryContext";
import { raceFormulaKey, type LeagueRace } from "../league/league";
import {
  SR_START,
  SR_TIERS,
  srChangeIn,
  tierOf,
  type SafetyRow,
} from "../league/safety";
import { cn } from "../utils/cn";
import { toSlug } from "../utils/parseFilename";
import { sessionPath } from "../utils/routes";
import { getTrackDisplayName } from "../utils/tracks";

const HISTORY_ROWS = 10;

const signed = (n: number) => `${n > 0 ? "+" : ""}${n.toFixed(1)}`;

export function SafetyPage() {
  const { league } = useTelemetry();
  if (!league) {
    return (
      <div className="flex h-full items-center justify-center text-zinc-500">
        The safety rating needs the league race data.
      </div>
    );
  }
  const inPeriod = new Set(league.races.map((r) => r.file));
  // Drivers who raced in the filter period, ranked by their current SR
  const rows = [...league.safety.values()]
    .filter((r) => r.history.some((h) => inPeriod.has(h.file)))
    .sort((a, b) => b.sr - a.sr);
  const mine = league.selectedDriver
    ? league.safety.get(league.selectedDriver)
    : undefined;

  return (
    <div className="mx-auto max-w-5xl space-y-8 p-6">
      <div>
        <h2 className="mb-1 flex items-center gap-2 text-xl font-bold">
          <ShieldCheck className="h-5 w-5 text-emerald-400" />
          Safety rating
        </h2>
        <p className="text-sm text-zinc-500">
          Current rating over every race · change shown for {league.filterLabel} ·{" "}
          {rows.length} drivers
        </p>
      </div>

      {mine && (
        <MyRating
          row={mine}
          inPeriod={inPeriod}
          allRaces={league.allRaces}
          filterLabel={league.filterLabel}
        />
      )}

      {rows.length === 0 ? (
        <section className={cn(cardClass, "text-center text-sm text-zinc-400")}>
          No races in this period ({league.filterLabel}).{" "}
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
            hint="Click a driver to see their rating history"
          />
          <div className="overflow-x-auto">
            <table className={tableClassLoose}>
              <thead className={tableHeadClass}>
                <tr>
                  <th className={tableCellClass({ align: "right" })}>#</th>
                  <th className={tableCellClass()}>Tier</th>
                  <th className={tableCellClass()}>Driver</th>
                  <th className={tableCellClass({ align: "right" })}>SR</th>
                  <th className={tableCellClass({ align: "right" })}>Change</th>
                  <th className={tableCellClass({ align: "right" })}>Races</th>
                  <th className={tableCellClass({ align: "right" })}>IP / lap</th>
                  <th className={tableCellClass({ align: "right" })}>Contacts</th>
                  <th className={tableCellClass({ align: "right" })}>Warnings</th>
                  <th className={tableCellClass({ align: "right" })}>Penalties</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, i) => {
                  const isSelected = row.key === league.selectedDriver;
                  const change = srChangeIn(row, inPeriod);
                  return (
                    <tr
                      key={row.key}
                      onClick={() => {
                        league.setSelectedDriver(row.key);
                        window.scrollTo({ top: 0, behavior: "smooth" });
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
                          className: "text-zinc-500",
                        })}
                      >
                        {i + 1}
                      </td>
                      <td className={tableCellClass()}>
                        <TierBadge sr={row.sr} />
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
                      <Num v={row.sr.toFixed(1)} className={cn("font-semibold", tierOf(row.sr).color)} />
                      <Num
                        v={change == null ? "—" : signed(change)}
                        className={
                          change == null || Math.abs(change) < 0.05
                            ? "text-zinc-500"
                            : change > 0
                              ? "text-emerald-300"
                              : "text-red-300"
                        }
                      />
                      <Num v={row.races} />
                      <Num v={(row.points / row.laps).toFixed(2)} />
                      <Num v={row.contacts} />
                      <Num v={row.warnings} />
                      <Num v={row.penalties} />
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section className={cardClass}>
        <SectionHeader title="How it works" />
        <div className="space-y-3 text-sm text-zinc-400">
          <p>
            Everyone starts at {SR_START}. Each race gives incident points (IP): 2
            per contact with another car (once per car per lap), 1 per warning,
            2 per time penalty, 4 per drive-through and 6 per stop-go. A race
            cleaner than the league's usual 1.8 IP per lap raises your rating, a
            messier one lowers it. Longer races count more, and gains slow down
            near the top. The game doesn't say who caused a contact, so both
            cars get it.
          </p>
          <div className="flex flex-wrap gap-2">
            {SR_TIERS.map((t, i) => (
              <span
                key={t.tier}
                className={cn("rounded-md px-2 py-1 text-xs ring-1 ring-inset", t.ring, t.color)}
              >
                {t.tier} · {i === 0 ? `${t.min}+` : `${t.min}–${SR_TIERS[i - 1].min - 0.1}`}
              </span>
            ))}
          </div>
          <p className="text-xs text-zinc-500">
            The rating always counts every race; the time filter only changes
            who is listed and the Change column.
          </p>
        </div>
      </section>
    </div>
  );
}

function MyRating({
  row,
  inPeriod,
  allRaces,
  filterLabel,
}: {
  row: SafetyRow;
  inPeriod: Set<string>;
  allRaces: LeagueRace[];
  filterLabel: string;
}) {
  const navigate = useNavigate();
  const tier = tierOf(row.sr);
  const recent = row.history.slice(-HISTORY_ROWS).reverse();
  const raceByFile = new Map(allRaces.map((r) => [r.file, r]));
  const change = srChangeIn(row, inPeriod);
  return (
    <section className={cardClass}>
      <SectionHeader title={row.name} hint={`Last ${recent.length} races`} />
      <div className="mb-4 flex flex-wrap items-baseline gap-x-6 gap-y-2">
        <span className={cn("font-mono text-4xl font-bold tabular-nums", tier.color)}>
          {row.sr.toFixed(1)}
        </span>
        <TierBadge sr={row.sr} large />
        {change != null && (
          <span className="text-sm text-zinc-400">
            {signed(change)} in {filterLabel}
          </span>
        )}
        <span className="text-sm text-zinc-500">
          {row.races} races · {(row.points / row.laps).toFixed(2)} IP per lap
        </span>
      </div>
      <div className="overflow-x-auto">
        <table className={tableClassLoose}>
          <thead className={tableHeadClass}>
            <tr>
              <th className={tableCellClass()}>Race</th>
              <th className={tableCellClass({ align: "right" })}>Laps</th>
              <th className={tableCellClass({ align: "right" })}>Contacts</th>
              <th className={tableCellClass({ align: "right" })}>Warnings</th>
              <th className={tableCellClass({ align: "right" })}>Penalties</th>
              <th className={tableCellClass({ align: "right" })}>IP</th>
              <th className={tableCellClass({ align: "right" })}>SR</th>
            </tr>
          </thead>
          <tbody>
            {recent.map((h) => {
              const race = raceByFile.get(h.file);
              const track = race?.session["session-info"]?.["track-id"] ?? "";
              const delta = h.srAfter - h.srBefore;
              return (
                <tr
                  key={h.file}
                  onClick={() => {
                    if (race)
                      navigate(sessionPath(raceFormulaKey(race.session), toSlug(h.file)));
                  }}
                  className={cn(
                    tableRowClass,
                    "cursor-pointer transition-colors hover:bg-white/[0.03]",
                  )}
                >
                  <td className={tableCellClass()}>
                    <span className="flex items-center gap-2">
                      <TrackFlag track={track} size="small" />
                      <span className="text-zinc-100">{getTrackDisplayName(track)}</span>
                      <span className="font-mono text-xs text-zinc-500">
                        {h.date?.toISOString().slice(0, 10) ?? ""}
                      </span>
                    </span>
                  </td>
                  <Num v={h.laps} />
                  <Num v={h.contacts} />
                  <Num v={h.warnings} />
                  <Num v={h.penalties} />
                  <Num v={h.points} />
                  <Num
                    v={`${h.srAfter.toFixed(1)} (${signed(delta)})`}
                    className={delta >= 0 ? "text-emerald-300" : "text-red-300"}
                  />
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function TierBadge({ sr, large }: { sr: number; large?: boolean }) {
  const t = tierOf(sr);
  return (
    <span
      className={cn(
        "inline-flex items-center justify-center rounded-md font-mono font-bold ring-1 ring-inset",
        large ? "h-8 min-w-8 px-2 text-base" : "h-6 min-w-6 px-1.5 text-xs",
        t.ring,
        t.color,
      )}
    >
      {t.tier}
    </span>
  );
}

function Num({ v, className }: { v: number | string; className?: string }) {
  return (
    <td
      className={tableCellClass({
        align: "right",
        mono: true,
        className: cn("tabular-nums text-zinc-300", className),
      })}
    >
      {v}
    </td>
  );
}
