import { ArrowUpRight, ShieldCheck, ShieldPlus, Sparkles, Swords, Users } from "lucide-react";
import { rankOf, type SafetyCategory, type SafetyDriver } from "../../league/safety";
import { best, HighlightGrid, useAwards, type Highlight } from "./HighlightCard";
import { awardHighlights } from "./LeagueHighlights";

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const count = (d: SafetyDriver, cat: SafetyCategory) =>
  d.sessions.filter((s) => s.items.some((i) => i.cat === cat && i.pts > 0)).length;
const points = (d: SafetyDriver, cat: SafetyCategory) =>
  d.sessions.reduce((n, s) => n + s.items.filter((i) => i.cat === cat && i.pts > 0).reduce((m, i) => m + i.pts, 0), 0);

export function SafetyHighlights({ drivers }: { drivers: SafetyDriver[] }) {
  const { data: awards } = useAwards();
  const items: Highlight[] = [];
  const top = best(drivers.filter((d) => !d.provisional), (d) => d.sr);
  if (top)
    items.push({ id: "top", title: "Safest Driver", icon: ShieldCheck, accent: "emerald", name: top.name, value: top.sr.toFixed(1), detail: `Highest safety rating · rank ${rankOf(top.sr).rank} · ${plural(top.races, "race")}` });
  const climb = best(drivers, (d) => d.change);
  if (climb)
    items.push({ id: "climb", title: "Biggest Climber", icon: ArrowUpRight, accent: "lime", name: climb.name, value: `+${climb.change.toFixed(1)}`, detail: "Most SR gained in the last stream" });
  const clean = best(drivers, (d) => count(d, "clean"));
  if (clean)
    items.push({ id: "clean", title: "Most Clean Races", icon: Sparkles, accent: "sky", name: clean.name, value: String(count(clean, "clean")), detail: `Clean races out of ${plural(clean.races, "race")}` });
  const close = best(drivers, (d) => points(d, "close"));
  if (close)
    items.push({ id: "close", title: "Wheel to Wheel", icon: Users, accent: "violet", name: close.name, value: `+${points(close, "close").toFixed(1)}`, detail: "Most SR from close racing without contact" });
  const passes = best(drivers, (d) => points(d, "overtakes"));
  if (passes)
    items.push({ id: "passes", title: "Clean Overtaker", icon: Swords, accent: "fuchsia", name: passes.name, value: `+${points(passes, "overtakes").toFixed(1)}`, detail: "Most SR from clean overtakes" });
  const role = awardHighlights(awards, ["clean"]).map((h) => ({ ...h, icon: ShieldPlus, accent: "amber" as const, detail: `${h.detail} · last ${awards?.streams.length ?? 5} streams` }));
  return (
    <HighlightGrid
      title="Highlights"
      hint="From every rated driver's races · GreMi doesn't count"
      items={[...items, ...role]}
    />
  );
}
