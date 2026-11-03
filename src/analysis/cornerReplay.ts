import { driverKey, isNamedDriver } from "../league/league";
import type { TrackSessionData } from "./trackAnalysis";
import {
  buildCornerCatalog,
  analyzeCornerReplayRace,
  buildCornerDevelopmentModel,
  summarizeCornerRace,
  type CornerDefinition,
  type CornerDevelopmentModel,
  type CornerSessionConditions,
  type CornerTracePoint,
  type StraightDefinition,
} from "./cornerAnalysis";
import { getRacePaceLapSamples } from "../utils/stats/laps";
import { getTrackId } from "../utils/tracks";
import {
  decodeChunk,
  loadManifest,
  loadRaceIndexDetailed,
  type Chunk,
  type RaceIndexEntry,
  type RaceManifest,
} from "../viewer/format";

const MAX_LAPS_PER_DRIVER = 5;
const CHUNK_FETCH_CONCURRENCY = 6;
const SESSION_MATCH_WINDOW_MS = 20 * 60 * 1000;

interface RaceIndexRow extends RaceIndexEntry {
  base: string;
}

interface DriverLap {
  lap: number;
  timeMs: number;
  sectorOneMs?: number;
  sectorTwoMs?: number;
  compound?: string;
  tyreAge?: number;
}

interface ReplayDriver {
  car: number;
  key: string;
  name: string;
  laps: Map<number, DriverLap>;
  frames: Map<number, CornerTracePoint[]>;
}

interface ReplayRace {
  index: RaceIndexRow;
  manifest: RaceManifest;
  session: TrackSessionData;
  trackLength: number;
  drivers: ReplayDriver[];
  trace: CornerTracePoint[];
  sectorBoundaries?: [number, number];
}

function booleanCondition(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  if (value === 1 || value === "1" || value === "true") return true;
  if (value === 0 || value === "0" || value === "false") return false;
  return null;
}

export interface CornerAnalysisProgress {
  completedRaces: number;
  totalRaces: number;
}

export interface CornerAnalysisLoadResult {
  model: CornerDevelopmentModel;
  matchedRaces: number;
  availableRaces: number;
  detectedCorners: number;
  indexAvailable: boolean;
}

function normalizeSessionUid(uid: string | undefined): string | null {
  const normalized = uid?.trim().toLowerCase().replace(/^0x/, "");
  return normalized && /^[\da-f]{16}$/.test(normalized) ? normalized : null;
}

function findSessionForRace(
  race: RaceIndexRow,
  sessions: readonly TrackSessionData[],
  used: Set<string>,
): TrackSessionData | null {
  const uid = normalizeSessionUid(race.session_uid);
  if (uid) {
    const exact = sessions.find(
      (candidate) =>
        !used.has(candidate.summary.slug) &&
        normalizeSessionUid(candidate.summary.sessionUid) === uid,
    );
    if (exact) return exact;
  }

  // A few older summary rows have no session UID. Only use a timestamp fallback
  // if one race in the current formula scope is an unambiguous close match.
  const raceTime = Date.parse(race.started);
  if (!Number.isFinite(raceTime)) return null;
  const nearby = sessions
    .filter(
      (candidate) =>
        !used.has(candidate.summary.slug) &&
        getTrackId(candidate.summary.track) === getTrackId(race.track),
    )
    .map((candidate) => ({
      candidate,
      difference: Math.abs(Date.parse(candidate.summary.date) - raceTime),
    }))
    .filter(
      ({ difference }) =>
        Number.isFinite(difference) && difference <= SESSION_MATCH_WINDOW_MS,
    )
    .sort((a, b) => a.difference - b.difference);
  if (!nearby.length) return null;
  if (
    nearby.length > 1 &&
    nearby[1]!.difference - nearby[0]!.difference < 2 * 60 * 1000
  ) {
    return null;
  }
  return nearby[0]!.candidate;
}

