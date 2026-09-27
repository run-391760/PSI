"use client";

import { ArrowDown, ArrowUp } from "lucide-react";
import { useMemo, useState } from "react";
import { KeywordLink } from "@/components/seo/badges";
import { buttonClass } from "@/components/ui/button";
import { CellLink, type Column, DataTable } from "@/components/ui/data-table";
import { Segmented } from "@/components/ui/tabs";
import { InfoTip } from "@/components/ui/tooltip";
import { compact, displayUrl, pct } from "@/lib/format";
import { keywordListHref } from "@/lib/competitive/links";
import type { OwnPageRow, OwnQueryRow, QueryStatus } from "@/lib/competitive/own-site-map";

const NA = <span className="text-text-3">n/a</span>;
type StatusFilter = "all" | Exclude<QueryStatus, "unchanged">;
type BrandFilter = "all" | "branded" | "nonbranded";

function Change({ row }: { row: OwnQueryRow }) {
  if (row.status === "new") return <span className="rounded bg-brand-soft px-1 text-[11px] font-semibold text-brand-ink">New</span>;
  if (row.status === "lost") return <span className="text-[12px] font-medium text-critical-ink">Lost</span>;
  if (row.change == null || Math.abs(row.change) < 0.1) return <span className="text-text-3">–</span>;
  const up = row.change > 0;
  return (
    <span className={`tabular inline-flex items-center text-[12.5px] font-medium ${up ? "text-good-ink" : "text-critical-ink"}`}>
      {up ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />}
      {Math.abs(row.change).toFixed(1)}
    </span>
  );
}

/**
 * Organic Research (own site): Search Console queries as the positions table. Average positions are
 * compared with the previous period of the same length; volume/KD need DataForSEO and show n/a.
 */
export function OwnQueriesTable({
  rows,
  db,
  comparable,
  initialStatus = "all",
  initialUrl = "",
  exportName,
  pageSize,
}: {
  rows: OwnQueryRow[];
  db: string;
  comparable: boolean;
  initialStatus?: StatusFilter;
  initialUrl?: string;
  exportName: string;
  pageSize?: number;
}) {
  const [status, setStatus] = useState<StatusFilter>(initialStatus);
  const [brand, setBrand] = useState<BrandFilter>("all");
  const [url, setUrl] = useState(initialUrl);
  const filtered = useMemo(
    () =>
      rows.filter(
        (r) =>
          (status === "all" ? r.status !== "lost" : r.status === status) &&
          (brand === "all" || (brand === "branded") === r.branded) &&
          (!url || r.url === url),
      ),
    [rows, status, brand, url],
  );
  const columns: Column<OwnQueryRow>[] = [
    { key: "query", header: "Query", render: (r) => <KeywordLink keyword={r.query} db={db} className="block max-w-[280px] truncate" /> },
    { key: "position", header: "Avg. pos.", align: "right", sortValue: (r) => r.position ?? 999, render: (r) => (r.position == null ? NA : r.position.toFixed(1)), csv: (r) => r.position ?? "" },
    ...(comparable
      ? ([
          { key: "change", header: "Change", align: "right", sortValue: (r) => r.change ?? (r.status === "new" ? 1000 : -1000), render: (r) => <Change row={r} />, csv: (r) => (r.status === "new" || r.status === "lost" ? r.status : (r.change ?? "")) },
          { key: "previousPosition", header: "Prev. pos.", align: "right", hideOnMobile: true, sortValue: (r) => r.previousPosition ?? 999, render: (r) => (r.previousPosition == null ? NA : r.previousPosition.toFixed(1)), csv: (r) => r.previousPosition ?? "" },
        ] as Column<OwnQueryRow>[])
      : []),
    { key: "clicks", header: "Clicks", align: "right", render: (r) => compact(r.clicks) },
    ...(comparable
      ? ([{ key: "previousClicks", header: "Prev. clicks", align: "right", hideOnMobile: true, sortValue: (r) => r.previousClicks ?? -1, render: (r) => (r.previousClicks == null ? NA : compact(r.previousClicks)) }] as Column<OwnQueryRow>[])
      : []),
    { key: "impressions", header: "Impressions", align: "right", render: (r) => compact(r.impressions) },
    { key: "ctr", header: "CTR", align: "right", sortValue: (r) => r.ctr, render: (r) => pct(r.ctr * 100, 1), csv: (r) => (r.ctr * 100).toFixed(2) },
    {
      key: "url",
      header: "Top URL",
      sortValue: (r) => r.url ?? "",
      render: (r) =>
        r.url ? (
          <button type="button" onClick={() => setUrl(r.url!)} className="block max-w-[260px] truncate text-left text-link hover:underline" title={`Show queries of ${r.url}`}>
            {displayUrl(r.url)}
          </button>
        ) : (
          NA
        ),
      csv: (r) => r.url ?? "",
    },
    {
      key: "volume",
      header: (
        <span className="inline-flex items-center gap-1">
          Volume <InfoTip text="Search volume, keyword difficulty and CPC need DataForSEO. Search Console reports impressions instead." />
        </span>
      ),
      csvHeader: "Volume",
      align: "right",
      sortable: false,
      hideOnMobile: true,
      render: () => NA,
      csv: () => "n/a",
    },
    { key: "branded", header: "Branded", exportOnly: true, csv: (r) => (r.branded ? "yes" : "no") },
  ];
  const statusOptions: { value: StatusFilter; label: string }[] = [
    { value: "all", label: "All" },
    ...(comparable
      ? ([
          { value: "improved", label: `Improved · ${compact(rows.filter((r) => r.status === "improved").length)}` },
          { value: "declined", label: `Declined · ${compact(rows.filter((r) => r.status === "declined").length)}` },
          { value: "new", label: `New · ${compact(rows.filter((r) => r.status === "new").length)}` },
          { value: "lost", label: `Lost · ${compact(rows.filter((r) => r.status === "lost").length)}` },
        ] as { value: StatusFilter; label: string }[])
      : []),
  ];
  return (
    <DataTable
      rows={filtered}
      columns={columns}
      rowKey={(r) => r.query}
      defaultSort={{ key: "clicks", dir: "desc" }}
      pageSize={pageSize}
      searchable
      searchPlaceholder="Filter queries"
      searchText={(r) => `${r.query} ${r.url ?? ""}`}
      exportName={exportName}
      selectable
      toolbar={
        <div className="flex flex-wrap items-center gap-2">
          {statusOptions.length > 1 && <div className="scroll-thin max-w-full overflow-x-auto"><Segmented options={statusOptions} value={status} onChange={setStatus} /></div>}
          <Segmented
            options={[
              { value: "all", label: "All queries" },
              { value: "branded", label: "Branded" },
              { value: "nonbranded", label: "Non-branded" },
            ]}
            value={brand}
            onChange={setBrand}
          />
          {url && (
            <button type="button" onClick={() => setUrl("")} className="rounded border border-border bg-surface-2 px-2 py-0.5 text-[12px] text-text-2 hover:text-text" title="Clear URL filter">
              URL: <span className="inline-block max-w-[200px] truncate align-bottom">{displayUrl(url)}</span> ✕
            </button>
          )}
        </div>
      }
      selectionActions={(selected) => (
        <>
          <a className={buttonClass("secondary", "sm")} href={`/position-tracking?import=${encodeURIComponent(selected.slice(0, 300).map((r) => r.query).join(","))}`}>
            Track positions
          </a>
          <a className={buttonClass("secondary", "sm")} href={keywordListHref(selected.map((r) => r.query), db)}>
            Add to keyword list
          </a>
        </>
      )}
      emptyText="No queries match these filters."
    />
  );
}

