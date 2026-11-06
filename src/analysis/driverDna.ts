import type { DriverData } from "../types/telemetry";
import {
  displayName,
  driverKey,
  isNamedDriver,
  isRaceSession,
  raceDate,
  raceResults,
  type LeagueRace,
} from "../league/league";
import { getTeamName } from "../utils/colors";

export const DRIVER_DNA_STYLES = {
  comeback: {
    label: "Comeback Artist",
    tagline: "Turns a rough grid slot into a result.",
    criterion:
      "Blends grid-to-finish recovery, lap-one gains, overtakes, finishing position, and podiums.",
  },
  qualifying: {
    label: "Qualifying Specialist",
    tagline: "Usually starts where the action is at the front.",
    criterion:
      "Blends starting-grid strength, poles, race pace, fastest laps, and podiums.",
  },
  consistency: {
    label: "Consistency Machine",
    tagline: "Same calm hands, race after race.",
    criterion:
      "Blends finish stability, completion rate, average finish, and race pace.",
  },
  openingLap: {
    label: "Opening-Lap Menace",
    tagline: "The first lap is where the story changes.",
    criterion:
      "Blends lap-one gains, overtakes, overall recovery, podiums, and race completion.",
  },
  overtakeArtist: {
    label: "Overtake Artist",
    tagline: "Finds a way through when the pack gets tight.",
    criterion:
      "Blends passes per race with recovery, lap-one gains, podiums, and consistency.",
  },
  podiumMagnet: {
    label: "Podium Magnet",
    tagline: "Keeps finding their way into the top three.",
    criterion:
      "Blends podium rate, average finish, grid strength, consistency, and race pace.",
  },
  fastestLapHunter: {
    label: "Fastest-Lap Hunter",
    tagline: "Always has one more lap in the pocket.",
    criterion:
      "Blends fastest-lap rate, race pace, poles, podiums, and laps led.",
  },
  ironWill: {
    label: "Iron Will",
    tagline: "Starts the race. Sees the flag. Repeat.",
    criterion:
      "Blends finish rate, consistency, average finish, and race pace.",
  },
  paceSetter: {
    label: "Pace Setter",
    tagline: "When the pack looks up, they’re at the front.",
    criterion:
      "Blends laps led, race pace, fastest laps, podiums, and grid strength.",
  },
  allRounder: {
    label: "All-Rounder",
    tagline: "No single trick. A little bit of everything.",
    criterion: "No one measured trait stands out yet.",
  },
  developing: {
    label: "In the Making",
    tagline: "The sample is still warming up.",
    criterion: "Three races reveal a first signature.",
  },
} as const;

export type DriverDnaStyle = keyof typeof DRIVER_DNA_STYLES;

export interface DriverDnaCard {
  key: string;
  name: string;
  team: string;
  style: DriverDnaStyle;
  races: number;
  finishedRaces: number;
  averageGrid: number | null;
  averageFinish: number | null;
  averagePlacesGained: number | null;
  gridTopThirdShare: number | null;
  finishSwing: number | null;
  openingLapPlacesGained: number | null;
  openingLapPositiveShare: number | null;
  averageOvertakes: number | null;
  totalOvertakes: number;
  podiums: number;
  podiumRate: number | null;
  fastestLapCount: number;
  fastestLapRate: number | null;
  finishRate: number | null;
  lapsLed: number;
  recordedPositionSamples: number;
  lapsLedShare: number | null;
  signatureFit: number | null;
  supportingSignals: DriverDnaSignalEvidence[];
  points: number;
}

export interface DriverDnaSignalEvidence {
  label: string;
  value: string;
  percentile: number;
}

interface PositionSample {
  position: number;
  field: number;
}

interface DriverAccumulator {
  key: string;
  name: string;
  team: string;
  latestTeamAt: number;
  races: Set<string>;
  grids: PositionSample[];
  finishes: PositionSample[];
  placesGained: number[];
  normalizedPlacesGained: number[];
  normalizedOvertakeRates: number[];
  openingLapPlacesGained: number[];
  normalizedOpeningLapPlacesGained: number[];
  overtakeSamples: number[];
  podiums: number;
  poles: number;
  fastestLapCount: number;
  lapsLed: number;
  recordedPositionSamples: number;
  positionHistoryRaces: Set<string>;
  racePaceScores: number[];
  points: number;
}

