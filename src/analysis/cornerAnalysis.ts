import { median } from "../utils/stats/core";

/** A frame from a full-race replay, expressed in metres and seconds. */
export interface CornerTracePoint {
  t: number;
  distance: number;
  x: number;
  z: number;
  speedKmh: number;
  throttle: number;
  brake: number;
  steer: number;
  off: number;
  gapMs: number | null;
}

export interface CornerMapPoint {
  x: number;
  z: number;
}

export interface CornerTrackPoint extends CornerMapPoint {
  distance: number;
}

export interface CornerDefinition {
  number: number;
  sector?: 1 | 2 | 3;
  /** Start/end delimit a shared distance window; apex is the curve's peak curvature. */
  startM: number;
  apexM: number;
  endM: number;
  curveStartM: number;
  curveEndM: number;
  mapPoint: CornerMapPoint;
}

export interface StraightDefinition {
  number: number;
  sector?: 1 | 2 | 3;
  startM: number;
  endM: number;
  mapPoint: CornerMapPoint;
}

/** Session context used to avoid mixing unlike races in cross-session benchmarks. */
export interface CornerSessionConditions {
  trackId: string;
  trackLength: number;
  formula: string;
  gameYear: number;
  sessionType: string;
  gameMode: string;
  weather: string;
  trackTemperatureC: number;
  airTemperatureC: number;
  totalLaps: number;
  equalCarPerformance: boolean | null;
  aiDifficulty: number | null;
}

const CONDITION_TEMP_TOLERANCE_C = 5;
const TRACK_LENGTH_TOLERANCE = 0.03;

function weatherBand(weather: string): "wet" | "dry" | null {
  const value = weather.trim().toLowerCase();
  if (!value) return null;
  return /rain|wet|storm/.test(value) ? "wet" : "dry";
}

/** Strict session-context match; race-level peer deltas remain the normalization. */
export function areComparableCornerSessions(
  reference: CornerSessionConditions,
  candidate: CornerSessionConditions,
): boolean {
  const referenceWeather = weatherBand(reference.weather);
  const candidateWeather = weatherBand(candidate.weather);
  if (
    !referenceWeather ||
    !candidateWeather ||
    referenceWeather !== candidateWeather ||
    reference.trackId !== candidate.trackId ||
    reference.formula.trim().toLowerCase() !==
      candidate.formula.trim().toLowerCase() ||
    reference.gameYear !== candidate.gameYear ||
    reference.sessionType.trim().toLowerCase() !== "race" ||
    candidate.sessionType.trim().toLowerCase() !== "race" ||
    reference.gameMode.trim().toLowerCase() !==
      candidate.gameMode.trim().toLowerCase()
  ) {
    return false;
  }

  const longerTrack = Math.max(reference.trackLength, candidate.trackLength);
  if (
    !Number.isFinite(longerTrack) ||
    longerTrack <= 0 ||
    Math.abs(reference.trackLength - candidate.trackLength) / longerTrack >
      TRACK_LENGTH_TOLERANCE
  ) {
    return false;
  }
  if (
    !Number.isFinite(reference.trackTemperatureC) ||
    !Number.isFinite(candidate.trackTemperatureC) ||
    !Number.isFinite(reference.airTemperatureC) ||
    !Number.isFinite(candidate.airTemperatureC) ||
    Math.abs(reference.trackTemperatureC - candidate.trackTemperatureC) >
      CONDITION_TEMP_TOLERANCE_C ||
    Math.abs(reference.airTemperatureC - candidate.airTemperatureC) >
      CONDITION_TEMP_TOLERANCE_C
  ) {
    return false;
  }
  if (
    reference.equalCarPerformance != null &&
    candidate.equalCarPerformance != null &&
    reference.equalCarPerformance !== candidate.equalCarPerformance
  ) {
    return false;
  }
  if (
    reference.aiDifficulty != null &&
    candidate.aiDifficulty != null &&
    Math.abs(reference.aiDifficulty - candidate.aiDifficulty) > 5
  ) {
    return false;
  }
  return true;
}

export interface CornerPass {
  raceUid: string;
  date: string;
  driverKey: string;
  driverName: string;
  car: number;
  lap: number;
  cornerNumber: number;
  durationMs: number;
  brakePointM: number | null;
  minimumSpeedKmh: number | null;
  throttlePickupM: number | null;
  exitSpeedKmh: number;
  entrySpeedKmh?: number | null;
  maximumSpeedKmh?: number | null;
  compound?: string;
  tyreAge?: number;
}

export interface CornerTrendPoint {
  raceUid: string;
  date: string;
  label: string;
  playerMs: number;
  groupMs: number;
  deltaMs: number;
  playerFastestMs: number;
  groupFastestMs: number;
  fastestDeltaMs: number;
  playerPasses: number;
  peerDrivers: number;
  peerPasses: number;
  peerComparisons: CornerPeerComparison[];
  confidence: "high" | "low";
  playerMetrics: CornerMeasuredMetrics;
  groupMetrics: CornerMeasuredMetrics;
}

export interface CornerPeerComparison {
  driverKey: string;
  driverName: string;
  medianMs: number;
  fastestMs: number;
  matchedLaps: number;
  playerPasses: number;
}

export interface CornerMeasuredMetrics {
  brakePointM: number | null;
  minimumSpeedKmh: number | null;
  throttlePickupM: number | null;
  exitSpeedKmh: number | null;
  entrySpeedKmh?: number | null;
  maximumSpeedKmh?: number | null;
}

export interface CornerRaceSummary {
  raceUid: string;
  date: string;
  label: string;
  corners: Map<number, CornerTrendPoint>;
  evidence: Map<number, CornerEvidence>;
  straights: Map<number, CornerTrendPoint>;
  straightEvidence: Map<number, CornerEvidence>;
  conditions?: CornerSessionConditions;
}

