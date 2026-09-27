"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ANCHOR_TYPE_LABELS, type AnchorRow, type AnchorType, type CompetitorRow, type IndexedPageRow, type IpRow, type OutboundRow, type RefDomainRow } from "@/lib/backlinks/types";
import { database } from "@/lib/domain";
import { compact, displayUrl, pct } from "@/lib/format";
import { AsBadge } from "@/components/seo/badges";
import { Badge } from "@/components/ui/badge";
import { type Column, DataTable } from "@/components/ui/data-table";
import { Input, Select } from "@/components/ui/input";
import { Bar } from "@/components/ui/progress";
import { BlDomainLink, CountryLabel, NewLostBadge, shortDate } from "./bits";
import { ExportButton, useCsvExport, ScrollSegmented } from "./table-tools";

/* ------------------------------------------------------------------------------------------------
 * Referring domains
 * ---------------------------------------------------------------------------------------------- */

const rdColumns: Column<RefDomainRow>[] = [
  {
    key: "domain",
    header: "Root domain",
    render: (r) => (
      <div className="min-w-[200px]">
        <BlDomainLink domain={r.domain} />
        {r.category && (
          <div className="mt-0.5 flex items-center gap-1.5 text-[11.5px] text-text-3">
            <span className="truncate">{r.category}</span>
          </div>
        )}
      </div>
    ),
  },
  { key: "authorityScore", header: "Domain AS", align: "right", render: (r) => <AsBadge score={r.authorityScore} /> },
  { key: "backlinks", header: "Backlinks", align: "right", render: (r) => compact(r.backlinks) },
  {
    key: "ip",
    header: "IP / Country",
    sortValue: (r) => r.country + r.ip,
    render: (r) => (
      <div className="whitespace-nowrap">
        <div className="tabular text-text-2">{r.ip || "n/a"}</div>
        <div className="text-[11.5px] text-text-3">
          <CountryLabel code={r.country} />
        </div>
      </div>
    ),
  },
  {
    key: "follow",
    header: "Link",
    sortValue: (r) => (r.isLost ? 0 : r.isNew ? 2 : 1),
    render: (r) => (
      <span className="inline-flex flex-wrap gap-1">
        {r.follow ? <Badge tone="good">Follow</Badge> : <Badge>Nofollow</Badge>}
        <NewLostBadge isNew={r.isNew} isLost={r.isLost} />
      </span>
    ),
  },
  { key: "firstSeen", header: "First seen", align: "right", render: (r) => <span className="whitespace-nowrap text-text-2">{shortDate(r.firstSeen)}</span> },
  { key: "lastSeen", header: "Last seen", align: "right", render: (r) => <span className="whitespace-nowrap text-text-2">{shortDate(r.lastSeen)}</span> },
];