const average = (values: number[]): number | null =>
  values.length
    ? values.reduce((sum, value) => sum + value, 0) / values.length
    : null;

function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function completed(status: string): boolean {
  const value = status.trim().toUpperCase();
  return value === "" || value === "FINISHED" || value === "ACTIVE";
}

function validPosition(
  value: number | null | undefined,
  field: number,
): value is number {
  return Number.isFinite(value) && (value ?? 0) > 0 && (value ?? 0) <= field;
}

function lapOnePosition(driver: DriverData): number | null {
  const laps = driver["per-lap-info"] ?? [];
  const lap = laps.find((entry) => entry["lap-number"] === 1) ?? laps[0];
  const position = lap?.["track-position"];
  return typeof position === "number" && position > 0 ? position : null;
}

function fieldFraction(sample: PositionSample): number {
  return (sample.position - 1) / Math.max(1, sample.field - 1);
}

type DriverDnaSignal =
  | "recovery"
  | "grid"
  | "pole"
  | "stability"
  | "openingLap"
  | "overtaking"
  | "podium"
  | "fastestLap"
  | "reliability"
  | "lapsLed"
  | "racePace"
  | "finish";

type SignatureStyle = Exclude<DriverDnaStyle, "allRounder" | "developing">;
type SignalSet = Record<DriverDnaSignal, number | null>;

const SIGNALS: DriverDnaSignal[] = [
  "recovery",
  "grid",
  "pole",
  "stability",
  "openingLap",
  "overtaking",
  "podium",
  "fastestLap",
  "reliability",
  "lapsLed",
  "racePace",
  "finish",
];

/** Each style is a weighted mix of peer-ranked signals; no one stat can decide it. */
const STYLE_PROFILES: Record<
  SignatureStyle,
  Partial<Record<DriverDnaSignal, number>>
> = {
  comeback: {
    recovery: 0.35,
    openingLap: 0.18,
    overtaking: 0.15,
    finish: 0.12,
    podium: 0.1,
    reliability: 0.1,
  },
  qualifying: {
    grid: 0.32,
    pole: 0.2,
    racePace: 0.17,
    fastestLap: 0.15,
    podium: 0.1,
    stability: 0.06,
  },
  consistency: {
    stability: 0.38,
    reliability: 0.22,
    finish: 0.16,
    grid: 0.1,
    racePace: 0.09,
    podium: 0.05,
  },
  openingLap: {
    openingLap: 0.38,
    overtaking: 0.2,
    recovery: 0.16,
    finish: 0.1,
    podium: 0.1,
    reliability: 0.06,
  },
  overtakeArtist: {
    overtaking: 0.36,
    recovery: 0.18,
    openingLap: 0.16,
    finish: 0.12,
    podium: 0.1,
    stability: 0.08,
  },
  podiumMagnet: {
    podium: 0.36,
    finish: 0.2,
    grid: 0.14,
    stability: 0.1,
    racePace: 0.1,
    reliability: 0.1,
  },
  fastestLapHunter: {
    fastestLap: 0.36,
    racePace: 0.26,
    grid: 0.12,
    pole: 0.1,
    podium: 0.1,
    lapsLed: 0.1,
  },
  ironWill: {
    reliability: 0.38,
    stability: 0.22,
    finish: 0.16,
    grid: 0.1,
    racePace: 0.08,
    podium: 0.1,
  },
  paceSetter: {
    lapsLed: 0.36,
    racePace: 0.22,
    fastestLap: 0.15,
    podium: 0.14,
    grid: 0.08,
    reliability: 0.09,
  },
};

const STYLE_ANCHORS: Record<SignatureStyle, DriverDnaSignal> = {
  comeback: "recovery",
  qualifying: "grid",
  consistency: "stability",
  openingLap: "openingLap",
  overtakeArtist: "overtaking",
  podiumMagnet: "podium",
  fastestLapHunter: "fastestLap",
  ironWill: "reliability",
  paceSetter: "lapsLed",
};

