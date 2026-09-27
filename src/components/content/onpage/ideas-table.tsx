"use client";

import { ChevronRight } from "lucide-react";
import Link from "next/link";
import type { IdeaType } from "@/lib/content/ideas";
import { compact, displayUrl } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { type Column, DataTable } from "@/components/ui/data-table";
import { Bar } from "@/components/ui/progress";

export type IdeaRow = {
  targetId: string;
  url: string;
  keyword: string;
  impressions: number | null;
  position: number | null;
  priority: number;
  total: number;
  open: number;
  high: number;
  byType: Partial<Record<IdeaType, number>>;
  status: string | null;
};

const TYPES: { id: IdeaType; label: string }[] = [
  { id: "strategy", label: "Strategy" },
  { id: "serp", label: "SERP" },
  { id: "semantic", label: "Semantic" },
  { id: "content", label: "Content" },
  { id: "backlinks", label: "Backlinks" },
  { id: "technical", label: "Technical" },
  { id: "ux", label: "UX" },
];

export function priorityTone(score: number) {
  return score >= 70 ? "var(--critical)" : score >= 45 ? "var(--serious)" : score >= 25 ? "var(--warning)" : "var(--good)";
}

export function IdeasTable({ rows, projectId, domain }: { rows: IdeaRow[]; projectId: string; domain: string }) {
  const columns: Column<IdeaRow>[] = [
    {
      key: "url",
      header: "Page",
      render: (r) => (
        <Link href={`/on-page-checker/${r.targetId}?project=${projectId}`} className="block max-w-[300px] min-w-[180px] truncate text-link hover:underline" title={r.url}>
          {displayUrl(r.url)}
        </Link>
      ),
    },
    { key: "keyword", header: "Keyword", render: (r) => <span className="block max-w-[220px] truncate">{r.keyword}</span> },
    {
      key: "priority",
      header: "Priority",
      info: "0–100: traffic you could gain by reaching the top 3, plus the weight of open high-priority ideas.",
      render: (r) => (
        <div className="flex w-28 items-center gap-2">
          <Bar value={r.priority} color={priorityTone(r.priority)} className="w-16" />
          <span className="tabular text-[12.5px] font-medium">{r.priority}</span>
        </div>
      ),
    },
    { key: "impressions", header: "Impr. (28d)", align: "right", info: "Search Console impressions of the page in the last 28 days.", render: (r) => (r.impressions == null ? <span className="text-text-3">n/a</span> : compact(r.impressions)), sortValue: (r) => r.impressions ?? -1 },
    { key: "position", header: "Pos.", align: "right", info: "Average Search Console position, or the position in the live top results.", render: (r) => r.position ?? <span className="text-text-3">n/a</span>, sortValue: (r) => r.position ?? 101 },
    {
      key: "open",
      header: "Ideas",
      align: "right",
      render: (r) => (
        <span className="tabular">
          <span className="font-semibold text-text">{r.open}</span>
          {r.open !== r.total && <span className="text-text-3"> / {r.total}</span>}
        </span>
      ),
      csv: (r) => r.open,
    },
    ...TYPES.map(
      (t): Column<IdeaRow> => ({
        key: t.id,
        header: t.label,
        align: "right",
        sortValue: (r) => r.byType[t.id] ?? 0,
        render: (r) => (r.byType[t.id] ? <span className="tabular">{r.byType[t.id]}</span> : <span className="text-text-3">–</span>),
      }),
    ),
    {
      key: "status",
      header: "Page",
      render: (r) => (r.status ? <Badge tone="critical">{r.status}</Badge> : <Badge tone="good">Fetched</Badge>),
      csv: (r) => r.status ?? "Fetched",
    },
    {
      key: "go",
      header: "",
      sortable: false,
      noExport: true,
      render: (r) => (
        <Link href={`/on-page-checker/${r.targetId}?project=${projectId}`} className="inline-flex items-center text-[12.5px] text-link hover:underline" aria-label={`Ideas for ${r.url}`}>
          Ideas <ChevronRight className="h-3.5 w-3.5" />
        </Link>
      ),
    },
  ];
  return (
    <DataTable
      rows={rows}
      columns={columns}
      rowKey={(r) => r.targetId}
      defaultSort={{ key: "priority", dir: "desc" }}
      searchable
      searchPlaceholder="Filter by URL or keyword"
      searchText={(r) => `${r.url} ${r.keyword}`}
      exportName={`on-page-ideas-${domain}`}
    />
  );
}
