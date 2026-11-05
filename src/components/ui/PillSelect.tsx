import type { LucideIcon } from "lucide-react";
import { PillMenuSelect } from "./PillMenuSelect";
import type { FormControlSize, FormControlWidth } from "./formControl";

export type PillSelectValue = string | number;

export interface PillSelectOption {
  value: PillSelectValue;
  label: string;
  disabled?: boolean;
}

export type PillSelectWidth = FormControlWidth;
export type PillSelectSize = FormControlSize;

/**
 * Branded single-select control. The native select is replaced by the shared
 * menu so every site dropdown has the same surface, selected state, and keys.
 */
export function PillSelect({
  value,
  onChange,
  options,
  ariaLabel,
  dotColor,
  leadingIcon,
  width = "auto",
  size = "md",
  className,
}: {
  value: PillSelectValue;
  onChange: (value: string) => void;
  options: readonly PillSelectOption[];
  ariaLabel: string;
  dotColor?: string;
  /** Replaces the default color dot when set. */
  leadingIcon?: LucideIcon;
  width?: PillSelectWidth;
  size?: PillSelectSize;
  className?: string;
}) {
  return (
    <PillMenuSelect
      value={value}
      onChange={onChange}
      options={options.map((option) => ({ ...option, group: "" }))}
      ariaLabel={ariaLabel}
      dotColor={dotColor}
      leadingIcon={leadingIcon}
      width={width}
      size={size}
      className={className}
    />
  );
}
