import {
  ArrowLeft,
  ArrowUpRight,
  BarChart3,
  CloudRain,
  CircleHelp,
  Crown,
  Flame,
  Flag,
  Gauge,
  Link2,
  MapPin,
  Medal,
  Rocket,
  Search,
  Shield,
  ShieldCheck,
  Sparkles,
  Swords,
  Target,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { useMemo, useState } from "react";
import {
  Link,
  useLocation,
  useNavigate,
  useSearchParams,
} from "react-router-dom";
import { accentCardClass, interactiveFocusClass } from "../components/Card";
import { ArchetypeFitHistory } from "../components/dna/ArchetypeFitHistory";
import { DriverDnaArchetypeRadar } from "../components/dna/DriverDnaArchetypeRadar";
import { CopyButton } from "../components/ui/CopyButton";
import { Modal } from "../components/ui/Modal";
import { PageFrame } from "../components/ui/PageFrame";
import { PageHeader } from "../components/ui/PageHeader";
import { PillSelect } from "../components/ui/PillSelect";
import { SectionHeader } from "../components/ui/SectionHeader";
import { useTelemetry } from "../context/TelemetryContext";
import type { AccentColor } from "../constants/accents";
import {
  buildDriverDna,
  buildDriverDnaHistory,
  DRIVER_DNA_STYLES,
  formatDriverDnaFieldPercentile,
  type DriverDnaCard,
  type DriverDnaSignal,
  type DriverDnaStyle,
} from "../analysis/driverDna";
import {
  allowedFiles,
  buildStreams,
  describeFilter,
  type LeagueFilter,
} from "../league/filter";
import { isRaceSession, raceFormulaKey } from "../league/league";
import { cn } from "../utils/cn";
import {
  isLeaderboardSeries,
  leaderboardSeriesLabel,
  seriesForFormula,
} from "../utils/leaderboardSeries";
import {
  dashboardPath,
  driverDnaLeaderboardIndexPath,
  driverDnaLeaderboardPath,
} from "../utils/routes";

type StyleFilter = "all" | DriverDnaStyle;

const STYLE_ICONS: Record<DriverDnaStyle, LucideIcon> = {
  comeback: Rocket,
  qualifying: Crown,
  mrSaturday: Flag,
  consistency: Target,
  openingLap: Flame,
  overtakeArtist: Swords,
  podiumMagnet: Medal,
  fastestLapHunter: Zap,
  ironWill: ShieldCheck,
  paceSetter: Crown,
  cleanDuelist: Shield,
  rainMaster: CloudRain,
  tyreWhisperer: Gauge,
  streetCircuitSpecialist: MapPin,
  allRounder: Sparkles,
  noSignature: CircleHelp,
  developing: Gauge,
};

const STYLE_ACCENTS: Record<DriverDnaStyle, AccentColor> = {
  comeback: "rose",
  qualifying: "amber",
  mrSaturday: "purple",
  consistency: "cyan",
  openingLap: "orange",
  overtakeArtist: "emerald",
  podiumMagnet: "fuchsia",
  fastestLapHunter: "purple",
  ironWill: "sky",
  paceSetter: "lime",
  cleanDuelist: "cyan",
  rainMaster: "sky",
  tyreWhisperer: "amber",
  streetCircuitSpecialist: "fuchsia",
  allRounder: "violet",
  noSignature: "zinc",
  developing: "zinc",
};

const SHARE_ACCENTS: Record<DriverDnaStyle, string> = {
  comeback: "#fb7185",
  qualifying: "#fbbf24",
  mrSaturday: "#c084fc",
  consistency: "#22d3ee",
  openingLap: "#fb923c",
  overtakeArtist: "#34d399",
  podiumMagnet: "#e879f9",
  fastestLapHunter: "#c084fc",
  ironWill: "#7dd3fc",
  paceSetter: "#a3e635",
  cleanDuelist: "#67e8f9",
  rainMaster: "#38bdf8",
  tyreWhisperer: "#fbbf24",
  streetCircuitSpecialist: "#e879f9",
  allRounder: "#c4b5fd",
  noSignature: "#a1a1aa",
  developing: "#a1a1aa",
};

type SignatureStyle = Exclude<DriverDnaStyle, "noSignature" | "developing">;

const SIGNATURE_STYLES = (
  Object.keys(DRIVER_DNA_STYLES) as DriverDnaStyle[]
).filter(
  (style): style is SignatureStyle =>
    style !== "noSignature" && style !== "developing",
);

const REAL_F1_EXAMPLES: Record<SignatureStyle, string> = {
  comeback: "Sebastian Vettel, Lewis Hamilton, Fernando Alonso",
  qualifying: "Charles Leclerc, George Russell, Sebastian Vettel",
  mrSaturday:
    "Ayrton Senna, Lewis Hamilton, Michael Schumacher, Charles Leclerc",
  consistency: "Alain Prost, Lewis Hamilton, Jenson Button",
  openingLap: "Kevin Magnussen, Fernando Alonso, Max Verstappen",
  overtakeArtist: "Daniel Ricciardo, Max Verstappen, Kamui Kobayashi",
  podiumMagnet: "Lewis Hamilton, Michael Schumacher, Sebastian Vettel",
  fastestLapHunter: "Michael Schumacher, Lewis Hamilton, Kimi Räikkönen",
  ironWill: "Fernando Alonso, Lewis Hamilton, Michael Schumacher",
  paceSetter: "Max Verstappen, Sebastian Vettel, Lewis Hamilton",
  cleanDuelist: "Jenson Button, Mika Häkkinen, Fernando Alonso",
  rainMaster:
    "Ayrton Senna, Michael Schumacher, Lewis Hamilton, Max Verstappen",
  tyreWhisperer: "Jenson Button, Lewis Hamilton, Sergio Pérez",
  streetCircuitSpecialist: "Ayrton Senna, Sergio Pérez, Charles Leclerc",
  allRounder: "Fernando Alonso, Alain Prost, Lewis Hamilton",
};

const plural = (value: number, singular: string, pluralForm = `${singular}s`) =>
  `${value} ${value === 1 ? singular : pluralForm}`;

function parseSharedFilter(value: string | null): LeagueFilter | null {
  if (!value) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== "object" || !("kind" in parsed))
      return null;
    const filter = parsed as Record<string, unknown>;
    switch (filter.kind) {
      case "today":
      case "week":
      case "month":
      case "year":
      case "all":
        return { kind: filter.kind };
      case "streams":
        return filter.count === 1 || filter.count === 3
          ? { kind: "streams", count: filter.count }
          : null;
      case "stream":
        return typeof filter.id === "string" && filter.id.length <= 64
          ? { kind: "stream", id: filter.id }
          : null;
      case "custom":
        return typeof filter.from === "string" &&
          typeof filter.to === "string" &&
          /^\d{4}-\d{2}-\d{2}$/.test(filter.from) &&
          /^\d{4}-\d{2}-\d{2}$/.test(filter.to)
          ? { kind: "custom", from: filter.from, to: filter.to }
          : null;
      default:
        return null;
    }
  } catch {
    return null;
  }
}

