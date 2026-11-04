import { driverKey } from "./league";

/**
 * GreMi Gang safety rating (SR). The numbers are worked out at build time by
 * scripts/safety_rating.py and published as league/safety.json; this file
 * only describes that data and the rank letters.
 */

export type SafetyCategory =
  | "contact"
  | "penalty"
  | "retirement"
  | "finish"
  | "clean"
  | "quali"
  | "overtakes"
  | "close"
  | "stream"
  | "staff";

/** The staff page; the flag on an incident opens its protest page. */
export const STAFF_URL = "https://104-154-182-45.sslip.io";

export interface SafetyItem {
  pts: number;
  text: string;
  lap: number | null;
  cat: SafetyCategory;
  id?: string;
  /** Set when staff changed or added this item: their reason. */
  staff?: string;
  /** The points before staff changed them. */
  orig?: number;
  /** Overhead replay of this contact: league/replays/<id>.json (scripts/telemetry/incident_replays.py). */
  replay?: string;
}

export interface SafetySession {
  file: string;
  race: boolean;
  /** Index into SafetyData.streams. */
  stream: number;
  /** How much this session counts now: 20% less for every 10 races you drove since (0 after 47). */
  weight: number;
  total: number;
  /** SR v2.2: half of this session's incident points, taken straight off the SR (fades like the race). */
  sting?: number;
  /** SR v2.2: what this session counts for. A race's bonus/incident/other include its qualifying (withQuali). */
  net?: number;
  bonus?: number;
  /** Bonus that counts (max 4 per race). */
  bonusCounted?: number;
  /** Incident penalty points (contacts, staff incident calls): half lowers the race, half is the sting. */
  incident?: number;
  /** Track limits, pit exit, retirements: count in full in the race. */
  other?: number;
  /** SR v2.5: penalty points this race counts for (with the SR-level and dirty-streak multipliers). */
  penalty?: number;
  /** SR v2.5: penalty points before the multipliers (race and its qualifying). */
  penaltyBase?: number;
  /** SR v2.5: penalty multiplier from your SR before the race (1.0 below 60 ... 2.0 at 100). */
  posMult?: number;
  /** SR v2.5: highest dirty-streak multiplier used in this race (1 = none). */
  streakMult?: number;
  /** SR v2.5: dirty race (1 big, 2 medium or 3 small incidents): no bonus. */
  dirty?: boolean;
  /** SR v2.5: share of the bonus cut at your SR (10% per 10 SR above 50). */
  bonusCut?: number;
  /** SR v2.5: gravity booked on this race (it ages out with it). */
  gravity?: number;
  /** Qualifying: its points join the next race. */
  carry?: boolean;
  withQuali?: boolean;
  items: SafetyItem[];
}

export interface SafetyDriver {
  name: string;
  sr: number;
  /** Change over the last stream. */
  change: number;
  races: number;
  provisional: boolean;
  banned: boolean;
  /** avg: average points per race the SR came from; streamAvg: points per race in that stream. */
  history: {
    stream: number;
    date: string;
    sr: number;
    raced: boolean;
    avg?: number;
    streamAvg?: number | null;
    /** SR v2.2: 50 + 25 x average, at most 100. */
    base?: number;
    /** SR v2.2: all your stings together after this stream (each fading as you race on). */
    sting?: number;
    /** SR v2.2: taken off for streams skipped (above 50 only). */
    drift?: number;
    /** SR v2.5: net score of this stream's races (bonus minus penalties). */
    net?: number;
    /** SR v2.5: gravity taken during this stream (joined and skipped races). */
    gravity?: number;
  }[];
  sessions: SafetySession[];
  flags: string[];
}

/** SR v2.5: how item points (stored on the v2.2 scale, which staff edit) are shown. */
export interface SafetyScale {
  bonus: number;
  other: number;
  /** v2.2 contact points -> v2.5 points */
  contact: Record<string, number>;
  contactElse: number;
}

