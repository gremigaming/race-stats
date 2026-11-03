import assert from "node:assert/strict";
import test from "node:test";
import {
  buildCornerCatalog,
  buildCornerPass,
  summarizeCornerRace,
  type CornerDefinition,
  type CornerPass,
  type CornerTracePoint,
} from "./cornerAnalysis";

function roundedRectangleTrace(): {
  points: CornerTracePoint[];
  length: number;
} {
  const points: CornerTracePoint[] = [];
  let distance = 0;
  const add = (x: number, z: number) => {
    points.push({
      t: distance / 50,
      distance,
      x,
      z,
      speedKmh: 200,
      throttle: 1,
      brake: 0,
      steer: 0,
      off: 0,
      gapMs: null,
    });
  };
  const line = (x0: number, z0: number, x1: number, z1: number) => {
    const length = Math.hypot(x1 - x0, z1 - z0);
    const steps = Math.ceil(length / 5);
    if (!points.length) add(x0, z0);
    for (let step = 1; step <= steps; step++) {
      const fraction = step / steps;
      distance += length / steps;
      add(x0 + (x1 - x0) * fraction, z0 + (z1 - z0) * fraction);
    }
  };
  const arc = (
    cx: number,
    cz: number,
    radius: number,
    from: number,
    to: number,
  ) => {
    const arcLength = Math.abs(to - from) * radius;
    const steps = Math.ceil(arcLength / 5);
    for (let step = 1; step <= steps; step++) {
      const angle = from + ((to - from) * step) / steps;
      distance += arcLength / steps;
      add(cx + Math.cos(angle) * radius, cz + Math.sin(angle) * radius);
    }
  };

  line(100, 0, 900, 0);
  arc(900, 100, 100, -Math.PI / 2, 0);
  line(1000, 100, 1000, 900);
  arc(900, 900, 100, 0, Math.PI / 2);
  line(900, 1000, 100, 1000);
  arc(100, 900, 100, Math.PI / 2, Math.PI);
  line(0, 900, 0, 100);
  arc(100, 100, 100, Math.PI, (3 * Math.PI) / 2);
  return { points, length: distance };
}

function straightLap(
  options: {
    length?: number;
    step?: number;
    offAt?: number;
    gapAt?: number;
  } = {},
): CornerTracePoint[] {
  const length = options.length ?? 3000;
  const step = options.step ?? 5;
  const points: CornerTracePoint[] = [];
  for (let distance = 0; distance <= length; distance += step) {
    points.push({
      t: distance / 50,
      distance,
      x: distance,
      z: Math.sin(distance / 180) * 80,
      speedKmh: distance >= 950 && distance <= 1050 ? 110 : 220,
      throttle: distance >= 1010 ? 1 : 0.4,
      brake: distance >= 920 && distance <= 950 ? 0.5 : 0,
      steer: 0,
      off: distance === options.offAt ? 1 : 0,
      gapMs: distance === options.gapAt ? 500 : null,
    });
  }
  return points;
}

const corner: CornerDefinition = {
  number: 1,
  startM: 900,
  apexM: 1000,
  endM: 1100,
  curveStartM: 950,
  curveEndM: 1050,
  mapPoint: { x: 1000, z: 0 },
};

function pass(driverKey: string, durationMs: number, lap: number): CornerPass {
  return {
    raceUid: "race",
    date: "2026-11-01T20:00:00Z",
    driverKey,
    driverName: driverKey,
    car: driverKey === "player" ? 0 : driverKey === "peer-a" ? 1 : 2,
    lap,
    cornerNumber: 1,
    durationMs,
    brakePointM: 80,
    minimumSpeedKmh: 110,
    throttlePickupM: 15,
    exitSpeedKmh: 220,
    compound: "Soft",
    tyreAge: 4,
  };
}