function formatPosition(value: number | null): string {
  return value == null ? "—" : `P${value.toFixed(1)}`;
}

function formatPositionWithFieldPercentile(
  position: number | null,
  percentile: number | null,
): string {
  return position == null
    ? "—"
    : `${formatPosition(position)} · ${formatDriverDnaFieldPercentile(percentile)}`;
}

function cardEvidence(card: DriverDnaCard): {
  primary: string;
  secondary: string;
} {
  switch (card.style) {
    case "comeback":
      return {
        primary: `${(card.averagePlacesGained ?? 0) > 0 ? "+" : ""}${(card.averagePlacesGained ?? 0).toFixed(1)} places`,
        secondary: `Grid ${formatPositionWithFieldPercentile(card.averageGrid, card.averageGridFieldPercentile)} → finish ${formatPositionWithFieldPercentile(card.averageFinish, card.averageFinishFieldPercentile)}`,
      };
    case "qualifying":
      return {
        primary: formatPositionWithFieldPercentile(
          card.averageGrid,
          card.averageGridFieldPercentile,
        ),
        secondary: `${Math.round((card.gridTopThirdShare ?? 0) * 100)}% of starts in the top third`,
      };
    case "mrSaturday":
      return {
        primary: `Average qualifying position ${formatPositionWithFieldPercentile(card.averageQualifyingPosition, card.averageQualifyingFieldPercentile)}`,
        secondary: `Top ${Math.max(1, 100 - Math.round((card.qualifyingPaceRank ?? 0) * 100))}% qualifying pace · ${plural(card.qualifyingPoleCount, "pole")} in ${plural(card.qualifyingPositionSessions, "qualifying result")}`,
      };
    case "consistency":
      return {
        primary: `±${(card.finishSwing ?? 0).toFixed(1)} spots`,
        secondary: `${plural(card.finishedRaces, "classified finish", "classified finishes")} · average ${formatPositionWithFieldPercentile(card.averageFinish, card.averageFinishFieldPercentile)}`,
      };
    case "openingLap":
      return {
        primary: `${(card.openingLapPlacesGained ?? 0) > 0 ? "+" : ""}${(card.openingLapPlacesGained ?? 0).toFixed(1)} places`,
        secondary: `Gained places in ${Math.round((card.openingLapPositiveShare ?? 0) * 100)}% of recorded lap ones`,
      };
    case "overtakeArtist":
      return {
        primary: `${(card.averageOvertakes ?? 0).toFixed(1)} passes / race`,
        secondary: `${card.totalOvertakes} recorded passes across ${plural(card.races, "race")}`,
      };
    case "podiumMagnet":
      return {
        primary: `${Math.round((card.podiumStrength ?? 0) * 100)}% field-adjusted podium strength`,
        secondary: `${plural(card.podiums, "podium")} · ${Math.round((card.podiumRate ?? 0) * 100)}% raw rate across ${plural(card.finishedRaces, "classified finish", "classified finishes")}`,
      };
    case "fastestLapHunter":
      return {
        primary: `${Math.round((card.fastestLapRate ?? 0) * 100)}% fastest-lap rate`,
        secondary: `${plural(card.fastestLapCount, "fastest lap")} in ${plural(card.races, "start")}`,
      };
    case "ironWill":
      return {
        primary: `${Math.round((card.finishRate ?? 0) * 100)}% finish rate`,
        secondary: `Classified in ${card.finishedRaces} of ${card.races} starts`,
      };
    case "paceSetter":
      return {
        primary: `${card.lapsLed} / ${card.recordedPositionSamples} laps led`,
        secondary: `${Math.round((card.lapsLedShare ?? 0) * 100)}% of recorded race laps`,
      };
    case "cleanDuelist":
      return {
        primary: `${(card.cleanCloseSectorsPerRace ?? 0).toFixed(1)} clean close sectors / race`,
        secondary: `${Math.round((card.cleanCloseShare ?? 0) * 100)}% of close sectors stayed clean · ${card.cleanOvertakes} clean passes`,
      };
    case "rainMaster": {
      const delta = card.wetPerformanceDelta ?? 0;
      return {
        primary: `${delta > 0 ? "+" : ""}${Math.round(delta * 100)} race-performance points`,
        secondary: `${plural(card.wetRaces, "wet race")} · compared with ${plural(card.dryRaces, "dry race", "dry races")}`,
      };
    }
    case "tyreWhisperer":
      return {
        primary: `${(card.tyreWearPercentPerLap ?? 0).toFixed(2)}% worst-wheel wear / lap`,
        secondary: `Top ${Math.max(1, 100 - Math.round((card.tyreCareRank ?? 0) * 100))}% among same-race, same-compound peers · ${plural(card.tyreWearLaps, "measured lap")} over ${plural(card.tyreWearRaces, "race")}`,
      };
    case "streetCircuitSpecialist": {
      const delta = card.streetPerformanceDelta ?? 0;
      return {
        primary: `${delta > 0 ? "+" : ""}${Math.round(delta * 100)} race-performance points`,
        secondary: `${plural(card.streetRaces, "street race")} across ${plural(card.streetTrackCount, "circuit")} · compared with ${plural(card.nonStreetRaces, "other race")}`,
      };
    }
    case "developing":
      return {
        primary: plural(card.races, "race counted", "races counted"),
        secondary:
          "More race data is needed for a reliable multi-signal style fit",
      };
    case "allRounder":
      return {
        primary: "Balanced across three areas",
        secondary: "Above-peer pace, racecraft, and results",
      };
    case "noSignature":
      return {
        primary: "No usable style signals",
        secondary: "More race data is needed to find a supported archetype",
      };
  }
}