export interface SafetyData {
  generated: string;
  streams: { date: string; files: string[] }[];
  drivers: SafetyDriver[];
  rules?: string;
  scale?: SafetyScale;
}

/** One item's points on the v2.5 scale (same as scripts/sr_v24.py v25_pts). */
export function scaledPts(pts: number, cat: string, sc: SafetyScale): number {
  if (pts > 0) return pts * sc.bonus;
  if (pts === 0) return 0;
  if (cat === "contact" || cat === "staff") {
    const one = sc.contact[String(-pts)];
    if (one != null) return -one;
    const two = sc.contact[String(-pts * 2)];
    if (two != null) return -two / 2;
    return pts * sc.contactElse;
  }
  return pts * sc.other;
}

/** Shows every item on the v2.5 scale when the data carries one (SR v2.5 live). */
export function applySafetyScale(data: SafetyData): SafetyData {
  const sc = data.scale;
  if (!sc) return data;
  for (const d of data.drivers)
    for (const s of d.sessions) {
      for (const it of s.items) {
        if (it.orig != null) it.orig = scaledPts(it.orig, it.cat, sc);
        it.pts = scaledPts(it.pts, it.cat, sc);
      }
      s.total = s.items.reduce((n, it) => n + it.pts, 0);
    }
  return data;
}

export const SR_START = 50;

export interface SrRank {
  rank: string;
  min: number;
  label: string;
  /** Text colour, its light shade, and the rgb triple for the tile tint. */
  color: string;
  light: string;
  rgb: string;
}

export const SR_RANKS: SrRank[] = [
  { rank: "S+", min: 100, label: "100", color: "#fcd34d", light: "#fef3c7", rgb: "252,211,77" },
  { rank: "S", min: 90, label: "90+", color: "#c084fc", light: "#f3e8ff", rgb: "192,132,252" },
  { rank: "A", min: 70, label: "70+", color: "#4ade80", light: "#dcfce7", rgb: "74,222,128" },
  { rank: "B", min: 50, label: "50+", color: "#facc15", light: "#fef9c3", rgb: "250,204,21" },
  { rank: "C", min: 40, label: "40+", color: "#fbbf24", light: "#fef3c7", rgb: "245,158,11" },
  { rank: "D", min: 30, label: "30+", color: "#fb923c", light: "#ffedd5", rgb: "251,146,60" },
  { rank: "E", min: 20, label: "20+", color: "#f87171", light: "#fee2e2", rgb: "248,113,113" },
  { rank: "F", min: -Infinity, label: "<20", color: "#dc2626", light: "#fca5a5", rgb: "220,38,38" },
];

export function rankOf(sr: number): SrRank {
  return SR_RANKS.find((r) => sr >= r.min) ?? SR_RANKS[SR_RANKS.length - 1];
}

/** A race you finished without losing a single point. */
export const isCleanRace = (s: SafetySession) =>
  s.race && s.items.some((i) => i.cat === "finish") && !s.items.some((i) => i.pts < 0);

export function safetyByKey(data: SafetyData | null): Map<string, SafetyDriver> {
  return new Map((data?.drivers ?? []).map((d) => [driverKey(d.name), d]));
}

export const signedHalf = (n: number) =>
  `${n > 0 ? "+" : n < 0 ? "−" : "±"}${Math.abs(n).toFixed(1)}`;

export const SAFETY_CATEGORIES: { cat: SafetyCategory; label: string }[] = [
  { cat: "contact", label: "Contacts" },
  { cat: "penalty", label: "Penalties" },
  { cat: "retirement", label: "Retirements" },
  { cat: "finish", label: "Finishing" },
  { cat: "clean", label: "Clean laps" },
  { cat: "quali", label: "Clean qualifying" },
  { cat: "overtakes", label: "Clean overtakes" },
  { cat: "close", label: "Close racing" },
  { cat: "stream", label: "Showing up" },
  { cat: "staff", label: "Staff decisions" },
];
