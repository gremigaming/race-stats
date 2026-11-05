import { Check, ChevronDown, type LucideIcon } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { cn } from "../../utils/cn";
import {
  DROPDOWN_OPTION_STYLES,
  DROPDOWN_OPTION_IDLE_STYLES,
  DROPDOWN_OPTION_SELECTED_STYLES,
  DROPDOWN_GROUP_LABEL_STYLES,
  DROPDOWN_DIVIDER_STYLES,
  DROPDOWN_PANEL_STYLES,
  FORM_CONTROL_CHROME_STYLES,
  FORM_CONTROL_CONTAINER_STYLES,
  FORM_CONTROL_SIZE_STYLES,
  FORM_CONTROL_WIDTH_STYLES,
  type FormControlSize,
} from "./formControl";
import type { PillSelectValue, PillSelectWidth } from "./PillSelect";

export interface PillMenuOption {
  value: PillSelectValue;
  label: string;
  group?: string;
  disabled?: boolean;
}

const SIZE = {
  sm: {
    indicator: "left-2.5",
    dot: "size-1.5",
    icon: "right-2 size-3",
    trigger: cn(
      FORM_CONTROL_SIZE_STYLES.sm.control,
      FORM_CONTROL_SIZE_STYLES.sm.yPadding,
      "pl-6 pr-7",
    ),
  },
  md: {
    indicator: "left-3",
    dot: "size-1.5",
    icon: "right-2.5 size-3",
    trigger: cn(
      FORM_CONTROL_SIZE_STYLES.md.control,
      FORM_CONTROL_SIZE_STYLES.md.yPadding,
      "pl-6.5 pr-8",
    ),
  },
} as const;

