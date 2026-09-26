import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Compact, non-interactive table for dashboard widgets (server-safe). Use DataTable for full reports. */
export function MiniTable({
  columns,
  rows,
  className,
  empty = "No data",
}: {
  columns: { header: ReactNode; align?: "left" | "right" | "center"; className?: string }[];
  rows: ReactNode[][];
  className?: string;
  empty?: ReactNode;
}) {
  return (
    <div className={cn("scroll-thin overflow-x-auto", className)}>
      <table className="w-full border-collapse text-[13px]">
        <thead>
          <tr className="text-left text-[11.5px] text-text-3">
            {columns.map((c, i) => (
              <th key={i} className={cn("border-b border-border px-2 py-1.5 font-medium whitespace-nowrap first:pl-0 last:pr-0", c.align === "right" && "text-right", c.align === "center" && "text-center", c.className)}>
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr>
              <td colSpan={columns.length} className="py-6 text-center text-text-3">
                {empty}
              </td>
            </tr>
          )}
          {rows.map((r, i) => (
            <tr key={i} className="border-b border-border last:border-0">
              {r.map((cell, j) => (
                <td key={j} className={cn("px-2 py-2 align-middle first:pl-0 last:pr-0", columns[j]?.align === "right" && "tabular text-right", columns[j]?.align === "center" && "text-center", columns[j]?.className)}>
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