export interface CornerPassRejections {
  pitPassages: number;
  incidents: number;
  missingTelemetry: number;
  incompleteTelemetry: number;
  offTrack: number;
  closeTraffic: number;
}

export interface CornerEvidence extends CornerPassRejections {
  candidateLaps: number;
  playerPasses: number;
  peerDriversWithAnyPasses: number;
  peerDriversWithThreePasses: number;
  comparablePlayerPasses: number;
  strongComparablePlayerPasses: number;
}

export interface CornerDevelopmentModel {
  corners: CornerDefinition[];
  straights: StraightDefinition[];
  trackTrace: CornerTrackPoint[];
  races: CornerRaceSummary[];
  latest: Map<number, CornerTrendPoint>;
  latestEvidence: Map<number, CornerEvidence>;
  latestStraights: Map<number, CornerTrendPoint>;
  latestStraightEvidence: Map<number, CornerEvidence>;
  totalRaces: number;
  matchedRaces: number;
}

export interface CornerRaceInput {
  raceUid: string;
  date: string;
  trackLength: number;
  passes: CornerPass[];
  playerPassRejections?: Map<number, CornerPassRejections>;
  conditions?: CornerSessionConditions;
}

export interface CornerReplayLapInput {
  lap: number;
  lapTimeMs: number;
  points: readonly CornerTracePoint[] | null;
  compound?: string;
  tyreAge?: number;
  pitPassage?: boolean;
  incident?: boolean;
}

export interface CornerReplayDriverInput {
  car: number;
  driverKey: string;
  driverName: string;
  ai: boolean;
  laps: readonly CornerReplayLapInput[];
}

const TRACE_STEP_M = 5;
const TANGENT_WINDOW_M = 15;
const CURVATURE_THRESHOLD = 0.0016;
const MIN_TURN_ANGLE_RAD = (9 * Math.PI) / 180;
const MIN_TURN_LENGTH_M = 20;
const MAX_TURN_LENGTH_M = 480;
const MAX_JOIN_GAP_M = 15;
const MIN_PLAYER_PASSES = 3;
const MIN_PEER_PASSES = 3;
const MIN_PEER_DRIVERS = 2;
const MAX_TYRE_AGE_DELTA = 3;

const nullableMedian = (values: number[]) => median(values) ?? null;

const wrapDistance = (distance: number, length: number) =>
  ((distance % length) + length) % length;

function angleDelta(a: number, b: number): number {
  let delta = a - b;
  while (delta > Math.PI) delta -= Math.PI * 2;
  while (delta < -Math.PI) delta += Math.PI * 2;
  return delta;
}

function sortedTrace(trace: readonly CornerTracePoint[]) {
  return trace
    .filter(
      (point) =>
        Number.isFinite(point.distance) &&
        Number.isFinite(point.x) &&
        Number.isFinite(point.z),
    )
    .map((point) => ({ ...point }))
    .sort((a, b) => a.distance - b.distance);
}

function interpolatePosition(
  trace: readonly CornerTracePoint[],
  distance: number,
  length: number,
): CornerMapPoint | null {
  if (trace.length < 2 || length <= 0) return null;
  const target = wrapDistance(distance, length);
  let lo = 0;
  let hi = trace.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (trace[mid]!.distance < target) lo = mid + 1;
    else hi = mid;
  }

  if (lo < trace.length && Math.abs(trace[lo]!.distance - target) < 1e-3) {
    return { x: trace[lo]!.x, z: trace[lo]!.z };
  }

  let a: CornerTracePoint;
  let b: CornerTracePoint;
  let targetAdjusted = target;
  if (lo === 0) {
    a = trace[trace.length - 1]!;
    b = trace[0]!;
    targetAdjusted += length;
  } else if (lo === trace.length) {
    a = trace[trace.length - 1]!;
    b = trace[0]!;
  } else {
    a = trace[lo - 1]!;
    b = trace[lo]!;
  }
  let aDistance = a.distance;
  let bDistance = b.distance;
  if (bDistance <= aDistance) bDistance += length;
  if (targetAdjusted < aDistance) targetAdjusted += length;
  const span = bDistance - aDistance;
  if (span <= 0 || span > 120) return null;
  const t = (targetAdjusted - aDistance) / span;
  return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t };
}

interface TurnRegion {
  startM: number;
  endM: number;
  apexM: number;
  angle: number;
  sign: number;
}

/**
 * Detects stable, numbered turn zones from a lap's world-coordinate trace.
 * The catalogue is generated from the selected track's replay, so it works
 * for every supported layout (including reverse/short variants) without
 * hand-maintained coordinates. Turn numbers follow lap order.
 */
