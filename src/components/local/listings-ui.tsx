"use client";

import { Check, Pencil, RefreshCw, Send, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { distributeAction } from "@/app/(app)/local/actions";
import { KIND_LABELS } from "@/lib/local/directories";
import { FIELD_LABELS, STATUS_META, type FieldKey, type FoundListing, type ListingRow, type ListingStatus } from "@/lib/local/listing-meta";
import type { ProfileInput } from "@/lib/local/profile-schema";
import { dateTimeLabel, timeAgo } from "@/lib/format";
import { DomainAvatar } from "@/components/seo/badges";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DataTable, type Column } from "@/components/ui/data-table";
import { Dialog } from "@/components/ui/dialog";
import { Callout } from "@/components/ui/feedback";
import { Select } from "@/components/ui/input";
import { ProfileForm } from "./profile-form";

export function EditProfileButton({ projectId, initial, variant = "secondary" }: { projectId: string; initial: ProfileInput; variant?: "secondary" | "primary" }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant={variant} onClick={() => setOpen(true)}>
        <Pencil className="h-3.5 w-3.5" /> Edit profile
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)} title="Business profile" description="The source of truth pushed to every directory." size="xl">
        <ProfileForm projectId={projectId} initial={initial} onDone={() => setOpen(false)} />
      </Dialog>
    </>
  );
}

export function DistributeButton({ projectId, count, disabled }: { projectId: string; count: number; disabled?: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        variant="primary"
        loading={pending}
        disabled={disabled || count === 0}
        title={count === 0 ? "All listings are in sync" : `Push your profile to ${count} directories`}
        onClick={() =>
          start(async () => {
            setError(null);
            const res = await distributeAction(projectId);
            if (!res.ok) setError(res.error);
            router.refresh();
          })
        }
      >
        <Send className="h-3.5 w-3.5" /> Distribute updates{count > 0 ? ` (${count})` : ""}
      </Button>
      {error && <span className="text-[12px] text-critical-ink">{error}</span>}
    </div>
  );
}

const STATUS_ORDER: Record<ListingStatus, number> = { not_listed: 0, duplicates: 1, needs_update: 2, in_review: 3, synced: 4 };

