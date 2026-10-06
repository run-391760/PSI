"use client";

import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, ChevronsUpDown, Download, Search } from "lucide-react";
import Link from "next/link";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { downloadCsv } from "@/lib/csv";
import { cn } from "@/lib/utils";
import { Button } from "./button";
import { Checkbox, Select } from "./input";
import { InfoTip } from "./tooltip";

export type Column<T> = {
  key: string;
  header: ReactNode;
  /** Plain-text header for CSV export (defaults to `header` when it is a string). */
  csvHeader?: string;
  align?: "left" | "right" | "center";
  /** Defaults to true. */
  sortable?: boolean;
  sortValue?: (row: T) => number | string | null | undefined;
  render?: (row: T) => ReactNode;
  /** Export value; defaults to sortValue or row[key]. Return undefined to skip the column. */
  csv?: (row: T) => string | number | null | undefined;
  width?: string;
  className?: string;
  info?: string;
  /** Excluded from CSV. */
  noExport?: boolean;
  /** Included in CSV only (not rendered), e.g. a "Source" column. Needs csv or sortValue. */
  exportOnly?: boolean;
  /** Hide on narrow screens (< 768px). */
  hideOnMobile?: boolean;
};

/**
 * Client-side data table. Because column renderers are functions, define columns inside a
 * "use client" component and pass it serializable rows from the server.
 */