async function fetchChunk(
  base: string,
  name: string,
  signal: AbortSignal,
): Promise<Chunk> {
  const response = await fetch(`${base}chunks/${name}`, {
    cache: "force-cache",
    signal,
  });
  if (!response.ok) throw new Error(`Replay chunk returned ${response.status}`);
  let buffer = await response.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  // GitHub Pages serves the archived gzip bytes; R2 applies Content-Encoding
  // and the browser has already unpacked them before this code receives them.
  if (bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b) {
    const stream = new Blob([buffer])
      .stream()
      .pipeThrough(new DecompressionStream("gzip"));
    buffer = await new Response(stream).arrayBuffer();
  }
  return decodeChunk(buffer);
}

function lapInfo(
  driver: TrackSessionData["session"]["classification-data"][number],
  lap: number,
) {
  return driver["per-lap-info"]?.find((entry) => entry["lap-number"] === lap);
}

function eligibleReplayDrivers(
  manifest: RaceManifest,
  session: TrackSessionData,
): ReplayDriver[] {
  const dataByName = new Map(
    session.session["classification-data"]
      .filter(isNamedDriver)
      .map((driver) => [driverKey(driver["driver-name"]), driver] as const),
  );
  const output: ReplayDriver[] = [];
  for (const [rawCar, car] of Object.entries(manifest.cars ?? {})) {
    if (car.ai) continue;
    const index = Number(rawCar);
    if (!Number.isInteger(index) || index < 0) continue;
    const driver = dataByName.get(driverKey(car.name));
    if (!driver) continue;
    const lapData = new Map<number, DriverLap>();
    const samples = getRacePaceLapSamples(driver)
      .sort((a, b) => a.timeMs - b.timeMs)
      .slice(0, MAX_LAPS_PER_DRIVER);
    for (const sample of samples) {
      const info = lapInfo(driver, sample.lapNumber);
      const status = info?.["car-status-data"];
      const compound = status?.["visual-tyre-compound"];
      const tyreAge = status?.["tyres-age-laps"];
      lapData.set(sample.lapNumber, {
        lap: sample.lapNumber,
        timeMs: sample.timeMs,
        ...(sample.lap["sector-1-time-in-ms"] > 0
          ? { sectorOneMs: sample.lap["sector-1-time-in-ms"] }
          : {}),
        ...(sample.lap["sector-2-time-in-ms"] > 0
          ? { sectorTwoMs: sample.lap["sector-2-time-in-ms"] }
          : {}),
        ...(sample.compound || compound
          ? { compound: sample.compound ?? compound }
          : {}),
        ...(typeof tyreAge === "number" && Number.isFinite(tyreAge)
          ? { tyreAge }
          : {}),
      });
    }
    if (!lapData.size) continue;
    output.push({
      car: index,
      key: driverKey(driver["driver-name"]),
      name: driver["driver-name"],
      laps: lapData,
      frames: new Map(),
    });
  }
  return output;
}

function chunksForCandidateLaps(
  manifest: RaceManifest,
  drivers: readonly ReplayDriver[],
): string[] {
  const chunkSeconds = manifest.chunk_seconds || 10;
  const needed = new Set<number>();
  for (const driver of drivers) {
    const timing = manifest.timing?.[String(driver.car)];
    if (!timing) continue;
    for (const [lap, endTime, lapMs] of timing.laps) {
      if (!driver.laps.has(lap) || lapMs <= 0) continue;
      const startTime = Math.max(0, endTime - lapMs / 1000);
      const first = Math.max(0, Math.floor(startTime / chunkSeconds) - 1);
      const last = Math.floor(endTime / chunkSeconds) + 1;
      for (let key = first; key <= last; key++) needed.add(key);
    }
  }
  return manifest.chunks.filter((name) =>
    needed.has(Number.parseInt(name, 10)),
  );
}

function distanceAtReplayTime(
  rawPoints: readonly CornerTracePoint[],
  targetTime: number,
  trackLength: number,
): number | null {
  const points = [...rawPoints].sort((a, b) => a.t - b.t);
  let lo = 0;
  let hi = points.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (points[mid]!.t < targetTime) lo = mid + 1;
    else hi = mid;
  }
  if (lo < points.length && Math.abs(points[lo]!.t - targetTime) < 1e-3) {
    return ((points[lo]!.distance % trackLength) + trackLength) % trackLength;
  }
  if (lo === 0 || lo >= points.length) return null;
  const before = points[lo - 1]!;
  const after = points[lo]!;
  const timeSpan = after.t - before.t;
  if (timeSpan <= 0 || timeSpan > 2) return null;
  let distanceSpan = after.distance - before.distance;
  if (distanceSpan < -trackLength / 2) distanceSpan += trackLength;
  if (distanceSpan < 0 || distanceSpan > 120) return null;
  const fraction = (targetTime - before.t) / timeSpan;
  const distance = before.distance + distanceSpan * fraction;
  return ((distance % trackLength) + trackLength) % trackLength;
}

