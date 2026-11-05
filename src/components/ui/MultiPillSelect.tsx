import { Check, ChevronDown } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { cn } from "../../utils/cn";
import {
  DROPDOWN_OPTION_STYLES,
  DROPDOWN_OPTION_IDLE_STYLES,
  DROPDOWN_OPTION_SELECTED_STYLES,
  DROPDOWN_DIVIDER_STYLES,
  DROPDOWN_PANEL_STYLES,
  FORM_CONTROL_CHROME_STYLES,
  FORM_CONTROL_CONTAINER_STYLES,
  FORM_CONTROL_SIZE_STYLES,
  FORM_CONTROL_WIDTH_STYLES,
  type FormControlSize,
} from "./formControl";
import type { PillSelectOption, PillSelectWidth } from "./PillSelect";

export function MultiPillSelect({
  value,
  onChange,
  options,
  ariaLabel,
  width = "auto",
  size = "md",
  className,
}: {
  value: string[];
  onChange: (value: string[]) => void;
  options: readonly PillSelectOption[];
  ariaLabel: string;
  width?: PillSelectWidth;
  size?: FormControlSize;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;
    function handlePointerDown(e: PointerEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    }
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [open]);

  const [allOption, ...typeOptions] = options;

  const triggerLabel = (() => {
    if (value.length === 0) return allOption?.label ?? "All types";
    if (value.length === 1) {
      const opt = typeOptions.find((o) => String(o.value) === value[0]);
      return opt?.label ?? value[0];
    }
    return `${value.length} types`;
  })();

  function toggle(optValue: string) {
    if (value.includes(optValue)) {
      onChange(value.filter((v) => v !== optValue));
    } else {
      onChange([...value, optValue]);
    }
  }

  const styles = FORM_CONTROL_SIZE_STYLES[size];

  return (
    <div
      ref={containerRef}
      className={cn(
        FORM_CONTROL_CONTAINER_STYLES,
        FORM_CONTROL_WIDTH_STYLES[width],
        className,
      )}
    >
      <button
        type="button"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => setOpen((o) => !o)}
        className={cn(
          FORM_CONTROL_CHROME_STYLES,
          "flex items-center justify-between gap-2 px-3",
          styles.control,
        )}
      >
        <span className="truncate">{triggerLabel}</span>
        <ChevronDown className="size-3 shrink-0 text-zinc-500" />
      </button>

      {open && (
        <div
          id={menuId}
          role="listbox"
          aria-label={ariaLabel}
          aria-multiselectable="true"
          className={cn(
            "absolute right-0 top-full z-50 mt-1.5 w-full min-w-[14rem] overflow-hidden p-1.5",
            DROPDOWN_PANEL_STYLES,
          )}
        >
          <button
            type="button"
            role="option"
            aria-selected={value.length === 0}
            onClick={() => onChange([])}
            className={cn(
              DROPDOWN_OPTION_STYLES,
              value.length === 0
                ? DROPDOWN_OPTION_SELECTED_STYLES
                : DROPDOWN_OPTION_IDLE_STYLES,
            )}
          >
            <span className="min-w-0 flex-1 truncate">{allOption?.label}</span>
            {value.length === 0 && (
              <Check
                aria-hidden="true"
                className="size-3.5 shrink-0 text-rose-200"
              />
            )}
          </button>

          <div aria-hidden="true" className={DROPDOWN_DIVIDER_STYLES} />

          {typeOptions.map((option) => {
            const isSelected = value.includes(String(option.value));
            return (
              <button
                key={String(option.value)}
                type="button"
                role="option"
                aria-selected={isSelected}
                disabled={option.disabled}
                onClick={() => toggle(String(option.value))}
                className={cn(
                  DROPDOWN_OPTION_STYLES,
                  isSelected
                    ? DROPDOWN_OPTION_SELECTED_STYLES
                    : DROPDOWN_OPTION_IDLE_STYLES,
                  option.disabled && "cursor-not-allowed opacity-40",
                )}
              >
                <span className="truncate">{option.label}</span>
                {isSelected && (
                  <Check
                    aria-hidden="true"
                    className="ml-auto size-3.5 shrink-0 text-rose-200"
                  />
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
