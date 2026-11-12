export type LeaderboardSeries = "f1-26" | "f1-25" | "f2";

export const LEADERBOARD_SERIES_OPTIONS: {
  value: LeaderboardSeries;
  label: string;
}[] = [
  { value: "f1-26", label: "F1 26" },
  { value: "f1-25", label: "F1 25" },
  { value: "f2", label: "F2" },
];

export function isLeaderboardSeries(
  value: string | null | undefined,
): value is LeaderboardSeries {
  return LEADERBOARD_SERIES_OPTIONS.some((option) => option.value === value);
}

export function leaderboardSeriesLabel(series: LeaderboardSeries): string {
  return (
    LEADERBOARD_SERIES_OPTIONS.find((option) => option.value === series)
      ?.label ?? series
  );
}

export function seriesForFormula(key: string): LeaderboardSeries | null {
  if (key === "f1-26") return "f1-26";
  if (key === "f1-25" || key === "f1-modern") return "f1-25";
  if (key.startsWith("f2")) return "f2";
  return null;
}
