import { cn } from "../../utils/cn";
import { LoadingSpinner } from "./LoadingSpinner";

export function LoadingState({
  label,
  variant = "page",
  className,
}: {
  label: string;
  variant?: "page" | "inline";
  className?: string;
}) {
  if (variant === "inline") {
    return (
      <div
        role="status"
        aria-live="polite"
        className={cn(
          "flex items-center gap-2 px-4 py-3 text-xs text-zinc-500",
          className,
        )}
      >
        <LoadingSpinner className="size-4 border-2" />
        <span>{label}</span>
      </div>
    );
  }

  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        "flex min-h-80 items-center justify-center px-4 py-8",
        className,
      )}
    >
      <div className="inline-flex items-center gap-3 rounded-2xl border border-white/[0.07] bg-zinc-900/50 px-4 py-3 text-sm text-zinc-300 shadow-lg shadow-black/20">
        <span className="relative grid size-9 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-brand-red/15 to-brand-violet/15 ring-1 ring-inset ring-white/[0.07]">
          <LoadingSpinner className="size-5 border-2" />
        </span>
        <span>{label}</span>
      </div>
    </div>
  );
}
