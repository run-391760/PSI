"use client";

import { Ban, MailX, ShieldCheck, Undo2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { setListAction } from "@/app/(app)/backlink-audit/actions";
import { MARKER_INFO, POTENTIAL_MIN, TOXIC_MIN, type AuditDomainRow, type AuditList } from "@/lib/backlinks/types";
import { compact, displayUrl } from "@/lib/format";
import { AsBadge, DomainLink } from "@/components/seo/badges";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { type Column, DataTable } from "@/components/ui/data-table";
import { Callout } from "@/components/ui/feedback";
import { Select } from "@/components/ui/input";
import { Tooltip } from "@/components/ui/tooltip";
import { CountryLabel, shortDate } from "./bits";
import { ExportButton, useCsvExport, ScrollSegmented } from "./table-tools";
import { MarkerChips, ToxicityScore, toxicLabel } from "./toxicity";

type Cls = "all" | "toxic" | "potentially" | "non";
const LIST_BADGE: Record<AuditList, { label: string; tone: "good" | "warning" | "critical" }> = {
  whitelist: { label: "Whitelisted", tone: "good" },
  remove: { label: "Remove list", tone: "warning" },
  disavow: { label: "Disavow list", tone: "critical" },
};

export function ListBadge({ list }: { list: AuditList | null }) {
  if (!list) return null;
  return <Badge tone={LIST_BADGE[list].tone}>{LIST_BADGE[list].label}</Badge>;
}

/** Hook: move domains between lists with a pending state and error message. */
export function useListMover(projectId: string) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const move = (domains: string[], list: AuditList | null, after?: () => void) =>
    start(async () => {
      const res = await setListAction(projectId, domains, list);
      if (!res.ok) setError(res.error);
      else {
        setError(null);
        after?.();
        router.refresh();
      }
    });
  return { move, pending, error };
}

function RowActions({ row, move, pending }: { row: AuditDomainRow; move: (d: string[], l: AuditList | null) => void; pending: boolean }) {
  const btn = "inline-flex h-7 w-7 items-center justify-center rounded-md text-text-3 hover:bg-surface-3 hover:text-text disabled:opacity-40";
  return (
    <span className="inline-flex items-center gap-0.5">
      {row.list !== "whitelist" && (
        <Tooltip content="Whitelist: this link is safe; exclude it from the toxic score">
          <button type="button" className={btn} disabled={pending} onClick={() => move([row.domain], "whitelist")} aria-label={`Whitelist ${row.domain}`}>
            <ShieldCheck className="h-4 w-4" />
          </button>
        </Tooltip>
      )}
      {row.list !== "remove" && (
        <Tooltip content="Move to Remove list: ask the site owner to remove the link">
          <button type="button" className={btn} disabled={pending} onClick={() => move([row.domain], "remove")} aria-label={`Move ${row.domain} to Remove list`}>
            <MailX className="h-4 w-4" />
          </button>
        </Tooltip>
      )}
      {row.list !== "disavow" && (
        <Tooltip content="Move to Disavow list: include in disavow.txt">
          <button type="button" className={btn} disabled={pending} onClick={() => move([row.domain], "disavow")} aria-label={`Move ${row.domain} to Disavow list`}>
            <Ban className="h-4 w-4" />
          </button>
        </Tooltip>
      )}
      {row.list && (
        <Tooltip content="Restore: back to the review list">
          <button type="button" className={btn} disabled={pending} onClick={() => move([row.domain], null)} aria-label={`Restore ${row.domain}`}>
            <Undo2 className="h-4 w-4" />
          </button>
        </Tooltip>
      )}
    </span>
  );
}

