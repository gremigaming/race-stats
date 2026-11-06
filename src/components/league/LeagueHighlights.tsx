import { useMemo } from "react";
import {
  Award,
  Crown,
  HeartCrack,
  Medal,
  Repeat,
  Rocket,
  ShieldCheck,
  Swords,
  Timer,
  Trophy,
  Zap,
} from "lucide-react";
import { driverKey, type LeaderboardRow, type LeagueRace } from "../../league/league";
import { useLeagueCalls, type LeagueCall } from "../incidents/data";
import { best, HighlightGrid, isHost, useAwards, type AwardRow, type Highlight } from "./HighlightCard";

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const fileName = (file: string) => file.replace(/\\/g, "/").split("/").pop() ?? file;

/** Contacts where another driver was blamed and this driver was cleared. */
function takenOutCounts(races: LeagueRace[], calls: LeagueCall[] | undefined) {
  const selectedFiles = new Set(races.map((race) => fileName(race.file)));
  const counts = new Map<string, number>();
  for (const call of calls ?? []) {
    if (!selectedFiles.has(fileName(call.file))) continue;
    const lines = Object.entries(call.lines).map(([name, [points]]) => ({ key: driverKey(name), points }));
    const blamed = new Set(lines.filter((line) => line.points < 0).map((line) => line.key));
    if (!blamed.size) continue;
    for (const key of new Set(lines.filter((line) => line.points >= 0).map((line) => line.key))) {
      if (!blamed.has(key)) counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  return counts;
}

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

export function LeagueHighlights({ rows, races }: { rows: LeaderboardRow[]; races: LeagueRace[] }) {
  const { data: awards } = useAwards();
  const { data: calls } = useLeagueCalls();
  const takenOut = useMemo(() => takenOutCounts(races, calls), [races, calls]);
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
  const unlucky = best(rows, (r) => takenOut.get(r.key) ?? 0);
  if (unlucky)
    extra.push({
      id: "unlucky",
      title: "Most Unlucky",
      icon: HeartCrack,
      accent: "orange",
      name: unlucky.name,
      value: String(takenOut.get(unlucky.key) ?? 0),
      detail: `${plural(takenOut.get(unlucky.key) ?? 0, "collision")} where another driver was at fault · ${plural(unlucky.dnfs, "DNF")} in ${plural(unlucky.races, "race")}`,
    });
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
