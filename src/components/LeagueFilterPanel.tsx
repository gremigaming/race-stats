import { CalendarRange } from "lucide-react";
import { useTelemetry } from "../context/TelemetryContext";
import {
  FILTER_KINDS,
  isoDay,
  STREAM_COUNTS,
  streamLabel,
} from "../league/filter";
import { PillMenuSelect, type PillMenuOption } from "./ui/PillMenuSelect";
import { PillSelect } from "./ui/PillSelect";

const dateInputClass =
  "w-full min-w-0 rounded-lg bg-zinc-900/70 px-2 py-1 text-xs text-zinc-200 ring-1 ring-inset ring-white/[0.08] [color-scheme:dark] focus:outline-none focus:ring-red-400/40";

const TIME_RANGE_OPTIONS: PillMenuOption[] = [
  ...FILTER_KINDS.filter(
    (option) => option.value !== "streams" && option.value !== "stream",
  ).map((option) => ({ ...option, group: "Date ranges" })),
  ...STREAM_COUNTS.map((count) => ({
    value: `streams:${count}`,
    label: count === 1 ? "Last stream" : `Last ${count} streams`,
    group: "Recent streams",
  })),
  { value: "stream", label: "One stream", group: "Recent streams" },
];

/** The site-wide time filter, shown beside the driver picker. */
export function LeagueFilterPanel() {
  const { league } = useTelemetry();
  if (!league) return null;
  const { filter, setFilter, streams } = league;

  const changeKind = (value: string) => {
    if (value.startsWith("streams:")) {
      const count = Number(value.slice("streams:".length));
      if (STREAM_COUNTS.includes(count)) setFilter({ kind: "streams", count });
      return;
    }

    switch (value) {
      case "today":
      case "week":
      case "month":
      case "year":
      case "all":
        setFilter({ kind: value });
        break;
      case "stream":
        setFilter({ kind: "stream", id: streams[0]?.id ?? "" });
        break;
      case "custom": {
        const today = new Date();
        const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
        setFilter({
          kind: "custom",
          from: isoDay(monthStart),
          to: isoDay(today),
        });
        break;
      }
    }
  };

  const value =
    filter.kind === "streams" ? `streams:${filter.count}` : filter.kind;

  return (
    <div className="space-y-1.5">
      <PillMenuSelect
        value={value}
        onChange={changeKind}
        options={TIME_RANGE_OPTIONS}
        ariaLabel="Time range"
        leadingIcon={CalendarRange}
        width="full"
        size="sm"
      />
      {filter.kind === "stream" &&
        (streams.length ? (
          <PillSelect
            value={filter.id}
            onChange={(v) => setFilter({ kind: "stream", id: String(v) })}
            options={streams.map((s) => ({
              value: s.id,
              label: streamLabel(s),
            }))}
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
    </div>
  );
}