export function buildCornerCatalog(
  rawTrace: readonly CornerTracePoint[],
  trackLength: number,
  sectorBoundaries?: readonly [number, number],
): {
  corners: CornerDefinition[];
  straights: StraightDefinition[];
  trackTrace: CornerTrackPoint[];
} {
  if (trackLength < 100 || rawTrace.length < 80) {
    return { corners: [], straights: [], trackTrace: [] };
  }

  const trace = sortedTrace(rawTrace);
  if (trace.length < 80) return { corners: [], straights: [], trackTrace: [] };
  const count = Math.floor(trackLength / TRACE_STEP_M);
  if (count < 100) return { corners: [], straights: [], trackTrace: [] };

  const rawPositions: (CornerMapPoint | null)[] = [];
  for (let i = 0; i < count; i++) {
    rawPositions.push(
      interpolatePosition(trace, i * TRACE_STEP_M, trackLength),
    );
  }
  if (rawPositions.some((point) => point == null)) {
    return { corners: [], straights: [], trackTrace: [] };
  }
  const positions = rawPositions as CornerMapPoint[];
  const smooth = positions.map((_, i) => {
    let x = 0;
    let z = 0;
    let n = 0;
    for (let offset = -2; offset <= 2; offset++) {
      const point = positions[(i + offset + count) % count]!;
      x += point.x;
      z += point.z;
      n++;
    }
    return { x: x / n, z: z / n };
  });

  const tangentWindow = Math.max(
    2,
    Math.round(TANGENT_WINDOW_M / TRACE_STEP_M),
  );
  const headings = smooth.map((_, i) => {
    const before = smooth[(i - tangentWindow + count) % count]!;
    const after = smooth[(i + tangentWindow) % count]!;
    return Math.atan2(after.z - before.z, after.x - before.x);
  });
  const curvature = headings.map((_, i) => {
    const before = headings[(i - 2 + count) % count]!;
    const after = headings[(i + 2) % count]!;
    return angleDelta(after, before) / (4 * TRACE_STEP_M);
  });
  const smoothedCurvature = curvature.map((_, i) => {
    let sum = 0;
    for (let offset = -2; offset <= 2; offset++) {
      sum += curvature[(i + offset + count) % count]!;
    }
    return sum / 5;
  });

  // Scan three copies so a corner that straddles the start/finish line is one
  // region. Keep only regions whose midpoint lies in the middle copy.
  const expanded = [
    ...smoothedCurvature,
    ...smoothedCurvature,
    ...smoothedCurvature,
  ];
  const regions: TurnRegion[] = [];
  let i = 0;
  while (i < expanded.length) {
    const value = expanded[i]!;
    const sign = Math.sign(value);
    if (!sign || Math.abs(value) < CURVATURE_THRESHOLD) {
      i++;
      continue;
    }

    const start = i;
    let lastActive = i;
    let gap = 0;
    let angle = Math.abs(value) * TRACE_STEP_M;
    let apexIndex = i;
    let apexStrength = Math.abs(value);
    i++;
    while (i < expanded.length && i - start <= count / 2) {
      const next = expanded[i]!;
      if (Math.sign(next) === sign && Math.abs(next) >= CURVATURE_THRESHOLD) {
        lastActive = i;
        gap = 0;
        angle += Math.abs(next) * TRACE_STEP_M;
        if (Math.abs(next) > apexStrength) {
          apexStrength = Math.abs(next);
          apexIndex = i;
        }
        i++;
        continue;
      }
      if (
        Math.abs(next) < CURVATURE_THRESHOLD &&
        gap < MAX_JOIN_GAP_M / TRACE_STEP_M
      ) {
        gap++;
        i++;
        continue;
      }
      break;
    }

    const end = lastActive;
    const midpoint = (start + end) / 2;
    if (
      midpoint >= count &&
      midpoint < count * 2 &&
      end - start >= MIN_TURN_LENGTH_M / TRACE_STEP_M &&
      end - start <= MAX_TURN_LENGTH_M / TRACE_STEP_M &&
      angle >= MIN_TURN_ANGLE_RAD
    ) {
      regions.push({
        startM: wrapDistance(start * TRACE_STEP_M, trackLength),
        endM: wrapDistance((end + 1) * TRACE_STEP_M, trackLength),
        apexM: wrapDistance(apexIndex * TRACE_STEP_M, trackLength),
        angle,
        sign,
      });
    }
  }

  regions.sort((a, b) => a.apexM - b.apexM);
  const uniqueRegions = regions.filter(
    (region, index) =>
      index === 0 ||
      Math.min(
        wrapDistance(region.apexM - regions[index - 1]!.apexM, trackLength),
        wrapDistance(regions[index - 1]!.apexM - region.apexM, trackLength),
      ) > 70,
  );
  if (uniqueRegions.length < 3) {
    return { corners: [], straights: [], trackTrace: [] };
  }

  const validSectorBoundaries =
    sectorBoundaries &&
    Number.isFinite(sectorBoundaries[0]) &&
    Number.isFinite(sectorBoundaries[1]) &&
    sectorBoundaries[0] >= 0 &&
    sectorBoundaries[0] < sectorBoundaries[1] &&
    sectorBoundaries[1] < trackLength
      ? sectorBoundaries
      : null;

  const corners = uniqueRegions.map((region, index): CornerDefinition => {
    const previous =
      uniqueRegions[(index - 1 + uniqueRegions.length) % uniqueRegions.length]!;
    const next = uniqueRegions[(index + 1) % uniqueRegions.length]!;
    const previousGap = wrapDistance(
      region.startM - previous.endM,
      trackLength,
    );
    const nextGap = wrapDistance(next.startM - region.endM, trackLength);
    const startM = wrapDistance(region.startM - previousGap / 2, trackLength);
    const endM = wrapDistance(region.endM + nextGap / 2, trackLength);
    const sectorOneEnd = validSectorBoundaries
      ? wrapDistance(validSectorBoundaries[0], trackLength)
      : null;
    const sectorTwoEnd = validSectorBoundaries
      ? wrapDistance(validSectorBoundaries[1], trackLength)
      : null;
    const apexM = region.apexM;
    return {
      number: index + 1,
      ...(sectorOneEnd != null && sectorTwoEnd != null
        ? {
            sector: (apexM < sectorOneEnd
              ? 1
              : apexM < sectorTwoEnd
                ? 2
                : 3) as 1 | 2 | 3,
          }
        : {}),
      startM,
      apexM,
      endM,
      curveStartM: region.startM,
      curveEndM: region.endM,
      mapPoint: interpolatePosition(trace, region.apexM, trackLength) ?? {
        x: 0,
        z: 0,
      },
    };
  });
  const straights: StraightDefinition[] = [];
  corners.forEach((corner, index) => {
    const next = corners[(index + 1) % corners.length]!;
    const lengthM = wrapDistance(
      next.curveStartM - corner.curveEndM,
      trackLength,
    );
    if (lengthM < 20) return;
    const startM = corner.curveEndM;
    const endM = next.curveStartM;
    const midpointM = wrapDistance(startM + lengthM / 2, trackLength);
    const sectorOneEnd = validSectorBoundaries?.[0] ?? null;
    const sectorTwoEnd = validSectorBoundaries?.[1] ?? null;
    const mapPoint = interpolatePosition(trace, midpointM, trackLength);
    if (!mapPoint) return;
    straights.push({
      number: straights.length + 1,
      ...(sectorOneEnd != null && sectorTwoEnd != null
        ? {
            sector: (midpointM < sectorOneEnd
              ? 1
              : midpointM < sectorTwoEnd
                ? 2
                : 3) as 1 | 2 | 3,
          }
        : {}),
      startM,
      endM,
      mapPoint,
    });
  });

  return {
    corners,
    straights,
    trackTrace: positions
      .map((point, index) => ({ ...point, distance: index * TRACE_STEP_M }))
      .filter((_, index) => index % 2 === 0),
  };
}

