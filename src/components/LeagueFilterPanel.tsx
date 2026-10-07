import { CalendarRange } from "lucide-react";
import { useTelemetry } from "../context/TelemetryContext";
import {
  DEFAULT_FILTER,
  FILTER_KINDS,
  isoDay,
  STREAM_COUNTS,
  streamLabel,
  type LeagueFilter,
} from "../league/filter";
import { PillSelect } from "./ui/PillSelect";

const dateInputClass =
  "w-full min-w-0 rounded-lg bg-zinc-900/70 px-2 py-1 text-xs text-zinc-200 ring-1 ring-inset ring-white/[0.08] [color-scheme:dark] focus:outline-none focus:ring-red-400/40";

/** The site-wide time filter, under the driver picker. */
export function LeagueFilterPanel() {
  const { league } = useTelemetry();
  if (!league) return null;
  const { filter, setFilter, streams } = league;

  const changeKind = (kind: LeagueFilter["kind"]) => {
    if (kind === "streams") setFilter({ kind, count: 3 });
    else if (kind === "stream") setFilter({ kind, id: streams[0]?.id ?? "" });
    else if (kind === "custom") {
      const today = new Date();
      const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
      setFilter({ kind, from: isoDay(monthStart), to: isoDay(today) });
    } else setFilter({ kind });
  };

  return (
    <div className="space-y-1.5">
      <PillSelect
        value={filter.kind}
        onChange={(v) => changeKind(v as LeagueFilter["kind"])}
        options={FILTER_KINDS}
        ariaLabel="Time range"
        leadingIcon={CalendarRange}
        width="full"
        size="sm"
      />
      {filter.kind === "streams" && (
        <PillSelect
          value={filter.count}
          onChange={(v) => setFilter({ kind: "streams", count: Number(v) })}
          options={STREAM_COUNTS.map((n) => ({
            value: n,
            label: n === 1 ? "Last stream" : `Last ${n} streams`,
          }))}
          ariaLabel="Number of streams"
          width="full"
          size="sm"
        />
      )}
      {filter.kind === "stream" &&
        (streams.length ? (
          <PillSelect
            value={filter.id}
            onChange={(v) => setFilter({ kind: "stream", id: String(v) })}
            options={streams.map((s) => ({ value: s.id, label: streamLabel(s) }))}
            ariaLabel="Stream"
            width="full"
            size="sm"
          />
        ) : (
          <p className="px-1 text-xs text-zinc-500">No streams yet.</p>
        ))}
      {filter.kind === "custom" && (
        <div className="grid grid-cols-2 gap-1.5">
          <input
            type="date"
            aria-label="From"
            value={filter.from}
            max={filter.to || undefined}
            onChange={(e) => setFilter({ ...filter, from: e.target.value })}
            className={dateInputClass}
          />
          <input
            type="date"
            aria-label="To"
            value={filter.to}
            min={filter.from || undefined}
            onChange={(e) => setFilter({ ...filter, to: e.target.value })}
            className={dateInputClass}
          />
        </div>
      )}
      {filter.kind !== DEFAULT_FILTER.kind && (
        <button
          type="button"
          onClick={() => setFilter(DEFAULT_FILTER)}
          className="px-1 text-[11px] text-zinc-500 hover:text-zinc-300"
        >
          Back to this month
        </button>
      )}
    </div>
  );
}
