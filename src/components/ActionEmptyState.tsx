import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "../utils/cn";

export function ActionEmptyState({
  icon: Icon,
  title,
  message,
  actions,
  className,
}: {
  icon: LucideIcon;
  title: ReactNode;
  message: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "relative isolate w-full max-w-sm overflow-hidden rounded-2xl border border-white/[0.08] bg-[#171016]/75 px-5 py-7 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] sm:px-7",
        className,
      )}
    >
      <div
        aria-hidden="true"
        className="brand-stripe-wash pointer-events-none absolute inset-0 opacity-35"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-8 top-0 h-px bg-gradient-to-r from-brand-red/45 via-white/10 to-brand-violet/45"
      />
      <div className="relative flex flex-col items-center gap-4 text-center">
        <span className="inline-flex size-12 items-center justify-center rounded-2xl bg-gradient-to-br from-brand-red/20 to-brand-violet/20 text-rose-200 ring-1 ring-inset ring-white/[0.08]">
          <Icon className="size-5" />
        </span>
        <div>
          <h3 className="text-lg font-semibold text-zinc-100">{title}</h3>
          <p className="mt-1 text-sm leading-relaxed text-zinc-400">
            {message}
          </p>
        </div>
        {actions && (
          <div className="flex flex-wrap justify-center gap-2">{actions}</div>
        )}
      </div>
    </div>
  );
}