export function RefDomainsTable({ rows, domain }: { rows: RefDomainRow[]; domain: string }) {
  const [asMin, setAsMin] = useState("");
  const [asMax, setAsMax] = useState("");
  const [country, setCountry] = useState("");
  const [status, setStatus] = useState("");
  const [follow, setFollow] = useState("");
  const countries = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of rows) if (r.country) m.set(r.country, (m.get(r.country) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [rows]);
  const filtered = useMemo(() => {
    const lo = asMin === "" ? 0 : Number(asMin);
    const hi = asMax === "" ? 100 : Number(asMax);
    return rows.filter((r) => {
      if (r.authorityScore < lo || r.authorityScore > hi) return false;
      if (country && r.country !== country) return false;
      if (status === "new" && !r.isNew) return false;
      if (status === "lost" && !r.isLost) return false;
      if (status === "active" && r.isLost) return false;
      if (follow === "follow" && !r.follow) return false;
      if (follow === "nofollow" && r.follow) return false;
      return true;
    });
  }, [rows, asMin, asMax, country, status, follow]);
  const { onRowsChange, exportCsv } = useCsvExport<RefDomainRow>(
    `${domain}-referring-domains`,
    ["Domain", "Authority Score", "Backlinks", "IP", "Country", "Category", "Follow", "First seen", "Last seen", "Status"],
    (r) => [r.domain, r.authorityScore, r.backlinks, r.ip, r.country, r.category, r.follow, r.firstSeen, r.lastSeen, r.isLost ? "lost" : r.isNew ? "new" : "active"],
  );
  const asInvalid = (asMin !== "" && (Number(asMin) < 0 || Number(asMin) > 100)) || (asMax !== "" && (Number(asMax) < 0 || Number(asMax) > 100)) || (asMin !== "" && asMax !== "" && Number(asMin) > Number(asMax));
  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 px-4 pb-3">
        <div className="inline-flex items-center gap-1.5 text-[12.5px] text-text-2">
          AS
          <Input type="number" min={0} max={100} value={asMin} onChange={(e) => setAsMin(e.target.value)} placeholder="0" className="h-8 w-16" aria-label="Minimum Authority Score" aria-invalid={asInvalid} />–
          <Input type="number" min={0} max={100} value={asMax} onChange={(e) => setAsMax(e.target.value)} placeholder="100" className="h-8 w-16" aria-label="Maximum Authority Score" aria-invalid={asInvalid} />
        </div>
        <Select value={country} onChange={(e) => setCountry(e.target.value)} className="h-8 w-auto" aria-label="Country">
          <option value="">All countries</option>
          {countries.map(([c, n]) => (
            <option key={c} value={c}>
              {database(c).code === c ? `${database(c).flag} ${database(c).name}` : c} ({n})
            </option>
          ))}
        </Select>
        <Select value={status} onChange={(e) => setStatus(e.target.value)} className="h-8 w-auto" aria-label="New or lost">
          <option value="">All domains</option>
          <option value="active">Active</option>
          <option value="new">New (30 days)</option>
          <option value="lost">Lost</option>
        </Select>
        <Select value={follow} onChange={(e) => setFollow(e.target.value)} className="h-8 w-auto" aria-label="Follow">
          <option value="">Follow + nofollow</option>
          <option value="follow">Follow only</option>
          <option value="nofollow">Nofollow only</option>
        </Select>
        {asInvalid && <span className="text-[12px] text-critical-ink">AS range must be 0–100, min ≤ max.</span>}
      </div>
      <DataTable
        rows={filtered}
        columns={rdColumns}
        rowKey={(r) => r.domain}
        defaultSort={{ key: "authorityScore", dir: "desc" }}
        searchable
        searchPlaceholder="Filter by domain"
        searchText={(r) => `${r.domain} ${r.category}`}
        onRowsChange={onRowsChange}
        toolbar={
          <div className="flex flex-1 flex-wrap items-center gap-2">
            <span className="text-[12.5px] text-text-3">{filtered.length.toLocaleString()} domains</span>
            <ExportButton onClick={exportCsv} className="ml-auto" />
          </div>
        }
        emptyText="No referring domains match these filters."
      />
    </div>
  );
}

/* ------------------------------------------------------------------------------------------------
 * Anchors
 * ---------------------------------------------------------------------------------------------- */

