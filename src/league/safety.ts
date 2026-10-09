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
  | "clean"
  | "quali"
  | "overtakes"
  | "close"
  | "stream"
  | "staff";

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
}

export interface SafetySession {
  file: string;
  race: boolean;
  /** Index into SafetyData.streams. */
  stream: number;
  /** How much this session counts now (1, .75, .5 or .25; 0 when too old). */
  weight: number;
  total: number;
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
  /** SR lost so far to the top rule (10% of the part above 50 per stream). */
  aging?: number;
  history: { stream: number; date: string; sr: number; raced: boolean }[];
  sessions: SafetySession[];
  flags: string[];
}

export interface SafetyData {
  generated: string;
  streams: { date: string; files: string[] }[];
  drivers: SafetyDriver[];
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

export function safetyByKey(data: SafetyData | null): Map<string, SafetyDriver> {
  return new Map((data?.drivers ?? []).map((d) => [driverKey(d.name), d]));
}

export const signedHalf = (n: number) =>
  `${n > 0 ? "+" : n < 0 ? "−" : "±"}${Math.abs(n).toFixed(1)}`;

export const SAFETY_CATEGORIES: { cat: SafetyCategory; label: string }[] = [
  { cat: "contact", label: "Contacts" },
  { cat: "penalty", label: "Penalties" },
  { cat: "retirement", label: "Retirements" },
  { cat: "clean", label: "Clean races" },
  { cat: "quali", label: "Clean qualifying" },
  { cat: "overtakes", label: "Clean overtakes" },
  { cat: "close", label: "Close racing" },
  { cat: "stream", label: "Showing up" },
  { cat: "staff", label: "Staff decisions" },
];
