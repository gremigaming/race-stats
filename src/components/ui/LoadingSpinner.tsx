import { cn } from "../../utils/cn";

const SPINNER_GRADIENT =
  "conic-gradient(from 0deg, var(--color-brand-red) 0deg, #fb7185 54deg, #e879f9 112deg, #c084fc 174deg, var(--color-brand-violet) 238deg, transparent 292deg 360deg)";

const SPINNER_MASK =
  "linear-gradient(#fff 0 0) padding-box, linear-gradient(#fff 0 0)";

/** A lightweight loading ring with a rotating red-to-violet gradient arc. */
export function LoadingSpinner({
  className,
  label,
}: {
  className: string;
  label?: string;
}) {
  return (
    <span
      role={label ? "status" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      className={cn(
        "relative block shrink-0 animate-spin rounded-full border-2 border-transparent motion-reduce:animate-none",
        className,
      )}
    >
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 rounded-full border-2 border-transparent"
        style={{
          borderWidth: "inherit",
          background: SPINNER_GRADIENT,
          backgroundOrigin: "border-box",
          mask: SPINNER_MASK,
          maskComposite: "exclude",
          WebkitMask: SPINNER_MASK,
          WebkitMaskComposite: "xor",
        }}
      />
    </span>
  );
}