function hasIncidentOnLap(
  manifest: RaceManifest,
  car: number,
  lap: number,
  lapStart: number | undefined,
  lapEnd: number | undefined,
): boolean {
  if (manifest.incidents) {
    return manifest.incidents.some(
      (incident) =>
        incident.kind !== "tap" &&
        incident.drivers.some((driver) => driver.car === car) &&
        (incident.lap === lap ||
          (lapStart != null &&
            lapEnd != null &&
            incident.t0 <= lapEnd &&
            incident.t1 >= lapStart)),
    );
  }
  return (manifest.events ?? []).some(
    (event) =>
      event.code === "COLL" &&
      (event.a === car || event.b === car) &&
      lapStart != null &&
      lapEnd != null &&
      event.t >= lapStart &&
      event.t <= lapEnd,
  );
}

async function loadReplayRace(
  index: RaceIndexRow,
  session: TrackSessionData,
  selectedDriverKey: string,
  signal: AbortSignal,
): Promise<ReplayRace | null> {
  const loaded = await loadManifest(index.uid);
  if (!loaded) return null;
  const manifest = loaded.manifest;
  const trackLength =
    manifest.track_length ?? session.session["session-info"]["track-length"];
  if (!trackLength || trackLength < 100) return null;
  const drivers = eligibleReplayDrivers(manifest, session);
  if (drivers.length < 3) return null;
  const chunks = chunksForCandidateLaps(manifest, drivers);
  if (!chunks.length) return null;

  const driversByCar = new Map(drivers.map((driver) => [driver.car, driver]));
  const appendChunk = (chunk: Chunk) => {
    const cars = Math.min(chunk.cars, Math.max(...driversByCar.keys()) + 1);
    for (let frame = 0; frame < chunk.n; frame++) {
      const time = chunk.t[frame]!;
      for (let car = 0; car < cars; car++) {
        const driver = driversByCar.get(car);
        if (!driver) continue;
        const row = frame * chunk.cars + car;
        const lap = chunk.lap[row]!;
        const lapSample = driver.laps.get(lap);
        if (!lapSample || (!chunk.x[row] && !chunk.z[row])) continue;
        const points = driver.frames.get(lap) ?? [];
        const gap = chunk.gap?.[row];
        points.push({
          t: time,
          distance: chunk.dist[row]!,
          x: chunk.x[row]!,
          z: chunk.z[row]!,
          speedKmh: chunk.speed[row]! / 10,
          throttle: chunk.throttle[row]! / 255,
          brake: chunk.brake[row]! / 255,
          steer: chunk.steer[row]! / 127,
          off: chunk.off[row]!,
          gapMs: gap != null && gap > 0 ? gap : null,
        });
        driver.frames.set(lap, points);
      }
    }
  };
  let nextChunk = 0;
  let fetchError: unknown;
  const workers = Array.from(
    { length: Math.min(CHUNK_FETCH_CONCURRENCY, chunks.length) },
    async () => {
      while (fetchError == null) {
        if (signal.aborted) throw new DOMException("Aborted", "AbortError");
        const chunkIndex = nextChunk++;
        if (chunkIndex >= chunks.length) return;
        try {
          appendChunk(
            await fetchChunk(loaded.base, chunks[chunkIndex]!, signal),
          );
        } catch (error) {
          fetchError = error;
        }
      }
    },
  );
  await Promise.all(workers);
  if (fetchError != null) throw fetchError;

  // Prefer the selected driver's fastest complete trace for turn geometry and
  // map placement. The race-pace filtering already rejects SC and pit laps.
  const chosen = drivers.find((driver) => driver.key === selectedDriverKey);
  let trace: CornerTracePoint[] = [];
  let sectorBoundaries: [number, number] | undefined;
  if (chosen) {
    const lap = [...chosen.laps.values()]
      .sort((a, b) => a.timeMs - b.timeMs)
      .find(
        (candidate) => (chosen.frames.get(candidate.lap)?.length ?? 0) >= 80,
      );
    if (lap) {
      trace = chosen.frames.get(lap.lap) ?? [];
      const timingLap = manifest.timing?.[String(chosen.car)]?.laps.find(
        (entry) => entry[0] === lap.lap,
      );
      if (
        timingLap &&
        timingLap[2] > 0 &&
        lap.sectorOneMs != null &&
        lap.sectorTwoMs != null
      ) {
        const lapStart = timingLap[1] - timingLap[2] / 1000;
        const first = distanceAtReplayTime(
          trace,
          lapStart + lap.sectorOneMs / 1000,
          trackLength,
        );
        const second = distanceAtReplayTime(
          trace,
          lapStart + (lap.sectorOneMs + lap.sectorTwoMs) / 1000,
          trackLength,
        );
        if (first != null && second != null && first < second) {
          sectorBoundaries = [first, second];
        }
      }
    }
  }
  if (!trace.length) {
    const any = drivers.find((driver) =>
      [...driver.frames.values()].some((points) => points.length >= 80),
    );
    if (any) {
      const candidate = [...any.frames.entries()].find(
        ([, points]) => points.length >= 80,
      );
      trace = candidate?.[1] ?? [];
    }
  }

  return {
    index,
    manifest,
    session,
    trackLength,
    drivers,
    trace,
    ...(sectorBoundaries ? { sectorBoundaries } : {}),
  };
}

