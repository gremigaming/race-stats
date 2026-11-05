export type FormControlSize = "sm" | "md";
export type FormControlWidth = "auto" | "compact" | "session" | "full";

export const FORM_CONTROL_CONTAINER_STYLES =
  "relative inline-flex min-w-0 max-w-full";

export const FORM_CONTROL_WIDTH_STYLES: Record<FormControlWidth, string> = {
  auto: "w-auto",
  compact: "w-[min(15rem,calc(100vw-3rem))]",
  session: "w-[min(20rem,calc(100vw-3rem))]",
  full: "w-full",
};

export const FORM_CONTROL_CHROME_STYLES =
  "w-full min-w-0 border border-zinc-800/80 bg-zinc-900/70 font-medium text-zinc-200 outline-none transition-colors hover:border-zinc-700 focus:ring-1 focus:ring-zinc-500/40";

export const DROPDOWN_PANEL_STYLES =
  "rounded-xl border border-white/[0.09] bg-[#110b0f]/[0.98] text-zinc-200 shadow-2xl shadow-black/60 ring-1 ring-black/40 backdrop-blur-xl";

export const DROPDOWN_OPTION_STYLES =
  "flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-red/50";

export const DROPDOWN_LINK_STYLES =
  "flex min-h-10 w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-red/50";

export const DROPDOWN_SELECTION_ACCENT_STYLES =
  "bg-brand-wine/55 text-white ring-1 ring-inset ring-brand-red/20";

export const DROPDOWN_OPTION_SELECTED_STYLES =
  DROPDOWN_SELECTION_ACCENT_STYLES;

export const DROPDOWN_OPTION_IDLE_STYLES =
  "text-zinc-300 hover:bg-white/[0.06] hover:text-zinc-100";

export const DROPDOWN_GROUP_LABEL_STYLES =
  "px-2.5 pb-1 pt-1.5 font-mono text-[9px] font-semibold uppercase tracking-[0.16em] text-zinc-500";

export const DROPDOWN_DIVIDER_STYLES = "my-1.5 h-px bg-white/[0.07]";

export const FORM_CONTROL_SIZE_STYLES: Record<
  FormControlSize,
  { control: string; yPadding: string }
> = {
  sm: {
    control: "h-6.5 rounded-md text-2xs",
    yPadding: "py-1",
  },
  md: {
    control: "h-7.5 rounded-lg text-xs",
    yPadding: "py-1.5",
  },
};