function dnaShareUrl(card: DriverDnaCard, filter: LeagueFilter): string {
  const url = new URL(window.location.href);
  url.search = "";
  url.searchParams.set("profile", card.key);
  // The app reads `driver` on first load; this opens the shared card with its
  // driver's data selected too.
  url.searchParams.set("driver", card.key);
  url.searchParams.set("dnaFilter", JSON.stringify(filter));
  url.searchParams.set("embed", "");
  return url.toString();
}

function escapeDiscordMarkdown(value: string): string {
  return value.replace(/([\\*_~`|])/g, "\\$1");
}

function discordShareText(card: DriverDnaCard, shareUrl: string): string {
  const style = DRIVER_DNA_STYLES[card.style];
  const evidence = cardEvidence(card);
  const tagline =
    card.matchKind === "developing" && card.style !== "developing"
      ? `Early data points toward this style. ${style.tagline}`
      : style.tagline;
  const supportingSignals = card.supportingSignals.map(
    (signal) =>
      `• **${signal.label}:** ${signal.value} · Top ${Math.max(1, 100 - Math.round(signal.percentile * 100))}%`,
  );

  return [
    `🏎️ **${escapeDiscordMarkdown(card.name)}** · **${style.label}**`,
    card.team ? `🏁 ${escapeDiscordMarkdown(card.team)}` : null,
    `_${tagline}_`,
    "",
    `📊 **${evidence.primary}**`,
    evidence.secondary,
    ...supportingSignals,
    card.signatureConfidence != null
      ? `**${card.signatureConfidence}% confidence**`
      : card.signatureFit != null
        ? `**${card.signatureFit}% weighted fit**`
        : null,
    plural(card.races, "race counted", "races counted"),
    "",
    shareUrl,
  ]
    .filter((line): line is string => line != null)
    .join("\n");
}

function drawFittedText(
  context: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
) {
  if (context.measureText(text).width <= maxWidth) {
    context.fillText(text, x, y, maxWidth);
    return;
  }
  let fitted = text;
  while (
    fitted.length > 0 &&
    context.measureText(`${fitted}…`).width > maxWidth
  ) {
    fitted = fitted.slice(0, -1);
  }
  context.fillText(
    fitted === text ? text : `${fitted.trimEnd()}…`,
    x,
    y,
    maxWidth,
  );
}

async function createDriverDnaPng(card: DriverDnaCard): Promise<Blob | null> {
  await document.fonts.ready;
  const signals = card.supportingSignals.slice(0, 3);
  const height = signals.length ? 720 : 590;
  const canvas = document.createElement("canvas");
  canvas.width = 1200;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) return null;

  const accent = SHARE_ACCENTS[card.style];
  const cardX = 32;
  const cardY = 32;
  const cardWidth = 1136;
  const cardHeight = height - 64;
  const panelX = 64;
  const panelWidth = 1072;
  const background = context.createLinearGradient(
    cardX,
    cardY,
    cardX + cardWidth,
    cardY + cardHeight,
  );
  background.addColorStop(0, "#17151a");
  background.addColorStop(1, "#0c0d11");

  context.beginPath();
  context.roundRect(cardX, cardY, cardWidth, cardHeight, 28);
  context.fillStyle = background;
  context.fill();
  context.save();
  context.beginPath();
  context.roundRect(cardX, cardY, cardWidth, cardHeight, 28);
  context.clip();
  const glow = context.createRadialGradient(1060, 80, 10, 1060, 80, 480);
  glow.addColorStop(0, `${accent}2b`);
  glow.addColorStop(1, `${accent}00`);
  context.fillStyle = glow;
  context.fillRect(cardX, cardY, cardWidth, cardHeight);
  context.restore();
  context.beginPath();
  context.roundRect(cardX, cardY, cardWidth, cardHeight, 28);
  context.strokeStyle = `${accent}55`;
  context.lineWidth = 1.5;
  context.stroke();

  context.textAlign = "left";
  context.textBaseline = "alphabetic";
  context.fillStyle = "#a1a1aa";
  context.font = '600 14px "Geist Variable", system-ui, sans-serif';
  context.fillText("GREMI GAMING  ·  DRIVER DNA", 76, 76);

  context.fillStyle = accent;
  context.font = '700 16px "Geist Variable", system-ui, sans-serif';
  const imageStyleLabel =
    card.matchKind === "developing" && card.style !== "developing"
      ? `IN THE MAKING  ·  ${DRIVER_DNA_STYLES[card.style].label.toUpperCase()}`
      : DRIVER_DNA_STYLES[card.style].label.toUpperCase();
  context.fillText(imageStyleLabel, 76, 128);

  context.fillStyle = "#fafafa";
  context.font = '700 48px "Geist Variable", system-ui, sans-serif';
  drawFittedText(context, card.name, 76, 187, 1030);

  context.fillStyle = "#858594";
  context.font = '400 20px "Geist Variable", system-ui, sans-serif';
  drawFittedText(context, card.team, 76, 218, 1030);

  context.fillStyle = "#e4e4e7";
  context.font = '400 22px "Geist Variable", system-ui, sans-serif';
  drawFittedText(
    context,
    card.matchKind === "developing" && card.style !== "developing"
      ? `Early data points toward this style. ${DRIVER_DNA_STYLES[card.style].tagline}`
      : DRIVER_DNA_STYLES[card.style].tagline,
    76,
    267,
    1030,
  );

  const evidence = cardEvidence(card);
  context.beginPath();
  context.roundRect(panelX, 298, panelWidth, 150, 18);
  context.fillStyle = "rgba(0, 0, 0, 0.34)";
  context.fill();
  context.strokeStyle = "rgba(255, 255, 255, 0.08)";
  context.lineWidth = 1;
  context.stroke();

  context.fillStyle = "#858594";
  context.font = '600 12px "Geist Variable", system-ui, sans-serif';
  context.fillText("THE EVIDENCE", 88, 326);
  context.fillStyle = "#fafafa";
  context.font = '700 36px "iA Writer Quattro", ui-monospace, monospace';
  drawFittedText(context, evidence.primary, 88, 383, 1016);
  context.fillStyle = "#a1a1aa";
  context.font = '400 16px "Geist Variable", system-ui, sans-serif';
  drawFittedText(context, evidence.secondary, 88, 416, 1016);

  if (signals.length) {
    const gap = 12;
    const signalWidth =
      (panelWidth - gap * (signals.length - 1)) / signals.length;
    signals.forEach((signal, index) => {
      const x = panelX + index * (signalWidth + gap);
      context.beginPath();
      context.roundRect(x, 466, signalWidth, 118, 14);
      context.fillStyle = "rgba(255, 255, 255, 0.045)";
      context.fill();

      context.fillStyle = "#858594";
      context.font = '600 12px "Geist Variable", system-ui, sans-serif';
      drawFittedText(
        context,
        signal.label.toUpperCase(),
        x + 16,
        494,
        signalWidth - 32,
      );
      context.fillStyle = "#f4f4f5";
      context.font = '600 18px "Geist Variable", system-ui, sans-serif';
      drawFittedText(context, signal.value, x + 16, 526, signalWidth - 32);
      context.fillStyle = "#858594";
      context.font = '400 13px "Geist Variable", system-ui, sans-serif';
      context.fillText(
        `Top ${Math.max(1, 100 - Math.round(signal.percentile * 100))}%`,
        x + 16,
        556,
      );
    });
  }

  const footerY = height - 64;
  context.beginPath();
  context.moveTo(panelX, footerY - 40);
  context.lineTo(panelX + panelWidth, footerY - 40);
  context.strokeStyle = "rgba(255, 255, 255, 0.09)";
  context.lineWidth = 1;
  context.stroke();

  context.fillStyle = "#858594";
  context.font = '400 15px "iA Writer Quattro", ui-monospace, monospace';
  const raceLabel = plural(card.races, "race counted", "races counted");
  context.fillText(raceLabel, panelX, footerY);
  const shownScore = card.signatureConfidence ?? card.signatureFit;
  if (shownScore != null) {
    const raceLabelWidth = context.measureText(raceLabel).width;
    context.fillStyle = accent;
    const fitLabel =
      card.signatureConfidence != null ? "confidence" : "weighted fit";
    context.fillText(
      `${shownScore}% ${fitLabel}`,
      panelX + raceLabelWidth + 22,
      footerY,
    );
  }
  context.textAlign = "right";
  context.fillStyle = "#858594";
  context.font = '600 13px "Geist Variable", system-ui, sans-serif';
  context.fillText(
    "GREMI GAMING  ·  F1 LOBBY MANAGER",
    panelX + panelWidth,
    footerY,
  );

  return new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
}

async function copyDriverDnaPng(
  card: DriverDnaCard,
  shareText: string,
): Promise<boolean> {
  if (!navigator.clipboard?.write || typeof ClipboardItem === "undefined") {
    return false;
  }
  const image = createDriverDnaPng(card).then((blob) => {
    if (!blob) throw new Error("Could not render the Driver DNA card image.");
    return blob;
  });
  const clipboardItem = new ClipboardItem({
    "image/png": image,
    "text/plain": new Blob([shareText], { type: "text/plain" }),
  });
  await navigator.clipboard.write([clipboardItem]);
  return true;
}

export function DriverDnaPage() {
  const { league, scopeKey, activeFormulaKey, activeFormula } = useTelemetry();
  const [params] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  const dnaSeriesParam = params.get("dnaSeries");
  const dnaSeries = isLeaderboardSeries(dnaSeriesParam) ? dnaSeriesParam : null;
  const [styleFilter, setStyleFilter] = useState<StyleFilter>("all");
  const [query, setQuery] = useState("");
  const [fitModalCard, setFitModalCard] = useState<DriverDnaCard | null>(null);

  const sharedFilter = useMemo(
    () => parseSharedFilter(params.get("dnaFilter")),
    [params],
  );
  const allStreams = useMemo(
    () => buildStreams(league?.allRaces ?? []),
    [league?.allRaces],
  );
  const leagueRaces = league?.races;
  const allLeagueRaces = league?.allRaces;
  const selectedFilter = sharedFilter ??
    league?.filter ?? { kind: "all" as const };
  const selectedRaces = useMemo(() => {
    if (!leagueRaces) return [];
    if (!sharedFilter) return leagueRaces;
    const races = allLeagueRaces ?? leagueRaces;
    const files = allowedFiles(sharedFilter, races, allStreams);
    return files ? races.filter((race) => files.has(race.file)) : races;
  }, [allLeagueRaces, leagueRaces, sharedFilter, allStreams]);

  const formulaRaces = useMemo(
    () =>
      activeFormulaKey
        ? selectedRaces.filter(
            (race) => raceFormulaKey(race.session) === activeFormulaKey,
          )
        : dnaSeries
          ? selectedRaces.filter(
              (race) =>
                seriesForFormula(raceFormulaKey(race.session)) === dnaSeries,
            )
          : selectedRaces,
    [selectedRaces, activeFormulaKey, dnaSeries],
  );
  const cards = useMemo(() => buildDriverDna(formulaRaces), [formulaRaces]);
  const profileKey = params.get("profile");
  const profileCard = profileKey
    ? cards.find((card) => card.key === profileKey)
    : null;
  const profileHistory = useMemo(
    () => (profileKey ? buildDriverDnaHistory(formulaRaces, profileKey) : []),
    [formulaRaces, profileKey],
  );
  const search = query.trim().toLocaleLowerCase();
  const searchedCards = useMemo(
    () =>
      search
        ? cards.filter(
            (card) =>
              card.name.toLocaleLowerCase().includes(search) ||
              card.team.toLocaleLowerCase().includes(search),
          )
        : cards,
    [cards, search],
  );
  const styleOptions = useMemo(() => {
    const counts = searchedCards.reduce<
      Partial<Record<DriverDnaStyle, number>>
    >((result, card) => {
      result[card.style] = (result[card.style] ?? 0) + 1;
      return result;
    }, {});
    return [
      { value: "all" as const, label: `All styles (${searchedCards.length})` },
      ...(Object.keys(DRIVER_DNA_STYLES) as DriverDnaStyle[]).map((value) => ({
        value,
        label: `${DRIVER_DNA_STYLES[value].label} (${counts[value] ?? 0})`,
      })),
    ];
  }, [searchedCards]);
  const visibleCards = profileKey
    ? profileCard
      ? [profileCard]
      : []
    : searchedCards.filter(
        (card) => styleFilter === "all" || card.style === styleFilter,
      );

  if (!league) {
    return (
      <PageFrame>
        <section className="rounded-2xl bg-zinc-900/70 p-5 text-sm text-zinc-400">
          Driver DNA needs the league race data.
        </section>
      </PageFrame>
    );
  }

  const formulaLabel = activeFormulaKey
    ? (activeFormula?.label ?? activeFormulaKey)
    : dnaSeries
      ? leaderboardSeriesLabel(dnaSeries)
      : "All games";
  const raceCount = formulaRaces.filter((race) =>
    isRaceSession(race.session),
  ).length;
  const titleMeta = `${formulaLabel} · ${sharedFilter ? describeFilter(sharedFilter, allStreams) : league.filterLabel} · ${plural(cards.length, "driver card")} · ${plural(raceCount, "race")}`;
  const browseAllCards = () => {
    const next = new URLSearchParams(location.search);
    next.delete("profile");
    next.delete("driver");
    next.delete("embed");
    navigate(`${location.pathname}${next.size ? `?${next.toString()}` : ""}`);
  };
  const openDriverDnaProfile = (driverKey: string) => {
    const next = new URLSearchParams(location.search);
    next.set("profile", driverKey);
    next.delete("embed");
    navigate(`${location.pathname}?${next.toString()}`);
  };
  const openSignalLeaderboard = (signal: DriverDnaSignal) => {
    const next = new URLSearchParams(location.search);
    next.delete("profile");
    next.delete("driver");
    next.delete("embed");
    if (activeFormulaKey) next.delete("dnaSeries");
    const path = driverDnaLeaderboardPath(scopeKey, signal);
    navigate(`${path}${next.size ? `?${next.toString()}` : ""}`);
  };
  const leaderboardParams = new URLSearchParams(location.search);
  leaderboardParams.delete("profile");
  leaderboardParams.delete("driver");
  leaderboardParams.delete("embed");
  if (activeFormulaKey) leaderboardParams.delete("dnaSeries");
  const leaderboardIndexHref = `${driverDnaLeaderboardIndexPath(scopeKey)}${leaderboardParams.size ? `?${leaderboardParams.toString()}` : ""}`;

  return (
    <PageFrame
      className={
        params.has("embed")
          ? "max-w-5xl space-y-5 p-4 sm:p-6 lg:px-6"
          : undefined
      }
    >
      <PageHeader
        icon={Sparkles}
        eyebrow="Drivers"
        title={profileCard ? `${profileCard.name} · Driver DNA` : "Driver DNA"}
        description={
          profileCard
            ? "A playful racing style, with the race data behind it."
            : "See each driver's primary racing style, confidence, and the data behind every archetype."
        }
        meta={titleMeta}
        action={
          profileKey ? (
            <button
              type="button"
              onClick={browseAllCards}
              className={cn(
                "inline-flex min-h-9 items-center gap-2 rounded-xl border border-white/[0.08] bg-black/20 px-3 text-xs font-medium text-zinc-300 transition hover:border-white/[0.16] hover:bg-white/[0.05] hover:text-white",
                interactiveFocusClass,
              )}
            >
              <ArrowLeft className="size-3.5" /> Browse cards
            </button>
          ) : (
            <Link
              to={leaderboardIndexHref}
              className={cn(
                "inline-flex min-h-9 items-center gap-2 rounded-xl border border-white/[0.08] bg-black/20 px-3 text-xs font-medium text-zinc-300 transition hover:border-white/[0.16] hover:bg-white/[0.05] hover:text-white",
                interactiveFocusClass,
              )}
            >
              <BarChart3 className="size-3.5" /> Stat leaderboards
            </Link>
          )
        }
      />

      {!profileCard && !profileKey && (
        <details className="group rounded-2xl border border-white/[0.06] bg-black/15 px-4 py-3">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-sm font-medium text-zinc-300 marker:hidden">
            <span>How a racing signature is earned</span>
            <span className="inline-flex shrink-0 items-center gap-2">
              <span className="hidden text-xs font-normal text-zinc-500 sm:inline">
                Scoring method and F1 examples
              </span>
              <span className="text-zinc-500 transition-transform group-open:rotate-180">
                ⌄
              </span>
            </span>
          </summary>
          <div className="mt-3 border-t border-white/[0.06] pt-3">
            <p className="mb-3 text-xs leading-relaxed text-zinc-500">
              Real F1 names are illustrative parallels, not part of the
              game-data scoring. Drivers can be examples of more than one style.
            </p>
            <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
              {SIGNATURE_STYLES.map((style) => (
                <article
                  key={style}
                  className="rounded-xl bg-white/[0.025] px-3 py-2.5 text-xs leading-relaxed text-zinc-400"
                >
                  <p>
                    <strong className="text-zinc-200">
                      {DRIVER_DNA_STYLES[style].label}:
                    </strong>{" "}
                    {DRIVER_DNA_STYLES[style].criterion}
                  </p>
                  <p className="mt-1.5 text-[11px] text-zinc-500">
                    {REAL_F1_EXAMPLES[style]}
                  </p>
                </article>
              ))}
            </div>
            <p className="mt-3 border-t border-white/[0.06] pt-3 text-xs leading-relaxed text-zinc-400">
              The page compares multiple race signals with every archetype's
              weighted profile, including qualifying data for Mr. Saturday. A
              signature also needs enough starts and data, a meaningful defining
              stat, a strong peer rank, at least three strong signals, and a
              clear lead over the next style. The highest weighted style becomes
              the driver's archetype; weaker defining stats reduce its fit score
              directly. Front-Runner, for example, is penalized when a driver
              leads only a small share of recorded laps. All-Rounder enters the
              comparison only when pace, racecraft, and results are all strong,
              and its fit is within five points of the strongest specialist. The
              fit breakdown lists every style and which core criteria each one
              meets. Confidence combines fit, separation, defining-stat
              strength, supporting signals, and sample size; it is a model
              score, not a statistical probability. Clean Combatant compares
              close sectors, the share of close sectors without a logged
              collision or penalty, and clean overtakes. Rain Master and Street
              Circuit Specialist compare a driver's race-field performance with
              their own baseline in dry weather or on other circuits. Tire
              Whisperer estimates wear per lap from the recorded wear curve,
              then compares only drivers using the same compound in the same
              race. Mr. Saturday combines qualifying lap pace, qualifying
              positions, and poles, with at least five qualifying sessions
              required. A podium earns a weight of one minus three divided by
              field size (zero in fields of three or fewer), averaged across
              classified finishes. Position evidence pairs the raw average with
              its average field percentile: 100% is first and 0% is last.
            </p>
          </div>
        </details>
      )}

      {!profileKey && (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <SectionHeader
            title="Racing signatures"
            hint={`${plural(visibleCards.length, "card")} shown · archetypes are scored from multiple race and qualifying signals`}
            className="mb-0"
          />
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex min-h-9 w-full items-center gap-2 rounded-xl border border-white/[0.08] bg-black/20 px-3 text-zinc-500 sm:w-52">
              <Search className="size-3.5 shrink-0" aria-hidden="true" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Find a driver"
                aria-label="Find a driver"
                className="min-w-0 flex-1 bg-transparent text-xs text-zinc-100 placeholder:text-zinc-500 focus:outline-none"
              />
            </label>
            <PillSelect
              ariaLabel="Filter driver styles"
              value={styleFilter}
              onChange={(value) => setStyleFilter(value as StyleFilter)}
              options={styleOptions}
              size="sm"
            />
          </div>
        </div>
      )}

      {profileKey && !profileCard ? (
        <section className="rounded-2xl bg-zinc-900/70 p-6 text-center">
          <Sparkles className="mx-auto size-7 text-violet-300" />
          <h2 className="mt-3 font-semibold text-zinc-100">
            This card isn’t in the selected race window
          </h2>
          <p className="mt-1 text-sm text-zinc-400">
            The shared card may be from a different game or date range.
          </p>
          <button
            type="button"
            onClick={browseAllCards}
            className="mt-4 rounded-xl bg-white/[0.07] px-3 py-2 text-sm text-zinc-200 hover:bg-white/[0.1]"
          >
            Browse available cards
          </button>
        </section>
      ) : visibleCards.length ? (
        <div
          className={cn(
            "grid grid-cols-1 gap-3",
            !profileCard && "sm:grid-cols-2",
          )}
        >
          {visibleCards.map((card) => (
            <DriverDnaTile
              key={card.key}
              card={card}
              filter={selectedFilter}
              profileLayout={Boolean(profileCard)}
              onShowFits={() => setFitModalCard(card)}
              onOpenProfile={() => openDriverDnaProfile(card.key)}
              onOpenLeaderboard={openSignalLeaderboard}
              onOpenStats={() => {
                league.setSelectedDriver(card.key);
                navigate(dashboardPath(scopeKey));
              }}
            />
          ))}
        </div>
      ) : (
        <section className="rounded-2xl bg-zinc-900/70 p-6 text-center">
          <Sparkles className="mx-auto size-7 text-violet-300" />
          <h2 className="mt-3 font-semibold text-zinc-100">
            {cards.length
              ? "No drivers match those filters"
              : "No racing signatures yet"}
          </h2>
          <p className="mt-1 text-sm text-zinc-400">
            {cards.length
              ? "Try another style or search for a different driver."
              : "Driver cards appear when race results are available for this game and date range."}
          </p>
        </section>
      )}

      {profileCard && (
        <DriverDnaArchetypeRadar
          fits={profileCard.archetypeFits}
          currentStyle={profileCard.style}
        />
      )}

      {profileCard && (
        <ArchetypeFitHistory
          key={profileCard.key}
          points={profileHistory}
          currentStyle={profileCard.style}
        />
      )}

      {fitModalCard && (
        <DriverDnaFitModal
          card={fitModalCard}
          onClose={() => setFitModalCard(null)}
        />
      )}
    </PageFrame>
  );
}

function DriverDnaFitModal({
  card,
  onClose,
}: {
  card: DriverDnaCard;
  onClose: () => void;
}) {
  const fits = [...card.archetypeFits].sort(
    (a, b) => (b.fit ?? -1) - (a.fit ?? -1),
  );

  return (
    <Modal
      onClose={onClose}
      ariaLabelledBy="driver-dna-fit-title"
      ariaDescribedBy="driver-dna-fit-description"
      className="max-h-[min(86vh,760px)] max-w-xl overflow-hidden"
    >
      <div className="border-b border-white/[0.07] px-5 pb-4 pt-5 sm:px-6">
        <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-cyan-300">
          Driver DNA breakdown
        </p>
        <h2
          id="driver-dna-fit-title"
          className="mt-1 pr-8 text-xl font-bold text-zinc-50"
        >
          {card.name}&apos;s archetype fits
        </h2>
        <p
          id="driver-dna-fit-description"
          className="mt-1 text-xs leading-relaxed text-zinc-400"
        >
          Each score blends peer-ranked race signals with that style&apos;s
          defining-stat strength. Scores are independent fits, not
          probabilities, so they do not add to 100%.
        </p>
      </div>
      <div className="min-h-0 overflow-y-auto px-5 py-4 sm:px-6">
        <div className="space-y-3">
          {fits.map((fit) => {
            const style = DRIVER_DNA_STYLES[fit.style];
            const Icon = STYLE_ICONS[fit.style];
            const isAssigned = card.style === fit.style;
            const status = !fit.hasEnoughStarts
              ? "Needs more starts"
              : fit.style === "allRounder"
                ? fit.qualifies
                  ? "Balanced profile qualifies"
                  : "Needs strength across all three areas"
                : !fit.meetsDefiningStat
                  ? "Defining stat below minimum"
                  : !fit.hasEnoughSignals
                    ? "Not enough measured signals"
                    : isAssigned && card.matchKind === "signature"
                      ? "Signature criteria met"
                      : isAssigned
                        ? card.matchKind === "developing"
                          ? "Early archetype"
                          : "Primary archetype"
                        : "Core criteria met";

            return (
              <div
                key={fit.style}
                className={cn(
                  "rounded-xl border px-3.5 py-3",
                  isAssigned
                    ? "border-cyan-300/25 bg-cyan-300/[0.05]"
                    : "border-white/[0.06] bg-black/15",
                )}
              >
                <div className="flex items-center gap-3">
                  <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg bg-white/[0.04] text-zinc-300">
                    <Icon className="size-4" aria-hidden="true" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-3">
                      <p className="truncate text-sm font-semibold text-zinc-100">
                        {style.label}
                        {isAssigned && (
                          <span className="ml-2 text-[10px] font-medium uppercase tracking-wide text-cyan-300">
                            Current
                          </span>
                        )}
                      </p>
                      <span className="shrink-0 font-mono text-sm tabular-nums text-zinc-200">
                        {fit.fit == null ? "—" : `${fit.fit}%`}
                      </span>
                    </div>
                    <div
                      className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/[0.08]"
                      role="meter"
                      aria-label={`${style.label} weighted fit`}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-valuenow={fit.fit ?? 0}
                    >
                      <div
                        className={cn(
                          "h-full rounded-full transition-[width]",
                          isAssigned ? "bg-cyan-300" : "bg-zinc-400/70",
                        )}
                        style={{ width: `${fit.fit ?? 0}%` }}
                      />
                    </div>
                    <p className="mt-1.5 text-[11px] text-zinc-500">{status}</p>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
      <div className="border-t border-white/[0.07] px-5 py-3 text-[11px] text-zinc-500 sm:px-6">
        Based on {plural(card.races, "race counted", "races counted")} in this
        game and date view.
      </div>
    </Modal>
  );
}

function DriverDnaTile({
  card,
  filter,
  profileLayout = false,
  onShowFits,
  onOpenProfile,
  onOpenLeaderboard,
  onOpenStats,
}: {
  card: DriverDnaCard;
  filter: LeagueFilter;
  profileLayout?: boolean;
  onShowFits: () => void;
  onOpenProfile: () => void;
  onOpenLeaderboard: (signal: DriverDnaSignal) => void;
  onOpenStats: () => void;
}) {
  const style = DRIVER_DNA_STYLES[card.style];
  const Icon = STYLE_ICONS[card.style];
  const accent = STYLE_ACCENTS[card.style];
  const evidence = cardEvidence(card);
  const shareUrl = dnaShareUrl(card, filter);
  const shareText = discordShareText(card, shareUrl);

  return (
    <article
      className={cn(
        accentCardClass(accent),
        "relative isolate flex h-full flex-col overflow-hidden rounded-2xl p-5",
      )}
    >
      <Icon
        aria-hidden="true"
        className="pointer-events-none absolute -right-3 -top-4 -z-10 size-36 opacity-[0.07]"
        strokeWidth={1.1}
      />
      <div
        className={cn(
          profileLayout &&
            "grid gap-5 md:grid-cols-[minmax(0,0.9fr)_minmax(0,1.4fr)] md:items-center md:gap-8",
        )}
      >
        <div>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-zinc-400">
                {card.matchKind === "developing" && card.style !== "developing"
                  ? `In the Making · ${style.label}`
                  : style.label}
              </p>
              <h2 className="mt-1 truncate text-xl font-bold tracking-tight text-zinc-50">
                {card.name}
              </h2>
              {card.team && (
                <p className="mt-0.5 truncate text-xs text-zinc-500">
                  {card.team}
                </p>
              )}
            </div>
            <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-xl bg-black/20 ring-1 ring-inset ring-white/[0.08]">
              <Icon className="size-5 text-zinc-100" aria-hidden="true" />
            </span>
          </div>

          <p className="mt-4 max-w-md text-sm leading-relaxed text-zinc-300">
            {card.matchKind === "developing" && card.style !== "developing"
              ? `Early data points toward this style. ${style.tagline}`
              : style.tagline}
          </p>
        </div>

        <div
          className={cn(
            "mt-4 rounded-xl bg-black/20 px-3.5 py-3 ring-1 ring-inset ring-white/[0.06]",
            profileLayout && "md:mt-0",
          )}
        >
          <p className="text-[10px] font-semibold uppercase tracking-[0.15em] text-zinc-500">
            The evidence
          </p>
          <p className="mt-1 font-mono text-lg font-semibold tabular-nums text-zinc-100">
            {evidence.primary}
          </p>
          <p className="mt-0.5 text-xs text-zinc-400">{evidence.secondary}</p>
          {card.supportingSignals.length > 0 && (
            <div
              className={cn(
                "mt-3 grid gap-1.5 border-t border-white/[0.06] pt-2.5",
                profileLayout ? "grid-cols-2 md:grid-cols-3" : "grid-cols-3",
              )}
            >
              {card.supportingSignals.map((signal) => (
                <button
                  key={signal.signal}
                  type="button"
                  onClick={() => onOpenLeaderboard(signal.signal)}
                  aria-label={`Open ${signal.label} leaderboard`}
                  title={`${signal.value} · ${Math.round(signal.percentile * 100)}th percentile among drivers in this view`}
                  className="group min-w-0 rounded-lg bg-white/[0.035] px-2 py-1.5 text-left transition-colors hover:bg-white/[0.08] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300"
                >
                  <span className="flex items-center justify-between gap-1">
                    <span className="truncate text-[9px] font-semibold uppercase tracking-wide text-zinc-500 transition-colors group-hover:text-zinc-300">
                      {signal.label}
                    </span>
                    <ArrowUpRight className="size-3 shrink-0 text-zinc-600 opacity-0 transition group-hover:opacity-100 group-focus-visible:opacity-100" />
                  </span>
                  <p className="truncate text-[10px] font-medium text-zinc-200">
                    {signal.value}
                  </p>
                  <p className="font-mono text-[9px] tabular-nums text-zinc-500">
                    Top {Math.max(1, 100 - Math.round(signal.percentile * 100))}
                    %
                  </p>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="mt-auto flex flex-wrap items-center justify-between gap-3 pt-4">
        <span className="inline-flex flex-wrap items-center gap-x-1.5 font-mono text-[11px] tabular-nums text-zinc-500">
          {plural(card.races, "race counted", "races counted")}
          {(card.signatureConfidence ?? card.signatureFit) != null && (
            <>
              <span aria-hidden="true">·</span>
              <button
                type="button"
                onClick={onShowFits}
                aria-haspopup="dialog"
                className="rounded-sm text-cyan-300 underline decoration-cyan-300/30 underline-offset-2 transition hover:text-cyan-200 hover:decoration-cyan-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300"
                title="Open the fit breakdown for every archetype"
                aria-label={`Open archetype fit breakdown for ${card.name}`}
              >
                {card.signatureConfidence != null
                  ? `${card.signatureConfidence}% confidence`
                  : `${card.signatureFit}% fit`}
              </button>
            </>
          )}
        </span>
        <div className="flex items-center gap-1.5">
          <CopyButton
            label="Copy PNG card for Discord"
            getText={() => shareText}
            onCopy={() => copyDriverDnaPng(card, shareText)}
            className="size-8 text-zinc-400 hover:bg-white/[0.08] hover:text-zinc-100"
          />
          <CopyButton
            label="Copy direct card link"
            getText={() => shareUrl}
            icon={Link2}
            className="size-8 text-zinc-400 hover:bg-white/[0.08] hover:text-zinc-100"
          />
          <button
            type="button"
            onClick={profileLayout ? onOpenStats : onOpenProfile}
            className={cn(
              "inline-flex min-h-8 items-center gap-1.5 rounded-lg bg-white/[0.07] px-2.5 text-xs font-medium text-zinc-200 transition hover:bg-white/[0.12]",
              interactiveFocusClass,
            )}
          >
            {profileLayout ? "Driver stats" : "View profile"}{" "}
            <ArrowUpRight className="size-3.5" />
          </button>
        </div>
      </div>
      <p className="sr-only">{style.criterion}</p>
    </article>
  );
}
