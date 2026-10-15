import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { ACCENT_TOKENS, type AccentColor } from "../../constants/accents";
import { driverKey } from "../../league/league";
import { Badge } from "../ui/Badge";
import { InsightDetail, InsightValue } from "../ui/InsightText";
import { InsightTile } from "../ui/InsightTile";
import { SectionHeader } from "../ui/SectionHeader";
import { HStack } from "../ui/Stack";

export interface Highlight {
  id: string;
  title: string;
  icon: LucideIcon;
  accent: AccentColor;
  name: string;
  value: string;
  detail: string;
  badge?: string;
}

/** GreMi hosts the lobby, so like the award roles he never gets a highlight. */
export const isHost = (name: string) => driverKey(name) === "ttv/gremi_gaming";

/** The best driver by one number: highest first unless `low`. */
export function best<T extends { name: string }>(
  rows: T[],
  value: (r: T) => number | null | undefined,
  { low = false, min = 0 }: { low?: boolean; min?: number } = {},
): T | undefined {
  let top: T | undefined;
  let topV = 0;
  for (const r of rows) {
    const v = value(r);
    if (v == null || isHost(r.name) || !(v > min || (low && v >= min))) continue;
    if (!top || (low ? v < topV : v > topV)) {
      top = r;
      topV = v;
    }
  }
  return top;
}

export interface AwardRow {
  name: string;
  value: number;
  races: number;
  text: string;
}
export interface AwardsData {
  generated: string;
  streams: string[];
  awards: Partial<Record<"wins" | "fastest" | "dotd" | "overtakes" | "clean", AwardRow[]>>;
}

/** league/awards.json: the five Discord award roles over the last 5 streams. */
export function useAwards() {
  return useQuery({
    queryKey: ["league-awards"],
    queryFn: async () => {
      const r = await fetch(`${import.meta.env.BASE_URL}league/awards.json?t=${Date.now()}`, { cache: "no-store" });
      return r.ok ? ((await r.json()) as AwardsData) : null;
    },
    staleTime: 5 * 60 * 1000,
  });
}

export function HighlightCard({ h }: { h: Highlight }) {
  const tokens = ACCENT_TOKENS[h.accent];
  return (
    <InsightTile
      title={h.title}
      icon={h.icon}
      accent={h.accent}
      badge={
        h.badge ? (
          <Badge size="xs" shape="square" tone="zinc" className="tracking-wider">
            {h.badge}
          </Badge>
        ) : undefined
      }
      background={
        <h.icon
          className={`pointer-events-none absolute -right-2 top-1/2 size-28 -translate-y-1/2 opacity-[0.06] ${tokens.iconText}`}
        />
      }
    >
      <HStack justify="between" className="gap-3">
        <div className="min-w-0">
          <div className="truncate text-base font-semibold">{h.name}</div>
          <InsightDetail size="sm" tone="text-zinc-500" className="mt-1">
            {h.detail}
          </InsightDetail>
        </div>
        <InsightValue size="xl" tone={tokens.accent} className="shrink-0 text-right">
          {h.value}
        </InsightValue>
      </HStack>
    </InsightTile>
  );
}

export function HighlightGrid({ title, hint, items }: { title: string; hint: ReactNode; items: Highlight[] }) {
  if (!items.length) return null;
  return (
    <section>
      <SectionHeader title={title} hint={hint} />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {items.map((h) => (
          <HighlightCard key={h.id} h={h} />
        ))}
      </div>
    </section>
  );
}
