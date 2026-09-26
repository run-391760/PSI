"use client";

import { Download } from "lucide-react";
import { type ComponentProps, useCallback, useRef } from "react";
import { downloadCsv } from "@/lib/csv";
import { Button } from "@/components/ui/button";
import { Segmented } from "@/components/ui/tabs";

type Cell = string | number | boolean | null | undefined;

/**
 * CSV export with explicit plain-text fields (richer than the rendered columns). Pass `onRowsChange`
 * to DataTable so the export follows the table's current quick filter and sort.
 */
export function useCsvExport<T>(filename: string, header: string[], toRow: (row: T) => Cell[]) {
  const rows = useRef<T[]>([]);
  const onRowsChange = useCallback((r: T[]) => {
    rows.current = r;
  }, []);
  const exportCsv = () => downloadCsv(filename, [header, ...rows.current.map((r) => toRow(r).map((v) => (typeof v === "boolean" ? (v ? "yes" : "no") : v)))]);
  return { onRowsChange, exportCsv };
}

export function ExportButton({ onClick, className }: { onClick: () => void; className?: string }) {
  return (
    <Button size="sm" onClick={onClick} className={className} title="Export the filtered rows as CSV">
      <Download className="h-3.5 w-3.5" /> Export
    </Button>
  );
}

/** Segmented control that never wraps its labels; scrolls horizontally on narrow screens. */
export function ScrollSegmented<T extends string>(props: ComponentProps<typeof Segmented<T>>) {
  return (
    <div className="scroll-thin max-w-full overflow-x-auto">
      <Segmented<T> {...props} options={props.options.map((o) => ({ ...o, label: <span className="whitespace-nowrap">{o.label}</span> }))} />
    </div>
  );
}
