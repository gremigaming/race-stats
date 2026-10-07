import { Swords, User } from "lucide-react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { cardClass, cardClassFeature } from "../components/Card";
import { TrackFlag } from "../components/TrackFlag";
import { PillSelect } from "../components/ui/PillSelect";
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
  const { league, activeFormulaKey } = useTelemetry();
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
  const a = keys.includes(params.get("a") ?? "")
    ? (params.get("a") as string)
    : league.selectedDriver;
  const fallbackB = keys.find((k) => k !== a) ?? a;
  const b = keys.includes(params.get("b") ?? "")
    ? (params.get("b") as string)
    : fallbackB;
  const nameOf = (k: string) =>
    league.drivers.find((d) => d.key === k)?.name ?? k;
  const options = league.drivers.map((d) => ({ value: d.key, label: d.name }));
  const set = (which: "a" | "b", value: string) => {
    const next = new URLSearchParams(params);
    next.set("a", which === "a" ? value : a);
    next.set("b", which === "b" ? value : b);
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
          {total} {total === 1 ? "race" : "races"} together
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <PillSelect
          value={a}
          onChange={(v) => set("a", v)}
          options={options}
          ariaLabel="First driver"
          leadingIcon={User}
        />
        <span className="font-mono text-xs uppercase text-zinc-500">vs</span>
        <PillSelect
          value={b}
          onChange={(v) => set("b", v)}
          options={options}
          ariaLabel="Second driver"
          leadingIcon={User}
        />
      </div>

      {a === b ? (
        <p className="text-sm text-zinc-500">Pick two different drivers.</p>
      ) : total === 0 ? (
        <section className={cn(cardClass, "text-center text-sm text-zinc-400")}>
          {nameOf(a)} and {nameOf(b)} haven't raced each other yet.
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
            <div className="mt-4 grid grid-cols-[1fr_auto_1fr] items-center gap-4 border-t border-white/[0.06] pt-4">
              <div className="font-mono text-lg tabular-nums text-purple-300">
                {h2h.aFasterLap}
              </div>
              <div className="text-center font-mono text-xs uppercase tracking-wider text-zinc-500">
                Faster best lap
              </div>
              <div className="text-right font-mono text-lg tabular-nums text-purple-300">
                {h2h.bFasterLap}
              </div>
            </div>
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
                          league.setSelectedDriver(a);
                          if (activeFormulaKey)
                            navigate(sessionPath(activeFormulaKey, toSlug(r.file)));
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