const STYLE_ANCHOR_FLOORS: Record<SignatureStyle, number> = {
  comeback: 0.62,
  qualifying: 0.62,
  consistency: 0.62,
  openingLap: 0.62,
  overtakeArtist: 0.72,
  podiumMagnet: 0.62,
  fastestLapHunter: 0.62,
  ironWill: 0.62,
  paceSetter: 0.62,
};

interface RawDriverDna {
  card: Omit<DriverDnaCard, "style" | "signatureFit" | "supportingSignals">;
  signals: SignalSet;
  evidence: Record<DriverDnaSignal, string>;
  samples: {
    gain: number;
    grid: number;
    finish: number;
    openingLap: number;
    overtaking: number;
    leadHistoryRaces: number;
    pace: number;
  };
}

interface StyleFit {
  style: SignatureStyle;
  score: number;
  coverage: number;
  strongSignals: number;
  support: DriverDnaSignalEvidence[];
}

function peerPercentile(value: number, peers: number[]): number {
  if (peers.length <= 1) return 0.5;
  const lower = peers.filter((peer) => peer < value).length;
  const tied = peers.filter((peer) => peer === value).length;
  return (lower + (tied - 1) / 2) / (peers.length - 1);
}

function percentileSignals(rows: RawDriverDna[]): Map<string, SignalSet> {
  const result = new Map(rows.map((row) => [row.card.key, {} as SignalSet]));
  for (const signal of SIGNALS) {
    const peers = rows.flatMap((row) => {
      const value = row.signals[signal];
      return value == null || !Number.isFinite(value) ? [] : [value];
    });
    for (const row of rows) {
      const value = row.signals[signal];
      if (value == null || !Number.isFinite(value)) continue;
      result.get(row.card.key)![signal] = peerPercentile(value, peers);
    }
  }
  return result;
}

function styleMinimumMet(style: SignatureStyle, row: RawDriverDna): boolean {
  if (row.card.races < 3) return false;
  switch (style) {
    case "comeback":
      return row.samples.gain >= 3;
    case "qualifying":
      return row.samples.grid >= 3;
    case "consistency":
    case "podiumMagnet":
      return row.samples.finish >= 4;
    case "openingLap":
      return row.samples.openingLap >= 3;
    case "overtakeArtist":
      return row.samples.overtaking >= 6;
    case "fastestLapHunter":
    case "ironWill":
      return row.card.races >= 5;
    case "paceSetter":
      return row.samples.leadHistoryRaces >= 3;
  }
}

function fitStyles(row: RawDriverDna, signalRanks: SignalSet): StyleFit[] {
  return (Object.keys(STYLE_PROFILES) as SignatureStyle[]).flatMap((style) => {
    if (!styleMinimumMet(style, row)) return [];
    const profile = STYLE_PROFILES[style];
    let weightedScore = 0;
    let coverage = 0;
    let strongSignals = 0;
    const support: { signal: DriverDnaSignal; contribution: number }[] = [];
    for (const [key, weight] of Object.entries(profile) as [
      DriverDnaSignal,
      number,
    ][]) {
      const rank = signalRanks[key];
      if (rank == null) continue;
      coverage += weight;
      weightedScore += rank * weight;
      if (rank >= 0.62) strongSignals += 1;
      support.push({ signal: key, contribution: rank * weight });
    }
    const score = coverage ? weightedScore / coverage : 0;
    const anchor = signalRanks[STYLE_ANCHORS[style]];
    if (
      coverage < 0.72 ||
      anchor == null ||
      anchor < STYLE_ANCHOR_FLOORS[style] ||
      strongSignals < 2
    )
      return [];
    return [
      {
        style,
        score,
        coverage,
        strongSignals,
        support: support
          .sort((a, b) => b.contribution - a.contribution)
          .slice(0, 3)
          .map(({ signal }) => ({
            label: signalLabel(signal),
            value: row.evidence[signal],
            percentile: signalRanks[signal] ?? 0.5,
          })),
      },
    ];
  });
}

