import { ArrowLeftRight } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "../../utils/cn";
import { ScrollArea } from "./ScrollArea";

export function HorizontalScrollRegion({
  label,
  hint = "Swipe or scroll to see all columns",
  stickyHeader = false,
  children,
}: {
  label: string;
  hint?: string;
  stickyHeader?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="min-w-0">
      <p className="mb-2 flex justify-end xl:hidden">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-white/[0.06] bg-zinc-900/60 px-2.5 py-1 text-[11px] font-medium text-zinc-400">
          {hint}
          <ArrowLeftRight
            aria-hidden="true"
            className="size-3.5 text-rose-200/80"
          />
        </span>
      </p>
      <ScrollArea
        axis="x"
        role="region"
        aria-label={label}
        tabIndex={0}
        className={cn(
          "overscroll-x-contain rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-red/60",
          stickyHeader && "xl:overflow-x-visible",
        )}
      >
        {children}
      </ScrollArea>
    </div>
  );
}
