import { useEffect, useMemo, useState } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { cardClass } from "../Card";
import { Badge } from "../ui/Badge";
import { SectionHeader } from "../ui/SectionHeader";
import { HorizontalScrollRegion } from "../ui/HorizontalScrollRegion";
import { LoadingSpinner } from "../ui/LoadingSpinner";
import { SegmentedControl } from "../ui/SegmentedControl";
import { useTelemetry } from "../../context/TelemetryContext";
import { CHART_THEME, TOOLTIP_STYLE } from "../../constants/colors";
import { cn } from "../../utils/cn";
import {
  loadCornerDevelopment,
  type CornerAnalysisProgress,
} from "../../analysis/cornerReplay";
import {
  areComparableCornerSessions,
  type CornerDefinition,
  type CornerEvidence,
  type CornerMeasuredMetrics,
  type CornerSessionConditions,
  type CornerTrackPoint,
  type CornerTrendPoint,
  type StraightDefinition,
} from "../../analysis/cornerAnalysis";
import type { TrackSessionData } from "../../analysis/trackAnalysis";
import { median } from "../../utils/stats/core";

type LoadState =
  | { status: "loading"; progress: CornerAnalysisProgress }
  | {
      status: "ready";
      result: Awaited<ReturnType<typeof loadCornerDevelopment>>;
    }
  | { status: "error" };

const NO_PROGRESS: CornerAnalysisProgress = {
  completedRaces: 0,
  totalRaces: 0,
};

function signedSeconds(ms: number): string {
  if (Math.abs(ms) < 0.5) return "0.000 s";
  return `${ms > 0 ? "+" : "−"}${(Math.abs(ms) / 1000).toFixed(3)} s`;
}

function durationSeconds(ms: number): string {
  return `${(ms / 1000).toFixed(3)} s`;
}

function largeGapThreshold(points: readonly CornerTrendPoint[]): number {
  const peerSpreads = points.flatMap((point) => {
    const peerTimes = point.peerComparisons
      .map((peer) => peer.medianMs)
      .filter((time) => time > 0);
    if (peerTimes.length < 2 || point.groupMs <= 0) return [];
    return [(Math.max(...peerTimes) - Math.min(...peerTimes)) / point.groupMs];
  });
  const typicalPeerSpread = median(peerSpreads);
  if (typicalPeerSpread == null) return 0.005;
  return Math.max(0.005, Math.min(0.03, typicalPeerSpread * 2));
}

function relativeGap(deltaMs: number, referenceMs: number): number | undefined {
  return referenceMs > 0 ? deltaMs / referenceMs : undefined;
}

function markerColor(
  relativeDelta: number | undefined,
  majorGapThreshold: number,
): string {
  if (relativeDelta == null || !Number.isFinite(relativeDelta))
    return "#71717a";
  if (relativeDelta >= majorGapThreshold) return CHART_THEME.behind;
  if (relativeDelta > 0) return "#eab308";
  if (relativeDelta <= -majorGapThreshold) return CHART_THEME.best;
  if (relativeDelta < 0) return CHART_THEME.ahead;
  return "#eab308";
}

function cornerLabel(corner: CornerDefinition): string {
  return `Corner ${corner.number}${corner.sector ? ` · S${corner.sector}` : ""}`;
}

function straightLabel(straight: StraightDefinition): string {
  return `Straight ${straight.number}${straight.sector ? ` · S${straight.sector}` : ""}`;
}

function sectionId(kind: "corner" | "straight", number: number): string {
  return `${kind}:${number}`;
}

type MapSection =
  | {
      kind: "corner";
      number: number;
      mapPoint: { x: number; z: number };
      definition: CornerDefinition;
    }
  | {
      kind: "straight";
      number: number;
      mapPoint: { x: number; z: number };
      definition: StraightDefinition;
    };

type AnalyzedSection =
  | { kind: "corner"; definition: CornerDefinition }
  | { kind: "straight"; definition: StraightDefinition };

type TrackSectionKind = AnalyzedSection["kind"];

function analyzedSectionLabel(section: AnalyzedSection): string {
  return section.kind === "corner"
    ? cornerLabel(section.definition)
    : straightLabel(section.definition);
}

function formatMeasure(
  player: number | null,
  group: number | null,
  suffix: string,
  digits = 0,
): string {
  if (player == null || group == null) return "No comparable measurement";
  return `${player.toFixed(digits)} ${suffix} · group ${group.toFixed(digits)} ${suffix}`;
}

function pathProjection(points: readonly { x: number; z: number }[]) {
  const width = 520;
  const height = 300;
  const padding = 14;
  if (!points.length)
    return { width, height, path: "", at: () => ({ x: 0, y: 0 }) };
  const xs = points.map((point) => point.x);
  const zs = points.map((point) => point.z);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minZ = Math.min(...zs);
  const maxZ = Math.max(...zs);
  const sourceWidth = Math.max(maxX - minX, 1);
  const sourceHeight = Math.max(maxZ - minZ, 1);
  const scale = Math.min(
    (width - padding * 2) / sourceWidth,
    (height - padding * 2) / sourceHeight,
  );
  const drawnWidth = sourceWidth * scale;
  const drawnHeight = sourceHeight * scale;
  const offsetX = (width - drawnWidth) / 2;
  const offsetY = (height - drawnHeight) / 2;
  const at = (point: { x: number; z: number }) => ({
    x: offsetX + (point.x - minX) * scale,
    y: offsetY + (point.z - minZ) * scale,
  });
  return {
    width,
    height,
    path: points
      .map((point) => {
        const p = at(point);
        return `${p.x.toFixed(1)},${p.y.toFixed(1)}`;
      })
      .join(" "),
    at,
  };
}