function interpolateTraceValue(
  points: readonly CornerTracePoint[],
  distance: number,
  trackLength: number,
  lapSeconds: number,
): CornerTracePoint | null {
  if (points.length < 2) return null;
  const target = wrapDistance(distance, trackLength);
  const expanded = [
    ...points.map((point) => ({
      ...point,
      distance: point.distance - trackLength,
      t: point.t - lapSeconds,
    })),
    ...points,
    ...points.map((point) => ({
      ...point,
      distance: point.distance + trackLength,
      t: point.t + lapSeconds,
    })),
  ].sort((a, b) => a.distance - b.distance);
  let lo = 0;
  let hi = expanded.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (expanded[mid]!.distance < target) lo = mid + 1;
    else hi = mid;
  }
  if (lo === 0 || lo >= expanded.length) return null;
  const a = expanded[lo - 1]!;
  const b = expanded[lo]!;
  const span = b.distance - a.distance;
  if (span <= 0 || span > 60) return null;
  const ratio = (target - a.distance) / span;
  const mix = (left: number, right: number) => left + (right - left) * ratio;
  return {
    t: mix(a.t, b.t),
    distance: target,
    x: mix(a.x, b.x),
    z: mix(a.z, b.z),
    speedKmh: mix(a.speedKmh, b.speedKmh),
    throttle: mix(a.throttle, b.throttle),
    brake: mix(a.brake, b.brake),
    steer: mix(a.steer, b.steer),
    off: ratio < 0.5 ? a.off : b.off,
    gapMs: a.gapMs != null && b.gapMs != null ? mix(a.gapMs, b.gapMs) : null,
  };
}

export interface CornerPassContext {
  raceUid: string;
  date: string;
  driverKey: string;
  driverName: string;
  car: number;
  lap: number;
  lapTimeMs: number;
  compound?: string;
  tyreAge?: number;
}

/** Analyze one complete replay lap around a catalogued turn. */
export function buildCornerPass(
  rawPoints: readonly CornerTracePoint[],
  corner: CornerDefinition,
  trackLength: number,
  context: CornerPassContext,
  onRejected?: (
    reason: "incompleteTelemetry" | "offTrack" | "closeTraffic",
  ) => void,
): CornerPass | null {
  const reject = (
    reason: "incompleteTelemetry" | "offTrack" | "closeTraffic",
  ): null => {
    onRejected?.(reason);
    return null;
  };
  if (trackLength <= 0 || rawPoints.length < 8 || context.lapTimeMs <= 0)
    return reject("incompleteTelemetry");
  const points = sortedTrace(rawPoints);
  const startM = wrapDistance(corner.startM, trackLength);
  const endM = wrapDistance(corner.endM, trackLength);
  const spanM = wrapDistance(endM - startM, trackLength);
  if (spanM < 30 || spanM > trackLength / 2)
    return reject("incompleteTelemetry");

  const lapSeconds = context.lapTimeMs / 1000;
  const start = interpolateTraceValue(points, startM, trackLength, lapSeconds);
  const finish = interpolateTraceValue(
    points,
    startM + spanM,
    trackLength,
    lapSeconds,
  );
  if (finish && startM + spanM >= trackLength) finish.t += lapSeconds;
  if (!start || !finish || finish.t <= start.t)
    return reject("incompleteTelemetry");

  const extended = [
    ...points.map((point) => ({
      ...point,
      distance: point.distance + trackLength,
    })),
    ...points,
  ].sort((a, b) => a.distance - b.distance);
  const startAbs = startM;
  const endAbs = startAbs + spanM;
  const window = extended.filter(
    (point) => point.distance >= startAbs && point.distance <= endAbs,
  );
  if (window.length < 5) return reject("incompleteTelemetry");
  const maxGap = window.reduce((max, point, index) => {
    if (index === 0) return max;
    return Math.max(max, point.distance - window[index - 1]!.distance);
  }, 0);
  if (maxGap > 60) return reject("incompleteTelemetry");
  if (window.some((point) => point.off !== 0)) return reject("offTrack");
  if (
    window.some(
      (point) => point.gapMs != null && point.gapMs > 0 && point.gapMs < 1000,
    )
  ) {
    return reject("closeTraffic");
  }

  const apexM = wrapDistance(corner.apexM, trackLength);
  const curveStart = wrapDistance(corner.curveStartM, trackLength);
  const curveEnd = wrapDistance(corner.curveEndM, trackLength);
  const curveStartAbs = startM + wrapDistance(curveStart - startM, trackLength);
  const curveEndAbs = startM + wrapDistance(curveEnd - startM, trackLength);
  const turnStart = interpolateTraceValue(
    points,
    curveStartAbs,
    trackLength,
    lapSeconds,
  );
  const turnFinish = interpolateTraceValue(
    points,
    curveEndAbs,
    trackLength,
    lapSeconds,
  );
  if (turnStart && curveStartAbs >= trackLength) turnStart.t += lapSeconds;
  if (turnFinish && curveEndAbs >= trackLength) turnFinish.t += lapSeconds;
  if (!turnStart || !turnFinish || turnFinish.t <= turnStart.t)
    return reject("incompleteTelemetry");
  const curvePoints = extended.filter(
    (point) => point.distance >= curveStartAbs && point.distance <= curveEndAbs,
  );
  const beforeApex = window.filter(
    (point) =>
      point.distance <= startM + wrapDistance(apexM - startM, trackLength),
  );
  const afterApex = window.filter(
    (point) =>
      point.distance >= startM + wrapDistance(apexM - startM, trackLength),
  );
  const brake = beforeApex.find((point) => point.brake >= 0.1);
  let throttlePickupM: number | null = null;
  for (let i = 1; i < afterApex.length; i++) {
    if (afterApex[i - 1]!.throttle >= 0.95 && afterApex[i]!.throttle >= 0.95) {
      throttlePickupM = wrapDistance(
        afterApex[i - 1]!.distance - apexM,
        trackLength,
      );
      break;
    }
  }

  const minimumSpeedKmh = curvePoints.length
    ? Math.min(...curvePoints.map((point) => point.speedKmh))
    : null;
  return {
    ...context,
    cornerNumber: corner.number,
    durationMs: (turnFinish.t - turnStart.t) * 1000,
    brakePointM: brake
      ? wrapDistance(apexM - brake.distance, trackLength)
      : null,
    minimumSpeedKmh,
    throttlePickupM,
    exitSpeedKmh: turnFinish.speedKmh,
  };
}