export function AuditTable({ projectId, rows, domain, initialClass = "all" }: { projectId: string; rows: AuditDomainRow[]; domain: string; initialClass?: Cls }) {
  const [cls, setCls] = useState<Cls>(initialClass);
  const [marker, setMarker] = useState("");
  const [status, setStatus] = useState("review");
  const { move, pending, error } = useListMover(projectId);

  const counts = useMemo(() => {
    const c = { toxic: 0, potentially: 0, non: 0, review: 0, whitelist: 0, remove: 0, disavow: 0 };
    for (const r of rows) {
      if (r.toxicity >= TOXIC_MIN) c.toxic++;
      else if (r.toxicity >= POTENTIAL_MIN) c.potentially++;
      else c.non++;
      c[r.list ?? "review"]++;
    }
    return c;
  }, [rows]);
  const markers = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of rows) for (const x of r.markers) m.set(x, (m.get(x) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [rows]);
  const filtered = useMemo(
    () =>
      rows.filter((r) => {
        if (cls === "toxic" && r.toxicity < TOXIC_MIN) return false;
        if (cls === "potentially" && (r.toxicity < POTENTIAL_MIN || r.toxicity >= TOXIC_MIN)) return false;
        if (cls === "non" && r.toxicity >= POTENTIAL_MIN) return false;
        if (marker && !r.markers.includes(marker)) return false;
        if (status === "review" && r.list) return false;
        if (status !== "review" && status !== "all" && r.list !== status) return false;
        return true;
      }),
    [rows, cls, marker, status],
  );

  const columns: Column<AuditDomainRow>[] = [
    {
      key: "domain",
      header: "Referring domain",
      render: (r) => (
        <div className="max-w-[340px] min-w-[210px]">
          <div className="flex items-center gap-1.5">
            <DomainLink domain={r.domain} className="min-w-0" />
            {r.isNew && <Badge tone="brand">New</Badge>}
            <ListBadge list={r.list} />
          </div>
          <a href={r.sampleUrl} target="_blank" rel="noopener noreferrer nofollow" className="mt-0.5 block truncate text-[11.5px] text-text-3 hover:text-link" title={r.sampleUrl}>
            {displayUrl(r.sampleUrl)}
            {r.sampleAnchor ? ` · “${r.sampleAnchor}”` : ""}
          </a>
        </div>
      ),
    },
    { key: "toxicity", header: "Toxicity", info: `Toxicity score 0–100 from the markers found. Toxic ≥ ${TOXIC_MIN}, potentially toxic ${POTENTIAL_MIN}–${TOXIC_MIN - 1}.`, render: (r) => <ToxicityScore score={r.toxicity} /> },
    { key: "markers", header: "Toxic markers", sortValue: (r) => r.markers.length, render: (r) => <MarkerChips markers={r.markers} /> },
    { key: "authorityScore", header: "AS", align: "right", render: (r) => <AsBadge score={r.authorityScore} /> },
    { key: "backlinks", header: "Backlinks", align: "right", render: (r) => compact(r.backlinks) },
    { key: "country", header: "Country", render: (r) => <CountryLabel code={r.country} short /> },
    { key: "follow", header: "Link", sortValue: (r) => (r.follow ? 1 : 0), render: (r) => (r.follow ? <Badge tone="good">Follow</Badge> : <Badge>Nofollow</Badge>) },
    { key: "actions", header: "Actions", sortable: false, render: (r) => <RowActions row={r} move={move} pending={pending} /> },
  ];
  const { onRowsChange, exportCsv } = useCsvExport<AuditDomainRow>(
    `${domain}-backlink-audit`,
    ["Domain", "Toxicity score", "Class", "Markers", "Authority Score", "Backlinks", "Country", "IP", "Follow", "First seen", "Last seen", "Sample URL", "List"],
    (r) => [r.domain, r.toxicity, toxicLabel(r.toxicity), r.markers.join("; "), r.authorityScore, r.backlinks, r.country, r.ip, r.follow, r.firstSeen, r.lastSeen, r.sampleUrl, r.list ?? "to review"],
  );

  return (
    <div>
      {error && (
        <Callout tone="critical" className="mx-4 mb-3">
          {error}
        </Callout>
      )}
      <div className="flex flex-wrap items-center gap-2 px-4 pb-3">
        <ScrollSegmented<Cls>
          value={cls}
          onChange={setCls}
          options={[
            { value: "all", label: `All · ${rows.length}` },
            { value: "toxic", label: `Toxic · ${counts.toxic}` },
            { value: "potentially", label: `Potentially toxic · ${counts.potentially}` },
            { value: "non", label: `Non-toxic · ${counts.non}` },
          ]}
        />
        <Select value={status} onChange={(e) => setStatus(e.target.value)} className="h-8 w-auto" aria-label="Review status">
          <option value="review">Not reviewed ({counts.review})</option>
          <option value="whitelist">Whitelisted ({counts.whitelist})</option>
          <option value="remove">Remove list ({counts.remove})</option>
          <option value="disavow">Disavow list ({counts.disavow})</option>
          <option value="all">All statuses ({rows.length})</option>
        </Select>
        <Select value={marker} onChange={(e) => setMarker(e.target.value)} className="h-8 w-auto max-w-60" aria-label="Toxic marker">
          <option value="">All markers</option>
          {markers.map(([m, n]) => (
            <option key={m} value={m} title={MARKER_INFO[m]}>
              {m} ({n})
            </option>
          ))}
        </Select>
      </div>
      <DataTable
        rows={filtered}
        columns={columns}
        rowKey={(r) => r.domain}
        defaultSort={{ key: "toxicity", dir: "desc" }}
        searchable
        searchPlaceholder="Filter by domain"
        searchText={(r) => r.domain}
        selectable
        selectionActions={(selected, clear) => (
          <>
            <Button size="sm" disabled={pending} onClick={() => move(selected.map((r) => r.domain), "whitelist", clear)}>
              <ShieldCheck className="h-3.5 w-3.5" /> Whitelist
            </Button>
            <Button size="sm" disabled={pending} onClick={() => move(selected.map((r) => r.domain), "remove", clear)}>
              <MailX className="h-3.5 w-3.5" /> Remove list
            </Button>
            <Button size="sm" variant="danger" disabled={pending} onClick={() => move(selected.map((r) => r.domain), "disavow", clear)}>
              <Ban className="h-3.5 w-3.5" /> Disavow
            </Button>
          </>
        )}
        onRowsChange={onRowsChange}
        toolbar={
          <div className="flex flex-1 flex-wrap items-center gap-2">
            <span className="text-[12.5px] text-text-3">{filtered.length.toLocaleString()} domains</span>
            <ExportButton onClick={exportCsv} className="ml-auto" />
          </div>
        }
        emptyText={status === "review" ? "Nothing left to review with these filters." : "No domains match these filters."}
      />
      <p className="px-4 py-2.5 text-[12px] text-text-3">
        First seen / last seen dates and sample pages come from the latest audit. {rows.length ? `Oldest link first seen ${shortDate(rows.reduce((m, r) => (r.firstSeen && r.firstSeen < m ? r.firstSeen : m), rows[0].firstSeen))}.` : ""}
      </p>
    </div>
  );
}
