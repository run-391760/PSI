"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Segmented } from "@/components/ui/tabs";
import { compact, money, monthShortLabel } from "@/lib/format";
import type { AdsHistory } from "@/lib/competitive/advertising-research";
import { cn } from "@/lib/utils";
import { CsvButton } from "./csv-button";
import { SearchBox } from "./filters";

const SHADE = [85, 62, 42, 26];

/** Keyword × month grid of ad positions: darker cells = higher ad position; empty = no ad that month. */
export function AdsHistoryGrid({ history, db, domain }: { history: AdsHistory; db: string; domain: string }) {
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<"all" | "active" | "new" | "lost">("all");
  const rows = useMemo(() => history.rows.filter((r) => (status === "all" || r.status === status) && (!q || r.keyword.includes(q.toLowerCase()))), [history.rows, q, status]);
  const csv: (string | number | null)[][] = [["Keyword", "Status", "Volume", "CPC", "Traffic", ...history.months], ...rows.map((r) => [r.keyword, r.status, r.volume, r.cpc, r.traffic, ...r.positions.map((p) => p ?? "")])];
  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 px-4 pb-3">
        <SearchBox value={q} onChange={setQ} />
        <Segmented
          options={[
            { value: "all", label: "All" },
            { value: "active", label: "Active" },
            { value: "new", label: "New" },
            { value: "lost", label: "Lost" },
          ]}
          value={status}
          onChange={setStatus}
        />
        <span className="flex items-center gap-2 text-[12px] text-text-3">
          Ad position
          {SHADE.map((s, i) => (
            <span key={i} className={cn("inline-flex h-5 w-5 items-center justify-center rounded text-[11px] font-semibold", i < 2 ? "text-white" : "text-text")} style={{ background: `color-mix(in srgb, var(--series-1) ${s}%, transparent)` }}>
              {i + 1}
            </span>
          ))}
        </span>
        <CsvButton className="ml-auto" filename={`${domain}-ads-history-${db}`} rows={csv} />
      </div>
      <div className="scroll-thin overflow-x-auto border-t border-border">
        <table className="w-full border-collapse text-[12.5px]">
          <thead>
            <tr className="bg-surface-2 text-[12px] text-text-2">
              <th className="sticky left-0 z-10 border-b border-border bg-surface-2 px-3 py-2 text-left font-medium">Keyword</th>
              <th className="border-b border-border px-2 py-2 text-right font-medium">Volume</th>
              <th className="border-b border-border px-2 py-2 text-right font-medium">CPC</th>
              {history.months.map((m) => (
                <th key={m} className="border-b border-border px-1 py-2 text-center font-medium whitespace-nowrap">
                  {monthShortLabel(m)}
                  {m.endsWith("-01") && <span className="block text-[10px] font-normal text-text-3">{m.slice(0, 4)}</span>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={history.months.length + 3} className="px-4 py-10 text-center text-text-3">
                  No keywords match.
                </td>
              </tr>
            )}
            {rows.map((r) => (
              <tr key={r.keyword} className="border-b border-border last:border-0 hover:bg-surface-2">
                <td className="sticky left-0 z-10 max-w-[220px] bg-surface px-3 py-1.5">
                  <span className="flex items-center gap-1.5">
                    <Link href={`/keyword-overview?q=${encodeURIComponent(r.keyword)}&db=${db}`} className="truncate text-link hover:underline">
                      {r.keyword}
                    </Link>
                    {r.status !== "active" && <span className={cn("shrink-0 rounded px-1 text-[10.5px] font-semibold", r.status === "new" ? "bg-brand-soft text-brand-ink" : "bg-critical-soft text-critical-ink")}>{r.status === "new" ? "New" : "Lost"}</span>}
                  </span>
                </td>
                <td className="tabular px-2 py-1.5 text-right">{compact(r.volume)}</td>
                <td className="tabular px-2 py-1.5 text-right">{money(r.cpc)}</td>
                {r.positions.map((p, i) => (
                  <td key={i} className="px-0.5 py-1">
                    <span
                      title={p == null ? `${history.months[i]}: no ad` : `${history.months[i]}: position ${p}`}
                      className={cn("mx-auto flex h-6 w-full min-w-7 items-center justify-center rounded text-[11.5px] font-semibold", p == null ? "bg-surface-2 text-text-3" : p <= 2 ? "text-white" : "text-text")}
                      style={p == null ? undefined : { background: `color-mix(in srgb, var(--series-1) ${SHADE[Math.min(p, 4) - 1]}%, transparent)` }}
                    >
                      {p ?? ""}
                    </span>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
