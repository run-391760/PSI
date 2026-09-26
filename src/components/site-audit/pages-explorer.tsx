"use client";

import { ExternalLink } from "lucide-react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import type { PageRow } from "@/lib/site-audit/data";
import { cn } from "@/lib/utils";
import { type Column, DataTable } from "@/components/ui/data-table";
import { Select } from "@/components/ui/input";
import { fmtBytes, fmtMs, HttpStatus, pathOf } from "./ui";

export type PagesFilter = { status: string; issues: string; depth: string; index: string };
const STATUS_OPTS = [
  ["all", "All statuses"],
  ["2xx", "2xx OK"],
  ["3xx", "3xx Redirect"],
  ["4xx", "4xx Client error"],
  ["5xx", "5xx Server error"],
  ["failed", "Failed (no response)"],
  ["blocked", "Blocked by robots.txt"],
] as const;
const ISSUE_OPTS = [
  ["all", "All pages"],
  ["errors", "With errors"],
  ["warnings", "With warnings"],
  ["notices", "With notices"],
  ["issues", "Have issues (errors or warnings)"],
  ["healthy", "Healthy"],
  ["broken", "Broken (4xx/5xx/failed)"],
] as const;
const DEPTH_OPTS = [
  ["all", "Any depth"],
  ["0", "0 (start page)"],
  ["1", "1 click"],
  ["2", "2 clicks"],
  ["3", "3 clicks"],
  ["4+", "4+ clicks"],
  ["none", "Not linked (sitemap only)"],
] as const;
const INDEX_OPTS = [
  ["all", "Indexable + non-indexable"],
  ["yes", "Indexable"],
  ["no", "Non-indexable"],
  ["sitemap", "In sitemap"],
] as const;

function matches(r: PageRow, f: PagesFilter) {
  const s = r.status;
  switch (f.status) {
    case "2xx":
      if (!(s != null && s >= 200 && s < 300)) return false;
      break;
    case "3xx":
      if (!(s != null && s >= 300 && s < 400)) return false;
      break;
    case "4xx":
      if (!(s != null && s >= 400 && s < 500)) return false;
      break;
    case "5xx":
      if (!(s != null && s >= 500)) return false;
      break;
    case "failed":
      if (s !== 0) return false;
      break;
    case "blocked":
      if (s != null) return false;
      break;
  }
  const ok2xx = s != null && s >= 200 && s < 300;
  switch (f.issues) {
    case "errors":
      if (!r.errors) return false;
      break;
    case "warnings":
      if (!r.warnings) return false;
      break;
    case "notices":
      if (!r.notices) return false;
      break;
    case "issues":
      if (!(ok2xx && (r.errors || r.warnings))) return false;
      break;
    case "healthy":
      if (!(ok2xx && !r.errors && !r.warnings)) return false;
      break;
    case "broken":
      if (!(s != null && (s === 0 || s >= 400))) return false;
      break;
  }
  if (f.depth !== "all") {
    if (f.depth === "none") {
      if (r.depth != null) return false;
    } else if (f.depth === "4+") {
      if (r.depth == null || r.depth < 4) return false;
    } else if (r.depth !== Number(f.depth)) return false;
  }
  if (f.index === "yes" && !r.indexable) return false;
  if (f.index === "no" && r.indexable) return false;
  if (f.index === "sitemap" && !r.in_sitemap) return false;
  return true;
}

function IssueChips({ r }: { r: PageRow }) {
  if (!r.errors && !r.warnings && !r.notices) return <span className="text-[12px] text-good-ink">None</span>;
  return (
    <span className="inline-flex gap-1">
      {r.errors > 0 && <span className="tabular rounded bg-critical-soft px-1.5 text-[11.5px] font-medium text-critical-ink" title="Errors">{r.errors}</span>}
      {r.warnings > 0 && <span className="tabular rounded bg-warning-soft px-1.5 text-[11.5px] font-medium text-warning-ink" title="Warnings">{r.warnings}</span>}
      {r.notices > 0 && <span className="tabular rounded bg-info-soft px-1.5 text-[11.5px] font-medium text-link" title="Notices">{r.notices}</span>}
    </span>
  );
}

