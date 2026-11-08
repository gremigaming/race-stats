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
import {
  getDriverStints,
  getStintWearCurve,
  stintWearRate,
} from "../utils/stats/tyres";
import { getTrackDisplayName, getTrackId } from "../utils/tracks";

const STREET_CIRCUIT_IDS = new Set([
  "jeddah",
  "miami",
  "monaco",
  "baku",
  "marina-bay",
  "las-vegas",
]);

export const DRIVER_DNA_STYLES = {
  comeback: {
    label: "Comeback Artist",
    tagline: "Turns a rough grid slot into a result.",
    criterion:
      "Blends grid-to-finish recovery, lap-one gains, overtakes, finishing position, and podiums.",
  },
  qualifying: {
    label: "One-Lap Weapon",
    tagline: "Puts the car in the fight before the lights go out.",
    criterion:
      "Blends front-of-grid starts, poles, race pace, fastest laps, and podiums.",
  },
  consistency: {
    label: "Race Metronome",
    tagline: "Same calm hands, race after race.",
    criterion:
      "Blends finish stability, completion rate, average finish, and race pace.",
  },
  openingLap: {
    label: "Lap-One Charger",
    tagline: "The race is moving before the field reaches lap two.",
    criterion:
      "Blends places gained by lap one, overtakes, overall recovery, podiums, and race completion.",
  },
  overtakeArtist: {
    label: "Pack Buster",
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
    label: "Hot-Lap Sniper",
    tagline: "Finds another gear when one lap matters.",
    criterion:
      "Blends fastest-lap rate, race pace, poles, podiums, and laps led.",
  },
  ironWill: {
    label: "Flag-to-Flag Finisher",
    tagline: "Starts the race. Sees the flag. Repeat.",
    criterion:
      "Blends finish rate, consistency, average finish, and race pace.",
  },
  paceSetter: {
    label: "Front-Runner",
    tagline: "When the pack looks up, they’re at the front.",
    criterion:
      "Blends laps led, race pace, fastest laps, podiums, and grid strength.",
  },
  cleanDuelist: {
    label: "Clean Combatant",
    tagline: "Lives in the tightest battles—and keeps them clean.",
    criterion:
      "Blends clean close sectors, how often close battles stay contact-free, and clean overtakes.",
  },
  rainMaster: {
    label: "Rain Master",
    tagline: "Gets more out of a wet race than their usual baseline.",
    criterion:
      "Compares race-field pace and finishing strength in wet races with the same driver's dry-race baseline.",
  },
  tyreWhisperer: {
    label: "Tire Whisperer",
    tagline: "Makes the rubber last when the race starts to bite.",
    criterion:
      "Ranks measured wear against drivers on the same compound in the same race, then checks pace, finishes, and reliability.",
  },
  streetCircuitSpecialist: {
    label: "Street Circuit Specialist",
    tagline: "Finds an extra edge where the walls close in.",
    criterion:
      "Compares performance on street circuits with the driver's other circuits, across multiple street venues.",
  },
  allRounder: {
    label: "All-Rounder",
    tagline: "Strong in the cockpit, wherever the fight takes them.",
    criterion:
      "Shows above-peer strength across pace, racecraft, and results without one specialist style dominating.",
  },
  noSignature: {
    label: "No Clear Signature",
    tagline: "No archetype clears its defining bar in this race window.",
    criterion:
      "The data is measurable, but no archetype has both a meaningful defining stat and enough supporting evidence.",
  },
  developing: {
    label: "In the Making",
    tagline: "The sample is still warming up.",
    criterion: "More race results are needed before a style can be earned.",
  },
} as const;

export type DriverDnaStyle = keyof typeof DRIVER_DNA_STYLES;

export interface DriverDnaCard {
  key: string;
  name: string;
  team: string;
  style: DriverDnaStyle;
  matchKind:
    | "signature"
    | "archetype"
    | "balanced"
    | "developing"
    | "insufficient";
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
  cleanCloseSectors: number;
  closeSectorOpportunities: number;
  cleanCloseShare: number | null;
  cleanCloseSectorsPerRace: number | null;
  cleanOvertakes: number;
  recordedOnTrackOvertakes: number;
  cleanOvertakeRate: number | null;
  cleanRacingRaces: number;
  wetRaces: number;
  dryRaces: number;
  wetPerformanceDelta: number | null;
  streetRaces: number;
  nonStreetRaces: number;
  streetTrackCount: number;
  streetPerformanceDelta: number | null;
  tyreWearRaces: number;
  tyreWearStints: number;
  tyreCareRank: number | null;
  signatureFit: number | null;
  signatureConfidence: number | null;
  archetypeFits: DriverDnaArchetypeFit[];
  supportingSignals: DriverDnaSignalEvidence[];
  points: number;
}

export type DriverDnaArchetype = Exclude<
  DriverDnaStyle,
  "noSignature" | "developing"
>;

