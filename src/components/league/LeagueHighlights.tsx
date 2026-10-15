import { Award, Crown, Medal, Rocket, ShieldCheck, Swords, Timer, Trophy, Zap, Repeat } from "lucide-react";
import type { LeaderboardRow } from "../../league/league";
import { best, HighlightGrid, isHost, useAwards, type AwardRow, type Highlight } from "./HighlightCard";

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** The five Discord award roles, as on the server: the best driver who isn't GreMi. */
const AWARDS: { key: "wins" | "fastest" | "dotd" | "overtakes" | "clean"; title: string; icon: Highlight["icon"]; accent: Highlight["accent"]; value: (r: AwardRow) => string }[] = [
  { key: "wins", title: "Most Wins", icon: Trophy, accent: "amber", value: (r) => String(r.value) },
  { key: "fastest", title: "Most Fastest Laps", icon: Zap, accent: "violet", value: (r) => String(r.value) },
  { key: "dotd", title: "Driver of the Day", icon: Crown, accent: "orange", value: (r) => `${Math.round(r.value * 100)}` },
  { key: "overtakes", title: "Most Overtakes", icon: Swords, accent: "emerald", value: (r) => String(r.value) },
  { key: "clean", title: "Cleanest Driver", icon: ShieldCheck, accent: "sky", value: (r) => r.value.toFixed(1) },
];

export function awardHighlights(awards: ReturnType<typeof useAwards>["data"], keys = AWARDS.map((a) => a.key)): Highlight[] {
  if (!awards) return [];
  return AWARDS.filter((a) => keys.includes(a.key)).flatMap((a) => {
    const ranking = (awards.awards[a.key] ?? []).filter((r) => !isHost(r.name));
    const [top, next] = ranking;
    if (!top) return [];
    const detail = a.key === "dotd" ? `All-round: quick, clean and racing often · ${plural(top.races, "race")}` : `${top.text}${a.key === "clean" ? "" : ` in ${plural(top.races, "race")}`}`;
    return [{
      id: `award-${a.key}`,
      title: a.title,
      icon: a.icon,
      accent: a.accent,
      name: top.name,
      value: a.value(top),
      detail: next ? `${detail} · next: ${next.name}` : detail,
      badge: "ROLE",
    }];
  });
}

export function LeagueHighlights({ rows }: { rows: LeaderboardRow[] }) {
  const { data: awards } = useAwards();
  const items = awardHighlights(awards);
  const extra: Highlight[] = [];
  const poles = best(rows, (r) => r.poles);
  if (poles)
    extra.push({ id: "poles", title: "Pole King", icon: Timer, accent: "cyan", name: poles.name, value: String(poles.poles), detail: `${plural(poles.poles, "pole")} in ${plural(poles.races, "race")}` });
  const podiums = best(rows, (r) => r.podiums);
  if (podiums)
    extra.push({ id: "podiums", title: "Podium Machine", icon: Medal, accent: "fuchsia", name: podiums.name, value: String(podiums.podiums), detail: `${plural(podiums.podiums, "podium")} in ${plural(podiums.races, "race")}` });
  const gain = best(rows.filter((r) => r.races >= 3), (r) => r.avgGain);
  if (gain?.avgGain != null)
    extra.push({ id: "gain", title: "Comeback King", icon: Rocket, accent: "lime", name: gain.name, value: `+${gain.avgGain.toFixed(1)}`, detail: `Places gained per race on average · ${plural(gain.races, "race")}` });
  const ppr = best(rows.filter((r) => r.races >= 3), (r) => r.points / r.races);
  if (ppr)
    extra.push({ id: "ppr", title: "Points per Race", icon: Award, accent: "rose", name: ppr.name, value: (ppr.points / ppr.races).toFixed(1), detail: `${ppr.points} points in ${plural(ppr.races, "race")}` });
  const iron = best(rows, (r) => r.races);
  if (iron)
    extra.push({ id: "iron", title: "Iron Man", icon: Repeat, accent: "sky", name: iron.name, value: String(iron.races), detail: `Most races driven · ${plural(iron.dnfs, "DNF")}` });
  return (
    <div id="league-highlights" className="space-y-8">
      <HighlightGrid
        title="Award roles"
        hint={`The Discord award roles · last ${awards?.streams.length ?? 5} streams · GreMi doesn't count`}
        items={items}
      />
      <HighlightGrid title="Highlights" hint="For the games and dates picked above · GreMi doesn't count · min. 3 races for averages" items={extra} />
    </div>
  );
}