/** Crawled pages explorer: filters by status / issues / depth / indexability; rows open the page drawer (?page=). */
export function PagesExplorer({ rows, initial, exportHref }: { rows: PageRow[]; initial: PagesFilter; exportHref: string }) {
  const [f, setF] = useState<PagesFilter>(initial);
  const pathname = usePathname();
  const search = useSearchParams();
  const hrefFor = (id: number) => {
    const p = new URLSearchParams(search.toString());
    p.set("page", String(id));
    return `${pathname}?${p.toString()}`;
  };
  const filtered = useMemo(() => rows.filter((r) => matches(r, f)), [rows, f]);
  const columns: Column<PageRow>[] = [
    {
      key: "url",
      header: "Page",
      sortValue: (r) => r.url,
      csv: (r) => r.url,
      render: (r) => (
        <div className="max-w-[460px] min-w-[220px]">
          <div className="flex items-center gap-1.5">
            <Link href={hrefFor(r.id)} scroll={false} className="truncate font-medium text-link hover:underline" title={r.url}>
              {pathOf(r.url)}
            </Link>
            <a href={r.url} target="_blank" rel="noopener noreferrer" className="shrink-0 text-text-3 hover:text-text" aria-label="Open the live page">
              <ExternalLink className="h-3 w-3" />
            </a>
          </div>
          <div className="truncate text-[12px] text-text-3" title={r.title ?? undefined}>
            {r.status == null ? "Blocked by robots.txt" : r.status === 0 ? (r.error ?? "No response") : r.status >= 300 && r.status < 400 ? `→ ${r.final_url ?? "?"}` : (r.title ?? (r.content_type && r.content_type !== "text/html" ? r.content_type : "No title"))}
          </div>
        </div>
      ),
    },
    { key: "status", header: "Status", sortValue: (r) => r.status ?? -1, render: (r) => <HttpStatus status={r.status} blocked={!!r.blocked} /> },
    {
      key: "issues",
      header: "Issues",
      sortValue: (r) => r.errors * 10000 + r.warnings * 100 + r.notices,
      csv: (r) => `${r.errors} errors, ${r.warnings} warnings, ${r.notices} notices`,
      render: (r) => <IssueChips r={r} />,
    },
    { key: "depth", header: "Depth", align: "right", sortValue: (r) => r.depth ?? 999, render: (r) => (r.depth == null ? <span className="text-text-3">n/a</span> : r.depth) },
    { key: "inlinks", header: "Inlinks", align: "right", info: "Unique crawled pages linking here", render: (r) => r.inlinks.toLocaleString() },
    { key: "words", header: "Words", align: "right", sortValue: (r) => r.words ?? -1, render: (r) => (r.words == null ? <span className="text-text-3">n/a</span> : r.words.toLocaleString()) },
    {
      key: "response_ms",
      header: "Load",
      align: "right",
      info: "Time to download the HTML",
      sortValue: (r) => r.response_ms ?? -1,
      render: (r) => <span className={cn((r.response_ms ?? 0) > 3000 ? "text-critical-ink" : (r.response_ms ?? 0) > 1000 ? "text-warning-ink" : "")}>{fmtMs(r.response_ms)}</span>,
    },
    { key: "size_bytes", header: "Size", align: "right", sortValue: (r) => r.size_bytes ?? -1, render: (r) => fmtBytes(r.size_bytes) },
    {
      key: "indexable",
      header: "Indexable",
      sortValue: (r) => (r.indexable ? 1 : 0),
      csv: (r) => (r.indexable ? "yes" : "no"),
      render: (r) => (r.indexable ? <span className="text-good-ink">Yes</span> : <span className="text-text-3">No</span>),
    },
    {
      key: "in_sitemap",
      header: "Sitemap",
      sortValue: (r) => (r.in_sitemap ? 1 : 0),
      csv: (r) => (r.in_sitemap ? "yes" : "no"),
      render: (r) => (r.in_sitemap ? <span className="text-text">Yes</span> : <span className="text-text-3">—</span>),
    },
  ];
  const sel = (key: keyof PagesFilter, opts: readonly (readonly [string, string])[], label: string) => (
    <Select aria-label={label} value={f[key]} onChange={(e) => setF((x) => ({ ...x, [key]: e.target.value }))} className="h-8 w-auto max-w-[200px] text-[12.5px]">
      {opts.map(([v, l]) => (
        <option key={v} value={v}>
          {l}
        </option>
      ))}
    </Select>
  );
  const active = f.status !== "all" || f.issues !== "all" || f.depth !== "all" || f.index !== "all";
  return (
    <DataTable
      rows={filtered}
      columns={columns}
      rowKey={(r) => String(r.id)}
      searchable
      searchPlaceholder="Filter by URL or title"
      searchText={(r) => `${r.url} ${r.title ?? ""}`}
      exportName="site-audit-pages"
      defaultSort={{ key: "issues", dir: "desc" }}
      toolbar={
        <div className="flex flex-wrap items-center gap-2">
          {sel("status", STATUS_OPTS, "Status")}
          {sel("issues", ISSUE_OPTS, "Issues")}
          {sel("depth", DEPTH_OPTS, "Crawl depth")}
          {sel("index", INDEX_OPTS, "Indexability")}
          {active && (
            <button type="button" onClick={() => setF({ status: "all", issues: "all", depth: "all", index: "all" })} className="text-[12.5px] text-link hover:underline">
              Reset
            </button>
          )}
          <span className="text-[12.5px] text-text-3">
            {filtered.length.toLocaleString()} of {rows.length.toLocaleString()}
          </span>
          <a href={exportHref} className="text-[12.5px] text-link hover:underline">
            Full export (all fields)
          </a>
        </div>
      }
      emptyText="No pages match these filters."
    />
  );
}