function intervalPolylinePoints(
  trace: readonly CornerTrackPoint[],
  startM: number,
  endM: number,
  at: (point: { x: number; z: number }) => { x: number; y: number },
): string[] {
  const isWrapped = startM > endM;
  const inSegment = (point: CornerTrackPoint) =>
    isWrapped
      ? point.distance >= startM || point.distance <= endM
      : point.distance >= startM && point.distance <= endM;
  const points = trace.filter(inSegment).map((point) => at(point));
  if (points.length < 2) return [];

  if (!isWrapped) {
    return [
      points
        .map((point) => `${point.x.toFixed(1)},${point.y.toFixed(1)}`)
        .join(" "),
    ];
  }

  const beforeStart = trace
    .filter((point) => point.distance >= startM)
    .map((point) => at(point));
  const afterFinish = trace
    .filter((point) => point.distance <= endM)
    .map((point) => at(point));
  return [beforeStart, afterFinish]
    .filter((segment) => segment.length >= 2)
    .map((segment) =>
      segment
        .map((point) => `${point.x.toFixed(1)},${point.y.toFixed(1)}`)
        .join(" "),
    );
}

function cornerSegmentPoints(
  trace: readonly CornerTrackPoint[],
  corner: CornerDefinition,
  at: (point: { x: number; z: number }) => { x: number; y: number },
): string[] {
  return intervalPolylinePoints(
    trace,
    corner.curveStartM,
    corner.curveEndM,
    at,
  );
}

function straightSegmentPoints(
  trace: readonly CornerTrackPoint[],
  straight: StraightDefinition,
  at: (point: { x: number; z: number }) => { x: number; y: number },
): string[] {
  return intervalPolylinePoints(trace, straight.startM, straight.endM, at);
}

function cornerLabelPositions(
  sections: readonly MapSection[],
  trace: readonly CornerTrackPoint[],
  at: (point: { x: number; z: number }) => { x: number; y: number },
) {
  const projectedTrace = trace.map((point) => at(point));
  const center = projectedTrace.reduce(
    (sum, point) => ({
      x: sum.x + point.x / projectedTrace.length,
      y: sum.y + point.y / projectedTrace.length,
    }),
    { x: 0, y: 0 },
  );

  const trackSegments = projectedTrace
    .slice(1)
    .map((point, index) => [projectedTrace[index]!, point] as const);
  if (projectedTrace.length > 2) {
    trackSegments.push([
      projectedTrace[projectedTrace.length - 1]!,
      projectedTrace[0]!,
    ]);
  }
  const distanceFromTrack = (target: { x: number; y: number }) => {
    let minimum = Number.POSITIVE_INFINITY;
    for (const [start, end] of trackSegments) {
      const dx = end.x - start.x;
      const dy = end.y - start.y;
      const lengthSquared = dx * dx + dy * dy;
      const progress = lengthSquared
        ? Math.max(
            0,
            Math.min(
              1,
              ((target.x - start.x) * dx + (target.y - start.y) * dy) /
                lengthSquared,
            ),
          )
        : 0;
      minimum = Math.min(
        minimum,
        Math.hypot(
          target.x - (start.x + dx * progress),
          target.y - (start.y + dy * progress),
        ),
      );
    }
    return minimum;
  };

  const placed: Array<{
    section: MapSection;
    point: { x: number; y: number };
    label: { x: number; y: number };
  }> = [];
  const angleOffsets = [
    0, 24, -24, 48, -48, 72, -72, 96, -96, 120, -120, 144, -144, 168, -168, 180,
  ];
  for (const [index, section] of sections.entries()) {
    const point = at(section.mapPoint);
    let dx = point.x - center.x;
    let dy = point.y - center.y;
    let length = Math.hypot(dx, dy);
    if (length < 1) {
      const angle = index * 2.4;
      dx = Math.cos(angle);
      dy = Math.sin(angle);
      length = 1;
    }
    const outwardAngle = Math.atan2(dy, dx);
    let bestLabel = {
      x: Math.max(16, Math.min(504, point.x + (dx / length) * 34)),
      y: Math.max(16, Math.min(284, point.y + (dy / length) * 34)),
    };
    let bestScore = Number.POSITIVE_INFINITY;

    for (const radius of [32, 40, 48, 56]) {
      for (const offsetDegrees of angleOffsets) {
        const angle = outwardAngle + (offsetDegrees * Math.PI) / 180;
        const candidate = {
          x: point.x + Math.cos(angle) * radius,
          y: point.y + Math.sin(angle) * radius,
        };
        if (
          candidate.x < 16 ||
          candidate.x > 504 ||
          candidate.y < 16 ||
          candidate.y > 284
        ) {
          continue;
        }

        const trackClearance = distanceFromTrack(candidate);
        const labelClearance = placed.length
          ? Math.min(
              ...placed.map(({ label }) =>
                Math.hypot(candidate.x - label.x, candidate.y - label.y),
              ),
            )
          : Number.POSITIVE_INFINITY;
        const leaderClearance = Math.min(
          ...[0.35, 0.55, 0.75].map((progress) =>
            distanceFromTrack({
              x: point.x + (candidate.x - point.x) * progress,
              y: point.y + (candidate.y - point.y) * progress,
            }),
          ),
        );
        const score =
          Math.max(0, 20 - trackClearance) ** 2 * 8 +
          Math.max(0, 24 - labelClearance) ** 2 * 6 +
          Math.max(0, 9 - leaderClearance) ** 2 * 2 +
          Math.max(0, radius - 40) * 0.25 +
          Math.abs(offsetDegrees) * 0.012;
        if (score < bestScore) {
          bestScore = score;
          bestLabel = candidate;
        }
      }
    }

    placed.push({
      section,
      point,
      label: bestLabel,
    });
  }

  return placed;
}