export function OwnPagesTable({ rows, comparable, positionsHref, exportName }: { rows: OwnPageRow[]; comparable: boolean; positionsHref: string; exportName: string }) {
  const columns: Column<OwnPageRow>[] = [
    {
      key: "url",
      header: "Page",
      render: (r) => (
        <CellLink href={r.url} external>
          <span className="block max-w-[360px] truncate" title={r.url}>
            {displayUrl(r.url)}
          </span>
        </CellLink>
      ),
    },
    { key: "clicks", header: "Clicks", align: "right", render: (r) => compact(r.clicks) },
    ...(comparable
      ? ([
          {
            key: "clicksChange",
            header: "Change",
            align: "right",
            sortValue: (r) => r.clicksChange ?? 0,
            render: (r) =>
              r.clicksChange == null || r.clicksChange === 0 ? (
                <span className="text-text-3">–</span>
              ) : (
                <span className={r.clicksChange > 0 ? "text-good-ink" : "text-critical-ink"}>
                  {r.clicksChange > 0 ? "+" : "−"}
                  {compact(Math.abs(r.clicksChange))}
                </span>
              ),
          },
        ] as Column<OwnPageRow>[])
      : []),
    { key: "impressions", header: "Impressions", align: "right", render: (r) => compact(r.impressions) },
    { key: "ctr", header: "CTR", align: "right", render: (r) => pct(r.ctr * 100, 1), csv: (r) => (r.ctr * 100).toFixed(2) },
    { key: "position", header: "Avg. pos.", align: "right", render: (r) => r.position.toFixed(1) },
    {
      key: "queries",
      header: "Queries",
      align: "right",
      render: (r) => (r.queries ? <CellLink href={`${positionsHref}&url=${encodeURIComponent(r.url)}`}>{compact(r.queries)}</CellLink> : compact(r.queries)),
    },
    { key: "topQuery", header: "Top query", hideOnMobile: true, sortValue: (r) => r.topQuery ?? "", render: (r) => (r.topQuery ? <span className="block max-w-[220px] truncate text-text-2">{r.topQuery}</span> : NA) },
  ];
  return <DataTable rows={rows} columns={columns} rowKey={(r) => r.url} defaultSort={{ key: "clicks", dir: "desc" }} searchable searchPlaceholder="Filter pages" searchText={(r) => `${r.url} ${r.topQuery ?? ""}`} exportName={exportName} />;
}