export interface DriverDnaArchetypeFit {
  style: DriverDnaArchetype;
  fit: number | null;
  hasEnoughStarts: boolean;
  hasEnoughSignals: boolean;
  meetsDefiningStat: boolean;
  qualifies: boolean;
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
  cleanCloseSectors: number;
  closeSectorOpportunities: number;
  totalCloseWeight: number;
  closeSectorCount: number;
  cleanOvertakes: number;
  recordedOnTrackOvertakes: number;
  cleanRacingRaces: Set<string>;
  wetPerformance: number[];
  dryPerformance: number[];
  streetPerformance: number[];
  nonStreetPerformance: number[];
  streetTracks: Set<string>;
  tyreCareScores: number[];
  tyreWearRaces: Set<string>;
  tyreWearStints: number;
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

function isWetWeather(weather: string | undefined): boolean {
  return Boolean(weather && /rain|storm|thunder|wet/i.test(weather));
}

function raceTyreCare(race: LeagueRace): {
  scoreByDriver: Map<string, number>;
  stintsByDriver: Map<string, number>;
} {
  const ratesByCompound = new Map<string, Map<string, number[]>>();
  const stintsByDriver = new Map<string, number>();
  for (const driver of race.session["classification-data"] ?? []) {
    if (!isNamedDriver(driver)) continue;
    const key = driverKey(driver["driver-name"]);
    for (const stint of getDriverStints(driver)) {
      const length = stint["stint-length"];
      const compound =
        stint["tyre-set-data"]["visual-tyre-compound"]?.trim().toLowerCase() ??
        "";
      if (
        length < 3 ||
        !["soft", "medium", "hard"].some((name) => compound.includes(name))
      ) {
        continue;
      }
      const wearCurve = getStintWearCurve(stint);
      if (wearCurve.length < 3 || wearCurve.at(-1)?.stintLap !== length) {
        continue;
      }
      const wearRate = stintWearRate(stint);
      if (!Number.isFinite(wearRate) || wearRate <= 0) continue;

      const byDriver = ratesByCompound.get(compound) ?? new Map();
      const driverRates = byDriver.get(key) ?? [];
      driverRates.push(wearRate);
      byDriver.set(key, driverRates);
      ratesByCompound.set(compound, byDriver);
      stintsByDriver.set(key, (stintsByDriver.get(key) ?? 0) + 1);
    }
  }

  const scores = new Map<string, number[]>();
  for (const byDriver of ratesByCompound.values()) {
    const averageRates = [...byDriver].map(([key, rates]) => ({
      key,
      rate: average(rates) ?? 0,
    }));
    const peers = averageRates.map((entry) => entry.rate);
    for (const { key, rate } of averageRates) {
      const ranks = scores.get(key) ?? [];
      ranks.push(1 - peerPercentile(rate, peers));
      scores.set(key, ranks);
    }
  }

  return {
    scoreByDriver: new Map(
      [...scores].flatMap(([key, ranks]) => {
        const score = average(ranks);
        return score == null ? [] : [[key, score]];
      }),
    ),
    stintsByDriver,
  };
}

interface RaceCleanRacingStats {
  validSectors: number;
  closeSectorOpportunities: number;
  closeWeight: number;
  cleanCloseWeight: number;
  cleanOvertakes: number;
  recordedOnTrackOvertakes: number;
}

interface SectorTiming {
  lap: number;
  sector: number;
  start: number;
  end: number;
}

/** Mirrors the league safety rating's clean proximity and overtake rules. */
function cleanRacingByDriver(
  race: LeagueRace,
): Map<string, RaceCleanRacingStats> {
  const raceControl = race.session["race-control"];
  if (!raceControl) return new Map();

  const classified = race.session["classification-data"] ?? [];
  const driverKeyByIndex = new Map<number, string>();
  const timingsByIndex = new Map<number, Map<string, SectorTiming>>();
  for (const driver of classified) {
    if (isNamedDriver(driver)) {
      driverKeyByIndex.set(driver.index, driverKey(driver["driver-name"]));
    }

    const sectors = new Map<string, SectorTiming>();
    let elapsed = 0;
    for (const [lapIndex, lap] of (
      driver["session-history"]?.["lap-history-data"] ?? []
    ).entries()) {
      const sector1 = lap["sector-1-time-in-ms"];
      const sector2 = lap["sector-2-time-in-ms"];
      const lapTime = lap["lap-time-in-ms"];
      if (!(sector1 > 0 && sector2 > 0 && lapTime > 0)) break;

      const lapNumber = lapIndex + 1;
      const start1 = elapsed;
      const start2 = start1 + sector1;
      const start3 = start2 + sector2;
      sectors.set(`${lapNumber}:S1`, {
        lap: lapNumber,
        sector: 1,
        start: start1,
        end: start2,
      });
      sectors.set(`${lapNumber}:S2`, {
        lap: lapNumber,
        sector: 2,
        start: start2,
        end: start3,
      });
      sectors.set(`${lapNumber}:S3`, {
        lap: lapNumber,
        sector: 3,
        start: start3,
        end: elapsed + lapTime,
      });
      elapsed += lapTime;
    }
    timingsByIndex.set(driver.index, sectors);
  }

  const dirtySectors = new Set<string>();
  const collisions = raceControl.filter(
    (event) => event["message-type"] === "COLLISION",
  );
  for (const event of raceControl) {
    if (
      (event["message-type"] !== "COLLISION" &&
        event["message-type"] !== "PENALTY") ||
      event["lap-number"] == null ||
      !event.sector
    ) {
      continue;
    }
    for (const index of event["involved-drivers"]) {
      dirtySectors.add(`${index}:${event["lap-number"]}:${event.sector}`);
    }
  }

  const stats = new Map<string, RaceCleanRacingStats>();
  for (const key of driverKeyByIndex.values()) {
    if (!stats.has(key)) {
      stats.set(key, {
        validSectors: 0,
        closeSectorOpportunities: 0,
        closeWeight: 0,
        cleanCloseWeight: 0,
        cleanOvertakes: 0,
        recordedOnTrackOvertakes: 0,
      });
    }
  }

  for (const [index, key] of driverKeyByIndex) {
    const ownSectors = timingsByIndex.get(index);
    const ownStats = stats.get(key);
    if (!ownSectors || !ownStats) continue;

    for (const [sectorKey, timing] of ownSectors) {
      if (timing.lap === 1 && timing.sector === 1) continue;
      ownStats.validSectors += 1;
      let closeWeight = 0;
      for (const [otherIndex, otherSectors] of timingsByIndex) {
        if (otherIndex === index) continue;
        const other = otherSectors.get(sectorKey);
        if (!other) continue;
        const startGap = Math.abs(other.start - timing.start);
        const endGap = Math.abs(other.end - timing.end);
        if (startGap <= 500 && endGap <= 500) {
          closeWeight = 1;
          break;
        }
        if (startGap <= 1000 && endGap <= 1000) closeWeight = 0.5;
      }
      if (closeWeight === 0) continue;

      ownStats.closeSectorOpportunities += 1;
      ownStats.closeWeight += closeWeight;
      if (!dirtySectors.has(`${index}:${timing.lap}:S${timing.sector}`)) {
        ownStats.cleanCloseWeight += closeWeight;
      }
    }
  }

  for (const event of raceControl) {
    if (
      event["message-type"] !== "OVERTAKE" ||
      event["overtaker-index"] == null ||
      event["overtaker-pitting"] ||
      event["overtaken-pitting"]
    ) {
      continue;
    }
    const key = driverKeyByIndex.get(event["overtaker-index"]);
    if (!key) continue;
    const ownStats = stats.get(key);
    if (!ownStats) continue;
    ownStats.recordedOnTrackOvertakes += 1;
    const nearCollision = collisions.some(
      (collision) =>
        Math.abs(collision.timestamp - event.timestamp) <= 5 &&
        collision["involved-drivers"].includes(event["overtaker-index"]!),
    );
    if (!nearCollision) ownStats.cleanOvertakes += 1;
  }

  return stats;
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
  | "cleanRacing"
  | "wetPerformance"
  | "tyreCare"
  | "streetPerformance"
  | "finish";

type SignatureStyle = Exclude<
  DriverDnaStyle,
  "allRounder" | "noSignature" | "developing"
>;
type SignalSet = Record<DriverDnaSignal, number | null>;

const MIN_SIGNATURE_FIT = 0.68;
const MIN_SIGNATURE_LEAD = 0.04;

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
  "cleanRacing",
  "wetPerformance",
  "tyreCare",
  "streetPerformance",
  "finish",
];

const ALL_ROUNDER_SIGNAL_GROUPS: {
  label: string;
  signals: DriverDnaSignal[];
}[] = [
  {
    label: "Pace",
    signals: ["grid", "pole", "fastestLap", "lapsLed", "racePace"],
  },
  {
    label: "Racecraft",
    signals: ["recovery", "openingLap", "overtaking", "cleanRacing"],
  },
  {
    label: "Results",
    signals: ["podium", "finish", "reliability", "stability"],
  },
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
  cleanDuelist: {
    cleanRacing: 0.54,
    overtaking: 0.16,
    openingLap: 0.1,
    reliability: 0.1,
    stability: 0.1,
  },
  rainMaster: {
    wetPerformance: 0.34,
    racePace: 0.18,
    recovery: 0.14,
    stability: 0.12,
    podium: 0.1,
    reliability: 0.12,
  },
  tyreWhisperer: {
    tyreCare: 0.4,
    racePace: 0.18,
    stability: 0.14,
    finish: 0.12,
    reliability: 0.1,
    grid: 0.06,
  },
  streetCircuitSpecialist: {
    streetPerformance: 0.36,
    racePace: 0.18,
    recovery: 0.14,
    stability: 0.12,
    podium: 0.1,
    reliability: 0.1,
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
  cleanDuelist: "cleanRacing",
  rainMaster: "wetPerformance",
  tyreWhisperer: "tyreCare",
  streetCircuitSpecialist: "streetPerformance",
};

const STYLE_ANCHOR_FLOORS: Record<SignatureStyle, number> = {
  comeback: 0.75,
  qualifying: 0.75,
  consistency: 0.75,
  openingLap: 0.75,
  overtakeArtist: 0.8,
  podiumMagnet: 0.75,
  fastestLapHunter: 0.75,
  ironWill: 0.75,
  paceSetter: 0.75,
  cleanDuelist: 0.75,
  rainMaster: 0.75,
  tyreWhisperer: 0.75,
  streetCircuitSpecialist: 0.75,
};

const MIN_STRONG_SIGNAL_RANK = 0.65;

interface RawDriverDna {
  card: Omit<
    DriverDnaCard,
    | "style"
    | "matchKind"
    | "signatureFit"
    | "signatureConfidence"
    | "archetypeFits"
    | "supportingSignals"
  >;
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
    cleanRacingRaces: number;
    closeSectorOpportunities: number;
    onTrackOvertakes: number;
    wetRaces: number;
    dryRaces: number;
    streetRaces: number;
    nonStreetRaces: number;
    streetTracks: number;
    tyreWearRaces: number;
    tyreWearStints: number;
  };
}

interface StyleFit {
  style: SignatureStyle;
  score: number | null;
  anchorStrength: number;
  coverage: number;
  strongSignals: number;
  anchor: number | null;
  hasEnoughStarts: boolean;
  hasEnoughSignals: boolean;
  meetsDefiningStat: boolean;
  qualifies: boolean;
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
    case "cleanDuelist":
      return (
        row.samples.cleanRacingRaces >= 5 &&
        row.samples.closeSectorOpportunities >= 18
      );
    case "rainMaster":
      return row.samples.wetRaces >= 3 && row.samples.dryRaces >= 5;
    case "tyreWhisperer":
      return row.samples.tyreWearRaces >= 5 && row.samples.tyreWearStints >= 10;
    case "streetCircuitSpecialist":
      return (
        row.samples.streetRaces >= 3 &&
        row.samples.nonStreetRaces >= 5 &&
        row.samples.streetTracks >= 2
      );
  }
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function absoluteAnchorStrength(
  style: SignatureStyle,
  row: RawDriverDna,
): number {
  const card = row.card;
  switch (style) {
    case "comeback":
      return clamp01((card.averagePlacesGained ?? 0) / 0.75);
    case "qualifying":
      return clamp01((card.gridTopThirdShare ?? 0) / 0.45);
    case "consistency":
      return clamp01(
        Math.min(
          card.finishSwing == null ? 0 : 3 / Math.max(0.1, card.finishSwing),
          (card.finishRate ?? 0) / 0.8,
        ),
      );
    case "openingLap":
      return clamp01(
        Math.min(
          (card.openingLapPlacesGained ?? 0) / 0.5,
          (card.openingLapPositiveShare ?? 0) / 0.55,
        ),
      );
    case "overtakeArtist":
      return clamp01((card.averageOvertakes ?? 0) / 5);
    case "podiumMagnet":
      return clamp01((card.podiumRate ?? 0) / 0.25);
    case "fastestLapHunter":
      return clamp01((card.fastestLapRate ?? 0) / 0.1);
    case "ironWill":
      return clamp01((card.finishRate ?? 0) / 0.85);
    case "paceSetter":
      return clamp01((card.lapsLedShare ?? 0) / 0.15);
    case "cleanDuelist":
      return clamp01(
        Math.min(
          (card.cleanCloseSectorsPerRace ?? 0) / 4,
          (card.cleanCloseShare ?? 0) / 0.7,
        ),
      );
    case "rainMaster":
      return clamp01((card.wetPerformanceDelta ?? 0) / 0.12);
    case "tyreWhisperer":
      return clamp01(((card.tyreCareRank ?? 0) - 0.5) / 0.25);
    case "streetCircuitSpecialist":
      return clamp01((card.streetPerformanceDelta ?? 0) / 0.12);
  }
}

function fitStyles(row: RawDriverDna, signalRanks: SignalSet): StyleFit[] {
  return (Object.keys(STYLE_PROFILES) as SignatureStyle[]).flatMap((style) => {
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
      if (rank >= MIN_STRONG_SIGNAL_RANK) strongSignals += 1;
      support.push({ signal: key, contribution: rank * weight });
    }
    const rawScore = coverage ? weightedScore / coverage : null;
    const anchorStrength = absoluteAnchorStrength(style, row);
    // A good peer rank cannot completely compensate for a weak defining stat.
    const score =
      rawScore == null ? null : rawScore * (0.35 + anchorStrength * 0.65);
    const anchor = signalRanks[STYLE_ANCHORS[style]];
    const hasEnoughStarts = styleMinimumMet(style, row);
    const hasEnoughSignals = coverage >= 0.72;
    const meetsDefiningStat = anchorStrength >= 1;
    return [
      {
        style,
        score,
        anchorStrength,
        coverage,
        strongSignals,
        anchor,
        hasEnoughStarts,
        hasEnoughSignals,
        meetsDefiningStat,
        qualifies: hasEnoughStarts && hasEnoughSignals && meetsDefiningStat,
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
    case "cleanRacing":
      return "Clean close racing";
    case "wetPerformance":
      return "Wet-race delta";
    case "tyreCare":
      return "Tyre preservation";
    case "streetPerformance":
      return "Street-circuit delta";
    case "finish":
      return "Finish";
  }
}

function fitAllRounder(
  row: RawDriverDna,
  signalRanks: SignalSet,
): {
  score: number | null;
  support: DriverDnaSignalEvidence[];
  hasEnoughStarts: boolean;
  hasEnoughSignals: boolean;
  qualifies: boolean;
} {
  const allRounderSignals = [
    ...new Set(ALL_ROUNDER_SIGNAL_GROUPS.flatMap((group) => group.signals)),
  ];
  const availableSignals = allRounderSignals.flatMap((signal) => {
    const percentile = signalRanks[signal];
    return percentile == null ? [] : [{ signal, percentile }];
  });
  const hasEnoughSignals = availableSignals.length >= 8;

  const groups = ALL_ROUNDER_SIGNAL_GROUPS.map((group) => {
    const signals = group.signals.flatMap((signal) => {
      const percentile = signalRanks[signal];
      return percentile == null ? [] : [{ signal, percentile }];
    });
    return {
      ...group,
      signals,
      score: average(signals.map((entry) => entry.percentile)),
    };
  });
  const overallScore = average(
    availableSignals.map((entry) => entry.percentile),
  );
  const groupScores = groups.flatMap((group) =>
    group.score == null ? [] : [group.score],
  );
  const score =
    groups.every((group) => group.score != null) && groupScores.length === 3
      ? average(groupScores)
      : null;
  const support = groups.map((group) => {
    const strongest = [...group.signals].sort(
      (a, b) => b.percentile - a.percentile,
    )[0];
    if (!strongest) return null;
    return {
      label: group.label,
      value: `${signalLabel(strongest.signal)} · ${row.evidence[strongest.signal]}`,
      percentile: strongest.percentile,
    };
  });

  const qualifies =
    row.card.races >= 8 &&
    hasEnoughSignals &&
    overallScore != null &&
    overallScore >= 0.58 &&
    groups.every(
      (group) =>
        group.signals.length >= 2 && group.score != null && group.score >= 0.54,
    );

  return {
    score,
    support: support.filter(
      (signal): signal is DriverDnaSignalEvidence => signal != null,
    ),
    hasEnoughStarts: row.card.races >= 8,
    hasEnoughSignals,
    qualifies,
  };
}

function confidenceScore(
  fit: number,
  lead: number,
  anchorStrength: number,
  strongSignals: number,
  races: number,
): number {
  const separation = Math.min(1, Math.max(0, lead) / 0.15);
  const breadth = Math.min(1, strongSignals / 4);
  const sample = Math.min(1, Math.sqrt(races / 30));
  return Math.round(
    100 *
      (fit * 0.35 +
        separation * 0.2 +
        anchorStrength * 0.2 +
        breadth * 0.1 +
        sample * 0.15),
  );
}

function archetypeFits(
  fits: StyleFit[],
  allRounder: ReturnType<typeof fitAllRounder>,
): DriverDnaArchetypeFit[] {
  return [
    ...fits.map((fit) => ({
      style: fit.style,
      fit: fit.score == null ? null : Math.round(fit.score * 100),
      hasEnoughStarts: fit.hasEnoughStarts,
      hasEnoughSignals: fit.hasEnoughSignals,
      meetsDefiningStat: fit.meetsDefiningStat,
      qualifies: fit.qualifies,
    })),
    {
      style: "allRounder" as const,
      fit: allRounder.score == null ? null : Math.round(allRounder.score * 100),
      hasEnoughStarts: allRounder.hasEnoughStarts,
      hasEnoughSignals: allRounder.hasEnoughSignals,
      meetsDefiningStat: allRounder.hasEnoughSignals,
      qualifies: allRounder.qualifies,
    },
  ];
}

function chooseSignature(
  row: RawDriverDna,
  fits: StyleFit[],
  signalRanks: SignalSet,
): {
  style: DriverDnaStyle;
  matchKind: DriverDnaCard["matchKind"];
  signatureFit: number | null;
  signatureConfidence: number | null;
  archetypeFits: DriverDnaArchetypeFit[];
  supportingSignals: DriverDnaSignalEvidence[];
} {
  const allRounderFit = fitAllRounder(row, signalRanks);
  const rankedFits = fits
    .filter((fit) => fit.score != null)
    .sort(
      (a, b) =>
        (b.score ?? -1) - (a.score ?? -1) ||
        b.strongSignals - a.strongSignals ||
        (b.anchor ?? -1) - (a.anchor ?? -1),
    );
  const eligibleFits = rankedFits.filter(
    (fit) => fit.hasEnoughStarts && fit.hasEnoughSignals,
  );
  const anchoredFits = eligibleFits.filter((fit) => fit.meetsDefiningStat);
  const rankedCandidates = anchoredFits.length
    ? anchoredFits
    : eligibleFits.length
      ? eligibleFits
      : rankedFits;
  const [best, second] = rankedCandidates;
  const allFits = archetypeFits(fits, allRounderFit);
  const confidenceSampleSize = (style: SignatureStyle) => {
    switch (style) {
      case "cleanDuelist":
        return row.samples.cleanRacingRaces;
      case "rainMaster":
        return row.samples.wetRaces;
      case "tyreWhisperer":
        return row.samples.tyreWearRaces;
      case "streetCircuitSpecialist":
        return Math.min(row.samples.streetRaces, row.samples.nonStreetRaces);
      default:
        return row.card.races;
    }
  };

  if (row.card.races < 6) {
    const earlyBest = anchoredFits[0];
    const earlySecond = anchoredFits[1];
    if (!earlyBest) {
      return {
        style: "developing",
        matchKind: "developing",
        signatureFit: null,
        signatureConfidence: null,
        archetypeFits: allFits,
        supportingSignals: [],
      };
    }
    return {
      style: earlyBest.style,
      matchKind: "developing",
      signatureFit: Math.round(earlyBest.score! * 100),
      signatureConfidence: confidenceScore(
        earlyBest.score!,
        earlyBest.score! - (earlySecond?.score ?? 0),
        earlyBest.anchorStrength,
        earlyBest.strongSignals,
        confidenceSampleSize(earlyBest.style),
      ),
      archetypeFits: allFits,
      supportingSignals: earlyBest.support,
    };
  }

  if (!best) {
    return {
      style: "developing",
      matchKind: "developing",
      signatureFit: null,
      signatureConfidence: null,
      archetypeFits: allFits,
      supportingSignals: [],
    };
  }

  const allRounderWins =
    allRounderFit.qualifies &&
    allRounderFit.score != null &&
    allRounderFit.score >= best.score! - 0.05;

  if (allRounderWins && allRounderFit.score != null) {
    return {
      style: "allRounder",
      matchKind: "balanced",
      signatureFit: Math.round(allRounderFit.score * 100),
      signatureConfidence: confidenceScore(
        allRounderFit.score,
        allRounderFit.score - (best.score ?? 0),
        1,
        3,
        row.card.races,
      ),
      archetypeFits: allFits,
      supportingSignals: allRounderFit.support,
    };
  }

  if (
    best.score! >= MIN_SIGNATURE_FIT &&
    best.score! - (second?.score ?? 0) >= MIN_SIGNATURE_LEAD &&
    best.anchor != null &&
    best.anchor >= STYLE_ANCHOR_FLOORS[best.style] &&
    best.meetsDefiningStat &&
    best.strongSignals >= 3
  ) {
    return {
      style: best.style,
      matchKind: "signature",
      signatureFit: Math.round(best.score! * 100),
      signatureConfidence: confidenceScore(
        best.score!,
        best.score! - (second?.score ?? 0),
        best.anchorStrength,
        best.strongSignals,
        confidenceSampleSize(best.style),
      ),
      archetypeFits: allFits,
      supportingSignals: best.support,
    };
  }

  return {
    style: best.style,
    matchKind: "archetype",
    signatureFit: Math.round(best.score! * 100),
    signatureConfidence: confidenceScore(
      best.score!,
      best.score! - (second?.score ?? 0),
      best.anchorStrength,
      best.strongSignals,
      confidenceSampleSize(best.style),
    ),
    archetypeFits: allFits,
    supportingSignals: best.support,
  };
}

/** Build each named driver's strongest racecraft signature from the visible races. */
export function buildDriverDna(races: LeagueRace[]): DriverDnaCard[] {
  const drivers = new Map<string, DriverAccumulator>();

  for (const race of races) {
    if (!isRaceSession(race.session)) continue;
    const cleanRacingStats = cleanRacingByDriver(race);
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
    const sessionInfo = race.session["session-info"];
    const weather = sessionInfo?.weather?.trim() ?? "";
    const trackId = getTrackId(sessionInfo?.["track-id"] ?? "");
    const isStreetCircuit = STREET_CIRCUIT_IDS.has(trackId);
    const wear = raceTyreCare(race);
    const racePerformance = new Map<string, number>();
    for (const [key, result] of results) {
      const parts = [paceRanks.get(key)];
      if (completed(result.status) && validPosition(result.position, field)) {
        parts.push(1 - fieldFraction({ position: result.position, field }));
      }
      const available = parts.filter(
        (value): value is number => value != null && Number.isFinite(value),
      );
      const score = average(available);
      if (score != null) racePerformance.set(key, score);
    }
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
        cleanCloseSectors: 0,
        closeSectorOpportunities: 0,
        totalCloseWeight: 0,
        closeSectorCount: 0,
        cleanOvertakes: 0,
        recordedOnTrackOvertakes: 0,
        cleanRacingRaces: new Set<string>(),
        wetPerformance: [],
        dryPerformance: [],
        streetPerformance: [],
        nonStreetPerformance: [],
        streetTracks: new Set<string>(),
        tyreCareScores: [],
        tyreWearRaces: new Set<string>(),
        tyreWearStints: 0,
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
      const raceScore = racePerformance.get(key);
      if (raceScore != null) {
        if (weather) {
          (isWetWeather(weather)
            ? current.wetPerformance
            : current.dryPerformance
          ).push(raceScore);
        }
        if (trackId) {
          if (isStreetCircuit) {
            current.streetPerformance.push(raceScore);
            current.streetTracks.add(trackId);
          } else {
            current.nonStreetPerformance.push(raceScore);
          }
        }
      }
      const wearStints = wear.stintsByDriver.get(key) ?? 0;
      const tyreCareRank = wear.scoreByDriver.get(key);
      if (wearStints > 0) {
        current.tyreWearRaces.add(race.file);
        current.tyreWearStints += wearStints;
        if (tyreCareRank != null) current.tyreCareScores.push(tyreCareRank);
      }
      const cleanRace = cleanRacingStats.get(key);
      if (cleanRace?.validSectors) {
        current.cleanRacingRaces.add(race.file);
        current.cleanCloseSectors += cleanRace.cleanCloseWeight;
        current.closeSectorOpportunities += cleanRace.closeSectorOpportunities;
        current.totalCloseWeight += cleanRace.closeWeight;
        current.closeSectorCount += cleanRace.validSectors;
        current.cleanOvertakes += cleanRace.cleanOvertakes;
        current.recordedOnTrackOvertakes += cleanRace.recordedOnTrackOvertakes;
      }
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
    const cleanRacingRaces = driver.cleanRacingRaces.size;
    const cleanCloseSectorsPerRace = cleanRacingRaces
      ? driver.cleanCloseSectors / cleanRacingRaces
      : null;
    const cleanCloseShare =
      driver.totalCloseWeight > 0
        ? driver.cleanCloseSectors / driver.totalCloseWeight
        : null;
    const cleanOvertakeRate =
      driver.recordedOnTrackOvertakes >= 5
        ? driver.cleanOvertakes / driver.recordedOnTrackOvertakes
        : null;
    const cleanRacingComponents = [
      {
        value:
          cleanCloseSectorsPerRace == null
            ? null
            : clamp01(cleanCloseSectorsPerRace / 4),
        weight: 0.4,
      },
      { value: cleanCloseShare, weight: 0.35 },
      { value: cleanOvertakeRate, weight: 0.25 },
    ].filter(
      (component): component is { value: number; weight: number } =>
        component.value != null,
    );
    const cleanRacingQuality = cleanRacingComponents.length
      ? cleanRacingComponents.reduce(
          (sum, component) => sum + component.value * component.weight,
          0,
        ) /
        cleanRacingComponents.reduce(
          (sum, component) => sum + component.weight,
          0,
        )
      : null;
    const wetPerformanceDelta =
      driver.wetPerformance.length && driver.dryPerformance.length
        ? (average(driver.wetPerformance) ?? 0) -
          (average(driver.dryPerformance) ?? 0)
        : null;
    const streetPerformanceDelta =
      driver.streetPerformance.length && driver.nonStreetPerformance.length
        ? (average(driver.streetPerformance) ?? 0) -
          (average(driver.nonStreetPerformance) ?? 0)
        : null;
    const tyreCareRank = average(driver.tyreCareScores);
    const evidence: Record<DriverDnaSignal, string> = {
      recovery: `${(averagePlacesGained ?? 0) > 0 ? "+" : ""}${(averagePlacesGained ?? 0).toFixed(1)} places gained / race`,
      grid: `Average start ${averageGrid == null ? "—" : `P${averageGrid.toFixed(1)}`}`,
      pole: `${driver.poles} pole${driver.poles === 1 ? "" : "s"} in ${driver.grids.length} starts`,
      stability: `±${(finishSwing ?? 0).toFixed(1)} finish swing`,
      openingLap: `${(openingLapPlacesGained ?? 0) > 0 ? "+" : ""}${(openingLapPlacesGained ?? 0).toFixed(1)} places by lap one`,
      overtaking: `${(averageOvertakes ?? 0).toFixed(1)} passes / race`,
      podium: `${Math.round((podiumRate ?? 0) * 100)}% podium rate`,
      fastestLap: `${Math.round((fastestLapRate ?? 0) * 100)}% fastest-lap rate`,
      reliability: `${Math.round((finishRate ?? 0) * 100)}% finish rate`,
      lapsLed: `${Math.round((lapsLedShare ?? 0) * 100)}% of recorded laps led`,
      racePace: `Top ${Math.round((1 - averageRacePaceRank) * 100)}% race pace`,
      cleanRacing: `${(cleanCloseSectorsPerRace ?? 0).toFixed(1)} clean close sectors / race`,
      wetPerformance: `${(wetPerformanceDelta ?? 0) > 0 ? "+" : ""}${Math.round((wetPerformanceDelta ?? 0) * 100)} performance points in rain`,
      tyreCare: `${Math.round((tyreCareRank ?? 0.5) * 100)}th-percentile matched-compound wear control`,
      streetPerformance: `${(streetPerformanceDelta ?? 0) > 0 ? "+" : ""}${Math.round((streetPerformanceDelta ?? 0) * 100)} performance points on street circuits`,
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
      cleanCloseSectors: driver.cleanCloseSectors,
      closeSectorOpportunities: driver.closeSectorOpportunities,
      cleanCloseShare,
      cleanCloseSectorsPerRace,
      cleanOvertakes: driver.cleanOvertakes,
      recordedOnTrackOvertakes: driver.recordedOnTrackOvertakes,
      cleanOvertakeRate,
      cleanRacingRaces,
      wetRaces: driver.wetPerformance.length,
      dryRaces: driver.dryPerformance.length,
      wetPerformanceDelta,
      streetRaces: driver.streetPerformance.length,
      nonStreetRaces: driver.nonStreetPerformance.length,
      streetTrackCount: driver.streetTracks.size,
      streetPerformanceDelta,
      tyreWearRaces: driver.tyreWearRaces.size,
      tyreWearStints: driver.tyreWearStints,
      tyreCareRank,
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
      cleanRacing:
        cleanRacingRaces >= 3 &&
        driver.closeSectorOpportunities >= 10 &&
        cleanRacingQuality != null
          ? cleanRacingQuality
          : null,
      wetPerformance:
        driver.wetPerformance.length >= 3 &&
        driver.dryPerformance.length >= 5 &&
        wetPerformanceDelta != null
          ? wetPerformanceDelta
          : null,
      tyreCare:
        driver.tyreWearRaces.size >= 5 &&
        driver.tyreWearStints >= 10 &&
        tyreCareRank != null
          ? tyreCareRank
          : null,
      streetPerformance:
        driver.streetPerformance.length >= 3 &&
        driver.nonStreetPerformance.length >= 5 &&
        driver.streetTracks.size >= 2 &&
        streetPerformanceDelta != null
          ? streetPerformanceDelta
          : null,
      finish:
        driver.finishes.length >= 3 && averageNormalizedFinish != null
          ? 1 - averageNormalizedFinish
          : null,
    };

    return {
      card: card satisfies Omit<
        DriverDnaCard,
        | "style"
        | "matchKind"
        | "signatureFit"
        | "signatureConfidence"
        | "archetypeFits"
        | "supportingSignals"
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
        cleanRacingRaces,
        closeSectorOpportunities: driver.closeSectorOpportunities,
        onTrackOvertakes: driver.recordedOnTrackOvertakes,
        wetRaces: driver.wetPerformance.length,
        dryRaces: driver.dryPerformance.length,
        streetRaces: driver.streetPerformance.length,
        nonStreetRaces: driver.nonStreetPerformance.length,
        streetTracks: driver.streetTracks.size,
        tyreWearRaces: driver.tyreWearRaces.size,
        tyreWearStints: driver.tyreWearStints,
      },
    };
  });

  const ranks = percentileSignals(rawRows);
  return rawRows
    .map((row) => {
      const fits = fitStyles(row, ranks.get(row.card.key) ?? ({} as SignalSet));
      const signature = chooseSignature(
        row,
        fits,
        ranks.get(row.card.key) ?? ({} as SignalSet),
      );
      return { ...row.card, ...signature } satisfies DriverDnaCard;
    })
    .sort((a, b) => b.races - a.races || a.name.localeCompare(b.name));
}

export interface DriverDnaHistoryPoint {
  raceNumber: number;
  timestamp: number | null;
  file: string;
  track: string;
  style: DriverDnaStyle;
  fit: number | null;
  confidence: number | null;
  fits: Record<DriverDnaArchetype, number | null>;
}

const MAX_DRIVER_DNA_HISTORY_POINTS = 18;

/**
 * Rebuild the driver's cumulative archetype fits at evenly spaced race starts.
 * The current model compares each driver against everyone in the same window,
 * so every historical point is recalculated against that point's race field.
 */
export function buildDriverDnaHistory(
  races: LeagueRace[],
  targetDriverKey: string,
): DriverDnaHistoryPoint[] {
  const chronologicalRaces = races
    .filter((race) => isRaceSession(race.session))
    .map((race) => ({
      race,
      timestamp: raceDate(race.file)?.getTime() ?? null,
    }))
    .sort(
      (a, b) =>
        (a.timestamp ?? 0) - (b.timestamp ?? 0) ||
        a.race.file.localeCompare(b.race.file),
    );

  const targetRaceIndices = chronologicalRaces.flatMap(({ race }, index) => {
    const participated = (race.session["classification-data"] ?? []).some(
      (driver) =>
        isNamedDriver(driver) &&
        driverKey(driver["driver-name"]) === targetDriverKey,
    );
    return participated ? [index] : [];
  });
  if (!targetRaceIndices.length) return [];

  const sampledIndices =
    targetRaceIndices.length <= MAX_DRIVER_DNA_HISTORY_POINTS
      ? targetRaceIndices
      : Array.from(
          { length: MAX_DRIVER_DNA_HISTORY_POINTS },
          (_, sample) =>
            targetRaceIndices[
              Math.round(
                (sample * (targetRaceIndices.length - 1)) /
                  (MAX_DRIVER_DNA_HISTORY_POINTS - 1),
              )
            ],
        );

  return sampledIndices.flatMap((raceIndex) => {
    const { race, timestamp } = chronologicalRaces[raceIndex];
    const card = buildDriverDna(
      chronologicalRaces
        .slice(0, raceIndex + 1)
        .map(({ race: historicalRace }) => historicalRace),
    ).find((candidate) => candidate.key === targetDriverKey);
    if (!card) return [];

    const fits = Object.fromEntries(
      card.archetypeFits.map(({ style, fit }) => [style, fit]),
    ) as Record<DriverDnaArchetype, number | null>;
    const trackId = race.session["session-info"]?.["track-id"] ?? "";

    return [
      {
        raceNumber: card.races,
        timestamp,
        file: race.file,
        track: trackId ? getTrackDisplayName(trackId) : "Unknown circuit",
        style: card.style,
        fit: card.signatureFit,
        confidence: card.signatureConfidence,
        fits,
      },
    ];
  });
}