function analyzeRace(
  race: ReplayRace,
  selectedDriverKey: string,
  corners: CornerDefinition[],
  straights: StraightDefinition[],
): ReturnType<typeof summarizeCornerRace> {
  const sessionInfo = race.session.session["session-info"];
  const rawAiDifficulty = sessionInfo["ai-difficulty"];
  const conditions: CornerSessionConditions = {
    trackId: getTrackId(sessionInfo["track-id"]),
    trackLength: race.trackLength,
    formula: sessionInfo.formula,
    gameYear: race.session.session["game-year"],
    sessionType: sessionInfo["session-type"],
    gameMode: sessionInfo["game-mode"],
    weather: sessionInfo.weather,
    trackTemperatureC: sessionInfo["track-temperature"],
    airTemperatureC: sessionInfo["air-temperature"],
    totalLaps: sessionInfo["total-laps"],
    equalCarPerformance: booleanCondition(sessionInfo["equal-car-performance"]),
    aiDifficulty:
      Number.isFinite(rawAiDifficulty) && rawAiDifficulty >= 0
        ? rawAiDifficulty
        : null,
  };
  const drivers = race.drivers.map((driver) => {
    const timing = race.manifest.timing?.[String(driver.car)];
    return {
      car: driver.car,
      driverKey: driver.key,
      driverName: driver.name,
      ai: race.manifest.cars[String(driver.car)]?.ai ?? false,
      laps: [...driver.laps.values()].map((lap) => {
        const timingLap = timing?.laps.find((entry) => entry[0] === lap.lap);
        const end = timingLap?.[1];
        const start =
          timingLap && timingLap[2] > 0
            ? timingLap[1] - timingLap[2] / 1000
            : undefined;
        return {
          lap: lap.lap,
          lapTimeMs: lap.timeMs,
          points: driver.frames.get(lap.lap) ?? null,
          pitPassage: Boolean(
            start != null &&
            end != null &&
            timing?.pits?.some((pitTime) => pitTime >= start && pitTime <= end),
          ),
          incident: hasIncidentOnLap(
            race.manifest,
            driver.car,
            lap.lap,
            start,
            end,
          ),
          ...(lap.compound ? { compound: lap.compound } : {}),
          ...(lap.tyreAge != null ? { tyreAge: lap.tyreAge } : {}),
        };
      }),
    };
  });
  return analyzeCornerReplayRace({
    raceUid: race.index.uid,
    date: race.index.started,
    trackLength: race.trackLength,
    selectedDriverKey,
    drivers,
    corners,
    straights,
    conditions,
  });
}