export function PillMenuSelect({
  value,
  onChange,
  options,
  ariaLabel,
  leadingIcon: LeadingIcon,
  dotColor,
  width = "auto",
  size = "md",
  className,
  triggerClassName,
  menuClassName,
}: {
  value: PillSelectValue;
  onChange: (value: string) => void;
  options: readonly PillMenuOption[];
  ariaLabel: string;
  leadingIcon?: LucideIcon;
  dotColor?: string;
  width?: PillSelectWidth;
  size?: FormControlSize;
  className?: string;
  triggerClassName?: string;
  menuClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const menuId = useId();
  const styles = SIZE[size];
  const selectedIndex = options.findIndex(
    (option) => String(option.value) === String(value),
  );
  const selectedOption = selectedIndex >= 0 ? options[selectedIndex] : null;

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  useEffect(() => {
    if (open) optionRefs.current[activeIndex]?.focus();
  }, [activeIndex, open]);

  const groupedOptions = options.reduce<
    Array<{ label: string; start: number; items: PillMenuOption[] }>
  >((groups, option, index) => {
    const lastGroup = groups.at(-1);
    const label = option.group ?? "";
    if (lastGroup?.label === label) {
      lastGroup.items.push(option);
    } else {
      groups.push({ label, start: index, items: [option] });
    }
    return groups;
  }, []);

  const moveActive = (index: number, direction: -1 | 1) => {
    let next = index;
    for (let tries = 0; tries < options.length; tries += 1) {
      next = (next + direction + options.length) % options.length;
      if (!options[next].disabled) {
        setActiveIndex(next);
        break;
      }
    }
  };

  return (
    <div
      ref={rootRef}
      className={cn(
        FORM_CONTROL_CONTAINER_STYLES,
        "items-center text-zinc-200",
        FORM_CONTROL_WIDTH_STYLES[width],
        className,
      )}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          setOpen(false);
        }
      }}
    >
      {LeadingIcon ? (
        <LeadingIcon
          aria-hidden="true"
          className={cn(
            "pointer-events-none absolute z-10 size-3 text-zinc-500",
            styles.indicator,
          )}
        />
      ) : (
        <span
          aria-hidden="true"
          className={cn(
            "pointer-events-none absolute z-10 rounded-full bg-zinc-500/60",
            styles.indicator,
            styles.dot,
          )}
          style={{ backgroundColor: dotColor }}
        />
      )}
      <button
        ref={triggerRef}
        type="button"
        aria-label={`${ariaLabel}: ${selectedOption?.label ?? "Choose"}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => {
          if (open) {
            setOpen(false);
            return;
          }
          setActiveIndex(selectedIndex >= 0 ? selectedIndex : 0);
          setOpen(true);
        }}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            const initial = selectedIndex >= 0 ? selectedIndex : 0;
            setActiveIndex(initial);
            setOpen(true);
          } else if (event.key === "Escape") {
            setOpen(false);
          }
        }}
        className={cn(
          FORM_CONTROL_CHROME_STYLES,
          "flex appearance-none items-center text-left focus-visible:ring-2 focus-visible:ring-brand-red/50",
          styles.trigger,
          triggerClassName,
        )}
      >
        <span className="min-w-0 flex-1 truncate">
          {selectedOption?.label ?? "Choose"}
        </span>
      </button>
      <ChevronDown
        aria-hidden="true"
        className={cn(
          "pointer-events-none absolute z-10 text-zinc-500",
          styles.icon,
        )}
      />

      {open && (
        <div
          id={menuId}
          role="listbox"
          aria-label={ariaLabel}
          className={cn(
            "absolute left-0 top-full z-50 mt-1.5 max-h-[70vh] w-56 max-w-[calc(100vw-2rem)] overflow-y-auto p-1.5",
            DROPDOWN_PANEL_STYLES,
            menuClassName,
          )}
        >
          {groupedOptions.map((group, groupIndex) => (
            <div key={group.label}>
              {group.label && groupIndex > 0 && (
                <div
                  aria-hidden="true"
                  className={DROPDOWN_DIVIDER_STYLES}
                />
              )}
              {group.label && (
                <p className={DROPDOWN_GROUP_LABEL_STYLES}>
                  {group.label}
                </p>
              )}
              {group.items.map((option, itemIndex) => {
                const index = group.start + itemIndex;
                const selected = index === selectedIndex;
                return (
                  <button
                    key={String(option.value)}
                    ref={(element) => {
                      optionRefs.current[index] = element;
                    }}
                    type="button"
                    role="option"
                    aria-selected={selected}
                    disabled={option.disabled}
                    tabIndex={activeIndex === index ? 0 : -1}
                    onMouseEnter={() => setActiveIndex(index)}
                    onKeyDown={(event) => {
                      if (event.key === "ArrowDown") {
                        event.preventDefault();
                        moveActive(index, 1);
                      } else if (event.key === "ArrowUp") {
                        event.preventDefault();
                        moveActive(index, -1);
                      } else if (event.key === "Home" || event.key === "End") {
                        event.preventDefault();
                        const enabled = options
                          .map((item, itemIndex) => ({ item, itemIndex }))
                          .filter(({ item }) => !item.disabled);
                        setActiveIndex(
                          event.key === "Home"
                            ? (enabled[0]?.itemIndex ?? 0)
                            : (enabled.at(-1)?.itemIndex ?? 0),
                        );
                      }
                    }}
                    onClick={() => {
                      onChange(String(option.value));
                      setOpen(false);
                      triggerRef.current?.focus();
                    }}
                    className={cn(
                      DROPDOWN_OPTION_STYLES,
                      selected
                        ? DROPDOWN_OPTION_SELECTED_STYLES
                        : DROPDOWN_OPTION_IDLE_STYLES,
                      option.disabled && "cursor-not-allowed opacity-40",
                    )}
                  >
                    <span className="min-w-0 flex-1 truncate">
                      {option.label}
                    </span>
                    {selected && (
                      <Check
                        aria-hidden="true"
                        className="size-3.5 shrink-0 text-rose-200"
                      />
                    )}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
