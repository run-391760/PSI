"use client";

import { ExternalLink } from "lucide-react";
import { useMemo } from "react";
import { compact, displayUrl } from "@/lib/format";
import type { SerpRow } from "@/lib/keywords/overview";
import { AsBadge, DomainLink } from "@/components/seo/badges";
import { Badge } from "@/components/ui/badge";
import { DataTable, type Column } from "@/components/ui/data-table";

const na = <span className="text-text-3">n/a</span>;

/** SERP analysis table (Keyword Overview). */
export function SerpTable({ rows, keyword, db }: { rows: SerpRow[]; keyword: string; db: string }) {
  const columns = useMemo<Column<SerpRow>[]>(
    () => [
      { key: "position", header: "Pos.", align: "right", width: "56px", sortValue: (r) => r.position },
      {
        key: "url",
        header: "URL",
        sortValue: (r) => r.domain,
        csv: (r) => r.url,
        render: (r) => (
          <div className="min-w-0 max-w-[520px] py-0.5">
            <div className="flex items-center gap-1.5">
              <DomainLink domain={r.domain} db={db} className="text-[12.5px]" />
              {r.isProject && <Badge tone="brand">Your project</Badge>}
            </div>
            <div className="truncate text-[13px] text-text" title={r.title}>
              {r.title}
            </div>
            <a href={r.url} target="_blank" rel="noopener noreferrer nofollow" className="inline-flex max-w-full items-center gap-1 text-[12px] text-text-3 hover:text-link" title={r.url}>
              <span className="truncate">{displayUrl(r.url)}</span>
              <ExternalLink className="h-3 w-3 shrink-0" />
            </a>
          </div>
        ),
      },
      { key: "domainAs", header: "Domain AS", align: "right", info: "Authority Score of the ranking domain (0–100).", sortValue: (r) => r.domainAs, render: (r) => (r.domainAs == null ? na : <AsBadge score={r.domainAs} />) },
      { key: "refDomains", header: "Ref. domains", align: "right", info: "Referring domains pointing to the ranking URL.", sortValue: (r) => r.refDomains, render: (r) => (r.refDomains == null ? na : compact(r.refDomains)) },
      { key: "backlinks", header: "Backlinks", align: "right", info: "Backlinks pointing to the ranking URL.", sortValue: (r) => r.backlinks, render: (r) => (r.backlinks == null ? na : compact(r.backlinks)) },
      { key: "traffic", header: "Search traffic", align: "right", info: "Estimated monthly organic visits to the URL from all keywords it ranks for.", sortValue: (r) => r.traffic, render: (r) => (r.traffic == null ? na : compact(r.traffic)) },
      { key: "urlKeywords", header: "URL keywords", align: "right", info: "Keywords the URL ranks for in Google's top 100.", sortValue: (r) => r.urlKeywords, render: (r) => (r.urlKeywords == null ? na : compact(r.urlKeywords)) },
    ],
    [db],
  );
  return (
    <DataTable
      rows={rows}
      columns={columns}
      rowKey={(r) => `${r.position}:${r.url}`}
      defaultSort={{ key: "position", dir: "asc" }}
      pageSize={10}
      exportName={`serp_${keyword.replace(/\s+/g, "-")}_${db}`}
      rowClassName={(r) => (r.isProject ? "bg-brand-soft/40" : undefined)}
      dense
    />
  );
}
