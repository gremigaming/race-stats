import { useMemo, useState } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { cardClass } from "../Card";
import { SectionHeader } from "../ui/SectionHeader";
import { CHART_THEME, TOOLTIP_STYLE } from "../../constants/colors";
import {
  DRIVER_DNA_STYLES,
  type DriverDnaArchetype,
  type DriverDnaHistoryPoint,
  type DriverDnaStyle,
} from "../../analysis/driverDna";
import { cn } from "../../utils/cn";

const ARCHETYPE_ORDER: DriverDnaArchetype[] = [
  "comeback",
  "qualifying",
  "consistency",
  "openingLap",
  "overtakeArtist",
  "podiumMagnet",
  "fastestLapHunter",
  "ironWill",
  "paceSetter",
  "cleanDuelist",
  "rainMaster",
  "tyreWhisperer",
  "streetCircuitSpecialist",
  "allRounder",
];

const ARCHETYPE_COLORS: Record<DriverDnaArchetype, string> = {
  comeback: "#fb7185",
  qualifying: "#c084fc",
  consistency: "#a78bfa",
  openingLap: "#fb923c",
  overtakeArtist: "#f43f5e",
  podiumMagnet: "#facc15",
  fastestLapHunter: "#60a5fa",
  ironWill: "#38bdf8",
  paceSetter: "#a3e635",
  cleanDuelist: "#67e8f9",
  rainMaster: "#38bdf8",
  tyreWhisperer: "#fbbf24",
  streetCircuitSpecialist: "#e879f9",
  allRounder: "#c4b5fd",
};

function defaultVisibleStyles(
  point: DriverDnaHistoryPoint | undefined,
  currentStyle: DriverDnaStyle,
): DriverDnaArchetype[] {
  const strongest = ARCHETYPE_ORDER.map((style) => ({
    style,
    fit: point?.fits[style] ?? null,
  }))
    .filter((entry): entry is { style: DriverDnaArchetype; fit: number } =>
      Number.isFinite(entry.fit),
    )
    .sort((a, b) => b.fit - a.fit)
    .slice(0, 3)
    .map((entry) => entry.style);

  if (
    ARCHETYPE_ORDER.includes(currentStyle as DriverDnaArchetype) &&
    !strongest.includes(currentStyle as DriverDnaArchetype)
  ) {
    strongest.unshift(currentStyle as DriverDnaArchetype);
  }
  return strongest;
}

function formatDate(timestamp: number | null): string {
  if (timestamp == null) return "Date unavailable";
  return new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(timestamp));
}

