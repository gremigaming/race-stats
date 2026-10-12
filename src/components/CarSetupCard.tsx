import type { CarSetup } from "../types/telemetry";
import { CAR_SETUP_RANGES } from "../constants/setup";
import { formatSetupText } from "../analysis/shareText";
import { CopyButton } from "./ui/CopyButton";
import { Eyebrow } from "./ui/Eyebrow";
import { SectionHeader } from "./ui/SectionHeader";
import { HStack, VStack } from "./ui/Stack";

interface CarSetupCardProps {
  setup: CarSetup;
  /** Header text; the Discord setup pictures name the track and kind here. */
  title?: string;
  /** Pictures can't be clicked, so they leave out the copy button. */
  hideCopy?: boolean;
  /** Colour class of the value bars (the Discord pictures colour them per kind). */
  bar?: string;
}

const DEFAULT_BAR = "bg-blue-500/50";

function getRangePercent(key: string, value: number): number {
  const range = CAR_SETUP_RANGES[key];
  if (!range) return 50;
  const [min, max] = range;
  if (max === min) return 50;
  return Math.max(0, Math.min(100, ((value - min) / (max - min)) * 100));
}

function formatValue(key: string, value: number): string {
  if (key.includes("tyre-pressure")) return value.toFixed(1);
  if (key.includes("camber") || key.includes("toe"))
    return `${value.toFixed(1)}°`;
  if (
    ["on-throttle", "off-throttle", "brake-pressure", "brake-bias"].includes(
      key,
    )
  )
    return `${value}%`;
  return String(value);
}