/** Analyze one complete replay lap across a straight between two detected turns. */
export function buildStraightPass(
  rawPoints: readonly CornerTracePoint[],
  straight: StraightDefinition,
  trackLength: number,
  context: CornerPassContext,
  onRejected?: (
    reason: "incompleteTelemetry" | "offTrack" | "closeTraffic",
  ) => void,
): CornerPass | null {
  const reject = (
    reason: "incompleteTelemetry" | "offTrack" | "closeTraffic",
  ): null => {
    onRejected?.(reason);
    return null;
  };
  if (trackLength <= 0 || rawPoints.length < 8 || context.lapTimeMs <= 0)
    return reject("incompleteTelemetry");

  const points = sortedTrace(rawPoints);
  const startM = wrapDistance(straight.startM, trackLength);
  const spanM = wrapDistance(straight.endM - startM, trackLength);
  if (spanM < 20 || spanM > trackLength * 0.75)
    return reject("incompleteTelemetry");

  const lapSeconds = context.lapTimeMs / 1000;
  const start = interpolateTraceValue(points, startM, trackLength, lapSeconds);
  const finish = interpolateTraceValue(
    points,
    startM + spanM,
    trackLength,
    lapSeconds,
  );
  if (finish && startM + spanM >= trackLength) finish.t += lapSeconds;
  if (!start || !finish || finish.t <= start.t)
    return reject("incompleteTelemetry");

  const endAbs = startM + spanM;
  const extended = [
    ...points,
    ...points.map((point) => ({
      ...point,
      distance: point.distance + trackLength,
    })),
  ].sort((a, b) => a.distance - b.distance);
  const window = extended.filter(
    (point) => point.distance >= startM && point.distance <= endAbs,
  );
  if (window.length < 5) return reject("incompleteTelemetry");
  const maxGap = window.reduce((max, point, index) => {
    if (index === 0) return max;
    return Math.max(max, point.distance - window[index - 1]!.distance);
  }, 0);
  if (maxGap > 60) return reject("incompleteTelemetry");
  if (window.some((point) => point.off !== 0)) return reject("offTrack");
  if (
    window.some(
      (point) => point.gapMs != null && point.gapMs > 0 && point.gapMs < 1000,
    )
  ) {
    return reject("closeTraffic");
  }

  return {
    ...context,
    cornerNumber: straight.number,
    durationMs: (finish.t - start.t) * 1000,
    brakePointM: null,
    minimumSpeedKmh: null,
    throttlePickupM: null,
    entrySpeedKmh: start.speedKmh,
    maximumSpeedKmh: Math.max(...window.map((point) => point.speedKmh)),
    exitSpeedKmh: finish.speedKmh,
  };
}

function compatiblePasses(
  playerPass: CornerPass,
  peerPasses: readonly CornerPass[],
): CornerPass[] {
  return peerPasses.filter((peer) => {
    if (
      playerPass.compound &&
      peer.compound &&
      playerPass.compound !== peer.compound
    ) {
      return false;
    }
    if (
      playerPass.tyreAge != null &&
      peer.tyreAge != null &&
      Math.abs(playerPass.tyreAge - peer.tyreAge) > MAX_TYRE_AGE_DELTA
    ) {
      return false;
    }
    return true;
  });
}