export function ListingsTable({ projectId, rows, expected, busy }: { projectId: string; rows: ListingRow[]; expected: FoundListing; busy: boolean }) {
  const router = useRouter();
  const [status, setStatus] = useState<"all" | ListingStatus>("all");
  const [detail, setDetail] = useState<ListingRow | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, start] = useTransition();
  const sync = (ids: string[]) =>
    start(async () => {
      setError(null);
      setPendingId(ids.join(","));
      const res = await distributeAction(projectId, ids);
      if (!res.ok) setError(res.error);
      setPendingId(null);
      router.refresh();
    });

  const visible = status === "all" ? rows : rows.filter((r) => r.status === status);
  const columns: Column<ListingRow>[] = [
    {
      key: "name",
      header: "Directory",
      sortValue: (r) => r.name,
      render: (r) => (
        <button type="button" onClick={() => setDetail(r)} className="flex min-w-0 items-center gap-2 text-left">
          <DomainAvatar domain={r.domain} size={22} />
          <span className="min-w-0">
            <span className="block truncate font-medium text-link hover:underline">{r.name}</span>
            <span className="block text-[11.5px] text-text-3">
              {KIND_LABELS[r.kind]} · {r.domain}
            </span>
          </span>
        </button>
      ),
    },
    {
      key: "status",
      header: "Status",
      sortValue: (r) => STATUS_ORDER[r.status],
      csv: (r) => STATUS_META[r.status].label,
      render: (r) => (
        <span className="inline-flex flex-col gap-0.5">
          <Badge tone={STATUS_META[r.status].tone}>{STATUS_META[r.status].label}</Badge>
          {r.status === "in_review" && <span className="text-[11px] text-text-3">Verification in progress</span>}
        </span>
      ),
    },
    {
      key: "accuracy",
      header: "NAP match",
      align: "right",
      info: "Share of name, address, phone and website that match your profile.",
      sortValue: (r) => r.accuracy ?? -1,
      render: (r) => (r.accuracy == null ? <span className="text-text-3">n/a</span> : <span className={r.accuracy === 100 ? "text-good-ink" : r.accuracy >= 75 ? "text-warning-ink" : "text-critical-ink"}>{r.accuracy}%</span>),
    },
    {
      key: "issues",
      header: "Issues found",
      sortable: false,
      csv: (r) => [...r.mismatches.map((m) => `${FIELD_LABELS[m]} mismatch`), r.duplicates ? `${r.duplicates} duplicates` : "", r.status === "not_listed" ? "Missing listing" : ""].filter(Boolean).join("; "),
      render: (r) => (
        <div className="flex max-w-[340px] flex-wrap gap-1">
          {r.status === "not_listed" && <Badge tone="critical">No listing</Badge>}
          {r.duplicates > 0 && <Badge tone="serious">{r.duplicates} duplicate{r.duplicates > 1 ? "s" : ""}</Badge>}
          {r.mismatches.map((m) => (
            <Badge key={m} tone="warning">
              {FIELD_LABELS[m]}
            </Badge>
          ))}
          {r.found && !r.mismatches.length && !r.duplicates && <span className="text-[12.5px] text-text-3">None</span>}
        </div>
      ),
    },
    {
      key: "synced",
      header: "Last synced",
      sortValue: (r) => r.syncedAt ?? "",
      render: (r) => (r.syncedAt ? <span title={dateTimeLabel(r.syncedAt)} suppressHydrationWarning>{timeAgo(r.syncedAt)}</span> : <span className="text-text-3">{r.status === "synced" ? "Already accurate" : "Never"}</span>),
    },
    {
      key: "action",
      header: "",
      sortable: false,
      noExport: true,
      align: "right",
      render: (r) =>
        r.status === "synced" || r.status === "in_review" ? (
          <span className="inline-flex items-center gap-1 text-[12.5px] text-good-ink">
            <Check className="h-3.5 w-3.5" /> Up to date
          </span>
        ) : (
          <Button size="sm" onClick={() => sync([r.id])} loading={pendingId === r.id} disabled={busy || !!pendingId}>
            <RefreshCw className="h-3.5 w-3.5" /> {r.status === "not_listed" ? "Create" : r.status === "duplicates" ? "Fix" : "Sync"}
          </Button>
        ),
    },
  ];

  return (
    <>
      {error && <Callout tone="critical" className="mx-4 mb-3">{error}</Callout>}
      <DataTable
        rows={visible}
        columns={columns}
        rowKey={(r) => r.id}
        defaultSort={{ key: "status", dir: "asc" }}
        pageSize={25}
        searchable
        searchPlaceholder="Filter directories"
        searchText={(r) => `${r.name} ${r.domain}`}
        exportName="listings"
        toolbar={
          <Select value={status} onChange={(e) => setStatus(e.target.value as typeof status)} className="h-8 w-auto text-[12.5px]" aria-label="Status filter">
            <option value="all">All statuses ({rows.length})</option>
            {(Object.keys(STATUS_META) as ListingStatus[]).map((s) => (
              <option key={s} value={s}>
                {STATUS_META[s].label} ({rows.filter((r) => r.status === s).length})
              </option>
            ))}
          </Select>
        }
        selectable
        selectionActions={(sel, clear) => (
          <Button
            size="sm"
            variant="primary"
            disabled={busy || !sel.some((r) => r.status !== "synced" && r.status !== "in_review")}
            onClick={() => {
              sync(sel.filter((r) => r.status !== "synced" && r.status !== "in_review").map((r) => r.id));
              clear();
            }}
          >
            <Send className="h-3.5 w-3.5" /> Sync selected
          </Button>
        )}
      />
      <Dialog open={!!detail} onClose={() => setDetail(null)} title={detail?.name ?? ""} description={detail ? `${KIND_LABELS[detail.kind]} · ${detail.domain} · Demo data` : undefined} size="lg"
        footer={
          detail && detail.status !== "synced" && detail.status !== "in_review" ? (
            <Button variant="primary" disabled={busy} onClick={() => (sync([detail.id]), setDetail(null))}>
              <Send className="h-3.5 w-3.5" /> {detail.status === "not_listed" ? "Create listing" : "Push profile to this directory"}
            </Button>
          ) : undefined
        }
      >
        {detail && <ListingDetail row={detail} expected={expected} />}
      </Dialog>
    </>
  );
}

