/**
 * Incident types for the incident viewer's markers and filters (GreMi, 5 Nov 2026), read from the
 * fault engine's verdict on each incident (rule + why, verdicts.py). Same idea as the staff page's
 * scripts/telemetry/incident_kinds.py kind_of, but from what a race manifest carries.
 */
import { MAJOR_SEVERITY, type RaceIncident } from "./format";

export type IncidentKind = "rear" | "lunge" | "side" | "block" | "rejoin" | "control" | "retaliation" | "racing" | "tap" | "contact";

export const KIND_META: Record<IncidentKind, { label: string; color: string; hint: string }> = {
  lunge: { label: "Divebomb", color: "#ff4d6d", hint: "Late lunge from behind, closing fast" },
  rear: { label: "Rear-end", color: "#ff9f43", hint: "Ran into the back of the car ahead" },
  side: { label: "Side contact", color: "#ffd166", hint: "Side by side and moved across into the other car" },
  block: { label: "Blocking", color: "#f472d0", hint: "The car ahead swept across into the car behind" },
  rejoin: { label: "Unsafe rejoin", color: "#4cc9f0", hint: "Came back onto the track into someone" },
  control: { label: "Lost control", color: "#9d8cff", hint: "Spin, slide or chain reaction" },
  retaliation: { label: "Retaliation", color: "#2ee6a6", hint: "Hit the same car again on purpose" },
  racing: { label: "Racing incident", color: "#cbd5e1", hint: "Nobody to blame" },
  tap: { label: "Tap", color: "#8a94a6", hint: "Light contact without consequences" },
  contact: { label: "Contact", color: "#a8b0bd", hint: "Not judged yet" },
};

export const KIND_ORDER: IncidentKind[] = ["lunge", "rear", "side", "block", "rejoin", "control", "retaliation", "racing", "tap", "contact"];

/** The type of an incident, from the rulebook's rule and its explanation. */
export function kindOf(inc: RaceIncident): IncidentKind {
  const v = inc.verdict;
  if (!v?.rule) return inc.kind === "tap" ? "tap" : "contact";
  const why = v.why ?? "";
  switch (v.rule) {
    case "R1":
    case "R6":
      return "tap";
    case "R5":
      return "rejoin";
    case "R9":
      return "retaliation";
    case "R10":
      return "rear";
    case "R4":
      return "control";
    case "R7":
      return /lost the car|slid or went off/.test(why) ? "control" : /aftermath/.test(why) ? "control" : "racing";
    case "R8":
      return "side";
    case "R2":
      return /swept/.test(why) ? "block" : v.at_fault === null || v.at_fault === undefined ? "racing" : "side";
    case "R3": {
      if (/hardly closing/.test(why) || v.at_fault === null || v.at_fault === undefined) return "racing";
      const kmh = Number(/closing at (\d+)/.exec(why)?.[1] ?? 0);
      return kmh >= 30 ? "lunge" : "rear";
    }
    default:
      return v.at_fault === null || v.at_fault === undefined ? "racing" : "rear";
  }
}

/** Severity 1..10: the fault engine's, else a guess for an incident it hasn't judged. */
export function severityOf(inc: RaceIncident): number {
  const s = inc.verdict?.severity;
  if (typeof s === "number") return kindOf(inc) === "tap" ? Math.min(s, 1) : s;
  if (inc.kind === "tap" || !Number.isFinite(inc.x)) return 1;
  return inc.drivers.some((d) => d.role !== "contact") ? MAJOR_SEVERITY : 3;
}

/** Cars the verdict blames (both for a shared call). */
export function atFaultOf(inc: RaceIncident): number[] {
  const v = inc.verdict;
  if (!v || v.at_fault === null || v.at_fault === undefined) return [];
  // a shared call (R8: both moved across) names one car; the other is the one it hit
  if (v.rule === "R8") {
    const c = inc.contacts.find((x) => x.a === v.at_fault || x.b === v.at_fault);
    if (c) return [c.a, c.b];
  }
  return [v.at_fault];
}

/** Everyone in the incident: contact cars first. */
export function carsOf(inc: RaceIncident): number[] {
  const out: number[] = [];
  for (const c of inc.contacts) for (const x of [c.a, c.b]) if (!out.includes(x)) out.push(x);
  for (const d of inc.drivers) if (!out.includes(d.car)) out.push(d.car);
  return out;
}

export const isTap = (inc: RaceIncident) => kindOf(inc) === "tap";