export function AnchorsTable({ rows, domain }: { rows: AnchorRow[]; domain: string }) {
  const [type, setType] = useState<"" | AnchorType>("");
  const [onlyNew, setOnlyNew] = useState(false);
  const max = useMemo(() => Math.max(1, ...rows.map((r) => r.referringDomains)), [rows]);
  const filtered = useMemo(() => rows.filter((r) => (!type || r.type === type) && (!onlyNew || r.isNew)), [rows, type, onlyNew]);
  const columns: Column<AnchorRow>[] = [
    {
      key: "anchor",
      header: "Anchor",
      render: (r) => (
        <div className="max-w-[420px] min-w-[200px]">
          <div className={r.anchor === "<EmptyAnchor>" ? "text-text-3 italic" : "truncate text-text"} title={r.anchor}>
            {r.anchor}
          </div>
          <div className="mt-0.5 flex gap-1">
            <Badge>{ANCHOR_TYPE_LABELS[r.type]}</Badge>
            {r.isNew && <Badge tone="brand">New</Badge>}
          </div>
        </div>
      ),
    },
    {
      key: "referringDomains",
      header: "Domains",
      align: "right",
      render: (r) => (
        <div className="flex items-center justify-end gap-2">
          <Bar value={r.referringDomains} max={max} className="hidden w-16 sm:block" />
          <span className="tabular w-12 text-right">{compact(r.referringDomains)}</span>
        </div>
      ),
    },
    { key: "backlinks", header: "Backlinks", align: "right", render: (r) => compact(r.backlinks) },
    { key: "firstSeen", header: "First seen", align: "right", render: (r) => <span className="whitespace-nowrap text-text-2">{shortDate(r.firstSeen)}</span> },
    { key: "lastSeen", header: "Last seen", align: "right", render: (r) => <span className="whitespace-nowrap text-text-2">{shortDate(r.lastSeen)}</span> },
  ];
  const { onRowsChange, exportCsv } = useCsvExport<AnchorRow>(`${domain}-anchors`, ["Anchor", "Type", "Referring domains", "Backlinks", "First seen", "Last seen"], (r) => [r.anchor, ANCHOR_TYPE_LABELS[r.type], r.referringDomains, r.backlinks, r.firstSeen, r.lastSeen]);
  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 px-4 pb-3">
        <Select value={type} onChange={(e) => setType(e.target.value as AnchorType | "")} className="h-8 w-auto" aria-label="Anchor type">
          <option value="">All anchor types</option>
          {(Object.keys(ANCHOR_TYPE_LABELS) as AnchorType[]).map((t) => (
            <option key={t} value={t}>
              {ANCHOR_TYPE_LABELS[t]}
            </option>
          ))}
        </Select>
        <ScrollSegmented<"all" | "new"> value={onlyNew ? "new" : "all"} onChange={(v) => setOnlyNew(v === "new")} options={[{ value: "all", label: "All" }, { value: "new", label: "New (30 days)" }]} />
      </div>
      <DataTable
        rows={filtered}
        columns={columns}
        rowKey={(r) => r.anchor}
        defaultSort={{ key: "referringDomains", dir: "desc" }}
        searchable
        searchPlaceholder="Filter by anchor"
        searchText={(r) => r.anchor}
        onRowsChange={onRowsChange}
        toolbar={
          <div className="flex flex-1 flex-wrap items-center gap-2">
            <span className="text-[12.5px] text-text-3">{filtered.length.toLocaleString()} anchors</span>
            <ExportButton onClick={exportCsv} className="ml-auto" />
          </div>
        }
      />
    </div>
  );
}

/* ------------------------------------------------------------------------------------------------
 * Referring IPs
 * ---------------------------------------------------------------------------------------------- */

export function IpsTable({ ips, subnets, domain }: { ips: IpRow[]; subnets: IpRow[]; domain: string }) {
  const [mode, setMode] = useState<"ip" | "subnet">("ip");
  const rows = mode === "ip" ? ips : subnets;
  const columns: Column<IpRow>[] = [
    { key: "ip", header: mode === "ip" ? "IP address" : "Subnet", render: (r) => <span className="tabular font-medium whitespace-nowrap text-text">{r.ip || "n/a"}</span> },
    { key: "country", header: "Country", render: (r) => <CountryLabel code={r.country} /> },
    { key: "domains", header: "Domains", align: "right", render: (r) => compact(r.domains) },
    {
      key: "sampleDomains",
      header: "Referring domains",
      sortable: false,
      render: (r) => (r.sampleDomains.length ? <span className="block max-w-[320px] truncate text-[12.5px] text-text-2" title={r.sampleDomains.join(", ")}>{r.sampleDomains.join(", ")}{r.domains > r.sampleDomains.length ? ` +${r.domains - r.sampleDomains.length}` : ""}</span> : <span className="text-text-3">n/a</span>),
    },
    { key: "backlinks", header: "Backlinks", align: "right", render: (r) => compact(r.backlinks) },
    { key: "firstSeen", header: "First seen", align: "right", render: (r) => <span className="whitespace-nowrap text-text-2">{shortDate(r.firstSeen)}</span> },
    { key: "lastSeen", header: "Last seen", align: "right", render: (r) => <span className="whitespace-nowrap text-text-2">{shortDate(r.lastSeen)}</span> },
  ];
  const { onRowsChange, exportCsv } = useCsvExport<IpRow>(`${domain}-referring-${mode === "ip" ? "ips" : "subnets"}`, [mode === "ip" ? "IP" : "Subnet", "Country", "Domains", "Sample domains", "Backlinks", "First seen", "Last seen"], (r) => [r.ip, r.country, r.domains, r.sampleDomains.join(" "), r.backlinks, r.firstSeen, r.lastSeen]);
  return (
    <DataTable
      key={mode}
      rows={rows}
      columns={columns}
      rowKey={(r) => r.ip}
      defaultSort={{ key: "domains", dir: "desc" }}
      searchable
      searchPlaceholder="Filter by IP or domain"
      searchText={(r) => `${r.ip} ${r.sampleDomains.join(" ")}`}
      onRowsChange={onRowsChange}
      toolbar={
        <div className="flex flex-1 flex-wrap items-center gap-2">
          <ScrollSegmented<"ip" | "subnet">
            value={mode}
            onChange={setMode}
            options={[
              { value: "ip", label: `IPs · ${ips.length}` },
              { value: "subnet", label: `Subnets · ${subnets.length}` },
            ]}
          />
          <ExportButton onClick={exportCsv} className="ml-auto" />
        </div>
      }
    />
  );
}

