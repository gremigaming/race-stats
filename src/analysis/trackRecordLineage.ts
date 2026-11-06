import type { TelemetrySession } from "../types/telemetry";
import { displayName, driverKey, isNamedDriver } from "../league/league";
import {
  getFormulaComparisonKey,
  isQualifyingSessionType,
  isRaceSessionType,
} from "../utils/sessionTypes";
import {
  isAutoSaveFilename,
  parseFilename,
  toSlug,
} from "../utils/parseFilename";
import { getTrackId } from "../utils/tracks";

export interface TrackRecordSource {
  file: string;
  session: TelemetrySession;
  date?: string;
  slug?: string;
  /** When omitted, use the network-game flag stored in the session. */
  isOnline?: boolean;
}

export type TrackRecordDiscipline = "race" | "qualifying";

export interface TrackRecordCandidate {
  id: string;
  file: string;
  slug: string;
  date: string;
  timestamp: number;
  formulaKey: string;
  discipline: TrackRecordDiscipline;
  driverName: string;
  lapTimeMs: number;
  weather: string;
  trackTemperature: number;
}

export type TrackRecordEventKind = "first" | "improved" | "taken";

export interface TrackRecordEvent extends TrackRecordCandidate {
  kind: TrackRecordEventKind;
  previousTimeMs: number | null;
  previousHolder: string | null;
  improvementMs: number | null;
  /** Duration until the next record; the current record runs through `now`. */
  heldMs: number;
}

function isNamedHumanDriver(
  driver: TelemetrySession["classification-data"][number],
): boolean {
  if (!isNamedDriver(driver)) return false;
  const participant = driver["participant-data"];
  const driverId = participant?.["driver-id"];
  return !(
    participant?.["ai-controlled"] &&
    driverId !== 255 &&
    driverId !== 65535
  );
}

/**
 * Use each online race or qualifying session's official fastest-lap entry as
 * record evidence. This avoids treating a selected driver's partial lap
 * history as the full league record book, and works from the archive alone.
 */
export function buildTrackRecordCandidates(
  sources: readonly TrackRecordSource[],
  trackId: string,
): TrackRecordCandidate[] {
  const bySession = new Map<string, TrackRecordCandidate>();

  for (const source of sources) {
    const { session, file } = source;
    const info = session["session-info"];
    const sessionType = info?.["session-type"];
    const discipline = isRaceSessionType(sessionType)
      ? "race"
      : isQualifyingSessionType(sessionType)
        ? "qualifying"
        : null;
    if (
      !discipline ||
      (source.isOnline ?? info?.["network-game"] === 1) !== true ||
      isAutoSaveFilename(file) ||
      getTrackId(info?.["track-id"] ?? "") !== getTrackId(trackId)
    ) {
      continue;
    }

    const fastest = session.records?.fastest?.lap;
    const lapTimeMs = fastest?.time;
    if (
      typeof lapTimeMs !== "number" ||
      !Number.isFinite(lapTimeMs) ||
      lapTimeMs <= 0
    ) {
      continue;
    }

    const drivers = session["classification-data"] ?? [];
    const driver =
      drivers.find(
        (candidate) => candidate.index === fastest["driver-index"],
      ) ??
      drivers.find(
        (candidate) =>
          driverKey(candidate["driver-name"] ?? "") ===
          driverKey(fastest["driver-name"] ?? ""),
      );
    if (!driver || !isNamedHumanDriver(driver)) continue;

    const date = source.date ?? parseFilename(file).date;
    const timestamp = new Date(date).getTime();
    if (!Number.isFinite(timestamp)) continue;

    const formulaKey = getFormulaComparisonKey(
      info?.formula,
      session["game-year"],
    );
    const sessionUid = session.debug?.["session-uid"];
    const id =
      sessionUid != null
        ? `${formulaKey}:${discipline}:${getTrackId(info["track-id"])}:${String(sessionUid)}`
        : `${formulaKey}:${discipline}:${source.slug ?? toSlug(file)}`;
    const candidate: TrackRecordCandidate = {
      id,
      file,
      slug: source.slug ?? toSlug(file),
      date,
      timestamp,
      formulaKey,
      discipline,
      driverName: displayName(driver["driver-name"]),
      lapTimeMs,
      weather: info.weather ?? "Unknown",
      trackTemperature: info["track-temperature"] ?? 0,
    };

    const previous = bySession.get(id);
    // A repeated save of the same race may reveal a faster lap later. Keep the
    // fastest official result once, and skip periodic just-in-case snapshots.
    if (!previous || candidate.lapTimeMs < previous.lapTimeMs) {
      bySession.set(id, candidate);
    }
  }

  return [...bySession.values()].sort(
    (a, b) => a.timestamp - b.timestamp || a.file.localeCompare(b.file),
  );
}

/** Keep only strict record improvements; ties do not transfer the record. */
export function buildTrackRecordEvents(
  candidates: readonly TrackRecordCandidate[],
  now = Date.now(),
): TrackRecordEvent[] {
  const ordered = [...candidates].sort(
    (a, b) => a.timestamp - b.timestamp || a.file.localeCompare(b.file),
  );
  const recordEvents: Omit<TrackRecordEvent, "heldMs">[] = [];
  let currentTimeMs: number | null = null;
  let currentHolder: string | null = null;

  for (const candidate of ordered) {
    if (currentTimeMs != null && candidate.lapTimeMs >= currentTimeMs) continue;

    const previousTimeMs = currentTimeMs;
    const previousHolder = currentHolder;
    const kind: TrackRecordEventKind =
      previousTimeMs == null
        ? "first"
        : driverKey(previousHolder ?? "") === driverKey(candidate.driverName)
          ? "improved"
          : "taken";

    recordEvents.push({
      ...candidate,
      kind,
      previousTimeMs,
      previousHolder,
      improvementMs:
        previousTimeMs == null ? null : previousTimeMs - candidate.lapTimeMs,
    });
    currentTimeMs = candidate.lapTimeMs;
    currentHolder = candidate.driverName;
  }

  return recordEvents.map((event, index) => {
    const next = recordEvents[index + 1];
    const end = next?.timestamp ?? now;
    return { ...event, heldMs: Math.max(0, end - event.timestamp) };
  });
}