function CornerTrackMap({
  trace,
  corners,
  straights,
  latest,
  latestStraights,
  majorGapThreshold,
  selected,
  onSelect,
}: {
  trace: readonly CornerTrackPoint[];
  corners: readonly CornerDefinition[];
  straights: readonly StraightDefinition[];
  latest: ReadonlyMap<number, CornerTrendPoint>;
  latestStraights: ReadonlyMap<number, CornerTrendPoint>;
  majorGapThreshold: number;
  selected: string;
  onSelect: (sectionId: string) => void;
}) {
  const [zoom, setZoom] = useState(1);
  const projection = useMemo(() => pathProjection(trace), [trace]);
  const sections = useMemo<MapSection[]>(
    () => [
      ...corners.map((corner) => ({
        kind: "corner" as const,
        number: corner.number,
        mapPoint: corner.mapPoint,
        definition: corner,
      })),
      ...straights.map((straight) => ({
        kind: "straight" as const,
        number: straight.number,
        mapPoint: straight.mapPoint,
        definition: straight,
      })),
    ],
    [corners, straights],
  );
  const labels = useMemo(
    () => cornerLabelPositions(sections, trace, projection.at),
    [sections, trace, projection],
  );
  if (!projection.path) {
    return (
      <div className="flex h-64 items-center justify-center text-sm text-zinc-500">
        No complete racing line is available to draw the map.
      </div>
    );
  }

  const selectedSection = sections.find(
    (section) => sectionId(section.kind, section.number) === selected,
  );
  const zoomAnchor =
    zoom > 1 && selectedSection
      ? projection.at(selectedSection.mapPoint)
      : { x: projection.width / 2, y: projection.height / 2 };
  const zoomTransform = `translate(${projection.width / 2} ${projection.height / 2}) scale(${zoom}) translate(${-zoomAnchor.x} ${-zoomAnchor.y})`;

  return (
    <div>
      <div className="mb-2 flex justify-end">
        <div
          role="group"
          aria-label="Track map zoom controls"
          className="group/zoom flex items-center gap-1 rounded-lg border border-white/10 bg-zinc-950/90 p-1 shadow-lg"
        >
          <button
            type="button"
            aria-label={`Zoom in on selected section; current zoom ${zoom.toFixed(1)} times`}
            title="Zoom in · hover or focus for more controls"
            disabled={zoom >= 3}
            onClick={() => setZoom((current) => Math.min(3, current * 1.5))}
            className="flex h-7 w-11 items-center justify-center rounded-md font-mono text-[10px] text-zinc-200 hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {zoom.toFixed(1)}×
          </button>
          <div className="track-map-zoom-details flex max-w-0 items-center gap-1 overflow-hidden whitespace-nowrap opacity-0 transition-[max-width,opacity] duration-200 ease-out group-hover/zoom:max-w-[8rem] group-hover/zoom:opacity-100 group-focus-within/zoom:max-w-[8rem] group-focus-within/zoom:opacity-100">
            <button
              type="button"
              aria-label="Zoom in on selected section"
              title="Zoom in on selected section"
              disabled={zoom >= 3}
              onClick={() => setZoom((current) => Math.min(3, current * 1.5))}
              className="flex size-7 items-center justify-center rounded-md text-lg text-zinc-200 hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
            >
              +
            </button>
            <button
              type="button"
              aria-label="Zoom out"
              title="Zoom out"
              disabled={zoom <= 1}
              onClick={() => setZoom((current) => Math.max(1, current / 1.5))}
              className="flex size-7 items-center justify-center rounded-md text-lg text-zinc-200 hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
            >
              −
            </button>
            <button
              type="button"
              aria-label="Reset zoom"
              title="Reset zoom"
              disabled={zoom <= 1}
              onClick={() => setZoom(1)}
              className="rounded-md px-2 py-1 text-[10px] text-zinc-300 hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Reset
            </button>
          </div>
        </div>
      </div>
      <svg
        viewBox={`0 0 ${projection.width} ${projection.height}`}
        role="group"
        aria-label="Track map with selectable corners and straights"
        className="h-72 w-full overflow-hidden"
      >
        <g transform={zoomTransform}>
          <polyline
            points={projection.path}
            fill="none"
            stroke="#52525b"
            strokeWidth="14"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <polyline
            points={projection.path}
            fill="none"
            stroke="#a1a1aa"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          {labels.map(({ section, point, label }) => {
            const id = sectionId(section.kind, section.number);
            const segments =
              section.kind === "corner"
                ? cornerSegmentPoints(trace, section.definition, projection.at)
                : straightSegmentPoints(
                    trace,
                    section.definition,
                    projection.at,
                  );
            const isSelected = id === selected;
            const trend =
              section.kind === "corner"
                ? latest.get(section.number)
                : latestStraights.get(section.number);
            const color = markerColor(
              trend ? relativeGap(trend.deltaMs, trend.groupMs) : undefined,
              majorGapThreshold,
            );
            const opacity = selected == null || isSelected ? 1 : 0.42;
            const labelText =
              section.kind === "straight"
                ? `S${section.number}`
                : `${section.number}`;
            return (
              <g
                key={id}
                role="button"
                tabIndex={0}
                aria-label={`Select ${section.kind} ${section.number}`}
                aria-pressed={isSelected}
                onClick={() => onSelect(id)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    onSelect(id);
                  }
                }}
                className="cursor-pointer outline-none"
              >
                {segments.map((segment, index) => (
                  <g key={`segment-${index}`} opacity={opacity}>
                    <polyline
                      points={segment}
                      fill="none"
                      stroke="transparent"
                      strokeWidth="18"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      pointerEvents="stroke"
                    />
                    <polyline
                      points={segment}
                      fill="none"
                      stroke={color}
                      strokeWidth={isSelected ? 8 : 5}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      pointerEvents="none"
                    />
                  </g>
                ))}
                <line
                  x1={point.x}
                  y1={point.y}
                  x2={label.x}
                  y2={label.y}
                  stroke={color}
                  strokeWidth={isSelected ? 1.5 : 1}
                  opacity={opacity * 0.8}
                  pointerEvents="none"
                />
                <circle
                  cx={point.x}
                  cy={point.y}
                  r={isSelected ? 8 : 6}
                  fill={color}
                  fillOpacity={opacity}
                  stroke={isSelected ? "#fafafa" : "#18181b"}
                  strokeWidth={isSelected ? 2.5 : 1.5}
                />
                <rect
                  x={label.x - 12}
                  y={label.y - 8}
                  width="24"
                  height="16"
                  rx="7"
                  fill="#18181b"
                  stroke={color}
                  strokeWidth={isSelected ? 2 : 1.2}
                  opacity={opacity}
                />
                <text
                  x={label.x}
                  y={label.y + 3.5}
                  textAnchor="middle"
                  fill="#fafafa"
                  fontSize="9"
                  fontWeight="700"
                  opacity={opacity}
                >
                  {labelText}
                </text>
              </g>
            );
          })}
        </g>
      </svg>
    </div>
  );
}