test("corner catalogue detects curves around a complete recorded track", () => {
  const trace = roundedRectangleTrace();
  const catalog = buildCornerCatalog(trace.points, trace.length, [
    trace.length / 3,
    (trace.length * 2) / 3,
  ]);
  assert.ok(catalog.corners.length >= 3, `detected ${catalog.corners.length}`);
  assert.equal(catalog.trackTrace.length > 100, true);
  assert.deepEqual(
    catalog.corners.map((entry) => entry.number),
    catalog.corners.map((_, index) => index + 1),
  );
  for (const entry of catalog.corners) {
    assert.ok(entry.startM >= 0 && entry.startM < trace.length);
    assert.ok(entry.apexM >= 0 && entry.apexM < trace.length);
    assert.ok(entry.endM >= 0 && entry.endM < trace.length);
    assert.ok(entry.sector === 1 || entry.sector === 2 || entry.sector === 3);
  }
});

test("pass metrics interpolate fixed distances and handle a corner across start/finish", () => {
  const normal = buildCornerPass(straightLap(), corner, 3000, {
    raceUid: "race",
    date: "2026-11-01T20:00:00Z",
    driverKey: "player",
    driverName: "Player",
    car: 0,
    lap: 2,
    lapTimeMs: 60_000,
    compound: "Soft",
    tyreAge: 4,
  });
  assert.ok(normal);
  assert.equal(Math.round(normal.durationMs), 4000);
  assert.equal(normal.brakePointM, 80);
  assert.equal(normal.minimumSpeedKmh, 110);
  assert.equal(normal.throttlePickupM, 10);

  const wrapCorner: CornerDefinition = {
    ...corner,
    startM: 2900,
    apexM: 2980,
    endM: 80,
    curveStartM: 2950,
    curveEndM: 30,
  };
  const wrapped = buildCornerPass(straightLap(), wrapCorner, 3000, {
    raceUid: "race",
    date: "2026-11-01T20:00:00Z",
    driverKey: "player",
    driverName: "Player",
    car: 0,
    lap: 2,
    lapTimeMs: 60_000,
  });
  assert.ok(wrapped);
  assert.equal(Math.round(wrapped.durationMs), 3600);
});

test("corner passes with off-track or close-traffic samples are excluded", () => {
  const context = {
    raceUid: "race",
    date: "2026-11-01T20:00:00Z",
    driverKey: "player",
    driverName: "Player",
    car: 0,
    lap: 2,
    lapTimeMs: 60_000,
  };
  assert.equal(
    buildCornerPass(straightLap({ offAt: 1000 }), corner, 3000, context),
    null,
  );
  assert.equal(
    buildCornerPass(straightLap({ gapAt: 1000 }), corner, 3000, context),
    null,
  );
  assert.equal(
    buildCornerPass(straightLap({ step: 100 }), corner, 3000, context),
    null,
  );
});

test("race benchmark is the median of peer-driver medians with equal driver weight", () => {
  const passes = [
    ...[1000, 1010, 990].map((time, index) => pass("player", time, index + 2)),
    ...[900, 910, 890].map((time, index) => pass("peer-a", time, index + 2)),
    ...[1100, 1110, 1090].map((time, index) => pass("peer-b", time, index + 2)),
    ...[800, 810, 790, 820, 780].map((time, index) =>
      pass("peer-c", time, index + 2),
    ),
  ];
  const summary = summarizeCornerRace(
    {
      raceUid: "race",
      date: "2026-11-01T20:00:00Z",
      trackLength: 3000,
      passes,
    },
    "player",
    [corner],
  );
  const result = summary.corners.get(1);
  assert.ok(result);
  assert.equal(result.playerMs, 1000);
  assert.equal(result.groupMs, 900);
  assert.equal(result.deltaMs, 100);
  assert.equal(result.playerFastestMs, 990);
  assert.equal(result.groupFastestMs, 890);
  assert.equal(result.fastestDeltaMs, 100);
  assert.equal(result.peerDrivers, 3);
  assert.equal(result.confidence, "high");
  assert.deepEqual(
    result.peerComparisons.map((peer) => peer.driverName),
    ["peer-c", "peer-a", "peer-b"],
  );
  assert.equal(result.peerComparisons[0]?.medianMs, 800);
  assert.equal(result.peerComparisons[0]?.fastestMs, 780);
  assert.equal(result.peerComparisons[0]?.matchedLaps, 5);
});

