import {
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Radar,
  RadarChart,
  ResponsiveContainer,
  Tooltip,
} from "recharts";
import { cardClass } from "../Card";
import { SectionHeader } from "../ui/SectionHeader";
import { CHART_THEME, TOOLTIP_STYLE } from "../../constants/colors";
import {
  DRIVER_DNA_STYLES,
  type DriverDnaArchetypeFit,
  type DriverDnaStyle,
} from "../../analysis/driverDna";

const RADAR_COLOR = "#c084fc";

interface RadarDatum {
  style: DriverDnaArchetypeFit["style"];
  label: string;
  fullLabel: string;
  fit: number;
}

export function DriverDnaArchetypeRadar({
  fits,
  currentStyle,
}: {
  fits: DriverDnaArchetypeFit[];
  currentStyle: DriverDnaStyle;
}) {
  const rankedFits = [...fits].sort((a, b) => (b.fit ?? -1) - (a.fit ?? -1));
  const scoredFits = fits.filter(
    (fit): fit is DriverDnaArchetypeFit & { fit: number } => fit.fit != null,
  );
  const chartData: RadarDatum[] = scoredFits.map((fit) => ({
    style: fit.style,
    label: DRIVER_DNA_STYLES[fit.style].label,
    fullLabel: DRIVER_DNA_STYLES[fit.style].label,
    fit: fit.fit,
  }));

  return (
    <section
      className={cardClass}
      aria-label="Driver DNA archetype fit radar chart"
    >
      <SectionHeader
        title="Archetype fit radar"
        hint="Each spoke is a style; farther from the center means a stronger fit."
        className="mb-0"
      />

      <div className="mt-3 grid min-w-0 items-center gap-4 lg:grid-cols-[minmax(0,1.35fr)_minmax(16rem,0.85fr)]">
        {chartData.length >= 3 ? (
          <div
            className="h-[340px] min-w-0"
            role="img"
            aria-label={`Radar chart with ${chartData.length} scored archetypes`}
          >
            <ResponsiveContainer width="100%" height="100%">
              <RadarChart
                data={chartData}
                outerRadius="72%"
                margin={{ top: 12, right: 12, bottom: 12, left: 12 }}
              >
                <PolarGrid stroke={CHART_THEME.grid} />
                <PolarAngleAxis dataKey="label" tick={false} axisLine={false} />
                <PolarRadiusAxis
                  angle={90}
                  domain={[0, 100]}
                  tickCount={5}
                  tickFormatter={(value: number) => `${value}%`}
                  axisLine={false}
                  tickLine={false}
                  stroke={CHART_THEME.axis}
                  fontSize={10}
                />
                <Tooltip
                  {...TOOLTIP_STYLE}
                  labelFormatter={(_, payload) =>
                    payload?.[0]?.payload?.fullLabel ?? "Archetype fit"
                  }
                  formatter={(value) => [
                    `${Math.round(Number(value))}%`,
                    "Fit score",
                  ]}
                />
                <Radar
                  name="Archetype fit"
                  dataKey="fit"
                  stroke={RADAR_COLOR}
                  strokeWidth={2}
                  fill={RADAR_COLOR}
                  fillOpacity={0.18}
                  dot={{ r: 2.5, fill: RADAR_COLOR, strokeWidth: 0 }}
                  activeDot={{ r: 4, strokeWidth: 0 }}
                />
              </RadarChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <p className="rounded-xl border border-white/[0.06] bg-black/15 px-4 py-5 text-sm text-zinc-400">
            A radar chart appears when at least three archetypes have enough
            measurable signals.
          </p>
        )}

        <ol className="grid grid-cols-2 gap-x-4 gap-y-1.5 sm:grid-cols-3 lg:grid-cols-1">
          {rankedFits.map(({ style, fit }) => {
            const isPrimary = style === currentStyle;
            return (
              <li
                key={style}
                className={`flex min-w-0 items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-xs ${
                  isPrimary
                    ? "bg-violet-400/[0.08] text-zinc-100"
                    : "text-zinc-400"
                }`}
              >
                <span className="flex min-w-0 items-center gap-2">
                  <span
                    className={`size-1.5 shrink-0 rounded-full ${
                      fit == null
                        ? "bg-zinc-700"
                        : isPrimary
                          ? "bg-violet-300"
                          : "bg-zinc-500"
                    }`}
                    aria-hidden="true"
                  />
                  <span className="truncate">
                    {DRIVER_DNA_STYLES[style].label}
                  </span>
                  {isPrimary && (
                    <span className="shrink-0 font-mono text-[9px] uppercase tracking-wide text-violet-300">
                      Primary
                    </span>
                  )}
                </span>
                <span className="shrink-0 font-mono tabular-nums text-zinc-300">
                  {fit == null ? "—" : `${fit}%`}
                </span>
              </li>
            );
          })}
        </ol>
      </div>

      <p className="mt-2 text-[11px] text-zinc-500">
        Fit scores are weighted comparisons, not probabilities. Styles without a
        comparable score are omitted from the radar and marked — in the list.
      </p>
    </section>
  );
}
