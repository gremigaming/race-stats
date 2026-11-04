import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "../../utils/cn";

export function PageFrame({
  children,
  className,
  ...props
}: HTMLAttributes<HTMLDivElement> & { children: ReactNode }) {
  return (
    <div
      {...props}
      className={cn(
        "mx-auto w-full max-w-6xl space-y-6 px-4 py-5 sm:space-y-8 sm:px-6 sm:py-7 lg:px-8",
        className,
      )}
    >
      {children}
    </div>
  );
}
