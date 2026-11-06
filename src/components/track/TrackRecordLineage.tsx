import { ArrowUpRight, Crown, History, TimerReset } from "lucide-react";
import { useMemo } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { cardClass, cardClassCompact, cardClassFeature } from "../Card";
import { SectionHeader } from "../ui/SectionHeader";
import { SegmentedControl } from "../ui/SegmentedControl";
import type { FormulaScopeOption } from "../../utils/formulaScope";
import { sessionPath } from "../../utils/routes";
import { formatDate, msToLapTime } from "../../utils/format";
import type {
  TrackRecordCandidate,
  TrackRecordDiscipline,
  TrackRecordEvent,
} from "../../analysis/trackRecordLineage";
import { buildTrackRecordEvents } from "../../analysis/trackRecordLineage";

const RECORD_FORMULA_QUERY_PARAM = "recordFormula";
const RECORD_DISCIPLINE_QUERY_PARAM = "recordType";
const DAY_MS = 24 * 60 * 60 * 1000;
const RECORD_DISCIPLINES = ["race", "qualifying"] as const;

function formatDuration(durationMs: number): string {
  const days = Math.floor(durationMs / DAY_MS);
  if (days > 0) return `${days} day${days === 1 ? "" : "s"}`;
  const hours = Math.floor(durationMs / (60 * 60 * 1000));
  if (hours > 0) return `${hours} hr${hours === 1 ? "" : "s"}`;
  return "less than a day";
}

function formatImprovement(improvementMs: number | null): string {
  if (improvementMs == null || improvementMs <= 0) return "—";
  return `${(improvementMs / 1000).toFixed(3)}s`;
}

function formatChartDate(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString("en-GB", {
    month: "short",
    year: "2-digit",
  });
}

function RecordTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ payload?: TrackRecordEvent }>;
}) {
  const event = payload?.[0]?.payload;
  if (!active || !event) return null;

  return (
    <div className="rounded-xl border border-white/10 bg-zinc-950/95 px-3 py-2 shadow-xl">
      <p className="text-xs text-zinc-500">{formatDate(event.date)}</p>
      <p className="mt-1 font-semibold text-zinc-100">{event.driverName}</p>
      <p className="font-mono text-sm tabular-nums text-rose-200">
        {msToLapTime(event.lapTimeMs)}
      </p>
      {event.improvementMs != null && (
        <p className="mt-0.5 text-xs text-emerald-300">
          {formatImprovement(event.improvementMs)} faster
        </p>
      )}
    </div>
  );
}

function RecordStat({ label, value }: { label: string; value: string }) {
  return (
    <div className={`${cardClassCompact} min-w-0`}>
      <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-500">
        {label}
      </p>
      <p className="mt-1 truncate font-mono text-lg font-semibold tabular-nums text-zinc-100">
        {value}
      </p>
    </div>
  );
}

function eventDescription(event: TrackRecordEvent): string {
  const label = event.discipline === "qualifying" ? "qualifying" : "race";
  if (event.kind === "first") {
    return `First verified ${label} record in the archive`;
  }
  if (event.kind === "improved") return `Improved their own ${label} record`;
  return `Took the ${label} record from ${event.previousHolder}`;
}

function RecordTimelineRow({
  event,
  scopeKey,
  isCurrent,
}: {
  event: TrackRecordEvent;
  scopeKey?: string;
  isCurrent: boolean;
}) {
  return (
    <li className="relative grid gap-3 border-l border-white/[0.08] pb-6 pl-5 last:border-transparent last:pb-0 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
      <span
        aria-hidden="true"
        className={`absolute -left-[5px] top-1.5 size-2.5 rounded-full ring-4 ring-zinc-900 ${isCurrent ? "bg-rose-300" : "bg-zinc-600"}`}
      />
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="font-semibold text-zinc-100">
            {event.driverName}
          </span>
          {isCurrent && (
            <span className="rounded-full bg-rose-400/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-rose-200">
              Current holder
            </span>
          )}
        </div>
        <p className="mt-1 text-xs text-zinc-500">
          {eventDescription(event)} · {formatDate(event.date)}
        </p>
        <p className="mt-1 text-xs text-zinc-600">
          {isCurrent ? "Record held for " : "Record stood for "}
          {formatDuration(event.heldMs)}
          {event.weather && event.weather !== "Unknown"
            ? ` · ${event.weather}`
            : ""}
          {event.trackTemperature > 0
            ? ` · Track ${event.trackTemperature}°C`
            : ""}
        </p>
      </div>
      <div className="flex items-center justify-between gap-4 sm:justify-end">
        <div className="text-left sm:text-right">
          <p className="font-mono text-base font-semibold tabular-nums text-zinc-100">
            {msToLapTime(event.lapTimeMs)}
          </p>
          {event.improvementMs != null && (
            <p className="mt-0.5 font-mono text-xs tabular-nums text-emerald-300">
              −{formatImprovement(event.improvementMs)}
            </p>
          )}
        </div>
        <Link
          to={sessionPath(scopeKey ?? event.formulaKey, event.slug)}
          className="inline-flex min-h-9 shrink-0 items-center gap-1 rounded-lg px-2 text-xs font-medium text-zinc-400 transition hover:bg-white/[0.05] hover:text-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-red/70"
          aria-label={`Open ${event.driverName}'s record-setting session`}
        >
          Session <ArrowUpRight className="size-3.5" />
        </Link>
      </div>
    </li>
  );
}