/** Compare typical and fastest passes, weighting each peer driver equally. */
export function summarizeCornerRace(
  input: CornerRaceInput,
  selectedDriverKey: string,
  corners: readonly { number: number }[],
): CornerRaceSummary {
  const cornerSummaries = new Map<number, CornerTrendPoint>();
  const evidenceByCorner = new Map<number, CornerEvidence>();
  for (const corner of corners) {
    const passes = input.passes.filter(
      (pass) => pass.cornerNumber === corner.number,
    );
    const playerPasses = passes.filter(
      (pass) => pass.driverKey === selectedDriverKey,
    );
    const comparisons: Array<{
      player: CornerPass;
      groupMs: number;
      groupFastestMs: number;
      groupMetrics: CornerMeasuredMetrics;
      peerDrivers: number;
      peerPasses: number;
      peerComparisons: Array<{
        driverKey: string;
        driverName: string;
        medianMs: number;
        fastestMs: number;
        matchedLaps: number[];
      }>;
      strong: boolean;
      highConfidence: boolean;
    }> = [];
    const peersByDriver = new Map<string, CornerPass[]>();
    for (const pass of passes) {
      if (pass.driverKey === selectedDriverKey) continue;
      const group = peersByDriver.get(pass.driverKey) ?? [];
      group.push(pass);
      peersByDriver.set(pass.driverKey, group);
    }
    const peerDriversWithThreePasses = [...peersByDriver.values()].filter(
      (peerPasses) => peerPasses.length >= MIN_PEER_PASSES,
    ).length;
    for (const player of playerPasses) {
      const peerObservations: Array<{
        driverKey: string;
        driverName: string;
        medianMs: number;
        fastestMs: number;
        matchedPasses: number;
        matchedLaps: number[];
        metrics: CornerMeasuredMetrics;
        highConfidence: boolean;
      }> = [];
      for (const allPeerPasses of peersByDriver.values()) {
        const matched = compatiblePasses(player, allPeerPasses);
        if (!matched.length) continue;
        const medianMs = median(matched.map((pass) => pass.durationMs));
        if (medianMs == null) continue;
        peerObservations.push({
          driverKey: matched[0]!.driverKey,
          driverName: matched[0]!.driverName,
          medianMs,
          fastestMs: Math.min(...matched.map((pass) => pass.durationMs)),
          matchedPasses: matched.length,
          matchedLaps: matched.map((pass) => pass.lap),
          metrics: {
            brakePointM: nullableMedian(
              matched.flatMap((pass) =>
                pass.brakePointM == null ? [] : [pass.brakePointM],
              ),
            ),
            minimumSpeedKmh: nullableMedian(
              matched.flatMap((pass) =>
                pass.minimumSpeedKmh == null ? [] : [pass.minimumSpeedKmh],
              ),
            ),
            throttlePickupM: nullableMedian(
              matched.flatMap((pass) =>
                pass.throttlePickupM == null ? [] : [pass.throttlePickupM],
              ),
            ),
            exitSpeedKmh: nullableMedian(
              matched.map((pass) => pass.exitSpeedKmh),
            ),
            entrySpeedKmh: nullableMedian(
              matched.flatMap((pass) =>
                pass.entrySpeedKmh == null ? [] : [pass.entrySpeedKmh],
              ),
            ),
            maximumSpeedKmh: nullableMedian(
              matched.flatMap((pass) =>
                pass.maximumSpeedKmh == null ? [] : [pass.maximumSpeedKmh],
              ),
            ),
          },
          highConfidence: matched.every((pass) =>
            Boolean(pass.compound && pass.tyreAge != null),
          ),
        });
      }
      const strongPeers = peerObservations.filter(
        (peer) => peer.matchedPasses >= MIN_PEER_PASSES,
      );
      const strong = strongPeers.length >= MIN_PEER_DRIVERS;
      const benchmarkPeers = strong ? strongPeers : peerObservations;
      if (benchmarkPeers.length < MIN_PEER_DRIVERS) continue;
      const groupMs = median(benchmarkPeers.map((peer) => peer.medianMs));
      const groupFastestMs = median(
        benchmarkPeers.map((peer) => peer.fastestMs),
      );
      if (groupMs == null || groupFastestMs == null) continue;
      const groupMetrics: CornerMeasuredMetrics = {
        brakePointM: nullableMedian(
          benchmarkPeers.flatMap((peer) =>
            peer.metrics.brakePointM == null ? [] : [peer.metrics.brakePointM],
          ),
        ),
        minimumSpeedKmh: nullableMedian(
          benchmarkPeers.flatMap((peer) =>
            peer.metrics.minimumSpeedKmh == null
              ? []
              : [peer.metrics.minimumSpeedKmh],
          ),
        ),
        throttlePickupM: nullableMedian(
          benchmarkPeers.flatMap((peer) =>
            peer.metrics.throttlePickupM == null
              ? []
              : [peer.metrics.throttlePickupM],
          ),
        ),
        exitSpeedKmh: nullableMedian(
          benchmarkPeers.flatMap((peer) =>
            peer.metrics.exitSpeedKmh == null
              ? []
              : [peer.metrics.exitSpeedKmh],
          ),
        ),
        entrySpeedKmh: nullableMedian(
          benchmarkPeers.flatMap((peer) =>
            peer.metrics.entrySpeedKmh == null
              ? []
              : [peer.metrics.entrySpeedKmh],
          ),
        ),
        maximumSpeedKmh: nullableMedian(
          benchmarkPeers.flatMap((peer) =>
            peer.metrics.maximumSpeedKmh == null
              ? []
              : [peer.metrics.maximumSpeedKmh],
          ),
        ),
      };
      comparisons.push({
        player,
        groupMs,
        groupFastestMs,
        groupMetrics,
        peerDrivers: benchmarkPeers.length,
        peerPasses: benchmarkPeers.reduce(
          (total, peer) => total + peer.matchedPasses,
          0,
        ),
        peerComparisons: benchmarkPeers.map((peer) => ({
          driverKey: peer.driverKey,
          driverName: peer.driverName,
          medianMs: peer.medianMs,
          fastestMs: peer.fastestMs,
          matchedLaps: peer.matchedLaps,
        })),
        strong,
        highConfidence:
          strong &&
          Boolean(player.compound && player.tyreAge != null) &&
          benchmarkPeers.every((peer) => peer.highConfidence),
      });
    }

    const strongComparisons = comparisons.filter((entry) => entry.strong);
    const rejected = input.playerPassRejections?.get(corner.number);
    evidenceByCorner.set(corner.number, {
      candidateLaps:
        playerPasses.length +
        (rejected?.pitPassages ?? 0) +
        (rejected?.incidents ?? 0) +
        (rejected?.missingTelemetry ?? 0) +
        (rejected?.incompleteTelemetry ?? 0) +
        (rejected?.offTrack ?? 0) +
        (rejected?.closeTraffic ?? 0),
      playerPasses: playerPasses.length,
      peerDriversWithAnyPasses: peersByDriver.size,
      peerDriversWithThreePasses,
      comparablePlayerPasses: comparisons.length,
      strongComparablePlayerPasses: strongComparisons.length,
      pitPassages: rejected?.pitPassages ?? 0,
      incidents: rejected?.incidents ?? 0,
      missingTelemetry: rejected?.missingTelemetry ?? 0,
      incompleteTelemetry: rejected?.incompleteTelemetry ?? 0,
      offTrack: rejected?.offTrack ?? 0,
      closeTraffic: rejected?.closeTraffic ?? 0,
    });

    if (strongComparisons.length >= MIN_PLAYER_PASSES) {
      comparisons.splice(0, comparisons.length, ...strongComparisons);
    }
    if (!comparisons.length) continue;
    const peerBreakdowns = new Map<
      string,
      {
        driverKey: string;
        driverName: string;
        medianValues: number[];
        fastestValues: number[];
        matchedLaps: Set<number>;
        playerPasses: number;
      }
    >();
    for (const comparison of comparisons) {
      for (const peer of comparison.peerComparisons) {
        const breakdown = peerBreakdowns.get(peer.driverKey) ?? {
          driverKey: peer.driverKey,
          driverName: peer.driverName,
          medianValues: [],
          fastestValues: [],
          matchedLaps: new Set<number>(),
          playerPasses: 0,
        };
        breakdown.medianValues.push(peer.medianMs);
        breakdown.fastestValues.push(peer.fastestMs);
        peer.matchedLaps.forEach((lap) => breakdown.matchedLaps.add(lap));
        breakdown.playerPasses++;
        peerBreakdowns.set(peer.driverKey, breakdown);
      }
    }
    const peerComparisons: CornerPeerComparison[] = [...peerBreakdowns.values()]
      .flatMap((peer) => {
        const medianMs = median(peer.medianValues);
        const fastestMs = median(peer.fastestValues);
        return medianMs == null || fastestMs == null
          ? []
          : [
              {
                driverKey: peer.driverKey,
                driverName: peer.driverName,
                medianMs,
                fastestMs,
                matchedLaps: peer.matchedLaps.size,
                playerPasses: peer.playerPasses,
              },
            ];
      })
      .sort((a, b) => a.medianMs - b.medianMs);
    const playerMs = median(
      comparisons.map((entry) => entry.player.durationMs),
    );
    const playerFastestMs = Math.min(
      ...comparisons.map((entry) => entry.player.durationMs),
    );
    const groupMs = median(comparisons.map((entry) => entry.groupMs));
    const groupFastestMs = median(
      comparisons.map((entry) => entry.groupFastestMs),
    );
    const deltaMs =
      playerMs != null && groupMs != null ? playerMs - groupMs : null;
    if (
      playerMs == null ||
      groupMs == null ||
      groupFastestMs == null ||
      deltaMs == null
    )
      continue;
    const latestDate = new Date(input.date);
    cornerSummaries.set(corner.number, {
      raceUid: input.raceUid,
      date: input.date,
      label: Number.isNaN(latestDate.getTime())
        ? input.date
        : latestDate.toLocaleDateString("en-GB", {
            day: "numeric",
            month: "short",
            year: "numeric",
          }),
      playerMs,
      groupMs,
      deltaMs,
      playerFastestMs,
      groupFastestMs,
      fastestDeltaMs: playerFastestMs - groupFastestMs,
      playerPasses: comparisons.length,
      peerDrivers: Math.min(...comparisons.map((entry) => entry.peerDrivers)),
      peerPasses: Math.min(...comparisons.map((entry) => entry.peerPasses)),
      peerComparisons,
      confidence:
        strongComparisons.length >= MIN_PLAYER_PASSES &&
        comparisons.every((entry) => entry.highConfidence)
          ? "high"
          : "low",
      playerMetrics: {
        brakePointM: nullableMedian(
          comparisons.flatMap((entry) =>
            entry.player.brakePointM == null ? [] : [entry.player.brakePointM],
          ),
        ),
        minimumSpeedKmh: nullableMedian(
          comparisons.flatMap((entry) =>
            entry.player.minimumSpeedKmh == null
              ? []
              : [entry.player.minimumSpeedKmh],
          ),
        ),
        throttlePickupM: nullableMedian(
          comparisons.flatMap((entry) =>
            entry.player.throttlePickupM == null
              ? []
              : [entry.player.throttlePickupM],
          ),
        ),
        exitSpeedKmh: nullableMedian(
          comparisons.map((entry) => entry.player.exitSpeedKmh),
        ),
        entrySpeedKmh: nullableMedian(
          comparisons.flatMap((entry) =>
            entry.player.entrySpeedKmh == null
              ? []
              : [entry.player.entrySpeedKmh],
          ),
        ),
        maximumSpeedKmh: nullableMedian(
          comparisons.flatMap((entry) =>
            entry.player.maximumSpeedKmh == null
              ? []
              : [entry.player.maximumSpeedKmh],
          ),
        ),
      },
      groupMetrics: {
        brakePointM: nullableMedian(
          comparisons.flatMap((entry) =>
            entry.groupMetrics.brakePointM == null
              ? []
              : [entry.groupMetrics.brakePointM],
          ),
        ),
        minimumSpeedKmh: nullableMedian(
          comparisons.flatMap((entry) =>
            entry.groupMetrics.minimumSpeedKmh == null
              ? []
              : [entry.groupMetrics.minimumSpeedKmh],
          ),
        ),
        throttlePickupM: nullableMedian(
          comparisons.flatMap((entry) =>
            entry.groupMetrics.throttlePickupM == null
              ? []
              : [entry.groupMetrics.throttlePickupM],
          ),
        ),
        exitSpeedKmh: nullableMedian(
          comparisons.flatMap((entry) =>
            entry.groupMetrics.exitSpeedKmh == null
              ? []
              : [entry.groupMetrics.exitSpeedKmh],
          ),
        ),
        entrySpeedKmh: nullableMedian(
          comparisons.flatMap((entry) =>
            entry.groupMetrics.entrySpeedKmh == null
              ? []
              : [entry.groupMetrics.entrySpeedKmh],
          ),
        ),
        maximumSpeedKmh: nullableMedian(
          comparisons.flatMap((entry) =>
            entry.groupMetrics.maximumSpeedKmh == null
              ? []
              : [entry.groupMetrics.maximumSpeedKmh],
          ),
        ),
      },
    });
  }

  return {
    raceUid: input.raceUid,
    date: input.date,
    label: new Date(input.date).toLocaleDateString("en-GB", {
      day: "numeric",
      month: "short",
      year: "numeric",
    }),
    corners: cornerSummaries,
    evidence: evidenceByCorner,
    straights: new Map(),
    straightEvidence: new Map(),
    ...(input.conditions ? { conditions: input.conditions } : {}),
  };
}

