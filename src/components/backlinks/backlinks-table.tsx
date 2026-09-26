"use client";

import { useMemo, useState } from "react";
import type { BacklinkRow } from "@/lib/backlinks/types";
import { displayUrl } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { type Column, DataTable } from "@/components/ui/data-table";
import { Checkbox, Input, Select } from "@/components/ui/input";
import { NewLostBadge, RelBadges, shortDate } from "./bits";
import { ExportButton, useCsvExport, ScrollSegmented } from "./table-tools";

type Status = "all" | "active" | "new" | "lost";

const TYPE_LABEL: Record<BacklinkRow["type"], string> = { text: "Text", image: "Image", form: "Form", frame: "Frame" };

const columns: Column<BacklinkRow>[] = [
  {
    key: "pageAs",
    header: "Page AS",
    align: "right",
    width: "84px",
    info: "Authority Score of the linking page (0–100).",
    render: (r) => <span className="tabular inline-flex h-5 min-w-7 items-center justify-center rounded border border-border-strong px-1 text-[11.5px] font-semibold">{r.pageAs}</span>,
  },
  {
    key: "source",
    header: "Source page title and URL",
    sortValue: (r) => r.sourceUrl,
    render: (r) => (
      <div className="max-w-[420px] min-w-[220px]">
        <div className="truncate font-medium text-text" title={r.sourceTitle}>
          {r.sourceTitle || "Untitled page"}
        </div>
        <a href={r.sourceUrl} target="_blank" rel="noopener noreferrer nofollow" className="block truncate text-[12.5px] text-link hover:underline" title={r.sourceUrl}>
          {displayUrl(r.sourceUrl)}
        </a>
        <div className="mt-0.5 text-[11.5px] text-text-3">
          Ext. links {r.externalLinks} · Int. links {r.internalLinks}
          {r.language ? ` · ${r.language.toUpperCase()}` : ""}
        </div>
      </div>
    ),
  },
  {
    key: "anchor",
    header: "Anchor and target URL",
    sortValue: (r) => r.anchor,
    render: (r) => (
      <div className="max-w-[380px] min-w-[220px]">
        <div className="truncate text-text" title={r.anchor}>
          {r.anchor ? r.anchor : <span className="text-text-3 italic">{r.type === "image" ? "<Image>" : "<EmptyAnchor>"}</span>}
        </div>
        <a href={r.targetUrl} target="_blank" rel="noopener noreferrer" className="block truncate text-[12.5px] text-link hover:underline" title={r.targetUrl}>
          {displayUrl(r.targetUrl)}
        </a>
        <div className="mt-1 flex flex-wrap items-center gap-1">
          <Badge>{TYPE_LABEL[r.type]}</Badge>
          <RelBadges rel={r.rel} follow={r.follow} />
          <NewLostBadge isNew={r.isNew} isLost={r.isLost} />
        </div>
      </div>
    ),
  },
  { key: "firstSeen", header: "First seen", align: "right", render: (r) => <span className="whitespace-nowrap text-text-2">{shortDate(r.firstSeen)}</span> },
  { key: "lastSeen", header: "Last seen", align: "right", render: (r) => <span className="whitespace-nowrap text-text-2">{shortDate(r.lastSeen)}</span> },
];

export function BacklinksTable({ rows, domain }: { rows: BacklinkRow[]; domain: string }) {
  const [status, setStatus] = useState<Status>("all");
  const [type, setType] = useState("");
  const [attr, setAttr] = useState("");
  const [anchor, setAnchor] = useState("");
  const [perDomain, setPerDomain] = useState(false);

  const filtered = useMemo(() => {
    const needle = anchor.trim().toLowerCase();
    const seen = new Set<string>();
    return rows.filter((r) => {
      if (status === "active" && r.isLost) return false;
      if (status === "new" && !r.isNew) return false;
      if (status === "lost" && !r.isLost) return false;
      if (type && r.type !== type) return false;
      if (attr === "follow" && !r.follow) return false;
      if (attr && attr !== "follow" && !r.rel.includes(attr)) return false;
      if (needle && !r.anchor.toLowerCase().includes(needle)) return false;
      if (perDomain) {
        if (seen.has(r.sourceDomain)) return false;
        seen.add(r.sourceDomain);
      }
      return true;
    });
  }, [rows, status, type, attr, anchor, perDomain]);

  const counts = useMemo(() => ({ new: rows.filter((r) => r.isNew).length, lost: rows.filter((r) => r.isLost).length }), [rows]);
  const { onRowsChange, exportCsv } = useCsvExport<BacklinkRow>(
    `${domain}-backlinks`,
    ["Page AS", "Source title", "Source URL", "Anchor", "Target URL", "Type", "Attributes", "First seen", "Last seen", "Status", "External links", "Internal links"],
    (r) => [r.pageAs, r.sourceTitle, r.sourceUrl, r.anchor, r.targetUrl, TYPE_LABEL[r.type], r.rel.length ? r.rel.join(" ") : "follow", r.firstSeen, r.lastSeen, r.isLost ? "lost" : r.isNew ? "new" : "active", r.externalLinks, r.internalLinks],
  );

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 px-4 pb-3">
        <ScrollSegmented<Status>
          value={status}
          onChange={setStatus}
          options={[
            { value: "all", label: "All" },
            { value: "active", label: "Active" },
            { value: "new", label: `New · ${counts.new}` },
            { value: "lost", label: `Lost · ${counts.lost}` },
          ]}
        />
        <Select value={type} onChange={(e) => setType(e.target.value)} className="h-8 w-auto" aria-label="Link type">
          <option value="">All types</option>
          <option value="text">Text</option>
          <option value="image">Image</option>
          <option value="form">Form</option>
          <option value="frame">Frame</option>
        </Select>
        <Select value={attr} onChange={(e) => setAttr(e.target.value)} className="h-8 w-auto" aria-label="Link attributes">
          <option value="">All attributes</option>
          <option value="follow">Follow</option>
          <option value="nofollow">Nofollow</option>
          <option value="ugc">UGC</option>
          <option value="sponsored">Sponsored</option>
        </Select>
        <Input value={anchor} onChange={(e) => setAnchor(e.target.value)} placeholder="Anchor contains…" className="h-8 w-44" aria-label="Filter by anchor text" />
        <label className="inline-flex cursor-pointer items-center gap-1.5 text-[12.5px] text-text-2">
          <Checkbox checked={perDomain} onChange={(e) => setPerDomain(e.target.checked)} /> One link per domain
        </label>
      </div>
      <DataTable
        rows={filtered}
        columns={columns}
        rowKey={(r) => r.id}
        defaultSort={{ key: "pageAs", dir: "desc" }}
        searchable
        searchPlaceholder="Filter by source or target URL"
        searchText={(r) => `${r.sourceUrl} ${r.sourceTitle} ${r.targetUrl}`}
        toolbar={
          <div className="flex flex-1 flex-wrap items-center gap-2">
            <span className="text-[12.5px] text-text-3">{filtered.length.toLocaleString()} backlinks</span>
            <ExportButton onClick={exportCsv} className="ml-auto" />
          </div>
        }
        onRowsChange={onRowsChange}
        emptyText="No backlinks match these filters."
      />
    </div>
  );
}