export function ArchetypeFitHistory({
  points,
  currentStyle,
}: {
  points: DriverDnaHistoryPoint[];
  currentStyle: DriverDnaStyle;
}) {
  const [visibleStyles, setVisibleStyles] = useState(() =>
    defaultVisibleStyles(points.at(-1), currentStyle),
  );
  const visibleStyleSet = useMemo(
    () => new Set(visibleStyles),
    [visibleStyles],
  );
  const assignedStyleChanges = useMemo(
    () =>
      points.filter(
        (point, index) =>
          index === 0 || point.style !== points[index - 1].style,
      ),
    [points],
  );

  const toggleStyle = (style: DriverDnaArchetype) => {
    setVisibleStyles((current) =>
      current.includes(style)
        ? current.filter((entry) => entry !== style)
        : [...current, style],
    );
  };

  return (
    <section className={cardClass} aria-label="Archetype fit history">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <SectionHeader
          title="Archetype fit history"
          hint="See how each style’s fit changed as more races were added."
          className="mb-0"
        />
        <span className="font-mono text-[10px] tabular-nums text-zinc-500">
          {points.length} snapshots
        </span>
      </div>

      {points.length < 2 ? (
        <p className="mt-5 rounded-xl border border-white/[0.06] bg-black/15 px-4 py-5 text-sm text-zinc-400">
          Fit history appears once there are multiple races in this view.
        </p>
      ) : (
        <>
          <div
            role="group"
            className="mt-4 flex flex-wrap gap-1.5"
            aria-label="Choose archetypes to show in fit history"
          >
            {ARCHETYPE_ORDER.map((style) => {
              const selected = visibleStyleSet.has(style);
              const color = ARCHETYPE_COLORS[style];
              return (
                <button
                  key={style}
                  type="button"
                  onClick={() => toggleStyle(style)}
                  aria-pressed={selected}
                  className={cn(
                    "inline-flex min-h-7 items-center gap-1.5 rounded-full border px-2.5 text-[10px] font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300",
                    selected
                      ? "border-white/[0.15] bg-white/[0.07] text-zinc-100"
                      : "border-white/[0.06] bg-black/10 text-zinc-500 hover:text-zinc-300",
                  )}
                >
                  <span
                    aria-hidden="true"
                    className="size-1.5 rounded-full"
                    style={{ backgroundColor: selected ? color : "#52525b" }}
                  />
                  {DRIVER_DNA_STYLES[style].label}
                </button>
              );
            })}
          </div>

          {visibleStyles.length ? (
            <div className="mt-3 h-[260px] min-w-0">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart
                  data={points}
                  margin={{ top: 8, right: 10, bottom: 2, left: -16 }}
                >
                  <CartesianGrid
                    strokeDasharray="3 3"
                    stroke={CHART_THEME.grid}
                  />
                  <XAxis
                    dataKey="raceNumber"
                    type="number"
                    domain={["dataMin", "dataMax"]}
                    tickFormatter={(value: number) => `R${value}`}
                    stroke={CHART_THEME.axis}
                    fontSize={10}
                    minTickGap={24}
                  />
                  <YAxis
                    domain={[0, 100]}
                    ticks={[0, 25, 50, 75, 100]}
                    tickFormatter={(value: number) => `${value}%`}
                    stroke={CHART_THEME.axis}
                    fontSize={10}
                    width={42}
                  />
                  <Tooltip
                    {...TOOLTIP_STYLE}
                    labelFormatter={(_, payload) => {
                      const point = payload?.[0]?.payload as
                        | DriverDnaHistoryPoint
                        | undefined;
                      return point
                        ? `Race ${point.raceNumber} · ${point.track} · ${formatDate(point.timestamp)}`
                        : "Archetype fit";
                    }}
                    formatter={(value, name) => [
                      `${Math.round(Number(value))}%`,
                      String(name),
                    ]}
                  />
                  {visibleStyles.map((style) => (
                    <Line
                      key={style}
                      type="monotone"
                      dataKey={`fits.${style}`}
                      name={DRIVER_DNA_STYLES[style].label}
                      stroke={ARCHETYPE_COLORS[style]}
                      strokeWidth={style === currentStyle ? 2.8 : 1.8}
                      dot={false}
                      activeDot={{ r: 4, strokeWidth: 0 }}
                      connectNulls={false}
                    />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <p className="mt-3 rounded-xl border border-white/[0.06] bg-black/15 px-4 py-5 text-sm text-zinc-400">
              Choose at least one archetype to display its fit history.
            </p>
          )}

          <p className="mt-2 text-[11px] text-zinc-500">
            Fit is a weighted comparison score, not a probability. Each point
            recalculates peer rankings using races up to that start.
          </p>
        </>
      )}

      {assignedStyleChanges.length > 0 && (
        <div className="mt-4 border-t border-white/[0.06] pt-3">
          <p className="font-mono text-[9px] font-semibold uppercase tracking-[0.16em] text-zinc-500">
            Primary archetype at sampled starts
          </p>
          <ol className="mt-2 flex flex-wrap gap-2">
            {assignedStyleChanges.map((point) => (
              <li
                key={`${point.file}:${point.raceNumber}`}
                className="inline-flex items-center gap-1.5 rounded-lg bg-black/20 px-2.5 py-1.5 text-[11px]"
              >
                <span
                  className="size-1.5 rounded-full"
                  style={{
                    backgroundColor:
                      ARCHETYPE_COLORS[point.style as DriverDnaArchetype] ??
                      "#a1a1aa",
                  }}
                  aria-hidden="true"
                />
                <span className="font-medium text-zinc-200">
                  {DRIVER_DNA_STYLES[point.style].label}
                </span>
                <span className="font-mono text-[10px] text-zinc-500">
                  R{point.raceNumber}
                </span>
              </li>
            ))}
          </ol>
        </div>
      )}
    </section>
  );
}
