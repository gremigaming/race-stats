import { ChevronDown, ChevronUp } from "lucide-react";
import { useState, type ReactNode } from "react";
import { cn } from "../../utils/cn";
import { tableHeadCellClass } from "./table";

export type SortDir = "asc" | "desc";

/**
 * Column sorting for the league tables. `null` keeps the table's own order;
 * the first click on a column puts the best value on top (`firstDir`), the
 * second flips it, the third goes back to the table's own order.
 */
export function useSort<K extends string>() {
  const [sort, setSort] = useState<{ key: K; dir: SortDir } | null>(null);
  const toggle = (key: K, firstDir: SortDir) =>
    setSort((s) =>
      !s || s.key !== key
        ? { key, dir: firstDir }
        : s.dir === firstDir
          ? { key, dir: firstDir === "asc" ? "desc" : "asc" }
          : null,
    );
  return { sort, toggle };
}

/** Sorts rows by one value; missing values always go last. */
export function sortRows<T, K extends string>(
  rows: T[],
  sort: { key: K; dir: SortDir } | null,
  value: (row: T, key: K) => number | string | null | undefined,
): T[] {
  if (!sort) return rows;
  const sign = sort.dir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const va = value(a, sort.key);
    const vb = value(b, sort.key);
    if (va == null || vb == null) return va == null ? (vb == null ? 0 : 1) : -1;
    if (typeof va === "string" || typeof vb === "string")
      return sign * String(va).localeCompare(String(vb), undefined, { sensitivity: "base" });
    return sign * (va - vb);
  });
}

export function SortHeader<K extends string>({
  column,
  sort,
  toggle,
  firstDir = "desc",
  align = "right",
  children,
}: {
  column: K;
  sort: { key: K; dir: SortDir } | null;
  toggle: (key: K, firstDir: SortDir) => void;
  firstDir?: SortDir;
  align?: "left" | "right";
  children: ReactNode;
}) {
  const active = sort?.key === column;
  const Icon = active && sort?.dir === "asc" ? ChevronUp : ChevronDown;
  const icon = (
    <Icon
      className={cn(
        "inline size-3 align-[-1px]",
        align === "right" ? "mr-1" : "ml-1",
        active ? "text-zinc-300" : "opacity-0 group-hover:opacity-40",
      )}
    />
  );
  return (
    <th
      className={tableHeadCellClass({
        align,
        sortable: true,
        className: cn("whitespace-nowrap hover:text-zinc-300", active && "text-zinc-200"),
      })}
      tabIndex={0}
      aria-sort={active ? (sort?.dir === "asc" ? "ascending" : "descending") : "none"}
      onClick={() => toggle(column, firstDir)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          toggle(column, firstDir);
        }
      }}
    >
      {align === "right" && icon}
      {children}
      {align === "left" && icon}
    </th>
  );
}
