"use client";

import { ExternalLink } from "lucide-react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import type { IssueRow } from "@/lib/site-audit/data";
import { type Column, DataTable } from "@/components/ui/data-table";
import { HttpStatus, pathOf } from "./ui";

/** Affected URLs of one check (with the page drawer link and CSV export). */
export function IssueTable({ rows, exportName, scope }: { rows: IssueRow[]; exportName: string; scope: "page" | "link" | "site" }) {
  const pathname = usePathname();
  const search = useSearchParams();
  const pageHref = (id: number) => {
    const p = new URLSearchParams(search.toString());
    p.set("tab", "pages");
    p.delete("issue");
    p.set("page", String(id));
    return `${pathname}?${p.toString()}`;
  };
  const columns: Column<IssueRow>[] = [
    {
      key: "url",
      header: scope === "link" ? "Page with the link" : "URL",
      sortValue: (r) => r.url,
      render: (r) => (
        <div className="max-w-[420px] min-w-[200px]">
          <div className="flex items-center gap-1.5">
            {r.page_id != null ? (
              <Link href={pageHref(r.page_id)} scroll={false} className="truncate font-medium text-link hover:underline" title={r.url}>
                {pathOf(r.url)}
              </Link>
            ) : (
              <span className="truncate font-medium text-text" title={r.url}>
                {r.url}
              </span>
            )}
            <a href={r.url} target="_blank" rel="noopener noreferrer" className="shrink-0 text-text-3 hover:text-text" aria-label="Open URL">
              <ExternalLink className="h-3 w-3" />
            </a>
          </div>
          {r.title && <div className="truncate text-[12px] text-text-3">{r.title}</div>}
        </div>
      ),
    },
    { key: "detail", header: scope === "link" ? "Link / target" : "Details", sortValue: (r) => r.detail, render: (r) => <div className="max-w-[520px] min-w-[180px] text-[12.5px] break-words text-text-2">{r.detail || <span className="text-text-3">—</span>}</div> },
    { key: "status", header: "Status", sortValue: (r) => r.status ?? -1, render: (r) => (r.page_id == null ? <span className="text-text-3">—</span> : <HttpStatus status={r.status} blocked />) },
    { key: "depth", header: "Depth", align: "right", sortValue: (r) => r.depth ?? 999, render: (r) => (r.depth == null ? <span className="text-text-3">n/a</span> : r.depth) },
    { key: "inlinks", header: "Inlinks", align: "right", sortValue: (r) => r.inlinks ?? -1, render: (r) => (r.inlinks == null ? <span className="text-text-3">n/a</span> : r.inlinks) },
  ];
  return (
    <DataTable
      rows={rows}
      columns={columns}
      rowKey={(r, i) => `${r.url}-${i}`}
      searchable
      searchPlaceholder="Filter URLs or details"
      searchText={(r) => `${r.url} ${r.detail}`}
      exportName={exportName}
      pageSize={25}
    />
  );
}
