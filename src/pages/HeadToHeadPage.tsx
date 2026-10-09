import { Swords } from "lucide-react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { cardClass, cardClassFeature } from "../components/Card";
import { TrackFlag } from "../components/TrackFlag";
import { DriverSearchSelect } from "../components/DriverSearchSelect";
import { SectionHeader } from "../components/ui/SectionHeader";
import {
  tableCellClass,
  tableClassLoose,
  tableHeadClass,
  tableRowClass,
} from "../components/ui/table";
import { useTelemetry } from "../context/TelemetryContext";
import {
  formatLap,
  formatStatus,
  headToHead,
  raceFormulaKey,
} from "../league/league";
import { cn } from "../utils/cn";
import { sessionPath } from "../utils/routes";
import { getTrackDisplayName } from "../utils/tracks";
import { toSlug } from "../utils/parseFilename";

export function HeadToHeadPage() {
  const { league, scopeKey, activeFormulaKey } = useTelemetry();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  if (!league || league.drivers.length < 2) {
    return (
      <div className="flex h-full items-center justify-center text-zinc-500">
        Head to head needs at least two drivers with races.
      </div>
    );
  }
  const keys = league.drivers.map((d) => d.key);
  // The first driver is always the one picked at the top of the sidebar
  const a = league.selectedDriver;
  const fallbackB = keys.find((k) => k !== a) ?? a;
  const wantedB = params.get("b") ?? "";
  const b = keys.includes(wantedB) && wantedB !== a ? wantedB : fallbackB;
  const nameOf = (k: string) =>
    league.drivers.find((d) => d.key === k)?.name ?? k;
  const set = (which: "a" | "b", value: string) => {
    if (which === "a") {
      league.setSelectedDriver(value);
      return;
    }
    const next = new URLSearchParams(params);
    next.delete("a");
    next.set("b", value);
    setParams(next, { replace: true });
  };

  const races = league.races.filter(
    (r) => !activeFormulaKey || raceFormulaKey(r.session) === activeFormulaKey,
  );
  const h2h = headToHead(races, a, b);
  const total = h2h.races.length;

  return (
    <div className="mx-auto max-w-5xl space-y-8 p-6">
      <div>
        <h2 className="mb-1 flex items-center gap-2 text-xl font-bold">
          <Swords className="h-5 w-5 text-red-400" />
          Head to head
        </h2>
        <p className="text-sm text-zinc-500">
          {league.filterLabel} · {total} {total === 1 ? "race" : "races"} together
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <DriverSearchSelect
          drivers={league.drivers}
          value={a}
          onChange={(v) => set("a", v)}
          ariaLabel="First driver"
          className="w-56"
        />
        <span className="font-mono text-xs uppercase text-zinc-500">vs</span>
        <DriverSearchSelect
          drivers={league.drivers}
          value={b}
          onChange={(v) => set("b", v)}
          ariaLabel="Second driver"
          className="w-56"
        />
      </div>

      {a === b ? (
        <p className="text-sm text-zinc-500">Pick two different drivers.</p>
      ) : total === 0 ? (
        <section className={cn(cardClass, "text-center text-sm text-zinc-400")}>
          {nameOf(a)} and {nameOf(b)} didn't race each other in this period.
        </section>
      ) : (
        <>
          <section className={cardClassFeature}>
            <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-4">
              <Side name={nameOf(a)} score={h2h.aAhead} lead={h2h.aAhead > h2h.bAhead} />
              <div className="text-center font-mono text-xs uppercase tracking-wider text-zinc-500">
                Finished ahead
              </div>
              <Side
                name={nameOf(b)}
                score={h2h.bAhead}
                lead={h2h.bAhead > h2h.aAhead}
                right
              />
            </div>
          </section>

          <section className={cardClass}>
            <SectionHeader
              title="Tale of the tape"
              hint="Only the races they were both in"
            />
            <div className="divide-y divide-white/[0.04]">
              <StatRow label="Qualified ahead" a={h2h.a.qualiAhead} b={h2h.b.qualiAhead} />
              <StatRow label="Faster best lap" a={h2h.a.fasterLap} b={h2h.b.fasterLap} purple />
              <StatRow
                label="Better race pace"
                hint="Median clean lap"
                a={h2h.a.betterPace}
                b={h2h.b.betterPace}
              />
              <StatRow label="Points" a={h2h.a.points} b={h2h.b.points} />
              <StatRow label="Wins" a={h2h.a.wins} b={h2h.b.wins} />
              <StatRow label="Podiums" a={h2h.a.podiums} b={h2h.b.podiums} />
              <StatRow
                label="Average finish"
                a={h2h.a.avgFinish}
                b={h2h.b.avgFinish}
                lowerWins
                format={(v) => `P${v.toFixed(1)}`}
              />
              <StatRow
                label="Average grid"
                a={h2h.a.avgGrid}
                b={h2h.b.avgGrid}
                lowerWins
                format={(v) => `P${v.toFixed(1)}`}
              />
              <StatRow
                label="Places gained"
                a={h2h.a.gained}
                b={h2h.b.gained}
                format={(v) => `${v > 0 ? "+" : ""}${v}`}
              />
              <StatRow label="Overtakes made" a={h2h.a.overtakes} b={h2h.b.overtakes} />
              <StatRow
                label="Passed each other"
                a={h2h.a.passedRival}
                b={h2h.b.passedRival}
              />
              <StatRow
                label="Top speed"
                a={h2h.a.topSpeed}
                b={h2h.b.topSpeed}
                format={(v) => `${v} km/h`}
              />
              <StatRow
                label="Warnings & penalties"
                a={h2h.a.incidents}
                b={h2h.b.incidents}
                lowerWins
              />
              <StatRow label="DNFs" a={h2h.a.dnfs} b={h2h.b.dnfs} lowerWins />
            </div>
            <p className="mt-4 text-center text-xs text-zinc-500">
              {h2h.contact === 0
                ? "No contact between these two yet. Clean racing."
                : `They touched ${h2h.contact} ${h2h.contact === 1 ? "time" : "times"}.`}
            </p>
          </section>

          <section className={cardClass}>
            <SectionHeader title="Races together" hint="Newest first · click a race to open it" />
            <div className="overflow-x-auto">
              <table className={tableClassLoose}>
                <thead className={tableHeadClass}>
                  <tr>
                    <th className={tableCellClass()}>Race</th>
                    <th className={tableCellClass({ align: "right" })}>{nameOf(a)}</th>
                    <th className={tableCellClass({ align: "right" })}>{nameOf(b)}</th>
                    <th className={tableCellClass({ align: "right" })}>Best lap</th>
                    <th className={tableCellClass({ align: "right" })}>Best lap</th>
                  </tr>
                </thead>
                <tbody>
                  {h2h.races.map((r) => {
                    const aFaster =
                      r.a.bestLapMs != null &&
                      r.b.bestLapMs != null &&
                      r.a.bestLapMs < r.b.bestLapMs;
                    const bFaster =
                      r.a.bestLapMs != null &&
                      r.b.bestLapMs != null &&
                      r.b.bestLapMs < r.a.bestLapMs;
                    return (
                      <tr
                        key={r.file}
                        onClick={() => {
                          // Open the race as driver a, already compared with b
                          league.setSelectedDriver(a);
                          if (scopeKey)
                            navigate(
                              `${sessionPath(scopeKey, toSlug(r.file))}?vs=${encodeURIComponent(b)}`,
                            );
                        }}
                        className={cn(
                          tableRowClass,
                          "cursor-pointer transition-colors hover:bg-white/[0.03]",
                        )}
                      >
                        <td className={tableCellClass()}>
                          <span className="flex items-center gap-2">
                            <TrackFlag track={r.track} size="small" />
                            <span className="text-zinc-100">
                              {getTrackDisplayName(r.track)}
                            </span>
                            <span className="font-mono text-xs text-zinc-500">
                              {r.date.slice(0, 10)}
                            </span>
                          </span>
                        </td>
                        <Result text={formatStatus(r.a)} win={rank(r.a) < rank(r.b)} />
                        <Result text={formatStatus(r.b)} win={rank(r.b) < rank(r.a)} />
                        <Result text={formatLap(r.a.bestLapMs)} purple={aFaster} />
                        <Result text={formatLap(r.b.bestLapMs)} purple={bFaster} />
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </div>
  );
}

function rank(r: { position: number | null; status: string }): number {
  const ok = r.status === "FINISHED" || r.status === "ACTIVE" || r.status === "";
  return ok && r.position != null ? r.position : 1000;
}

function Side({
  name,
  score,
  lead,
  right,
}: {
  name: string;
  score: number;
  lead: boolean;
  right?: boolean;
}) {
  return (
    <div className={cn("min-w-0", right && "text-right")}>
      <div className="truncate text-sm font-semibold text-zinc-200">{name}</div>
      <div
        className={cn(
          "font-mono text-4xl font-bold tabular-nums",
          lead ? "text-emerald-300" : "text-zinc-400",
        )}
      >
        {score}
      </div>
    </div>
  );
}

function Result({
  text,
  win,
  purple,
}: {
  text: string;
  win?: boolean;
  purple?: boolean;
}) {
  return (
    <td
      className={tableCellClass({
        align: "right",
        mono: true,
        className: cn(
          "tabular-nums",
          win ? "font-semibold text-emerald-300" : "text-zinc-300",
          purple && "text-purple-300",
        ),
      })}
    >
      {text}
    </td>
  );
}

function StatRow({
  label,
  hint,
  a,
  b,
  lowerWins,
  purple,
  format = (v) => String(v),
}: {
  label: string;
  hint?: string;
  a: number | null;
  b: number | null;
  lowerWins?: boolean;
  purple?: boolean;
  format?: (v: number) => string;
}) {
  const both = a != null && b != null && a !== b;
  const aWins = both && (lowerWins ? a < b : a > b);
  const bWins = both && !aWins;
  // Share of the bar for a; even split when there's nothing to compare
  const base = Math.min(0, a ?? 0, b ?? 0);
  const va = (a ?? 0) - base;
  const vb = (b ?? 0) - base;
  const total = va + vb;
  let share = total ? va / total : 0.5;
  if (lowerWins && total) share = 1 - share;
  const win = purple ? "text-purple-300" : "text-emerald-300";
  return (
    <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-4 py-2.5">
      <div
        className={cn(
          "font-mono text-sm tabular-nums",
          aWins ? cn("font-semibold", win) : "text-zinc-400",
        )}
      >
        {a == null ? "—" : format(a)}
      </div>
      <div className="w-40 text-center sm:w-56">
        <div className="text-xs text-zinc-300">{label}</div>
        {hint && <div className="text-[10px] text-zinc-600">{hint}</div>}
        <div className="mt-1.5 flex h-1 overflow-hidden rounded-full bg-zinc-800">
          <div
            className={cn("h-full", aWins ? "bg-emerald-400/70" : "bg-zinc-600")}
            style={{ width: `${share * 100}%` }}
          />
          <div
            className={cn("h-full flex-1", bWins ? "bg-emerald-400/70" : "bg-zinc-700")}
          />
        </div>
      </div>
      <div
        className={cn(
          "text-right font-mono text-sm tabular-nums",
          bWins ? cn("font-semibold", win) : "text-zinc-400",
        )}
      >
        {b == null ? "—" : format(b)}
      </div>
    </div>
  );
}
