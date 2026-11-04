import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "../../utils/cn";

export function PageHeader({
  title,
  description,
  meta,
  eyebrow,
  icon: Icon,
  action,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  meta?: ReactNode;
  eyebrow?: ReactNode;
  icon?: LucideIcon;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <header
      className={cn(
        "relative isolate overflow-hidden rounded-2xl border border-white/[0.08] bg-[#171016]/90 px-4 py-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] sm:px-6 sm:py-5",
        className,
      )}
    >
      <div
        aria-hidden="true"
        className="brand-stripe-wash absolute inset-0 opacity-60"
      />
      <div
        aria-hidden="true"
        className="absolute inset-x-8 top-0 h-px bg-gradient-to-r from-brand-red/50 via-white/10 to-brand-violet/50"
      />
      <div className="relative flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <div className="flex min-w-0 items-start gap-3">
          {Icon && (
            <span className="mt-0.5 inline-flex size-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-brand-red/20 to-brand-violet/20 text-rose-200 ring-1 ring-inset ring-white/[0.08]">
              <Icon className="size-5" />
            </span>
          )}
          <div className="min-w-0">
            {eyebrow && (
              <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.2em] text-rose-200/70">
                {eyebrow}
              </p>
            )}
            <h1 className="text-xl font-bold tracking-tight text-white sm:text-2xl">
              {title}
            </h1>
            {description && (
              <p className="mt-1 max-w-3xl text-sm leading-relaxed text-zinc-300/75">
                {description}
              </p>
            )}
            {meta && (
              <p className="mt-1.5 font-mono text-xs tabular-nums text-zinc-400">
                {meta}
              </p>
            )}
          </div>
        </div>
        {action && <div className="relative shrink-0">{action}</div>}
      </div>
    </header>
  );
}