/** Build clean corner passages from a race replay fixture, then benchmark them. */
export function analyzeCornerReplayRace(input: {
  raceUid: string;
  date: string;
  trackLength: number;
  selectedDriverKey: string;
  drivers: readonly CornerReplayDriverInput[];
  corners: readonly CornerDefinition[];
  straights?: readonly StraightDefinition[];
  conditions?: CornerSessionConditions;
}): CornerRaceSummary {
  const passes: CornerPass[] = [];
  const straightPasses: CornerPass[] = [];
  const straights = input.straights ?? [];
  const rejectionsByCorner = new Map<number, CornerPassRejections>(
    input.corners.map((corner) => [
      corner.number,
      {
        pitPassages: 0,
        incidents: 0,
        missingTelemetry: 0,
        incompleteTelemetry: 0,
        offTrack: 0,
        closeTraffic: 0,
      },
    ]),
  );
  const rejectionsByStraight = new Map<number, CornerPassRejections>(
    straights.map((straight) => [
      straight.number,
      {
        pitPassages: 0,
        incidents: 0,
        missingTelemetry: 0,
        incompleteTelemetry: 0,
        offTrack: 0,
        closeTraffic: 0,
      },
    ]),
  );
  for (const driver of input.drivers) {
    if (driver.ai) continue;
    for (const lap of driver.laps) {
      const isPlayer = driver.driverKey === input.selectedDriverKey;
      if (lap.pitPassage || lap.incident || !lap.points) {
        if (isPlayer) {
          for (const corner of input.corners) {
            const rejected = rejectionsByCorner.get(corner.number)!;
            if (lap.pitPassage) rejected.pitPassages++;
            else if (lap.incident) rejected.incidents++;
            else rejected.missingTelemetry++;
          }
          for (const straight of straights) {
            const rejected = rejectionsByStraight.get(straight.number)!;
            if (lap.pitPassage) rejected.pitPassages++;
            else if (lap.incident) rejected.incidents++;
            else rejected.missingTelemetry++;
          }
        }
        continue;
      }
      const context: CornerPassContext = {
        raceUid: input.raceUid,
        date: input.date,
        driverKey: driver.driverKey,
        driverName: driver.driverName,
        car: driver.car,
        lap: lap.lap,
        lapTimeMs: lap.lapTimeMs,
        ...(lap.compound ? { compound: lap.compound } : {}),
        ...(lap.tyreAge != null ? { tyreAge: lap.tyreAge } : {}),
      };
      for (const corner of input.corners) {
        const pass = buildCornerPass(
          lap.points,
          corner,
          input.trackLength,
          context,
          isPlayer
            ? (reason) => {
                rejectionsByCorner.get(corner.number)![reason]++;
              }
            : undefined,
        );
        if (pass) passes.push(pass);
      }
      for (const straight of straights) {
        const pass = buildStraightPass(
          lap.points,
          straight,
          input.trackLength,
          context,
          isPlayer
            ? (reason) => {
                rejectionsByStraight.get(straight.number)![reason]++;
              }
            : undefined,
        );
        if (pass) straightPasses.push(pass);
      }
    }
  }
  const cornerSummary = summarizeCornerRace(
    {
      raceUid: input.raceUid,
      date: input.date,
      trackLength: input.trackLength,
      passes,
      playerPassRejections: rejectionsByCorner,
      conditions: input.conditions,
    },
    input.selectedDriverKey,
    input.corners,
  );
  const straightSummary = summarizeCornerRace(
    {
      raceUid: input.raceUid,
      date: input.date,
      trackLength: input.trackLength,
      passes: straightPasses,
      playerPassRejections: rejectionsByStraight,
      conditions: input.conditions,
    },
    input.selectedDriverKey,
    straights,
  );
  return {
    ...cornerSummary,
    straights: straightSummary.corners,
    straightEvidence: straightSummary.evidence,
  };
}