export async function loadCornerDevelopment(
  sessions: readonly TrackSessionData[],
  trackId: string,
  selectedDriverKey: string,
  signal: AbortSignal,
  onProgress?: (progress: CornerAnalysisProgress) => void,
): Promise<CornerAnalysisLoadResult> {
  const empty = buildCornerDevelopmentModel([], [], [], 0);
  if (!sessions.length || !selectedDriverKey) {
    return {
      model: empty,
      matchedRaces: 0,
      availableRaces: 0,
      detectedCorners: 0,
      indexAvailable: false,
    };
  }

  const indexResult = await loadRaceIndexDetailed();
  const index = indexResult.races as RaceIndexRow[];
  const matches = index
    .filter(
      (race) =>
        /^race/i.test(race.session) &&
        getTrackId(race.track) === getTrackId(trackId),
    )
    .sort((a, b) => b.started.localeCompare(a.started));
  const usedSessions = new Set<string>();
  const linked = matches.flatMap((race) => {
    const session = findSessionForRace(race, sessions, usedSessions);
    if (
      !session ||
      !session.session["classification-data"].some(
        (driver) =>
          isNamedDriver(driver) &&
          driverKey(driver["driver-name"]) === selectedDriverKey,
      )
    )
      return [];
    usedSessions.add(session.summary.slug);
    return [{ race, session }];
  });

  if (!linked.length) {
    onProgress?.({ completedRaces: 0, totalRaces: matches.length });
    return {
      model: buildCornerDevelopmentModel([], [], [], matches.length),
      matchedRaces: 0,
      availableRaces: matches.length,
      detectedCorners: 0,
      indexAvailable: indexResult.availableSources > 0,
    };
  }

  let corners: ReturnType<typeof buildCornerCatalog>["corners"] = [];
  let straights: ReturnType<typeof buildCornerCatalog>["straights"] = [];
  let trackTrace: ReturnType<typeof buildCornerCatalog>["trackTrace"] = [];
  let referenceTrackLength = 0;
  const summaries: ReturnType<typeof summarizeCornerRace>[] = [];
  let completedRaces = 0;
  for (const { race: raceIndex, session } of linked) {
    if (signal.aborted) throw new DOMException("Aborted", "AbortError");
    try {
      const race = await loadReplayRace(
        raceIndex,
        session,
        selectedDriverKey,
        signal,
      );
      if (race) {
        if (!corners.length) {
          const catalog = buildCornerCatalog(
            race.trace,
            race.trackLength,
            race.sectorBoundaries,
          );
          if (catalog.corners.length >= 3) {
            corners = catalog.corners;
            straights = catalog.straights;
            trackTrace = catalog.trackTrace;
            referenceTrackLength = race.trackLength;
          }
        }
        if (
          corners.length &&
          referenceTrackLength > 0 &&
          Math.abs(race.trackLength - referenceTrackLength) /
            referenceTrackLength <=
            0.03
        ) {
          const scale = race.trackLength / referenceTrackLength;
          const scaledCorners = corners.map((corner) => ({
            ...corner,
            startM: corner.startM * scale,
            apexM: corner.apexM * scale,
            endM: corner.endM * scale,
            curveStartM: corner.curveStartM * scale,
            curveEndM: corner.curveEndM * scale,
          }));
          const scaledStraights = straights.map((straight) => ({
            ...straight,
            startM: straight.startM * scale,
            endM: straight.endM * scale,
          }));
          summaries.push(
            analyzeRace(
              race,
              selectedDriverKey,
              scaledCorners,
              scaledStraights,
            ),
          );
        }
      }
    } catch (error) {
      if (signal.aborted) throw error;
      // A corrupt or unavailable archive chunk should not hide other races.
    }
    completedRaces++;
    onProgress?.({ completedRaces, totalRaces: linked.length });
  }

  const model = buildCornerDevelopmentModel(
    corners,
    trackTrace,
    summaries,
    matches.length,
    straights,
  );
  return {
    model,
    matchedRaces: model.matchedRaces,
    availableRaces: matches.length,
    detectedCorners: corners.length,
    indexAvailable: indexResult.availableSources > 0,
  };
}
