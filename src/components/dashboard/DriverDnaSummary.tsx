import { Dna } from "lucide-react";
import { useMemo } from "react";
import { Link } from "react-router-dom";
import { buildDriverDna, DRIVER_DNA_STYLES } from "../../analysis/driverDna";
import { useTelemetry } from "../../context/TelemetryContext";
import { raceFormulaKey } from "../../league/league";
import { cn } from "../../utils/cn";
import { driverDnaProfilePath } from "../../utils/routes";
import { interactiveFocusClass } from "../Card";

export function DriverDnaSummary() {
  const { league, scopeKey, activeFormulaKey } = useTelemetry();
  const leagueRaces = league?.races;
  const selectedDriverKey = league?.selectedDriver;
  const races = useMemo(
    () =>
      leagueRaces
        ? activeFormulaKey
          ? leagueRaces.filter(
              (race) => raceFormulaKey(race.session) === activeFormulaKey,
            )
          : leagueRaces
        : [],
    [activeFormulaKey, leagueRaces],
  );
  const card = useMemo(
    () =>
      selectedDriverKey
        ? buildDriverDna(races).find(
            (candidate) => candidate.key === selectedDriverKey,
          )
        : undefined,
    [races, selectedDriverKey],
  );

  if (!league || !card) return null;

  const style = DRIVER_DNA_STYLES[card.style];
  const confidence = card.signatureConfidence;

  return (
    <Link
      to={driverDnaProfilePath(scopeKey, card.key)}
      className={cn(
        "flex max-w-full items-center gap-3 rounded-xl bg-zinc-900/70 px-3 py-2 transition-colors hover:bg-zinc-900",
        interactiveFocusClass,
      )}
      title={`${card.name} · ${style.label}. Open Driver DNA fit history.`}
      aria-label={`Open ${card.name}'s Driver DNA detail page, ${style.label}${confidence == null ? "" : `, ${confidence}% confidence`}`}
    >
      <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-cyan-400/20 to-violet-500/10 text-cyan-200 ring-1 ring-inset ring-white/[0.07]">
        <Dna className="size-[18px]" aria-hidden="true" />
      </span>
      <span className="min-w-0 leading-tight">
        <span className="block truncate text-sm font-bold text-zinc-100">
          {style.label}
        </span>
        <span className="block text-[11px] text-zinc-500">
          Driver DNA
          {confidence != null
            ? ` · ${confidence}% confidence`
            : " · Building profile"}
        </span>
      </span>
    </Link>
  );
}