test("sparse corner samples show median and fastest comparisons with low confidence", () => {
  const summary = summarizeCornerRace(
    {
      raceUid: "race",
      date: "2026-11-01T20:00:00Z",
      trackLength: 3000,
      passes: [
        pass("player", 1000, 2),
        pass("player", 1100, 3),
        pass("peer-a", 1000, 2),
        pass("peer-b", 1400, 2),
      ],
    },
    "player",
    [corner],
  );

  const result = summary.corners.get(1);
  assert.ok(result);
  assert.equal(result.playerMs, 1050);
  assert.equal(result.groupMs, 1200);
  assert.equal(result.deltaMs, -150);
  assert.equal(result.playerFastestMs, 1000);
  assert.equal(result.groupFastestMs, 1200);
  assert.equal(result.fastestDeltaMs, -200);
  assert.equal(result.playerPasses, 2);
  assert.equal(result.peerDrivers, 2);
  assert.equal(result.confidence, "low");
  assert.deepEqual(
    result.peerComparisons.map((peer) => peer.driverName),
    ["peer-a", "peer-b"],
  );
  assert.deepEqual(
    result.peerComparisons.map((peer) => peer.matchedLaps),
    [1, 1],
  );
  const evidence = summary.evidence.get(1);
  assert.ok(evidence);
  assert.equal(evidence.comparablePlayerPasses, 2);
  assert.equal(evidence.strongComparablePlayerPasses, 0);
});

test("median gap matches displayed medians across tyre-matched cohorts", () => {
  const summary = summarizeCornerRace(
    {
      raceUid: "race",
      date: "2026-11-01T20:00:00Z",
      trackLength: 3000,
      passes: [
        { ...pass("player", 1000, 2), tyreAge: 1 },
        { ...pass("player", 1100, 3), tyreAge: 10 },
        { ...pass("player", 1200, 4), tyreAge: 10 },
        { ...pass("peer-a", 900, 2), tyreAge: 1 },
        { ...pass("peer-a", 1300, 3), tyreAge: 10 },
        { ...pass("peer-b", 1100, 2), tyreAge: 1 },
        { ...pass("peer-b", 1500, 3), tyreAge: 10 },
      ],
    },
    "player",
    [corner],
  );

  const result = summary.corners.get(1);
  assert.ok(result);
  assert.equal(result.playerMs, 1100);
  assert.equal(result.groupMs, 1400);
  assert.equal(result.deltaMs, result.playerMs - result.groupMs);
  assert.equal(result.deltaMs, -300);
});

test("benchmark needs two peers with three comparable passages each", () => {
  const player = [1000, 1010, 990].map((time, index) =>
    pass("player", time, index + 2),
  );
  const onePeer = [900, 910, 890].map((time, index) =>
    pass("peer-a", time, index + 2),
  );
  const summary = summarizeCornerRace(
    {
      raceUid: "race",
      date: "2026-11-01T20:00:00Z",
      trackLength: 3000,
      passes: [...player, ...onePeer],
    },
    "player",
    [corner],
  );
  assert.equal(summary.corners.size, 0);
  const evidence = summary.evidence.get(1);
  assert.ok(evidence);
  assert.equal(evidence.playerPasses, 3);
  assert.equal(evidence.peerDriversWithAnyPasses, 1);
  assert.equal(evidence.peerDriversWithThreePasses, 1);
  assert.equal(evidence.comparablePlayerPasses, 0);
  assert.equal(evidence.strongComparablePlayerPasses, 0);
});