function signalLabel(signal: DriverDnaSignal): string {
  switch (signal) {
    case "recovery":
      return "Recovery";
    case "grid":
      return "Grid";
    case "pole":
      return "Poles";
    case "stability":
      return "Consistency";
    case "openingLap":
      return "Lap one";
    case "overtaking":
      return "Overtakes";
    case "podium":
      return "Podiums";
    case "fastestLap":
      return "Fastest laps";
    case "reliability":
      return "Finishes";
    case "lapsLed":
      return "Laps led";
    case "racePace":
      return "Race pace";
    case "finish":
      return "Finish";
  }
}

function chooseSignature(
  races: number,
  fits: StyleFit[],
): {
  style: DriverDnaStyle;
  signatureFit: number | null;
  supportingSignals: DriverDnaSignalEvidence[];
} {
  if (races < 3) {
    return { style: "developing", signatureFit: null, supportingSignals: [] };
  }
  const [best, second] = [...fits].sort((a, b) => b.score - a.score);
  if (!best || best.score < 0.64 || best.score - (second?.score ?? 0) < 0.045) {
    return { style: "allRounder", signatureFit: null, supportingSignals: [] };
  }
  return {
    style: best.style,
    signatureFit: Math.round(best.score * 100),
    supportingSignals: best.support,
  };
}

