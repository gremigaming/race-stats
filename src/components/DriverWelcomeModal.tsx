import { ArrowRight, UserRound } from "lucide-react";
import { useCallback, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useTelemetry } from "../context/TelemetryContext";
import {
  LEAGUE_DRIVER_ONBOARDING_STORAGE_KEY,
  LEAGUE_DRIVER_STORAGE_KEY,
} from "../constants/storage";
import { readStoredBoolean, readStoredString, writeStoredBoolean } from "../utils/storage";
import { DriverSearchSelect } from "./DriverSearchSelect";
import { Modal } from "./ui/Modal";

export function DriverWelcomeModal() {
  const { mode, league } = useTelemetry();
  const [, setSearchParams] = useSearchParams();
  const [dismissed, setDismissed] = useState(() =>
    readStoredBoolean(LEAGUE_DRIVER_ONBOARDING_STORAGE_KEY),
  );
  const [selectedDriver, setSelectedDriver] = useState("");
  const pendingChoice = useRef<string | null>(null);
  const drivers = useMemo(
    () => [...(league?.drivers ?? [])].sort((a, b) => a.name.localeCompare(b.name)),
    [league?.drivers],
  );

  const savedDriver = readStoredString(LEAGUE_DRIVER_STORAGE_KEY);
  const hasSavedDriver = drivers.some((driver) => driver.key === savedDriver);
  const visible =
    mode === "league" &&
    drivers.length > 0 &&
    !dismissed &&
    !hasSavedDriver;

  const finish = useCallback(() => {
    if (pendingChoice.current) {
      league?.setSelectedDriver(pendingChoice.current);
      pendingChoice.current = null;
      // A shared driver URL must not override the visitor's own choice later.
      setSearchParams(
        (current) => {
          const next = new URLSearchParams(current);
          next.delete("driver");
          return next;
        },
        { replace: true },
      );
    }
    writeStoredBoolean(LEAGUE_DRIVER_ONBOARDING_STORAGE_KEY, true);
    setDismissed(true);
  }, [league?.setSelectedDriver, setSearchParams]);

  if (!visible || !league) return null;

  return (
    <Modal
      onClose={finish}
      className="mx-4 max-h-[calc(100dvh-2rem)] max-w-md border border-white/[0.08]"
      ariaLabelledBy="driver-welcome-title"
      ariaDescribedBy="driver-welcome-description"
    >
      {(requestClose) => (
        <div className="relative isolate rounded-3xl">
          <div className="pointer-events-none absolute inset-0 overflow-hidden rounded-3xl">
            <div
              aria-hidden="true"
              className="brand-stripe-wash absolute inset-x-0 top-0 h-24 opacity-70"
            />
          </div>
          <div className="relative z-10 p-6 sm:p-8">
            <div className="mb-6 flex items-center gap-3 pr-8">
              <span className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-brand-red/25 to-brand-violet/30 text-rose-100 ring-1 ring-inset ring-white/10 shadow-lg shadow-rose-950/30">
                <UserRound className="size-5" />
              </span>
              <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.2em] text-rose-200/75">
                Personalize your stats
              </span>
            </div>

            <h1
              id="driver-welcome-title"
              className="text-2xl font-bold tracking-tight text-white"
            >
              Who&apos;s driving?
            </h1>
            <p
              id="driver-welcome-description"
              className="mt-2 max-w-sm text-sm leading-relaxed text-zinc-300"
            >
              Choose your name to personalize your stats, charts, and recent
              activity. You can switch drivers any time from the top bar.
            </p>

            <div className="mt-6">
              <p className="mb-2 font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-zinc-500">
                Your driver
              </p>
              <DriverSearchSelect
                drivers={drivers}
                value={selectedDriver}
                onChange={setSelectedDriver}
                ariaLabel="Choose your driver"
              />
            </div>

            <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={requestClose}
                className="inline-flex min-h-10 items-center justify-center rounded-xl px-4 text-sm font-medium text-zinc-400 transition-colors hover:bg-white/[0.05] hover:text-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-red/70"
              >
                I&apos;ll choose later
              </button>
              <button
                type="button"
                disabled={!selectedDriver}
                onClick={() => {
                  pendingChoice.current = selectedDriver;
                  requestClose();
                }}
                className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-brand-red to-brand-violet px-4 text-sm font-semibold text-white shadow-lg shadow-rose-950/30 transition hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70 disabled:cursor-not-allowed disabled:opacity-45"
              >
                Use this driver
                <ArrowRight className="size-4" />
              </button>
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}
