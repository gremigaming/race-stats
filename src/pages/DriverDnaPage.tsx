import {
  ArrowLeft,
  ArrowUpRight,
  Crown,
  Flame,
  Flag,
  Gauge,
  Link2,
  Medal,
  Rocket,
  Search,
  ShieldCheck,
  Sparkles,
  Swords,
  Target,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { useMemo, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { accentCardClass, interactiveFocusClass } from "../components/Card";
import { CopyButton } from "../components/ui/CopyButton";
import { PageFrame } from "../components/ui/PageFrame";
import { PageHeader } from "../components/ui/PageHeader";
import { PillSelect } from "../components/ui/PillSelect";
import { SectionHeader } from "../components/ui/SectionHeader";
import { useTelemetry } from "../context/TelemetryContext";
import type { AccentColor } from "../constants/accents";
import {
  buildDriverDna,
  DRIVER_DNA_STYLES,
  type DriverDnaCard,
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
import { dashboardPath } from "../utils/routes";

type StyleFilter = "all" | DriverDnaStyle;

const STYLE_ICONS: Record<DriverDnaStyle, LucideIcon> = {
  comeback: Rocket,
  qualifying: Flag,
  consistency: Target,
  openingLap: Flame,
  overtakeArtist: Swords,
  podiumMagnet: Medal,
  fastestLapHunter: Zap,
  ironWill: ShieldCheck,
  paceSetter: Crown,
  allRounder: Sparkles,
  developing: Gauge,
};

const STYLE_ACCENTS: Record<DriverDnaStyle, AccentColor> = {
  comeback: "rose",
  qualifying: "amber",
  consistency: "cyan",
  openingLap: "orange",
  overtakeArtist: "emerald",
  podiumMagnet: "fuchsia",
  fastestLapHunter: "purple",
  ironWill: "sky",
  paceSetter: "lime",
  allRounder: "violet",
  developing: "zinc",
};

const SHARE_ACCENTS: Record<DriverDnaStyle, string> = {
  comeback: "#fb7185",
  qualifying: "#fbbf24",
  consistency: "#22d3ee",
  openingLap: "#fb923c",
  overtakeArtist: "#34d399",
  podiumMagnet: "#e879f9",
  fastestLapHunter: "#c084fc",
  ironWill: "#7dd3fc",
  paceSetter: "#a3e635",
  allRounder: "#c4b5fd",
  developing: "#a1a1aa",
};

const SIGNATURE_STYLES = (
  Object.keys(DRIVER_DNA_STYLES) as DriverDnaStyle[]
).filter((style) => style !== "allRounder" && style !== "developing");

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

function cardEvidence(card: DriverDnaCard): {
  primary: string;
  secondary: string;
} {
  switch (card.style) {
    case "comeback":
      return {
        primary: `${(card.averagePlacesGained ?? 0) > 0 ? "+" : ""}${(card.averagePlacesGained ?? 0).toFixed(1)} places`,
        secondary: `Grid ${formatPosition(card.averageGrid)} → finish ${formatPosition(card.averageFinish)}`,
      };
    case "qualifying":
      return {
        primary: formatPosition(card.averageGrid),
        secondary: `${Math.round((card.gridTopThirdShare ?? 0) * 100)}% of starts in the top third`,
      };
    case "consistency":
      return {
        primary: `±${(card.finishSwing ?? 0).toFixed(1)} spots`,
        secondary: `${plural(card.finishedRaces, "classified finish", "classified finishes")} · average ${formatPosition(card.averageFinish)}`,
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
        primary: `${Math.round((card.podiumRate ?? 0) * 100)}% podium rate`,
        secondary: `${plural(card.podiums, "podium")} in ${plural(card.finishedRaces, "classified finish", "classified finishes")}`,
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
    case "developing":
      return {
        primary: plural(card.races, "race counted", "races counted"),
        secondary: `${Math.max(0, 3 - card.races)} more ${card.races === 2 ? "race" : "races"} to reveal a signature`,
      };
    case "allRounder":
      return {
        primary: formatPosition(card.averageFinish),
        secondary: `${plural(card.finishedRaces, "classified finish", "classified finishes")} · ${card.points} points`,
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
  const supportingSignals = card.supportingSignals.map(
    (signal) =>
      `• **${signal.label}:** ${signal.value} · Top ${Math.max(1, 100 - Math.round(signal.percentile * 100))}%`,
  );

  return [
    `🏎️ **${escapeDiscordMarkdown(card.name)}** · **${style.label}**`,
    card.team ? `🏁 ${escapeDiscordMarkdown(card.team)}` : null,
    `_${style.tagline}_`,
    "",
    `📊 **${evidence.primary}**`,
    evidence.secondary,
    ...supportingSignals,
    card.signatureFit != null ? `**${card.signatureFit}% confidence**` : null,
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
  context.fillText(DRIVER_DNA_STYLES[card.style].label.toUpperCase(), 76, 128);

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
    DRIVER_DNA_STYLES[card.style].tagline,
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
    const signalWidth = (panelWidth - gap * (signals.length - 1)) / signals.length;
    signals.forEach((signal, index) => {
      const x = panelX + index * (signalWidth + gap);
      context.beginPath();
      context.roundRect(x, 466, signalWidth, 118, 14);
      context.fillStyle = "rgba(255, 255, 255, 0.045)";
      context.fill();

      context.fillStyle = "#858594";
      context.font = '600 12px "Geist Variable", system-ui, sans-serif';
      drawFittedText(context, signal.label.toUpperCase(), x + 16, 494, signalWidth - 32);
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
  if (card.signatureFit != null) {
    const raceLabelWidth = context.measureText(raceLabel).width;
    context.fillStyle = accent;
    context.fillText(
      `${card.signatureFit}% confidence`,
      panelX + raceLabelWidth + 22,
      footerY,
    );
  }
  context.textAlign = "right";
  context.fillStyle = "#858594";
  context.font = '600 13px "Geist Variable", system-ui, sans-serif';
  context.fillText("GREMI GAMING  ·  F1 LOBBY MANAGER", panelX + panelWidth, footerY);

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
  const [styleFilter, setStyleFilter] = useState<StyleFilter>("all");
  const [query, setQuery] = useState("");

  const sharedFilter = useMemo(
    () => parseSharedFilter(params.get("dnaFilter")),
    [params],
  );
  const allStreams = useMemo(
    () => buildStreams(league?.allRaces ?? []),
    [league?.allRaces],
  );
  const selectedFilter = sharedFilter ??
    league?.filter ?? { kind: "all" as const };
  const selectedRaces = useMemo(() => {
    if (!league) return [];
    if (!sharedFilter) return league.races;
    const files = allowedFiles(sharedFilter, league.allRaces, allStreams);
    return files
      ? league.allRaces.filter((race) => files.has(race.file))
      : league.allRaces;
  }, [league, sharedFilter, allStreams]);

  const formulaRaces = useMemo(
    () =>
      activeFormulaKey
        ? selectedRaces.filter(
            (race) => raceFormulaKey(race.session) === activeFormulaKey,
          )
        : selectedRaces,
    [selectedRaces, activeFormulaKey],
  );
  const cards = useMemo(() => buildDriverDna(formulaRaces), [formulaRaces]);
  const profileKey = params.get("profile");
  const profileCard = profileKey
    ? cards.find((card) => card.key === profileKey)
    : null;
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
    const counts = searchedCards.reduce<Partial<Record<DriverDnaStyle, number>>>(
      (result, card) => {
        result[card.style] = (result[card.style] ?? 0) + 1;
        return result;
      },
      {},
    );
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
            : "Every driver has a signature. See what their race starts, finishes, and first lap say about them."
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
          ) : undefined
        }
      />

      {!profileKey && (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <SectionHeader
            title="Racing signatures"
            hint={`${plural(visibleCards.length, "card")} shown · styles are earned from race data, not assigned by hand`}
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
            "grid grid-cols-1 gap-3 sm:grid-cols-2",
            profileCard && "mx-auto max-w-2xl",
          )}
        >
          {visibleCards.map((card) => (
            <DriverDnaTile
              key={card.key}
              card={card}
              filter={selectedFilter}
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

      {!profileCard && !profileKey && (
        <details className="group rounded-2xl border border-white/[0.06] bg-black/15 px-4 py-3">
          <summary className="cursor-pointer list-none text-sm font-medium text-zinc-300 marker:hidden">
            How a racing signature is earned
            <span className="float-right text-zinc-500 transition-transform group-open:rotate-180">
              ⌄
            </span>
          </summary>
          <div className="mt-3 grid gap-2 border-t border-white/[0.06] pt-3 text-xs leading-relaxed text-zinc-400 sm:grid-cols-2">
            {SIGNATURE_STYLES.map((style) => (
              <p key={style}>
                <strong className="text-zinc-200">
                  {DRIVER_DNA_STYLES[style].label}:
                </strong>{" "}
                {DRIVER_DNA_STYLES[style].criterion}
              </p>
            ))}
            <p className="sm:col-span-2">
              The page ranks available signals among drivers in the current
              game/date view, then blends them using each style's weights. A
              signature needs a fit of at least 64/100, a 4.5-point lead over
              the next style, and at least two signals above the 62nd peer
              percentile. Overtake Artist also requires its passing signal to
              rank above the 72nd percentile and six starts. Some other styles
              need four finishes, five starts, or three races with position
              history. The confidence figure is the style's relative, weighted
              composite fit, not a statistical probability; All-Rounder means
              no style stands out clearly.
            </p>
          </div>
        </details>
      )}
    </PageFrame>
  );
}

function DriverDnaTile({
  card,
  filter,
  onOpenStats,
}: {
  card: DriverDnaCard;
  filter: LeagueFilter;
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
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-zinc-400">
            {style.label}
          </p>
          <h2 className="mt-1 truncate text-xl font-bold tracking-tight text-zinc-50">
            {card.name}
          </h2>
          {card.team && (
            <p className="mt-0.5 truncate text-xs text-zinc-500">{card.team}</p>
          )}
        </div>
        <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-xl bg-black/20 ring-1 ring-inset ring-white/[0.08]">
          <Icon className="size-5 text-zinc-100" aria-hidden="true" />
        </span>
      </div>

      <p className="mt-4 max-w-md text-sm leading-relaxed text-zinc-300">
        {style.tagline}
      </p>

      <div className="mt-4 rounded-xl bg-black/20 px-3.5 py-3 ring-1 ring-inset ring-white/[0.06]">
        <p className="text-[10px] font-semibold uppercase tracking-[0.15em] text-zinc-500">
          The evidence
        </p>
        <p className="mt-1 font-mono text-lg font-semibold tabular-nums text-zinc-100">
          {evidence.primary}
        </p>
        <p className="mt-0.5 text-xs text-zinc-400">{evidence.secondary}</p>
        {card.supportingSignals.length > 0 && (
          <div className="mt-3 grid grid-cols-3 gap-1.5 border-t border-white/[0.06] pt-2.5">
            {card.supportingSignals.map((signal) => (
              <div
                key={signal.label}
                title={`${signal.value} · ${Math.round(signal.percentile * 100)}th percentile among drivers in this view`}
                className="min-w-0 rounded-lg bg-white/[0.035] px-2 py-1.5"
              >
                <p className="truncate text-[9px] font-semibold uppercase tracking-wide text-zinc-500">
                  {signal.label}
                </p>
                <p className="truncate text-[10px] font-medium text-zinc-200">
                  {signal.value}
                </p>
                <p className="font-mono text-[9px] tabular-nums text-zinc-500">
                  Top {Math.max(1, 100 - Math.round(signal.percentile * 100))}%
                </p>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="mt-auto flex flex-wrap items-center justify-between gap-3 pt-4">
        <span className="inline-flex flex-wrap items-center gap-x-1.5 font-mono text-[11px] tabular-nums text-zinc-500">
          {plural(card.races, "race counted", "races counted")}
          {card.signatureFit != null && (
            <>
              <span aria-hidden="true">·</span>
              <span
                className="text-cyan-300"
                title="Relative weighted fit for this archetype, not a statistical probability"
              >
                {card.signatureFit}% confidence
              </span>
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
            onClick={onOpenStats}
            className={cn(
              "inline-flex min-h-8 items-center gap-1.5 rounded-lg bg-white/[0.07] px-2.5 text-xs font-medium text-zinc-200 transition hover:bg-white/[0.12]",
              interactiveFocusClass,
            )}
          >
            Driver stats <ArrowUpRight className="size-3.5" />
          </button>
        </div>
      </div>
      <p className="sr-only">{style.criterion}</p>
    </article>
  );
}