function CornerMetric({
  label,
  player,
  group,
  unit,
  digits = 0,
}: {
  label: string;
  player: number | null;
  group: number | null;
  unit: string;
  digits?: number;
}) {
  return (
    <div className="flex flex-col gap-1 py-2 sm:flex-row sm:items-center sm:justify-between">
      <span className="text-sm text-zinc-400">{label}</span>
      <span className="font-mono text-xs tabular-nums text-zinc-200">
        {formatMeasure(player, group, unit, digits)}
      </span>
    </div>
  );
}

interface ComparableSessionPoint {
  conditions: CornerSessionConditions;
  point: CornerTrendPoint;
}

function sessionConditionsLabel(conditions: CornerSessionConditions): string {
  const trackTemp = Number.isFinite(conditions.trackTemperatureC)
    ? `${Math.round(conditions.trackTemperatureC)}°C`
    : "unknown";
  const airTemp = Number.isFinite(conditions.airTemperatureC)
    ? `${Math.round(conditions.airTemperatureC)}°C`
    : "unknown";
  const raceLength =
    conditions.totalLaps > 0 ? ` · ${conditions.totalLaps} laps` : "";
  return `${conditions.weather} · track ${trackTemp} · air ${airTemp}${raceLength}`;
}

function TrackSectionDetail({
  section,
  trend,
  history,
  evidence,
  comparableSessions,
  majorGapThreshold,
}: {
  section: AnalyzedSection;
  trend: CornerTrendPoint | undefined;
  history: CornerTrendPoint[];
  evidence: CornerEvidence | undefined;
  comparableSessions: ComparableSessionPoint[];
  majorGapThreshold: number;
}) {
  if (!trend) {
    const excluded = evidence
      ? [
          evidence.pitPassages > 0 &&
            `${evidence.pitPassages} pit-affected laps`,
          evidence.incidents > 0 &&
            `${evidence.incidents} incident-affected laps`,
          evidence.missingTelemetry > 0 &&
            `${evidence.missingTelemetry} laps missing replay samples`,
          evidence.offTrack > 0 &&
            `${evidence.offTrack} laps with off-track samples`,
          evidence.closeTraffic > 0 &&
            `${evidence.closeTraffic} laps with close traffic (<1 s gap)`,
          evidence.incompleteTelemetry > 0 &&
            `${evidence.incompleteTelemetry} laps with incomplete telemetry`,
        ].filter((item): item is string => Boolean(item))
      : [];
    return (
      <section className={cardClass}>
        <SectionHeader title={analyzedSectionLabel(section)} />
        <p className="text-sm text-zinc-500">
          No comparison is available yet. A limited comparison needs at least
          one usable pass from you and two other human drivers. A strong match
          needs three comparable passes from you and three from each peer.
        </p>
        {evidence && (
          <div className="mt-4 space-y-2 rounded-xl bg-white/[0.035] px-4 py-3 text-sm text-zinc-400">
            <p>
              Latest race: {evidence.playerPasses} of your{" "}
              {evidence.candidateLaps} candidate laps were usable;{" "}
              {evidence.peerDriversWithAnyPasses} other drivers have usable
              passes ({evidence.peerDriversWithThreePasses} have at least 3);{" "}
              {evidence.comparablePlayerPasses} of your passes match at least
              two peers, and {evidence.strongComparablePlayerPasses} meet the
              strong-match sample threshold.
            </p>
            {excluded.length > 0 && (
              <p className="text-xs text-zinc-500">
                Your laps excluded here: {excluded.join(", ")}.
              </p>
            )}
          </div>
        )}
      </section>
    );
  }

  const cornerMetrics: Array<{
    label: string;
    key: keyof CornerMeasuredMetrics;
    unit: string;
    digits?: number;
  }> = [
    { label: "Braking point before apex", key: "brakePointM", unit: "m" },
    { label: "Minimum speed", key: "minimumSpeedKmh", unit: "km/h" },
    { label: "Full throttle after apex", key: "throttlePickupM", unit: "m" },
    { label: "Exit speed at turn end", key: "exitSpeedKmh", unit: "km/h" },
  ];
  const straightMetrics: typeof cornerMetrics = [
    { label: "Entry speed", key: "entrySpeedKmh", unit: "km/h" },
    { label: "Maximum speed", key: "maximumSpeedKmh", unit: "km/h" },
    { label: "Exit speed", key: "exitSpeedKmh", unit: "km/h" },
  ];
  const metrics = section.kind === "straight" ? straightMetrics : cornerMetrics;
  const segmentType = section.kind === "straight" ? "straight" : "turn";
  const chartData = history.map((point, index) => ({
    race: index + 1,
    date: point.label,
    deltaSeconds: point.deltaMs / 1000,
  }));
  const comparableMedianDelta = median(
    comparableSessions.map(({ point }) => point.deltaMs),
  );
  const comparableFastestDelta = median(
    comparableSessions.map(({ point }) => point.fastestDeltaMs),
  );
  const comparableMedianRelativeGap = median(
    comparableSessions.flatMap(({ point }) => {
      const gap = relativeGap(point.deltaMs, point.groupMs);
      return gap == null ? [] : [gap];
    }),
  );
  const comparableFastestRelativeGap = median(
    comparableSessions.flatMap(({ point }) => {
      const gap = relativeGap(point.fastestDeltaMs, point.groupFastestMs);
      return gap == null ? [] : [gap];
    }),
  );

  return (
    <section className={cardClass}>
      <SectionHeader
        title={analyzedSectionLabel(section)}
        hint={`${trend.label} · ${trend.playerPasses} comparable ${trend.playerPasses === 1 ? "pass" : "passes"} · ${trend.peerDrivers} drivers`}
        action={
          <Badge tone={trend.confidence === "high" ? "green" : "amber"}>
            {trend.confidence === "high" ? "Strong match" : "Limited match"}
          </Badge>
        }
      />
      <div className="mb-4 grid gap-3 sm:grid-cols-2">
        <div className="rounded-xl bg-white/[0.035] px-4 py-3">
          <p className="text-xs uppercase tracking-wider text-zinc-500">
            Median {segmentType} time · gap to peer median
          </p>
          <p
            className="mt-1 font-mono text-2xl font-semibold tabular-nums"
            style={{
              color: markerColor(
                relativeGap(trend.deltaMs, trend.groupMs),
                majorGapThreshold,
              ),
            }}
          >
            {signedSeconds(trend.deltaMs)}
          </p>
          <p className="mt-1 text-xs text-zinc-500">
            You {durationSeconds(trend.playerMs)} · peers{" "}
            {durationSeconds(trend.groupMs)}
          </p>
        </div>
        <div className="rounded-xl bg-white/[0.035] px-4 py-3">
          <p className="text-xs uppercase tracking-wider text-zinc-500">
            Fastest {segmentType} time · gap to peers' median best
          </p>
          <p
            className="mt-1 font-mono text-2xl font-semibold tabular-nums"
            style={{
              color: markerColor(
                relativeGap(trend.fastestDeltaMs, trend.groupFastestMs),
                majorGapThreshold,
              ),
            }}
          >
            {signedSeconds(trend.fastestDeltaMs)}
          </p>
          <p className="mt-1 text-xs text-zinc-500">
            You {durationSeconds(trend.playerFastestMs)} · peers' median best{" "}
            {durationSeconds(trend.groupFastestMs)}
          </p>
        </div>
      </div>
      <p className="mb-4 text-xs text-zinc-500">
        {section.kind === "straight"
          ? "Straight time covers the section between detected turns. Entry, maximum, and exit speeds are measured on that section."
          : "Turn time covers the detected curve only; braking and throttle measures use the approach and exit window."}{" "}
        Each peer driver counts once. The median compares typical {segmentType}
        pace; the fastest compares your best {segmentType} with the median of
        peers' best {segmentType}s.
      </p>

      <section className="mb-4 rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-3">
        <SectionHeader
          title="Across similar sessions"
          size="sm"
          hint={`${comparableSessions.length} ${comparableSessions.length === 1 ? "race" : "races"} · ${comparableSessions[comparableSessions.length - 1] ? sessionConditionsLabel(comparableSessions[comparableSessions.length - 1]!.conditions) : "No session conditions available"}`}
        />
        {comparableSessions.length < 2 ||
        comparableMedianDelta == null ||
        comparableFastestDelta == null ? (
          <p className="py-3 text-sm text-zinc-500">
            One comparable race is not enough for a cross-session benchmark.
            Similar races need the same layout, formula, game mode and dry or
            wet conditions, compatible car settings, and temperatures within
            5°C.
          </p>
        ) : (
          <>
            <div className="mb-3 grid gap-3 sm:grid-cols-2">
              <div className="rounded-lg bg-white/[0.035] px-3 py-2.5">
                <p className="text-xs uppercase tracking-wider text-zinc-500">
                  Typical gap · median across races
                </p>
                <p
                  className="mt-1 font-mono text-xl font-semibold tabular-nums"
                  style={{
                    color: markerColor(
                      comparableMedianRelativeGap ?? undefined,
                      majorGapThreshold,
                    ),
                  }}
                >
                  {signedSeconds(comparableMedianDelta)}
                </p>
              </div>
              <div className="rounded-lg bg-white/[0.035] px-3 py-2.5">
                <p className="text-xs uppercase tracking-wider text-zinc-500">
                  Best-pass gap · median across races
                </p>
                <p
                  className="mt-1 font-mono text-xl font-semibold tabular-nums"
                  style={{
                    color: markerColor(
                      comparableFastestRelativeGap ?? undefined,
                      majorGapThreshold,
                    ),
                  }}
                >
                  {signedSeconds(comparableFastestDelta)}
                </p>
              </div>
            </div>
            <p className="mb-3 text-xs text-zinc-500">
              Each race is first compared with its own peer median, then those
              race-level gaps are combined. Raw times from different races are
              not compared directly.
            </p>
            <details className="rounded-lg border border-white/[0.05] bg-white/[0.015]">
              <summary className="cursor-pointer px-3 py-2.5 text-xs font-medium text-zinc-300">
                Races in this comparison ({comparableSessions.length})
              </summary>
              <HorizontalScrollRegion
                label="Races in the corner comparison"
                hint="Swipe to compare race conditions and pace"
              >
                <div className="px-3 pb-3">
                  <table className="w-full min-w-[460px] text-left text-xs">
                    <thead className="text-zinc-500">
                      <tr>
                        <th className="py-2 pr-3 font-medium">Race</th>
                        <th className="py-2 pr-3 font-medium">Conditions</th>
                        <th className="py-2 pr-3 text-right font-medium">
                          Median gap
                        </th>
                        <th className="py-2 text-right font-medium">Match</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/[0.05] text-zinc-300">
                      {comparableSessions.map(({ conditions, point }) => (
                        <tr key={point.raceUid}>
                          <td className="py-2 pr-3">{point.label}</td>
                          <td className="py-2 pr-3">
                            {sessionConditionsLabel(conditions)}
                          </td>
                          <td
                            className="py-2 pr-3 text-right font-mono tabular-nums"
                            style={{
                              color: markerColor(
                                relativeGap(point.deltaMs, point.groupMs),
                                majorGapThreshold,
                              ),
                            }}
                          >
                            {signedSeconds(point.deltaMs)}
                          </td>
                          <td className="py-2 text-right">
                            {point.confidence === "high" ? "Strong" : "Limited"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </HorizontalScrollRegion>
            </details>
          </>
        )}
      </section>

      <details className="mb-4 rounded-xl border border-white/[0.06] bg-white/[0.02]">
        <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-zinc-300">
          Peer drivers in this comparison ({trend.peerComparisons.length})
        </summary>
        <HorizontalScrollRegion
          label="Peer drivers in the corner comparison"
          hint="Swipe to compare peer drivers"
        >
          <div className="px-4 pb-4">
            <table className="w-full min-w-[480px] text-left text-xs">
              <thead className="text-zinc-500">
                <tr>
                  <th className="py-2 pr-4 font-medium">Driver</th>
                  <th className="py-2 pr-4 text-right font-medium">Median</th>
                  <th className="py-2 pr-4 text-right font-medium">Fastest</th>
                  <th className="py-2 pr-4 text-right font-medium">
                    Matched laps
                  </th>
                  <th className="py-2 text-right font-medium">
                    Your passes matched
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.05] text-zinc-300">
                {trend.peerComparisons.map((peer) => (
                  <tr key={peer.driverKey}>
                    <td className="py-2 pr-4 font-medium">{peer.driverName}</td>
                    <td className="py-2 pr-4 text-right font-mono tabular-nums">
                      {durationSeconds(peer.medianMs)}
                    </td>
                    <td className="py-2 pr-4 text-right font-mono tabular-nums">
                      {durationSeconds(peer.fastestMs)}
                    </td>
                    <td className="py-2 pr-4 text-right tabular-nums">
                      {peer.matchedLaps}
                    </td>
                    <td className="py-2 text-right tabular-nums">
                      {peer.playerPasses}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-3 text-xs text-zinc-500">
              Only tyre-compatible clean passes are included for each driver.
            </p>
          </div>
        </HorizontalScrollRegion>
      </details>

      <div className="divide-y divide-white/[0.05]">
        {metrics.map((metric) => (
          <CornerMetric
            key={metric.key}
            label={metric.label}
            player={trend.playerMetrics[metric.key] ?? null}
            group={trend.groupMetrics[metric.key] ?? null}
            unit={metric.unit}
            digits={metric.digits}
          />
        ))}
      </div>

      <div className="mt-5 border-t border-white/[0.06] pt-4">
        <SectionHeader
          title="Progress by race"
          size="sm"
          hint="Each race compared with that race's group median"
        />
        {chartData.length < 2 ? (
          <p className="py-8 text-center text-sm text-zinc-500">
            Only one race has enough comparable section data so far.
          </p>
        ) : (
          <ResponsiveContainer width="100%" height={210}>
            <LineChart
              data={chartData}
              margin={{ top: 8, right: 16, bottom: 4, left: 0 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke={CHART_THEME.grid} />
              <XAxis
                dataKey="race"
                stroke={CHART_THEME.axis}
                fontSize={11}
                tickFormatter={(value) => `R${value}`}
              />
              <YAxis
                stroke={CHART_THEME.axis}
                fontSize={11}
                tickFormatter={(value) =>
                  `${value > 0 ? "+" : ""}${value.toFixed(2)}s`
                }
                width={58}
              />
              <ReferenceLine
                y={0}
                stroke={CHART_THEME.muted}
                strokeDasharray="4 4"
              />
              <Tooltip
                {...TOOLTIP_STYLE}
                formatter={(value) => [
                  typeof value === "number" ? signedSeconds(value * 1000) : "—",
                  "Gap",
                ]}
                labelFormatter={(value) => {
                  const point = chartData.find((entry) => entry.race === value);
                  return point?.date ?? `Race ${String(value)}`;
                }}
              />
              <Line
                type="monotone"
                dataKey="deltaSeconds"
                name="Gap"
                stroke={CHART_THEME.player}
                strokeWidth={2}
                dot={{ fill: CHART_THEME.player, r: 4 }}
                activeDot={{ r: 6 }}
              />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>
    </section>
  );
}

export function CornerAnalysisPanel({
  sessions,
  trackId,
}: {
  sessions: readonly TrackSessionData[];
  trackId: string;
}) {
  const { league } = useTelemetry();
  const driverKey = league?.selectedDriver ?? "";
  const driverName = league?.drivers.find(
    (driver) => driver.key === driverKey,
  )?.name;
  const [state, setState] = useState<LoadState>({
    status: "loading",
    progress: NO_PROGRESS,
  });
  const [activeSectionKind, setActiveSectionKind] =
    useState<TrackSectionKind>("corner");
  const [selectedSectionByKind, setSelectedSectionByKind] = useState({
    corner: 1,
    straight: 1,
  });

  useEffect(() => {
    if (!driverKey) {
      setState({
        status: "ready",
        result: {
          model: {
            corners: [],
            straights: [],
            trackTrace: [],
            races: [],
            latest: new Map(),
            latestEvidence: new Map(),
            latestStraights: new Map(),
            latestStraightEvidence: new Map(),
            totalRaces: 0,
            matchedRaces: 0,
          },
          matchedRaces: 0,
          availableRaces: 0,
          detectedCorners: 0,
          indexAvailable: true,
        },
      });
      return;
    }
    const controller = new AbortController();
    setState({ status: "loading", progress: NO_PROGRESS });
    loadCornerDevelopment(
      sessions,
      trackId,
      driverKey,
      controller.signal,
      (progress) => {
        setState({ status: "loading", progress });
      },
    )
      .then((result) => {
        if (!controller.signal.aborted) setState({ status: "ready", result });
      })
      .catch((error: unknown) => {
        if (
          !controller.signal.aborted &&
          (error as { name?: string })?.name !== "AbortError"
        ) {
          setState({ status: "error" });
        }
      });
    return () => controller.abort();
  }, [driverKey, sessions, trackId]);

  if (state.status === "loading") {
    const { completedRaces, totalRaces } = state.progress;
    return (
      <section className={cardClass}>
        <SectionHeader
          title="Track section analysis"
          hint="Compared with human drivers in the same race"
        />
        <div
          role="status"
          aria-label={
            totalRaces > 0
              ? `Analyzing replay data, ${completedRaces} of ${totalRaces} races`
              : "Looking for replay data for this circuit"
          }
          className="flex flex-col items-center justify-center gap-3 py-10"
        >
          <LoadingSpinner className="h-6 w-6 border-2" />
          {totalRaces > 0 && (
            <span className="text-sm text-zinc-500">
              {`Analyzing replay data · ${completedRaces} of ${totalRaces} races`}
            </span>
          )}
        </div>
      </section>
    );
  }

  if (state.status === "error") {
    return (
      <section className={cardClass}>
        <SectionHeader title="Track section analysis" />
        <p className="text-sm text-zinc-500">
          Replay data could not be loaded. Try the circuit page again later.
        </p>
      </section>
    );
  }

  const {
    model,
    availableRaces,
    matchedRaces,
    detectedCorners,
    indexAvailable,
  } = state.result;
  if (!detectedCorners) {
    const message = !indexAvailable
      ? "The replay index could not be reached. Check your connection and try again."
      : !availableRaces
        ? "No full-race replay bundles are listed for this circuit."
        : !matchedRaces
          ? "No usable replay data was found for the race sessions."
          : "No complete racing line was found to detect corners.";
    return (
      <section className={cardClass}>
        <SectionHeader
          title="Track section analysis"
          hint={driverName ?? "Selected driver"}
        />
        <p className="text-sm text-zinc-500">{message}</p>
      </section>
    );
  }

  const allSections: AnalyzedSection[] = [
    ...model.corners.map((definition) => ({
      kind: "corner" as const,
      definition,
    })),
    ...model.straights.map((definition) => ({
      kind: "straight" as const,
      definition,
    })),
  ];
  const activeSections = allSections.filter(
    (section) => section.kind === activeSectionKind,
  );
  const visibleKind: TrackSectionKind = activeSections.length
    ? activeSectionKind
    : "corner";
  const visibleSections =
    visibleKind === "corner"
      ? allSections.filter((section) => section.kind === "corner")
      : allSections.filter((section) => section.kind === "straight");
  const selected =
    visibleSections.find(
      (section) =>
        section.definition.number === selectedSectionByKind[visibleKind],
    ) ?? visibleSections[0]!;
  const selectedId = sectionId(selected.kind, selected.definition.number);
  const selectedNumber = selected.definition.number;
  const selectSection = (id: string) => {
    const section = allSections.find(
      (candidate) =>
        sectionId(candidate.kind, candidate.definition.number) === id,
    );
    if (!section) return;
    setActiveSectionKind(section.kind);
    setSelectedSectionByKind((current) => ({
      ...current,
      [section.kind]: section.definition.number,
    }));
  };
  const latestFor = (section: AnalyzedSection) =>
    section.kind === "corner"
      ? model.latest.get(section.definition.number)
      : model.latestStraights.get(section.definition.number);
  const evidenceFor = (section: AnalyzedSection) =>
    section.kind === "corner"
      ? model.latestEvidence.get(section.definition.number)
      : model.latestStraightEvidence.get(section.definition.number);
  const sortedSections = [...visibleSections].sort((a, b) => {
    const aGap = latestFor(a)?.deltaMs;
    const bGap = latestFor(b)?.deltaMs;
    if (aGap == null && bGap != null) return 1;
    if (bGap == null && aGap != null) return -1;
    return (
      (bGap ?? Number.NEGATIVE_INFINITY) - (aGap ?? Number.NEGATIVE_INFINITY)
    );
  });
  const trend = latestFor(selected);
  const evidence = evidenceFor(selected);
  const history = model.races.flatMap((race) => {
    const point =
      selected.kind === "corner"
        ? race.corners.get(selectedNumber)
        : race.straights.get(selectedNumber);
    return point ? [point] : [];
  });
  const referenceConditions = model.races.find(
    (race) => race.raceUid === trend?.raceUid,
  )?.conditions;
  const comparableSessions: ComparableSessionPoint[] = referenceConditions
    ? model.races.flatMap((race) => {
        const point =
          selected.kind === "corner"
            ? race.corners.get(selectedNumber)
            : race.straights.get(selectedNumber);
        const conditions = race.conditions;
        return point &&
          conditions &&
          areComparableCornerSessions(referenceConditions, conditions)
          ? [{ conditions, point }]
          : [];
      })
    : [];
  const majorGapThreshold = largeGapThreshold([
    ...model.latest.values(),
    ...model.latestStraights.values(),
  ]);

  return (
    <section className="space-y-3">
      <SectionHeader
        title="Track section analysis"
        hint={`${model.corners.length} corners · ${model.straights.length} straights · usable replay data for ${matchedRaces} of ${sessions.filter((session) => session.isRace).length} race sessions`}
        action={
          model.straights.length > 0 ? (
            <SegmentedControl<TrackSectionKind>
              size="sm"
              ariaLabel="Show corners or straights"
              value={visibleKind}
              onChange={setActiveSectionKind}
              options={[
                {
                  value: "corner",
                  label: "Corners",
                  meta: model.corners.length,
                },
                {
                  value: "straight",
                  label: "Straights",
                  meta: model.straights.length,
                },
              ]}
            />
          ) : null
        }
      />
      <div className="grid gap-3 lg:grid-cols-[minmax(0,1.15fr)_minmax(280px,0.85fr)]">
        <section className={cardClass}>
          <SectionHeader
            title="Track map"
            size="sm"
            hint={`${visibleKind === "corner" ? "Corners" : "Straights"} show your gap to the group median`}
          />
          <CornerTrackMap
            trace={model.trackTrace}
            corners={visibleKind === "corner" ? model.corners : []}
            straights={visibleKind === "straight" ? model.straights : []}
            latest={model.latest}
            latestStraights={model.latestStraights}
            majorGapThreshold={majorGapThreshold}
            selected={selectedId}
            onSelect={selectSection}
          />
          <div className="mt-2 flex flex-wrap gap-3 text-xs text-zinc-500">
            <span className="inline-flex items-center gap-1.5">
              <i className="size-2 rounded-full bg-red-500" />
              Much slower
            </span>
            <span className="inline-flex items-center gap-1.5">
              <i className="size-2 rounded-full bg-yellow-500" />
              Slightly slower
            </span>
            <span className="inline-flex items-center gap-1.5">
              <i className="size-2 rounded-full bg-green-500" />
              Faster
            </span>
            <span className="inline-flex items-center gap-1.5">
              <i className="size-2 rounded-full bg-purple-500" />
              Much faster
            </span>
            <span className="inline-flex items-center gap-1.5">
              <i className="size-2 rounded-full bg-zinc-500" />
              Not enough data
            </span>
          </div>
          <p className="mt-1 text-xs text-zinc-600">
            “Much” means the gap exceeds {(majorGapThreshold * 100).toFixed(1)}%
            of section time, with the cutoff adjusted to peer spread on this
            track.
          </p>
        </section>

        <section className={cardClass}>
          <SectionHeader
            title={visibleKind === "corner" ? "Corners" : "Straights"}
            size="sm"
            hint="Largest time loss first"
          />
          <div className="max-h-[330px] space-y-1 overflow-y-auto pr-1">
            {sortedSections.map((section) => {
              const point = latestFor(section);
              const sectionEvidence = evidenceFor(section);
              const number = section.definition.number;
              const isSelected = sectionId(section.kind, number) === selectedId;
              return (
                <button
                  type="button"
                  key={sectionId(section.kind, number)}
                  onClick={() => selectSection(sectionId(section.kind, number))}
                  className={cn(
                    "flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left transition-colors",
                    isSelected ? "bg-white/[0.09]" : "hover:bg-white/[0.045]",
                  )}
                >
                  <span className="min-w-0">
                    <span className="block text-sm font-medium text-zinc-200">
                      {analyzedSectionLabel(section)}
                    </span>
                    <span className="block truncate text-xs text-zinc-500">
                      {point
                        ? `${point.playerPasses} ${point.playerPasses === 1 ? "pass" : "passes"} · ${point.peerDrivers} drivers · ${point.confidence === "high" ? "strong" : "limited"}`
                        : sectionEvidence
                          ? `You ${sectionEvidence.playerPasses} clean · ${sectionEvidence.peerDriversWithAnyPasses} peers with clean passes`
                          : "Not enough comparable passes yet"}
                    </span>
                  </span>
                  <span
                    className="shrink-0 font-mono text-sm tabular-nums"
                    style={{
                      color: markerColor(
                        point
                          ? relativeGap(point.deltaMs, point.groupMs)
                          : undefined,
                        majorGapThreshold,
                      ),
                    }}
                  >
                    {point ? signedSeconds(point.deltaMs) : "—"}
                  </span>
                </button>
              );
            })}
          </div>
        </section>
      </div>

      <TrackSectionDetail
        section={selected}
        trend={trend}
        history={history}
        evidence={evidence}
        comparableSessions={comparableSessions}
        majorGapThreshold={majorGapThreshold}
      />
      <p className="px-1 text-xs text-zinc-600">
        Median pace compares each driver's median clean section; fastest pace
        compares each driver's fastest clean section. Each peer driver counts
        once. Limited comparisons need one pass from you and two human peers; a
        strong match needs three comparable passes from you and three passes
        from each peer. Pit, incident, off-track, and close-traffic passages are
        excluded. Missing tyre data lowers confidence.
      </p>
    </section>
  );
}
