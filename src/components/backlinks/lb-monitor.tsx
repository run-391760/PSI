"use client";

import { CircleCheck, CircleHelp, CircleX, Clock, Link2, Plus, RefreshCw, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { type ReactNode, useState, useTransition } from "react";
import { removeLinkAction, verifyLinksAction } from "@/app/(app)/link-building/actions";
import type { LbLinkRow, LinkStatus } from "@/lib/backlinks/types";
import { displayUrl } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { type Column, DataTable } from "@/components/ui/data-table";
import { Callout } from "@/components/ui/feedback";
import { Tooltip } from "@/components/ui/tooltip";
import { RelativeTime, RelBadges, shortDate } from "./bits";
import { AddLinkDialog } from "./lb-pipeline";
import { ExportButton, useCsvExport, ScrollSegmented } from "./table-tools";

const STATUS_META: Record<LinkStatus, { label: string; cls: string; icon: ReactNode }> = {
  active: { label: "Active", cls: "bg-good-soft text-good-ink", icon: <CircleCheck className="h-3.5 w-3.5" /> },
  lost: { label: "Lost", cls: "bg-critical-soft text-critical-ink", icon: <CircleX className="h-3.5 w-3.5" /> },
  unknown: { label: "Unknown", cls: "bg-warning-soft text-warning-ink", icon: <CircleHelp className="h-3.5 w-3.5" /> },
  pending: { label: "Checking", cls: "bg-surface-3 text-text-2", icon: <Clock className="h-3.5 w-3.5" /> },
};

export function LinkStatusBadge({ status }: { status: LinkStatus }) {
  const m = STATUS_META[status];
  return <span className={cn("inline-flex h-5.5 items-center gap-1 rounded-full px-2 text-[12px] font-medium whitespace-nowrap", m.cls)}>{m.icon}{m.label}</span>;
}

export function MonitorToolbar({ projectId, prospects, running, count }: { projectId: string; prospects: string[]; running: boolean; count: number }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button variant="primary" onClick={() => setOpen(true)}>
        <Plus className="h-4 w-4" /> Add link
      </Button>
      <Button
        loading={pending}
        disabled={running || !count}
        onClick={() =>
          start(async () => {
            const res = await verifyLinksAction(projectId);
            if (!res.ok) setError(res.error);
            else {
              setError(null);
              router.refresh();
            }
          })
        }
      >
        {!pending && <RefreshCw className="h-4 w-4" />} {running ? "Checking…" : "Check all now"}
      </Button>
      {error && <span className="text-[12px] text-critical-ink">{error}</span>}
      {open && <AddLinkDialog projectId={projectId} prospects={prospects} onClose={() => setOpen(false)} />}
    </div>
  );
}

