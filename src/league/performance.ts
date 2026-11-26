/**
 * Performance Rating (PR): pace and racecraft per driver, 1.0 to 10.0.
 * Built by scripts/performance_rating.py and published as league/performance.json.
 * GreMi approved it on 25 Nov 2026 with the Hexagon emblem (Bronze/Silver/Gold I to III).
 * When PR and SR show together, the PR emblem always comes first.
 */
import { driverKey } from "./league";

export type PerfCategory =
  | "pace"
  | "onelap"
  | "consistency"
  | "overtaking"
  | "defending"
  | "awareness";

export interface PerfTell {
  kind: string;
  title: string;
  means: string;
  how: string;
}

export interface PerfDriver {
  name: string;
  pr: number;
  cat: Record<PerfCategory, number>;
  tells: PerfTell[];
  races: number;
  last: string;
  pace_gap: number;
  onelap_gap: number;
  onelap_src: "quali" | "best lap";
  cv: number;
  made: number;
  /** Quicker than a car that started ahead: chances, how many they got past, league-average expectation. */
  att_won: number;
  att_n: number;
  att_exp: number;
  /** Quicker car started behind them: chances, how many they kept behind, league-average expectation. */
  def_held: number;
  def_n: number;
  def_exp: number;
  cuts: number;
  lap1: number;
  trap: number;
  brake: number | null;
  steer: number | null;
  offs: number | null;
  tel_races: number;
  tel_km: number;
  recent: number | null;
  older: number | null;
}

export interface PerfData {
  version: number;
  built: string;
  since: string;
  races: number;
  min_races: number;
  active_days: number;
  weights: Record<PerfCategory, number>;
  field: {
    steer_rev_km: number | null;
    offs_per_10km: number | null;
    cuts: number | null;
    cv: number | null;
  };
  drivers: PerfDriver[];
  /** "a|b" (sorted names) -> [median lap-time gap b minus a in ms, races both finished] */
  pairs: Record<string, [number, number]>;
}

export type Metal = "Bronze" | "Silver" | "Gold";

export interface PerfRank {
  metal: Metal;
  numeral: "I" | "II" | "III";
  min: number;
  label: string;
}

/** Highest first. One rank per point: Bronze I under 2 up to Gold III at 9+. */
export const PR_RANKS: PerfRank[] = [
  { metal: "Gold", numeral: "III", min: 9, label: "9+" },
  { metal: "Gold", numeral: "II", min: 8, label: "8+" },
  { metal: "Gold", numeral: "I", min: 7, label: "7+" },
  { metal: "Silver", numeral: "III", min: 6, label: "6+" },
  { metal: "Silver", numeral: "II", min: 5, label: "5+" },
  { metal: "Silver", numeral: "I", min: 4, label: "4+" },
  { metal: "Bronze", numeral: "III", min: 3, label: "3+" },
  { metal: "Bronze", numeral: "II", min: 2, label: "2+" },
  { metal: "Bronze", numeral: "I", min: -Infinity, label: "under 2" },
];

export const METAL: Record<Metal, { hi: string; mid: string; lo: string; ink: string; bar: string }> = {
  Bronze: { hi: "#f6c7a1", mid: "#c9773f", lo: "#6e3714", ink: "#3a1a06", bar: "#e0894f" },
  Silver: { hi: "#ffffff", mid: "#b9c2cf", lo: "#5f6877", ink: "#252b35", bar: "#d4dbe5" },
  Gold: { hi: "#fff3b8", mid: "#e9b21c", lo: "#8a5a00", ink: "#4a2f00", bar: "#fbbf24" },
};

export function prRankOf(pr: number): PerfRank {
  return PR_RANKS.find((r) => pr >= r.min) ?? PR_RANKS[PR_RANKS.length - 1];
}

export const prRankName = (pr: number) => {
  const r = prRankOf(pr);
  return `${r.metal} ${r.numeral}`;
};

/**
 * Score colour on one scale (GreMi, 25 Nov 2026, "scale 1"): red and orange up to 6,
 * a long yellow middle, soft green from about 9.
 */
const SCORE_STOPS: [number, [number, number, number]][] = [
  [1, [217, 72, 59]],
  [4.5, [232, 116, 47]],
  [6, [233, 181, 42]],
  [7.5, [217, 207, 58]],
  [8.7, [143, 191, 74]],
  [10, [79, 157, 92]],
];

export function scoreColor(v: number): string {
  const x = Math.max(1, Math.min(10, v));
  for (let i = 1; i < SCORE_STOPS.length; i++) {
    const [a, ca] = SCORE_STOPS[i - 1];
    const [b, cb] = SCORE_STOPS[i];
    if (x <= b) {
      const t = (x - a) / (b - a);
      return `rgb(${ca.map((c, k) => Math.round(c + (cb[k] - c) * t)).join(",")})`;
    }
  }
  return "rgb(79,157,92)";
}

export const SCORE_GRADIENT = `linear-gradient(90deg,${SCORE_STOPS.map(
  ([v, c]) => `rgb(${c.join(",")}) ${(((v - 1) / 9) * 100).toFixed(1)}%`,
).join(",")})`;

/** Bar colour for a 1.0 to 10.0 score (its rank's metal). */
export const prColor = (v: number) => METAL[prRankOf(v).metal].bar;

export const PR_CATEGORIES: {
  key: PerfCategory;
  label: string;
  raw: (d: PerfDriver) => string;
}[] = [
  { key: "pace", label: "Race pace", raw: (d) => `+${d.pace_gap.toFixed(2)}% off the fastest` },
  {
    key: "onelap",
    label: "One lap",
    raw: (d) =>
      d.onelap_src === "quali"
        ? `+${d.onelap_gap.toFixed(2)}% off pole`
        : `+${d.onelap_gap.toFixed(2)}% off the fastest lap`,
  },
  { key: "consistency", label: "Consistency", raw: (d) => `${d.cv.toFixed(2)}% lap spread` },
  {
    key: "overtaking",
    label: "Overtaking",
    raw: (d) =>
      d.att_n === 0
        ? "no chances yet"
        : `got past ${d.att_won} of ${d.att_n} slower cars that started ahead (league average ${d.att_exp.toFixed(0)})`,
  },
  {
    key: "defending",
    label: "Defending",
    raw: (d) =>
      d.def_n === 0
        ? "no chances yet"
        : `kept ${d.def_held} of ${d.def_n} quicker cars that started behind (league average ${d.def_exp.toFixed(0)})`,
  },
  { key: "awareness", label: "Track discipline", raw: (d) => `${d.cuts.toFixed(1)} cut warnings a race` },
];

export const TELL_KIND: Record<string, string> = {
  brake: "Braking",
  steer: "Steering",
  offtrack: "Off track",
  speed: "Straight line",
  start: "Starts",
  defend: "Under pressure",
  limits: "Track limits",
  metronome: "Rhythm",
  variable: "Rhythm",
};

export function performanceByKey(data: PerfData | null): Map<string, PerfDriver> {
  return new Map((data?.drivers ?? []).map((d) => [driverKey(d.name), d]));
}

/** League position (1-based) of a driver in the PR ranking. */
export function prPosition(data: PerfData | null, name: string): number | null {
  const i = data?.drivers.findIndex((d) => d.name === name) ?? -1;
  return i >= 0 ? i + 1 : null;
}