export function DataTable<T>({
  rows,
  columns,
  rowKey,
  defaultSort,
  pageSize: initialPageSize = 25,
  searchable,
  searchPlaceholder = "Filter by keyword",
  searchText,
  selectable,
  selectionActions,
  toolbar,
  exportName,
  emptyText = "No results match the current filters.",
  title,
  dense,
  rowClassName,
  className,
  onRowsChange,
}: {
  rows: T[];
  columns: Column<T>[];
  rowKey: (row: T, index: number) => string;
  defaultSort?: { key: string; dir: "asc" | "desc" };
  pageSize?: number;
  /** Show the quick filter box. `searchText` extracts the searchable text of a row. */
  searchable?: boolean;
  searchPlaceholder?: string;
  searchText?: (row: T) => string;
  selectable?: boolean;
  selectionActions?: (selected: T[], clear: () => void) => ReactNode;
  toolbar?: ReactNode;
  exportName?: string;
  emptyText?: ReactNode;
  title?: ReactNode;
  dense?: boolean;
  rowClassName?: (row: T) => string | undefined;
  className?: string;
  /** Called with the filtered+sorted rows (e.g. to sync a chart with the table). */
  onRowsChange?: (rows: T[]) => void;
}) {
  const [sort, setSort] = useState(defaultSort ?? null);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(initialPageSize);
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const filtered = useMemo(() => {
    if (!q.trim()) return rows;
    const needle = q.trim().toLowerCase();
    const text = searchText ?? ((r: T) => JSON.stringify(r));
    return rows.filter((r) => text(r).toLowerCase().includes(needle));
  }, [rows, q, searchText]);

  const sorted = useMemo(() => {
    if (!sort) return filtered;
    const col = columns.find((c) => c.key === sort.key);
    if (!col) return filtered;
    const get = col.sortValue ?? ((r: T) => (r as Record<string, unknown>)[col.key] as number | string);
    const dir = sort.dir === "asc" ? 1 : -1;
    return [...filtered].sort((a, b) => {
      const x = get(a),
        y = get(b);
      if (x == null && y == null) return 0;
      if (x == null) return 1;
      if (y == null) return -1;
      return (typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y))) * dir;
    });
  }, [filtered, sort, columns]);

  // Held in a ref so an inline callback that sets parent state cannot cause a render loop.
  const onRowsChangeRef = useRef(onRowsChange);
  onRowsChangeRef.current = onRowsChange;
  useEffect(() => {
    onRowsChangeRef.current?.(sorted);
  }, [sorted]);
  useEffect(() => setPage(0), [q, rows]);
  // Drop selections for rows that no longer exist (new data), keep those hidden by the quick filter.
  useEffect(() => {
    setSelected((s) => {
      if (!s.size) return s;
      const valid = new Set(rows.map((r, i) => rowKey(r, i)));
      const next = new Set([...s].filter((k) => valid.has(k)));
      return next.size === s.size ? s : next;
    });
  }, [rows, rowKey]);

  // Keys always use the row's index in the original `rows` array so selection survives sorting/filtering.
  const originalIndex = useMemo(() => new Map(rows.map((r, i) => [r, i])), [rows]);
  const keyOf = (r: T) => rowKey(r, originalIndex.get(r) ?? 0);
  const pages = Math.max(1, Math.ceil(sorted.length / pageSize));
  const current = Math.min(page, pages - 1);
  const visible = sorted.slice(current * pageSize, current * pageSize + pageSize);
  const keys = visible.map(keyOf);
  const allVisibleSelected = keys.length > 0 && keys.every((k) => selected.has(k));
  const selectedRows = rows.filter((r, i) => selected.has(rowKey(r, i)));

  const toggleSort = (key: string) =>
    setSort((s) => (s?.key === key ? { key, dir: s.dir === "desc" ? "asc" : "desc" } : { key, dir: "desc" }));

  const exportCsv = () => {
    const cols = columns.filter((c) => !c.noExport);
    const header = cols.map((c) => c.csvHeader ?? (typeof c.header === "string" ? c.header : c.key));
    const body = sorted.map((r) =>
      cols.map((c) => {
        if (c.csv) return c.csv(r);
        if (c.sortValue) return c.sortValue(r);
        const v = (r as Record<string, unknown>)[c.key];
        return typeof v === "object" ? JSON.stringify(v) : (v as string | number);
      }),
    );
    downloadCsv(exportName ?? "export", [header, ...body]);
  };

  const cell = dense ? "px-3 py-1.5" : "px-3 py-2.5";
  const shown = columns.filter((c) => !c.exportOnly);
  const mobile = (c: Column<T>) => (c.hideOnMobile ? "hidden md:table-cell" : "");

  return (
    <div className={cn("min-w-0", className)}>
      {(title || searchable || toolbar || exportName || (selectable && selected.size > 0)) && (
        <div className="flex flex-wrap items-center gap-2 px-4 pb-3">
          {title && <div className="mr-2 text-[13px] font-semibold text-text">{title}</div>}
          {searchable && (
            <div className="relative w-64 max-w-full">
              <Search className="pointer-events-none absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2 text-text-3" />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder={searchPlaceholder}
                className="h-8 w-full rounded-md border border-border-strong bg-surface pr-2 pl-8 text-[13px] placeholder:text-text-3 focus:border-brand focus:ring-2 focus:ring-brand/20 focus:outline-none"
              />
            </div>
          )}
          {toolbar}
          <div className="ml-auto flex items-center gap-2">
            {selectable && selected.size > 0 && (
              <>
                <span className="text-[12.5px] text-text-2">{selected.size} selected</span>
                {selectionActions?.(selectedRows, () => setSelected(new Set()))}
              </>
            )}
            {exportName && (
              <Button size="sm" onClick={exportCsv} title="Export the filtered rows as CSV">
                <Download className="h-3.5 w-3.5" /> Export
              </Button>
            )}
          </div>
        </div>
      )}
      <div className="scroll-thin overflow-x-auto border-t border-border">
        <table className="w-full border-collapse text-[13px]">
          <thead>
            <tr className="bg-surface-2 text-left text-[12px] text-text-2">
              {selectable && (
                <th className="w-9 border-b border-border px-3 py-2">
                  <Checkbox
                    aria-label="Select all rows on this page"
                    checked={allVisibleSelected}
                    onChange={() =>
                      setSelected((s) => {
                        const next = new Set(s);
                        if (allVisibleSelected) keys.forEach((k) => next.delete(k));
                        else keys.forEach((k) => next.add(k));
                        return next;
                      })
                    }
                  />
                </th>
              )}
              {shown.map((c) => {
                const sortable = c.sortable !== false;
                const active = sort?.key === c.key;
                return (
                  <th
                    key={c.key}
                    style={{ width: c.width }}
                    className={cn("border-b border-border font-medium whitespace-nowrap", cell, c.align === "right" && "text-right", c.align === "center" && "text-center", mobile(c))}
                    aria-sort={active ? (sort!.dir === "asc" ? "ascending" : "descending") : undefined}
                  >
                    <span className={cn("inline-flex items-center gap-1", c.align === "right" && "flex-row-reverse")}>
                      {sortable ? (
                        <button type="button" onClick={() => toggleSort(c.key)} className={cn("inline-flex items-center gap-1 hover:text-text", active && "text-text")}>
                          {c.header}
                          {active ? sort!.dir === "asc" ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" /> : <ChevronsUpDown className="h-3 w-3 opacity-40" />}
                        </button>
                      ) : (
                        c.header
                      )}
                      {c.info && <InfoTip text={c.info} />}
                    </span>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 && (
              <tr>
                <td colSpan={shown.length + (selectable ? 1 : 0)} className="px-4 py-10 text-center text-text-3">
                  {emptyText}
                </td>
              </tr>
            )}
            {visible.map((r, i) => {
              const k = keys[i];
              return (
                <tr key={k} className={cn("border-b border-border last:border-b-0 hover:bg-surface-2", selected.has(k) && "bg-brand-soft/50", rowClassName?.(r))}>
                  {selectable && (
                    <td className={cell}>
                      <Checkbox
                        aria-label="Select row"
                        checked={selected.has(k)}
                        onChange={() =>
                          setSelected((s) => {
                            const next = new Set(s);
                            if (next.has(k)) next.delete(k);
                            else next.add(k);
                            return next;
                          })
                        }
                      />
                    </td>
                  )}
                  {shown.map((c) => (
                    <td key={c.key} className={cn(cell, "align-middle", c.align === "right" && "tabular text-right", c.align === "center" && "text-center", c.className, mobile(c))}>
                      {c.render ? c.render(r) : String((r as Record<string, unknown>)[c.key] ?? "")}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {sorted.length > 10 && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-4 py-2 text-[12.5px] text-text-2">
          <span>
            {(current * pageSize + 1).toLocaleString()}–{Math.min(sorted.length, (current + 1) * pageSize).toLocaleString()} of {sorted.length.toLocaleString()}
          </span>
          <div className="flex items-center gap-2">
            <Select value={pageSize} onChange={(e) => (setPageSize(Number(e.target.value)), setPage(0))} className="h-7 w-auto text-[12px]" aria-label="Rows per page">
              {[10, 25, 50, 100].map((n) => (
                <option key={n} value={n}>
                  {n} / page
                </option>
              ))}
            </Select>
            <Button size="sm" variant="ghost" onClick={() => setPage(Math.max(0, current - 1))} disabled={current === 0} aria-label="Previous page">
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="tabular">
              {current + 1} / {pages}
            </span>
            <Button size="sm" variant="ghost" onClick={() => setPage(Math.min(pages - 1, current + 1))} disabled={current >= pages - 1} aria-label="Next page">
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

/** Link cell helper for tables. */
export function CellLink({ href, children, external }: { href: string; children: ReactNode; external?: boolean }) {
  if (external)
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" className="text-link hover:underline">
        {children}
      </a>
    );
  // Rows can hold hundreds of links to heavy report pages: no prefetch.
  return (
    <Link prefetch={false} href={href} className="text-link hover:underline">
      {children}
    </Link>
  );
}
