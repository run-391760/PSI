"use client";

import { useMemo, useState } from "react";
import { compact, displayUrl } from "@/lib/format";
import { DomainAvatar } from "@/components/seo/badges";
import { Badge } from "@/components/ui/badge";
import { DataTable } from "@/components/ui/data-table";
import { Select } from "@/components/ui/input";
import { Pos } from "./ui";

export type SnippetRow = {
  id: string;
  keyword: string;
  volume: number | null;
  position: number | null;
  owner: string | null;
  prevOwner: string | null;
  ownerIsCompetitor: boolean;
  status: "owned" | "opportunity" | "other";
  url: string | null;
};

export function SnippetsTable({ rows, domain, exportName, kwBase }: { rows: SnippetRow[]; domain: string; exportName: string; kwBase: string }) {
  const [status, setStatus] = useState("all");
  const visible = useMemo(() => (status === "all" ? rows : status === "competitor" ? rows.filter((r) => r.ownerIsCompetitor) : rows.filter((r) => r.status === status)), [rows, status]);
  return (
    <DataTable
      rows={visible}
      rowKey={(r) => r.id}
      exportName={exportName}
      searchable
      searchText={(r) => `${r.keyword} ${r.owner ?? ""}`}
      emptyText="No featured snippets match."
      toolbar={
        <Select value={status} onChange={(e) => setStatus(e.target.value)} className="h-8 w-auto text-[12.5px]" aria-label="Snippet status">
          <option value="all">All snippets</option>
          <option value="owned">Owned by you</option>
          <option value="opportunity">Opportunities</option>
          <option value="competitor">Owned by competitors</option>
        </Select>
      }
      columns={[
        {
          key: "keyword",
          header: "Keyword",
          sortValue: (r) => r.keyword,
          render: (r) => (
            <a href={`${kwBase}&kw=${r.id}`} className="text-link hover:underline">
              {r.keyword}
            </a>
          ),
        },
        {
          key: "status",
          header: "Status",
          sortValue: (r) => (r.status === "opportunity" ? 3 : r.status === "owned" ? 2 : 1),
          render: (r) =>
            r.status === "owned" ? <Badge tone="good">Owned</Badge> : r.status === "opportunity" ? <Badge tone="warning">Opportunity</Badge> : <Badge>Not in top 10</Badge>,
        },
        {
          key: "owner",
          header: "Snippet owner",
          sortValue: (r) => r.owner,
          render: (r) =>
            r.owner ? (
              <span className="inline-flex items-center gap-1.5">
                <DomainAvatar domain={r.owner} size={16} />
                <span className={r.owner === domain ? "font-semibold text-text" : "text-text-2"}>{r.owner}</span>
                {r.ownerIsCompetitor && <span className="text-[11px] text-text-3">competitor</span>}
              </span>
            ) : (
              <span className="text-text-3">n/a</span>
            ),
        },
        { key: "prevOwner", header: "Owner at start", sortValue: (r) => r.prevOwner, render: (r) => (r.prevOwner === r.owner ? <span className="text-text-3">same</span> : (r.prevOwner ?? <span className="text-text-3">no snippet</span>)) },
        { key: "position", header: "Your pos.", align: "right", render: (r) => <Pos value={r.position} strong /> },
        { key: "volume", header: "Volume", align: "right", render: (r) => (r.volume == null ? "n/a" : compact(r.volume)) },
        {
          key: "url",
          header: "Your URL",
          render: (r) =>
            r.url ? (
              <a href={r.url} target="_blank" rel="noopener noreferrer" className="block max-w-[260px] truncate text-link hover:underline" title={r.url}>
                {displayUrl(r.url).replace(/^www\./, "")}
              </a>
            ) : (
              <span className="text-text-3">–</span>
            ),
        },
      ]}
    />
  );
}
