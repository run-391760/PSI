"use client";

import { compact, dayLabel, displayUrl } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { DataTable } from "@/components/ui/data-table";
import { Pos } from "./ui";

export type CannibalRow = {
  id: string;
  keyword: string;
  volume: number | null;
  position: number | null;
  urls: { url: string; days: number; current: number | null }[];
  switches: number;
  multiDays: number;
  severity: "high" | "medium" | "low";
  timeline: number[];
};

const URL_COLORS = ["var(--series-1)", "var(--series-2)", "var(--series-3)", "var(--series-4)", "var(--series-7)"];
const SEVERITY = { high: { tone: "critical" as const, label: "High" }, medium: { tone: "warning" as const, label: "Medium" }, low: { tone: "neutral" as const, label: "Low" } };

function Timeline({ values, days }: { values: number[]; days: string[] }) {
  return (
    <div className="flex h-4 w-[130px] gap-px" role="img" aria-label="Ranking URL per day">
      {values.map((v, i) => (
        <span
          key={i}
          title={`${days[i] ? dayLabel(days[i]) : ""}: ${v < 0 ? "not ranking" : `URL ${v + 1}`}`}
          className="h-full flex-1 first:rounded-l-sm last:rounded-r-sm"
          style={{ background: v < 0 ? "var(--surface-3)" : URL_COLORS[v % URL_COLORS.length] }}
        />
      ))}
    </div>
  );
}

export function CannibalizationTable({ rows, days, exportName, kwBase }: { rows: CannibalRow[]; days: string[]; exportName: string; kwBase: string }) {
  return (
    <DataTable
      rows={rows}
      rowKey={(r) => r.id}
      exportName={exportName}
      searchable
      searchText={(r) => `${r.keyword} ${r.urls.map((u) => u.url).join(" ")}`}
      emptyText="No cannibalization found: every keyword is served by a single URL in this range."
      columns={[
        {
          key: "keyword",
          header: "Keyword",
          sortValue: (r) => r.keyword,
          render: (r) => (
            <a href={`${kwBase}&kw=${r.id}`} className="block max-w-[220px] min-w-[140px] text-link hover:underline">
              {r.keyword}
            </a>
          ),
        },
        { key: "severity", header: "Severity", sortValue: (r) => (r.severity === "high" ? 3 : r.severity === "medium" ? 2 : 1), render: (r) => <Badge tone={SEVERITY[r.severity].tone}>{SEVERITY[r.severity].label}</Badge>, csv: (r) => r.severity },
        { key: "position", header: "Pos.", align: "right", render: (r) => <Pos value={r.position} strong /> },
        { key: "volume", header: "Volume", align: "right", render: (r) => (r.volume == null ? "n/a" : compact(r.volume)) },
        {
          key: "urls",
          header: "Competing URLs",
          sortValue: (r) => r.urls.length,
          render: (r) => (
            <ul className="space-y-1 py-0.5">
              {r.urls.map((u, i) => (
                <li key={u.url} className="flex items-center gap-2 text-[12.5px]">
                  <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: URL_COLORS[i % URL_COLORS.length] }} aria-hidden />
                  <a href={u.url} target="_blank" rel="noopener noreferrer" className="max-w-[300px] truncate text-link hover:underline" title={u.url}>
                    {displayUrl(u.url).replace(/^www\./, "")}
                  </a>
                  <span className="shrink-0 text-text-3">
                    {u.current != null ? `#${u.current} now` : "not ranking now"} · {u.days}d
                  </span>
                </li>
              ))}
            </ul>
          ),
          csv: (r) => r.urls.map((u) => `${u.url} (${u.current != null ? `#${u.current}` : "–"}, ${u.days}d)`).join("; "),
        },
        { key: "switches", header: "URL switches", align: "right", info: "Days on which the best-ranking URL changed." },
        { key: "multiDays", header: "Multi-URL days", align: "right", info: "Days on which two or more of your URLs ranked at the same time." },
        { key: "timeline", header: "Ranking URL by day", sortable: false, noExport: true, render: (r) => <Timeline values={r.timeline} days={days} /> },
      ]}
    />
  );
}