/* ------------------------------------------------------------------------------------------------
 * Indexed pages
 * ---------------------------------------------------------------------------------------------- */

const pageColumns: Column<IndexedPageRow>[] = [
  {
    key: "url",
    header: "Page title and URL",
    render: (r) => (
      <div className="max-w-[480px] min-w-[220px]">
        <div className="truncate font-medium text-text">{r.title || "Untitled"}</div>
        <a href={r.url} target="_blank" rel="noopener noreferrer" className="block truncate text-[12.5px] text-link hover:underline" title={r.url}>
          {displayUrl(r.url)}
        </a>
      </div>
    ),
  },
  { key: "referringDomains", header: "Ref. domains", align: "right", render: (r) => compact(r.referringDomains) },
  { key: "backlinks", header: "Backlinks", align: "right", render: (r) => compact(r.backlinks) },
  { key: "followPct", header: "Follow", align: "right", render: (r) => pct(r.followPct, 0) },
  { key: "topAnchor", header: "Top anchor", render: (r) => <span className="block max-w-[200px] truncate text-text-2" title={r.topAnchor}>{r.topAnchor || "n/a"}</span> },
  { key: "firstSeen", header: "First seen", align: "right", render: (r) => <span className="whitespace-nowrap text-text-2">{shortDate(r.firstSeen)}</span> },
  { key: "lastSeen", header: "Last seen", align: "right", render: (r) => <span className="whitespace-nowrap text-text-2">{shortDate(r.lastSeen)}</span> },
];

export function IndexedPagesTable({ rows, domain }: { rows: IndexedPageRow[]; domain: string }) {
  const { onRowsChange, exportCsv } = useCsvExport<IndexedPageRow>(`${domain}-indexed-pages`, ["Title", "URL", "Referring domains", "Backlinks", "Follow %", "Top anchor", "First seen", "Last seen"], (r) => [r.title, r.url, r.referringDomains, r.backlinks, r.followPct, r.topAnchor, r.firstSeen, r.lastSeen]);
  return (
    <DataTable
      rows={rows}
      columns={pageColumns}
      rowKey={(r) => r.url}
      defaultSort={{ key: "referringDomains", dir: "desc" }}
      searchable
      searchPlaceholder="Filter by URL or title"
      searchText={(r) => `${r.url} ${r.title}`}
      onRowsChange={onRowsChange}
      toolbar={
        <div className="flex flex-1 flex-wrap items-center gap-2">
          <span className="text-[12.5px] text-text-3">{rows.length.toLocaleString()} pages with backlinks</span>
          <ExportButton onClick={exportCsv} className="ml-auto" />
        </div>
      }
    />
  );
}

/* ------------------------------------------------------------------------------------------------
 * Outbound domains
 * ---------------------------------------------------------------------------------------------- */