export function MonitorTable({ projectId, rows, domain, running }: { projectId: string; rows: LbLinkRow[]; domain: string; running: boolean }) {
  const router = useRouter();
  const [status, setStatus] = useState<"all" | LinkStatus>("all");
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const act = (fn: () => Promise<{ ok: boolean; error?: string }>) =>
    start(async () => {
      const res = await fn();
      if (!res.ok) setError(res.error ?? "Something went wrong.");
      else {
        setError(null);
        router.refresh();
      }
    });
  const counts = { active: 0, lost: 0, unknown: 0, pending: 0 } as Record<LinkStatus, number>;
  for (const r of rows) counts[r.status]++;
  const filtered = status === "all" ? rows : rows.filter((r) => r.status === status);
  const columns: Column<LbLinkRow>[] = [
    {
      key: "status",
      header: "Status",
      sortValue: (r) => ["lost", "unknown", "pending", "active"].indexOf(r.status),
      render: (r) => (
        <div className="max-w-[260px] min-w-[150px]">
          <LinkStatusBadge status={running && r.status === "pending" ? "pending" : r.status} />
          {r.reason && <div className="mt-1 line-clamp-2 text-[11.5px] text-text-3" title={r.reason}>{r.reason}</div>}
        </div>
      ),
    },
    {
      key: "sourceUrl",
      header: "Source page",
      render: (r) => (
        <div className="max-w-[360px] min-w-[200px]">
          <a href={r.sourceUrl} target="_blank" rel="noopener noreferrer nofollow" className="block truncate text-link hover:underline" title={r.sourceUrl}>
            {displayUrl(r.sourceUrl)}
          </a>
          {r.prospectDomain && <div className="text-[11.5px] text-text-3">Prospect: {r.prospectDomain}</div>}
        </div>
      ),
    },
    {
      key: "anchor",
      header: "Anchor and target",
      sortValue: (r) => r.anchor ?? "",
      render: (r) =>
        r.targetUrl ? (
          <div className="max-w-[320px] min-w-[180px]">
            <div className="truncate text-text">{r.anchor || <span className="text-text-3 italic">&lt;EmptyAnchor&gt;</span>}</div>
            <a href={r.targetUrl} target="_blank" rel="noopener noreferrer" className="block truncate text-[12px] text-link hover:underline" title={r.targetUrl}>
              {displayUrl(r.targetUrl)}
            </a>
            <div className="mt-1">
              <RelBadges rel={r.rel} follow={!r.rel.includes("nofollow")} />
            </div>
          </div>
        ) : (
          <span className="text-text-3">n/a</span>
        ),
    },
    { key: "httpStatus", header: "HTTP", align: "right", render: (r) => (r.httpStatus ? <Badge tone={r.httpStatus < 300 ? "good" : r.httpStatus < 500 ? "warning" : "critical"}>{r.httpStatus}</Badge> : <span className="text-text-3">–</span>) },
    {
      key: "lastCheckedAt",
      header: "Last checked",
      align: "right",
      render: (r) => (
        <div className="text-right whitespace-nowrap">
          <div className="text-text-2">{r.lastCheckedAt ? <RelativeTime iso={r.lastCheckedAt} /> : "Not yet"}</div>
          <div className="text-[11.5px] text-text-3">{r.checks} check{r.checks === 1 ? "" : "s"}</div>
        </div>
      ),
    },
    { key: "firstActiveAt", header: "Live since", align: "right", render: (r) => <span className="whitespace-nowrap text-text-2">{r.firstActiveAt ? shortDate(r.firstActiveAt) : "–"}</span> },
    {
      key: "actions",
      header: "",
      sortable: false,
      render: (r) => (
        <span className="inline-flex items-center gap-0.5">
          <Tooltip content="Re-check this link now">
            <button type="button" disabled={pending || running} onClick={() => act(() => verifyLinksAction(projectId, [r.id]))} className="inline-flex h-7 w-7 items-center justify-center rounded-md text-text-3 hover:bg-surface-3 hover:text-text disabled:opacity-40" aria-label={`Re-check ${r.sourceUrl}`}>
              <RefreshCw className="h-3.5 w-3.5" />
            </button>
          </Tooltip>
          <Tooltip content="Stop monitoring">
            <button type="button" disabled={pending} onClick={() => act(() => removeLinkAction(projectId, r.id))} className="inline-flex h-7 w-7 items-center justify-center rounded-md text-text-3 hover:bg-surface-3 hover:text-critical-ink disabled:opacity-40" aria-label={`Stop monitoring ${r.sourceUrl}`}>
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </Tooltip>
        </span>
      ),
    },
  ];
  const { onRowsChange, exportCsv } = useCsvExport<LbLinkRow>(`${domain}-monitored-links`, ["Status", "Reason", "Source URL", "Anchor", "Target URL", "Rel", "HTTP", "Last checked", "Live since", "Lost at"], (r) => [r.status, r.reason, r.sourceUrl, r.anchor, r.targetUrl, r.rel.join(" "), r.httpStatus, r.lastCheckedAt, r.firstActiveAt, r.lostAt]);
  return (
    <div>
      {error && (
        <Callout tone="critical" className="mx-4 mb-3">
          {error}
        </Callout>
      )}
      <DataTable
        rows={filtered}
        columns={columns}
        rowKey={(r) => r.id}
        defaultSort={{ key: "status", dir: "asc" }}
        searchable
        searchPlaceholder="Filter by URL or anchor"
        searchText={(r) => `${r.sourceUrl} ${r.anchor ?? ""} ${r.prospectDomain ?? ""}`}
        onRowsChange={onRowsChange}
        toolbar={
          <div className="flex flex-1 flex-wrap items-center gap-2">
            <ScrollSegmented<"all" | LinkStatus>
              value={status}
              onChange={setStatus}
              options={[
                { value: "all", label: `All · ${rows.length}` },
                { value: "active", label: `Active · ${counts.active}` },
                { value: "lost", label: `Lost · ${counts.lost}` },
                { value: "unknown", label: `Unknown · ${counts.unknown}` },
              ]}
            />
            <ExportButton onClick={exportCsv} className="ml-auto" />
          </div>
        }
        emptyText={
          rows.length ? (
            "No links with this status."
          ) : (
            <span className="inline-flex flex-col items-center gap-1">
              <Link2 className="h-5 w-5 text-text-3" />
              No monitored links yet. Add the URL of a page that links to {domain}.
            </span>
          )
        }
      />
    </div>
  );
}