function ListingDetail({ row, expected }: { row: ListingRow; expected: FoundListing }) {
  const fields: FieldKey[] = ["name", "address", "phone", "website", "hours", "categories"];
  const value = (l: FoundListing, f: FieldKey) => (f === "categories" ? l.categories.join(", ") : (l[f] as string));
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={STATUS_META[row.status].tone}>{STATUS_META[row.status].label}</Badge>
        {row.duplicates > 0 && <Badge tone="serious">{row.duplicates} duplicate listing{row.duplicates > 1 ? "s" : ""} found</Badge>}
        {row.suppressed > 0 && <Badge tone="good">{row.suppressed} duplicate{row.suppressed > 1 ? "s" : ""} suppressed</Badge>}
        {row.verification && <Badge>Requires owner verification</Badge>}
      </div>
      {!row.found ? (
        <Callout tone="warning">No listing was found for your business on {row.name}. Distributing updates submits a new listing{row.verification ? " (the directory verifies new listings before they go live)" : ""}.</Callout>
      ) : (
        <div className="overflow-x-auto rounded-md border border-border">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="bg-surface-2 text-left text-[12px] text-text-2">
                <th className="px-3 py-2 font-medium">Field</th>
                <th className="px-3 py-2 font-medium">Your profile</th>
                <th className="px-3 py-2 font-medium">Found on {row.name}</th>
                <th className="w-8 px-2 py-2" />
              </tr>
            </thead>
            <tbody>
              {fields.map((f) => {
                const bad = row.mismatches.includes(f);
                return (
                  <tr key={f} className="border-t border-border align-top">
                    <td className="px-3 py-2 font-medium text-text-2">{FIELD_LABELS[f]}</td>
                    <td className="px-3 py-2 [overflow-wrap:anywhere] text-text">{value(expected, f) || <span className="text-text-3">Not set</span>}</td>
                    <td className={bad ? "px-3 py-2 [overflow-wrap:anywhere] text-critical-ink" : "px-3 py-2 [overflow-wrap:anywhere] text-text"}>{value(row.found!, f) || <span className="italic">Missing</span>}</td>
                    <td className="px-2 py-2">{bad ? <X className="h-4 w-4 text-critical-ink" aria-label="Mismatch" /> : <Check className="h-4 w-4 text-good-ink" aria-label="Match" />}</td>
                  </tr>
                );
              })}
              <tr className="border-t border-border">
                <td className="px-3 py-2 font-medium text-text-2">Photos</td>
                <td className="px-3 py-2">{expected.photos}</td>
                <td className="px-3 py-2">{row.found.photos}</td>
                <td />
              </tr>
              <tr className="border-t border-border">
                <td className="px-3 py-2 font-medium text-text-2">Description</td>
                <td className="px-3 py-2">{expected.hasDescription ? "Yes" : "No"}</td>
                <td className="px-3 py-2">{row.found.hasDescription ? "Yes" : "No"}</td>
                <td />
              </tr>
            </tbody>
          </table>
        </div>
      )}
      <p className="text-[12px] text-text-3">Demo data: SynapseSEO does not connect to directory APIs; found listings are simulated from your profile.</p>
    </div>
  );
}