const outboundColumns: Column<OutboundRow>[] = [
  {
    key: "domain",
    header: "Domain",
    render: (r) => (
      <div className="min-w-[180px]">
        <BlDomainLink domain={r.domain} />
        <div className="mt-0.5 text-[11.5px] text-text-3">{r.category}</div>
      </div>
    ),
  },
  { key: "authorityScore", header: "AS", align: "right", render: (r) => <AsBadge score={r.authorityScore} /> },
  { key: "links", header: "Outbound links", align: "right", render: (r) => compact(r.links) },
  {
    key: "linksBack",
    header: "Links back",
    info: "Whether this domain also links to the analyzed domain (mutual link).",
    sortValue: (r) => (r.linksBack ? 1 : 0),
    render: (r) => (r.linksBack ? <Badge tone="good">Mutual</Badge> : <span className="text-text-3">No</span>),
  },
  { key: "firstSeen", header: "First seen", align: "right", render: (r) => <span className="whitespace-nowrap text-text-2">{shortDate(r.firstSeen)}</span> },
];

export function OutboundTable({ rows, domain }: { rows: OutboundRow[]; domain: string }) {
  const { onRowsChange, exportCsv } = useCsvExport<OutboundRow>(`${domain}-outbound-domains`, ["Domain", "Authority Score", "Category", "Outbound links", "Links back", "First seen"], (r) => [r.domain, r.authorityScore, r.category, r.links, r.linksBack, r.firstSeen]);
  return (
    <DataTable
      rows={rows}
      columns={outboundColumns}
      rowKey={(r) => r.domain}
      defaultSort={{ key: "links", dir: "desc" }}
      searchable
      searchPlaceholder="Filter by domain"
      searchText={(r) => `${r.domain} ${r.category}`}
      onRowsChange={onRowsChange}
      toolbar={
        <div className="flex flex-1 items-center">
          <ExportButton onClick={exportCsv} className="ml-auto" />
        </div>
      }
      emptyText="No outbound domains found."
    />
  );
}

/* ------------------------------------------------------------------------------------------------
 * Backlink competitors
 * ---------------------------------------------------------------------------------------------- */

export function CompetitorsTable({ rows, domain }: { rows: CompetitorRow[]; domain: string }) {
  const columns: Column<CompetitorRow>[] = [
    { key: "domain", header: "Domain", render: (r) => <BlDomainLink domain={r.domain} /> },
    {
      key: "level",
      header: "Competition level",
      info: "Similarity of backlink profiles, based on the share of referring domains the two domains have in common.",
      render: (r) => (
        <div className="flex items-center gap-2">
          <Bar value={r.level * 100} className="w-24" />
          <span className="tabular text-[12px] text-text-3">{Math.round(r.level * 100)}%</span>
        </div>
      ),
    },
    { key: "authorityScore", header: "AS", align: "right", render: (r) => <AsBadge score={r.authorityScore} /> },
    { key: "common", header: "Common ref. domains", align: "right", render: (r) => compact(r.common) },
    { key: "referringDomains", header: "Ref. domains", align: "right", render: (r) => (r.referringDomains ? compact(r.referringDomains) : "n/a") },
    { key: "backlinks", header: "Backlinks", align: "right", render: (r) => (r.backlinks ? compact(r.backlinks) : "n/a") },
    {
      key: "compare",
      header: "",
      sortable: false,
      render: (r) => (
        <Link href={`/backlink-analytics?q=${encodeURIComponent(`${domain},${r.domain}`)}`} className="text-[12.5px] whitespace-nowrap text-link hover:underline">
          Compare
        </Link>
      ),
    },
  ];
  const { onRowsChange, exportCsv } = useCsvExport<CompetitorRow>(`${domain}-backlink-competitors`, ["Domain", "Competition level %", "Authority Score", "Common referring domains", "Referring domains", "Backlinks"], (r) => [r.domain, Math.round(r.level * 100), r.authorityScore, r.common, r.referringDomains, r.backlinks]);
  return (
    <DataTable
      rows={rows}
      columns={columns}
      rowKey={(r) => r.domain}
      defaultSort={{ key: "level", dir: "desc" }}
      onRowsChange={onRowsChange}
      toolbar={
        <div className="flex flex-1 items-center">
          <ExportButton onClick={exportCsv} className="ml-auto" />
        </div>
      }
      emptyText="No domains with a similar backlink profile were found."
    />
  );
}