/** Build each named driver's strongest racecraft signature from the visible races. */
export function buildDriverDna(races: LeagueRace[]): DriverDnaCard[] {
  const drivers = new Map<string, DriverAccumulator>();

  for (const race of races) {
    if (!isRaceSession(race.session)) continue;
    const classified = race.session["classification-data"] ?? [];
    const field = classified.length;
    if (field < 2) continue;

    const driverByKey = new Map<string, DriverData>();
    for (const driver of classified) {
      if (!isNamedDriver(driver)) continue;
      const key = driverKey(driver["driver-name"]);
      if (!driverByKey.has(key)) driverByKey.set(key, driver);
    }

    const results = raceResults(race);
    const paceResults = [...results.entries()].flatMap(([key, result]) =>
      result.racePaceMs != null && result.racePaceMs > 0
        ? [{ key, pace: result.racePaceMs }]
        : [],
    );
    const racePaces = paceResults.map((entry) => entry.pace);
    const paceRanks = new Map(
      paceResults.map(({ key, pace }) => [
        key,
        1 - peerPercentile(pace, racePaces),
      ]),
    );
    const timestamp = raceDate(race.file)?.getTime() ?? 0;
    for (const [key, result] of results) {
      const driver = driverByKey.get(key);
      if (!driver) continue;

      const current = drivers.get(key) ?? {
        key,
        name: displayName(driver["driver-name"]),
        team: "",
        latestTeamAt: Number.NEGATIVE_INFINITY,
        races: new Set<string>(),
        grids: [],
        finishes: [],
        placesGained: [],
        normalizedPlacesGained: [],
        normalizedOvertakeRates: [],
        openingLapPlacesGained: [],
        normalizedOpeningLapPlacesGained: [],
        overtakeSamples: [],
        podiums: 0,
        poles: 0,
        fastestLapCount: 0,
        lapsLed: 0,
        recordedPositionSamples: 0,
        positionHistoryRaces: new Set<string>(),
        racePaceScores: [],
        points: 0,
      };
      current.races.add(race.file);
      current.points += result.points;
      current.overtakeSamples.push(result.overtakes);
      current.normalizedOvertakeRates.push(
        result.overtakes / Math.max(1, field - 1),
      );
      if (result.fastestLap) current.fastestLapCount += 1;
      if (result.pole) current.poles += 1;
      const paceRank = paceRanks.get(key);
      if (paceRank != null) current.racePaceScores.push(paceRank);

      const positionHistory = (race.session["position-history"] ?? []).find(
        (entry) => driverKey(entry.name) === key,
      );
      const validHistory = (
        positionHistory?.["driver-position-history"] ?? []
      ).filter((entry) => validPosition(entry.position, field));
      if (validHistory.length) {
        current.positionHistoryRaces.add(race.file);
        current.recordedPositionSamples += validHistory.length;
        current.lapsLed += validHistory.filter(
          (entry) => entry.position === 1,
        ).length;
      }

      if (timestamp >= current.latestTeamAt) {
        current.team = getTeamName(driver.team ?? "");
        current.latestTeamAt = timestamp;
      }

      if (validPosition(result.grid, field)) {
        current.grids.push({ position: result.grid, field });
        const firstLap = lapOnePosition(driver);
        if (validPosition(firstLap, field)) {
          current.openingLapPlacesGained.push(result.grid - firstLap);
          current.normalizedOpeningLapPlacesGained.push(
            (result.grid - firstLap) / Math.max(1, field - 1),
          );
        }
      }

      if (completed(result.status) && validPosition(result.position, field)) {
        current.finishes.push({ position: result.position, field });
        if (result.position <= 3) current.podiums += 1;
        if (validPosition(result.grid, field)) {
          current.placesGained.push(result.grid - result.position);
          current.normalizedPlacesGained.push(
            (result.grid - result.position) / Math.max(1, field - 1),
          );
        }
      }

      drivers.set(key, current);
    }
  }

  const rawRows: RawDriverDna[] = [...drivers.values()].map((driver) => {
    const averageGrid = average(driver.grids.map((sample) => sample.position));
    const averageFinish = average(
      driver.finishes.map((sample) => sample.position),
    );
    const averageGridStrength = average(
      driver.grids.map((sample) => 1 - fieldFraction(sample)),
    );
    const topThirdStarts = driver.grids.filter(
      (sample) => fieldFraction(sample) < 1 / 3,
    ).length;
    const normalizedFinishes = driver.finishes.map(fieldFraction);
    const medianFinish = median(normalizedFinishes);
    const finishSwingFraction =
      medianFinish == null
        ? null
        : median(
            normalizedFinishes.map((finish) => Math.abs(finish - medianFinish)),
          );
    const typicalField =
      average(driver.finishes.map((sample) => sample.field)) ?? 0;
    const finishSwing =
      finishSwingFraction == null
        ? null
        : finishSwingFraction * Math.max(1, typicalField - 1);
    const averagePlacesGained = average(driver.placesGained);
    const averageNormalizedGain = average(driver.normalizedPlacesGained);
    const openingLapPlacesGained = average(driver.openingLapPlacesGained);
    const averageNormalizedLapOneGain = average(
      driver.normalizedOpeningLapPlacesGained,
    );
    const averageNormalizedOvertakes = average(driver.normalizedOvertakeRates);
    const averageOvertakes = average(driver.overtakeSamples);
    const totalOvertakes = driver.overtakeSamples.reduce(
      (sum, count) => sum + count,
      0,
    );
    const podiumRate = driver.finishes.length
      ? driver.podiums / driver.finishes.length
      : null;
    const fastestLapRate = driver.races.size
      ? driver.fastestLapCount / driver.races.size
      : null;
    const finishRate = driver.races.size
      ? driver.finishes.length / driver.races.size
      : null;
    const lapsLedShare = driver.recordedPositionSamples
      ? driver.lapsLed / driver.recordedPositionSamples
      : null;
    const poleRate = driver.grids.length
      ? driver.poles / driver.grids.length
      : null;
    const racePaceQuality = average(driver.racePaceScores);
    const averageNormalizedFinish = average(normalizedFinishes);
    const averageRacePaceRank = racePaceQuality ?? 0;
    const evidence: Record<DriverDnaSignal, string> = {
      recovery: `${(averagePlacesGained ?? 0) > 0 ? "+" : ""}${(averagePlacesGained ?? 0).toFixed(1)} places gained / race`,
      grid: `Average start ${averageGrid == null ? "—" : `P${averageGrid.toFixed(1)}`}`,
      pole: `${driver.poles} pole${driver.poles === 1 ? "" : "s"} in ${driver.grids.length} starts`,
      stability: `±${(finishSwing ?? 0).toFixed(1)} finish swing`,
      openingLap: `${(openingLapPlacesGained ?? 0) > 0 ? "+" : ""}${(openingLapPlacesGained ?? 0).toFixed(1)} places by lap one`,
      overtaking: `${(averageOvertakes ?? 0).toFixed(1)} passes / race`,
      podium: `${Math.round((podiumRate ?? 0) * 100)}% podium rate`,
      fastestLap: `${Math.round((fastestLapRate ?? 0) * 100)} fastest-lap rate`,
      reliability: `${Math.round((finishRate ?? 0) * 100)}% finish rate`,
      lapsLed: `${Math.round((lapsLedShare ?? 0) * 100)}% of recorded laps led`,
      racePace: `Top ${Math.round((1 - averageRacePaceRank) * 100)}% race pace`,
      finish: `Average finish ${averageFinish == null ? "—" : `P${averageFinish.toFixed(1)}`}`,
    };

    const card = {
      key: driver.key,
      name: driver.name,
      team: driver.team,
      races: driver.races.size,
      finishedRaces: driver.finishes.length,
      averageGrid,
      averageFinish,
      averagePlacesGained,
      gridTopThirdShare: driver.grids.length
        ? topThirdStarts / driver.grids.length
        : null,
      finishSwing,
      openingLapPlacesGained,
      openingLapPositiveShare: driver.openingLapPlacesGained.length
        ? driver.openingLapPlacesGained.filter((gain) => gain > 0).length /
          driver.openingLapPlacesGained.length
        : null,
      averageOvertakes,
      totalOvertakes,
      podiums: driver.podiums,
      podiumRate,
      fastestLapCount: driver.fastestLapCount,
      fastestLapRate,
      finishRate,
      lapsLed: driver.lapsLed,
      recordedPositionSamples: driver.recordedPositionSamples,
      lapsLedShare,
      points: driver.points,
    };
    const signals: SignalSet = {
      recovery:
        driver.normalizedPlacesGained.length >= 3
          ? averageNormalizedGain
          : null,
      grid: driver.grids.length >= 3 ? averageGridStrength : null,
      pole: driver.grids.length >= 3 ? poleRate : null,
      stability:
        driver.finishes.length >= 4 && finishSwingFraction != null
          ? 1 - finishSwingFraction
          : null,
      openingLap:
        driver.normalizedOpeningLapPlacesGained.length >= 3
          ? averageNormalizedLapOneGain
          : null,
      overtaking:
        driver.overtakeSamples.length >= 5 ? averageNormalizedOvertakes : null,
      podium: driver.finishes.length >= 4 ? podiumRate : null,
      fastestLap: driver.races.size >= 5 ? fastestLapRate : null,
      reliability: driver.races.size >= 3 ? finishRate : null,
      lapsLed:
        driver.positionHistoryRaces.size >= 3 &&
        driver.recordedPositionSamples >= 10
          ? lapsLedShare
          : null,
      racePace: driver.racePaceScores.length >= 3 ? racePaceQuality : null,
      finish:
        driver.finishes.length >= 3 && averageNormalizedFinish != null
          ? 1 - averageNormalizedFinish
          : null,
    };

    return {
      card: card satisfies Omit<
        DriverDnaCard,
        "style" | "signatureFit" | "supportingSignals"
      >,
      signals,
      evidence,
      samples: {
        gain: driver.normalizedPlacesGained.length,
        grid: driver.grids.length,
        finish: driver.finishes.length,
        openingLap: driver.normalizedOpeningLapPlacesGained.length,
        overtaking: driver.overtakeSamples.length,
        leadHistoryRaces: driver.positionHistoryRaces.size,
        pace: driver.racePaceScores.length,
      },
    };
  });

  const ranks = percentileSignals(rawRows);
  return rawRows
    .map((row) => {
      const fits = fitStyles(row, ranks.get(row.card.key) ?? ({} as SignalSet));
      const signature = chooseSignature(row.card.races, fits);
      return { ...row.card, ...signature } satisfies DriverDnaCard;
    })
    .sort((a, b) => b.races - a.races || a.name.localeCompare(b.name));
}