export function TrackRecordLineage({
  candidates,
  activeFormulaKey,
  formulaOptions,
  scopeKey,
}: {
  candidates: readonly TrackRecordCandidate[];
  activeFormulaKey?: string;
  formulaOptions: readonly FormulaScopeOption[];
  scopeKey?: string;
}) {
  const [searchParams, setSearchParams] = useSearchParams();
  const availableFormulaOptions = formulaOptions.filter((option) =>
    candidates.some((candidate) => candidate.formulaKey === option.key),
  );
  const requestedFormula = searchParams.get(RECORD_FORMULA_QUERY_PARAM);
  const selectedFormulaKey =
    activeFormulaKey ??
    (availableFormulaOptions.some((option) => option.key === requestedFormula)
      ? requestedFormula!
      : (availableFormulaOptions[0]?.key ?? ""));
  const selectedFormula = availableFormulaOptions.find(
    (option) => option.key === selectedFormulaKey,
  );
  const formulaCandidates = useMemo(
    () =>
      candidates.filter(
        (candidate) => candidate.formulaKey === selectedFormulaKey,
      ),
    [candidates, selectedFormulaKey],
  );
  const availableDisciplines: TrackRecordDiscipline[] =
    RECORD_DISCIPLINES.filter((discipline) =>
      formulaCandidates.some(
        (candidate) => candidate.discipline === discipline,
      ),
    );
  const requestedDiscipline = searchParams.get(RECORD_DISCIPLINE_QUERY_PARAM);
  const discipline: TrackRecordDiscipline = availableDisciplines.includes(
    requestedDiscipline as TrackRecordDiscipline,
  )
    ? (requestedDiscipline as TrackRecordDiscipline)
    : availableDisciplines.includes("race")
      ? "race"
      : (availableDisciplines[0] ?? "race");
  const disciplineCandidates = useMemo(
    () =>
      formulaCandidates.filter(
        (candidate) => candidate.discipline === discipline,
      ),
    [formulaCandidates, discipline],
  );
  const events = useMemo(
    () => buildTrackRecordEvents(disciplineCandidates),
    [disciplineCandidates],
  );
  const current = events[events.length - 1];
  const biggestImprovement = events.reduce<TrackRecordEvent | null>(
    (biggest, event) =>
      event.improvementMs != null &&
      (!biggest || event.improvementMs > (biggest.improvementMs ?? 0))
        ? event
        : biggest,
    null,
  );
  const longestHeld = events.reduce<TrackRecordEvent | null>(
    (longest, event) =>
      !longest || event.heldMs > longest.heldMs ? event : longest,
    null,
  );
  const handovers = events.filter((event) => event.kind === "taken").length;

  const selectFormula = (formulaKey: string) => {
    setSearchParams(
      (currentParams) => {
        const next = new URLSearchParams(currentParams);
        next.set(RECORD_FORMULA_QUERY_PARAM, formulaKey);
        return next;
      },
      { replace: true },
    );
  };
  const selectDiscipline = (nextDiscipline: TrackRecordDiscipline) => {
    setSearchParams(
      (currentParams) => {
        const next = new URLSearchParams(currentParams);
        next.set(RECORD_DISCIPLINE_QUERY_PARAM, nextDiscipline);
        return next;
      },
      { replace: true },
    );
  };

  return (
    <section className="space-y-5" aria-labelledby="record-lineage-title">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <SectionHeader
            title={
              <span
                id="record-lineage-title"
                className="inline-flex items-center gap-2"
              >
                <History className="size-5 text-rose-300" /> Record Lineage
              </span>
            }
            hint="Follow the official race or qualifying lap record through the GreMi archive"
            className="mb-0"
          />
        </div>
        <div className="flex max-w-full flex-wrap items-center gap-2">
          {!activeFormulaKey && availableFormulaOptions.length > 1 && (
            <SegmentedControl
              ariaLabel="Game and formula for track records"
              options={availableFormulaOptions.map((option) => ({
                value: option.key,
                label: option.label,
              }))}
              value={selectedFormulaKey}
              onChange={selectFormula}
              scrollable
            />
          )}
          {availableDisciplines.length > 1 && (
            <SegmentedControl<TrackRecordDiscipline>
              ariaLabel="Record session type"
              options={availableDisciplines.map((value) => ({
                value,
                label: value === "qualifying" ? "Qualifying" : "Race",
              }))}
              value={discipline}
              onChange={selectDiscipline}
              scrollable
            />
          )}
        </div>
      </div>

      {!current ? (
        <div className={cardClass}>
          <div className="flex items-start gap-3">
            <History className="mt-0.5 size-5 shrink-0 text-zinc-500" />
            <div>
              <h3 className="font-semibold text-zinc-100">
                No verified records yet
              </h3>
              <p className="mt-1 max-w-2xl text-sm leading-relaxed text-zinc-500">
                Record Lineage uses the official fastest lap from named-driver
                online races and qualifying sessions. This archive has no
                eligible record for {selectedFormula?.label ?? "this game"} at
                this circuit yet.
              </p>
            </div>
          </div>
        </div>
      ) : (
        <>
          <div
            className={`${cardClassFeature} grid gap-5 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center`}
          >
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <Crown className="size-4 text-rose-200" />
                <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-rose-200/80">
                  GreMi {discipline === "qualifying" ? "qualifying" : "race"}{" "}
                  lap record
                </p>
                {selectedFormula && (
                  <span className="rounded-full bg-black/20 px-2 py-0.5 text-[10px] text-zinc-400">
                    {selectedFormula.label}
                  </span>
                )}
              </div>
              <p className="mt-2 font-mono text-4xl font-bold tracking-tight tabular-nums text-white sm:text-5xl">
                {msToLapTime(current.lapTimeMs)}
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-zinc-300">
                <span className="font-semibold text-zinc-100">
                  {current.driverName}
                </span>
                <span className="text-zinc-600">·</span>
                <span>{formatDate(current.date)}</span>
                <span className="text-zinc-600">·</span>
                <span>Held for {formatDuration(current.heldMs)}</span>
              </div>
            </div>
            <Link
              to={sessionPath(scopeKey ?? current.formulaKey, current.slug)}
              className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl border border-white/10 bg-black/20 px-3 text-sm font-medium text-zinc-200 transition hover:border-rose-200/20 hover:bg-black/30 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-red/70"
            >
              Open record session <ArrowUpRight className="size-4" />
            </Link>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <RecordStat label="Handovers" value={String(handovers)} />
            <RecordStat
              label="Biggest improvement"
              value={formatImprovement(
                biggestImprovement?.improvementMs ?? null,
              )}
            />
            <RecordStat
              label="Longest held"
              value={longestHeld ? formatDuration(longestHeld.heldMs) : "—"}
            />
          </div>

          {events.length > 1 && (
            <section className={cardClass} aria-label="Record time over time">
              <SectionHeader
                title="The record staircase"
                hint={`${events.length} verified ${discipline} record marks · fastest time in each era`}
              />
              <ResponsiveContainer width="100%" height={250}>
                <LineChart
                  data={events}
                  margin={{ top: 8, right: 16, bottom: 4, left: 4 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="#ffffff12" />
                  <XAxis
                    dataKey="timestamp"
                    type="number"
                    scale="time"
                    domain={["dataMin", "dataMax"]}
                    tickFormatter={formatChartDate}
                    stroke="#71717a"
                    fontSize={11}
                    minTickGap={24}
                  />
                  <YAxis
                    dataKey="lapTimeMs"
                    type="number"
                    domain={["auto", "auto"]}
                    tickFormatter={(value: number) => msToLapTime(value)}
                    stroke="#71717a"
                    fontSize={11}
                    width={74}
                  />
                  <Tooltip content={<RecordTooltip />} />
                  <Line
                    type="stepAfter"
                    dataKey="lapTimeMs"
                    name="Record lap"
                    stroke="#fb7185"
                    strokeWidth={2.5}
                    dot={{
                      fill: "#fda4af",
                      stroke: "#18181b",
                      strokeWidth: 2,
                      r: 4,
                    }}
                    activeDot={{
                      r: 6,
                      fill: "#fff1f2",
                      stroke: "#fb7185",
                      strokeWidth: 2,
                    }}
                    isAnimationActive={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            </section>
          )}

          <section className={cardClass}>
            <SectionHeader
              title="Record history"
              hint={`Only ${discipline === "qualifying" ? "qualifying sessions" : "races"} that set or improved the archive record appear here`}
            />
            <ol className="ml-1 mt-5">
              {[...events].reverse().map((event, index) => (
                <RecordTimelineRow
                  key={`${event.id}-${event.timestamp}`}
                  event={event}
                  scopeKey={scopeKey}
                  isCurrent={index === 0}
                />
              ))}
            </ol>
            <p className="mt-5 flex items-center gap-2 border-t border-white/[0.06] pt-4 text-xs text-zinc-600">
              <TimerReset className="size-3.5 shrink-0" /> History starts with
              the first verifiable race in the archive. Tied laps do not change
              the record.
            </p>
          </section>
        </>
      )}
    </section>
  );
}
