import type { SessionSummary } from "../types/telemetry";
import { isRaceSessionType } from "../utils/sessionTypes";
import { median } from "../utils/stats/core";

export interface TrackLapPaceBenchmark {
  /** Positive means the player's race pace is slower than the peer median. */
  gapMs: number;
  /** Races that contributed a same-compound pace comparison. */
  raceCount: number;
  /** Distinct human rivals contributing at least one comparison. */
  peerDriverCount: number;
}

/**
 * Compare race pace per session, then summarize those gaps across a track.
 * This keeps raw lap times from different weather and race conditions out of
 * the same pool. Each rival contributes one same-compound race-pace comparison
 * per session, and each session contributes one median gap to the final result.
 */
export function buildTrackLapPaceBenchmark(
  sessions: readonly SessionSummary[],
): TrackLapPaceBenchmark | null {
  const raceGapsMs: number[] = [];
  const peerDriverKeys = new Set<string>();

  for (const session of sessions) {
    if (
      session.isSpectator === true ||
      session.isOnline !== true ||
      !isRaceSessionType(session.sessionType)
    ) {
      continue;
    }

    const comparablePeers = (session.rivals ?? []).filter(
      (rival) =>
        rival.isAi === false &&
        rival.validLapCount >= 3 &&
        Number.isFinite(rival.compoundMatchedPaceDeltaMs),
    );
    const peerMedianGapMs = median(
      comparablePeers.map((rival) => rival.compoundMatchedPaceDeltaMs!),
    );
    if (peerMedianGapMs == null) continue;

    // Rival entries store rival minus player, so invert the median to express
    // the result as player minus field: positive means the player is slower.
    raceGapsMs.push(-peerMedianGapMs);
    for (const rival of comparablePeers) peerDriverKeys.add(rival.key);
  }

  const trackMedianGapMs = median(raceGapsMs);
  if (trackMedianGapMs == null) return null;

  return {
    gapMs: Math.round(trackMedianGapMs),
    raceCount: raceGapsMs.length,
    peerDriverCount: peerDriverKeys.size,
  };
}
