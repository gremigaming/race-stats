import assert from "node:assert/strict";
import test from "node:test";
import {
  analyzeCornerReplayRace,
  type CornerReplayDriverInput,
  type CornerTracePoint,
} from "./cornerAnalysis";

const trackLength = 3000;
const corner = {
  number: 1,
  startM: 900,
  apexM: 1000,
  endM: 1100,
  curveStartM: 950,
  curveEndM: 1050,
  mapPoint: { x: 1000, z: 0 },
};

function replayLap(extraCornerMs: number): CornerTracePoint[] {
  const points: CornerTracePoint[] = [];
  for (let distance = 0; distance <= trackLength; distance += 5) {
    const cornerProgress = Math.max(0, Math.min(1, (distance - 900) / 200));
    points.push({
      t: distance / 50 + (extraCornerMs / 1000) * cornerProgress,
      distance,
      x: distance,
      z: Math.sin(distance / 180) * 80,
      speedKmh: distance >= 950 && distance <= 1050 ? 110 : 220,
      throttle: distance >= 1010 ? 1 : 0.4,
      brake: distance >= 920 && distance <= 950 ? 0.5 : 0,
      steer: 0,
      off: 0,
      gapMs: null,
    });
  }
  return points;
}

function driver(
  car: number,
  driverKey: string,
  extraCornerMs: number,
  flags: {
    ai?: boolean;
    pitLap?: number;
    incidentLap?: number;
    missingLap?: number;
    closeTraffic?: boolean;
  } = {},
): CornerReplayDriverInput {
  return {
    car,
    driverKey,
    driverName: driverKey,
    ai: flags.ai ?? false,
    laps: [2, 3, 4, 5, 6, 7].map((lap) => ({
      lap,
      lapTimeMs: 60_000,
      points:
        lap === flags.missingLap
          ? null
          : replayLap(extraCornerMs).map((point) => ({
              ...point,
              ...(flags.closeTraffic ? { gapMs: 500 } : {}),
            })),
      ...(lap === flags.pitLap ? { pitPassage: true } : {}),
      ...(lap === flags.incidentLap ? { incident: true } : {}),
      compound: "Soft",
      tyreAge: 4,
    })),
  };
}

test("replay fixture excludes AI, incidents, pit passages, and missing laps", () => {
  const summary = analyzeCornerReplayRace({
    raceUid: "fixture-race",
    date: "2026-11-01T20:00:00Z",
    trackLength,
    selectedDriverKey: "player",
    corners: [corner],
    drivers: [
      driver(0, "player", 500, { pitLap: 2, incidentLap: 3, missingLap: 4 }),
      driver(1, "peer-a", 0, { pitLap: 2 }),
      driver(2, "peer-b", 0, { incidentLap: 2 }),
      driver(3, "ai", -1000, { ai: true }),
    ],
  });

  const result = summary.corners.get(1);
  assert.ok(result);
  assert.equal(result.playerPasses, 3);
  assert.equal(result.peerDrivers, 2);
  assert.equal(result.groupMs, 4000);
  assert.equal(result.deltaMs, 500);
  const evidence = summary.evidence.get(1);
  assert.ok(evidence);
  assert.equal(evidence.candidateLaps, 6);
  assert.equal(evidence.playerPasses, 3);
  assert.equal(evidence.peerDriversWithAnyPasses, 2);
  assert.equal(evidence.peerDriversWithThreePasses, 2);
  assert.equal(evidence.comparablePlayerPasses, 3);
  assert.equal(evidence.strongComparablePlayerPasses, 3);
  assert.equal(evidence.pitPassages, 1);
  assert.equal(evidence.incidents, 1);
  assert.equal(evidence.missingTelemetry, 1);
});

test("corner evidence explains passes removed by close traffic", () => {
  const summary = analyzeCornerReplayRace({
    raceUid: "traffic-race",
    date: "2026-11-01T20:00:00Z",
    trackLength,
    selectedDriverKey: "player",
    corners: [corner],
    drivers: [
      driver(0, "player", 0, { closeTraffic: true }),
      driver(1, "peer-a", 0),
      driver(2, "peer-b", 0),
    ],
  });

  const evidence = summary.evidence.get(1);
  assert.ok(evidence);
  assert.equal(evidence.candidateLaps, 6);
  assert.equal(evidence.playerPasses, 0);
  assert.equal(evidence.peerDriversWithAnyPasses, 2);
  assert.equal(evidence.peerDriversWithThreePasses, 2);
  assert.equal(evidence.comparablePlayerPasses, 0);
  assert.equal(evidence.closeTraffic, 6);
});