export function buildCornerDevelopmentModel(
  corners: CornerDefinition[],
  trackTrace: CornerTrackPoint[],
  races: CornerRaceSummary[],
  totalRaces = races.length,
  straights: StraightDefinition[] = [],
): CornerDevelopmentModel {
  const orderedRaces = [...races].sort(
    (a, b) => Date.parse(a.date) - Date.parse(b.date),
  );
  const latest = new Map<number, CornerTrendPoint>();
  const latestEvidence = new Map<number, CornerEvidence>();
  const latestStraights = new Map<number, CornerTrendPoint>();
  const latestStraightEvidence = new Map<number, CornerEvidence>();
  for (const race of orderedRaces) {
    for (const [number, point] of race.corners) latest.set(number, point);
    for (const [number, evidence] of race.evidence) {
      latestEvidence.set(number, evidence);
    }
    for (const [number, point] of race.straights) {
      latestStraights.set(number, point);
    }
    for (const [number, evidence] of race.straightEvidence) {
      latestStraightEvidence.set(number, evidence);
    }
  }
  return {
    corners,
    straights,
    trackTrace,
    races: orderedRaces,
    latest,
    latestEvidence,
    latestStraights,
    latestStraightEvidence,
    totalRaces,
    matchedRaces: orderedRaces.length,
  };
}