function RangeBar({
  setupKey,
  value,
  bar,
}: {
  setupKey: string;
  value: number;
  bar: string;
}) {
  const pct = getRangePercent(setupKey, value);
  return (
    <div className="h-1.5 bg-zinc-800 rounded-full flex-1 min-w-[48px]">
      <div
        className={`h-full rounded-full ${bar}`}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

function SetupRow({
  label,
  setupKey,
  value,
  bar = DEFAULT_BAR,
}: {
  label: string;
  setupKey: string;
  value: number;
  bar?: string;
}) {
  return (
    <HStack className="gap-2 text-xs">
      <span className="text-zinc-500 w-20 shrink-0 truncate">{label}</span>
      <RangeBar setupKey={setupKey} value={value} bar={bar} />
      <span className="font-mono text-zinc-300 w-14 text-right shrink-0">
        {formatValue(setupKey, value)}
      </span>
    </HStack>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="mb-2">
        <Eyebrow className="text-zinc-400">{title}</Eyebrow>
      </div>
      <div className="space-y-1.5">{children}</div>
    </div>
  );
}

function TyrePressureCell({
  label,
  setupKey,
  value,
  bar = DEFAULT_BAR,
}: {
  label: string;
  setupKey: string;
  value: number;
  bar?: string;
}) {
  const pct = getRangePercent(setupKey, value);
  return (
    <VStack
      align="center"
      className="gap-1 rounded-lg bg-zinc-800/40 px-3 py-2.5"
    >
      <span className="font-mono text-2xs uppercase tracking-wider text-zinc-500">
        {label}
      </span>
      <span className="font-mono text-sm font-medium text-zinc-200">
        {value.toFixed(1)}
      </span>
      <div className="w-full h-1 bg-zinc-700/60 rounded-full">
        <div
          className={`h-full rounded-full ${bar}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </VStack>
  );
}

export function CarSetupCard({
  setup,
  title = "Car Setup",
  hideCopy = false,
  bar = DEFAULT_BAR,
}: CarSetupCardProps) {
  if (!setup["is-valid"]) return null;

  const allZero = Object.entries(setup).every(
    ([k, v]) => k === "is-valid" || v === 0,
  );
  if (allZero) return null;

  return (
    <div>
      {title && (
      <SectionHeader
        size="sm"
        title={title}
        className="mb-4"
        action={
          hideCopy ? undefined : (
            <CopyButton
              label="Copy setup"
              getText={() => formatSetupText(setup)}
              className="-my-1.5"
            />
          )
        }
      />
      )}
      <div
        className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-x-8 gap-y-5"
      >
        {/* Column 1: Aero + Transmission + Brakes */}
        <div className="space-y-5">
          <Section title="Aerodynamics">
            <SetupRow
              bar={bar}
              label="Front Wing"
              setupKey="front-wing"
              value={setup["front-wing"]}
            />
            <SetupRow
              bar={bar}
              label="Rear Wing"
              setupKey="rear-wing"
              value={setup["rear-wing"]}
            />
          </Section>

          <Section title="Transmission">
            <SetupRow
              bar={bar}
              label="On Throttle"
              setupKey="on-throttle"
              value={setup["on-throttle"]}
            />
            <SetupRow
              bar={bar}
              label="Off Throttle"
              setupKey="off-throttle"
              value={setup["off-throttle"]}
            />
          </Section>

          <Section title="Brakes">
            <SetupRow
              bar={bar}
              label="Pressure"
              setupKey="brake-pressure"
              value={setup["brake-pressure"]}
            />
            <SetupRow
              bar={bar}
              label="Bias"
              setupKey="brake-bias"
              value={setup["brake-bias"]}
            />
          </Section>
        </div>

        {/* Column 2: Suspension + Geometry */}
        <div className="space-y-5">
          <Section title="Suspension">
            <SetupRow
              bar={bar}
              label="Spring F"
              setupKey="front-suspension"
              value={setup["front-suspension"]}
            />
            <SetupRow
              bar={bar}
              label="Spring R"
              setupKey="rear-suspension"
              value={setup["rear-suspension"]}
            />
            <SetupRow
              bar={bar}
              label="ARB F"
              setupKey="front-anti-roll-bar"
              value={setup["front-anti-roll-bar"]}
            />
            <SetupRow
              bar={bar}
              label="ARB R"
              setupKey="rear-anti-roll-bar"
              value={setup["rear-anti-roll-bar"]}
            />
            <SetupRow
              bar={bar}
              label="Height F"
              setupKey="front-suspension-height"
              value={setup["front-suspension-height"]}
            />
            <SetupRow
              bar={bar}
              label="Height R"
              setupKey="rear-suspension-height"
              value={setup["rear-suspension-height"]}
            />
          </Section>

          <Section title="Geometry">
            <SetupRow
              bar={bar}
              label="Camber F"
              setupKey="front-camber"
              value={setup["front-camber"]}
            />
            <SetupRow
              bar={bar}
              label="Camber R"
              setupKey="rear-camber"
              value={setup["rear-camber"]}
            />
            <SetupRow
              bar={bar}
              label="Toe F"
              setupKey="front-toe"
              value={setup["front-toe"]}
            />
            <SetupRow
              bar={bar}
              label="Toe R"
              setupKey="rear-toe"
              value={setup["rear-toe"]}
            />
          </Section>
        </div>

        {/* Column 3: Tyre Pressures + Other */}
        <div className="space-y-5">
          <Section title="Tyre Pressures (psi)">
            <div className="grid grid-cols-2 gap-1.5">
              <TyrePressureCell
                bar={bar}
                label="FL"
                setupKey="front-left-tyre-pressure"
                value={setup["front-left-tyre-pressure"]}
              />
              <TyrePressureCell
                bar={bar}
                label="FR"
                setupKey="front-right-tyre-pressure"
                value={setup["front-right-tyre-pressure"]}
              />
              <TyrePressureCell
                bar={bar}
                label="RL"
                setupKey="rear-left-tyre-pressure"
                value={setup["rear-left-tyre-pressure"]}
              />
              <TyrePressureCell
                bar={bar}
                label="RR"
                setupKey="rear-right-tyre-pressure"
                value={setup["rear-right-tyre-pressure"]}
              />
            </div>
          </Section>
        </div>
      </div>
    </div>
  );
}
