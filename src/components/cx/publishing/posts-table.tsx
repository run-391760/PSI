"use client";

import { Copy, FileUp, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { bulkUploadAction, deletePostAction, duplicatePostAction } from "@/app/(app)/cx/publishing/actions";
import { Button } from "@/components/ui/button";
import { DataTable, type Column } from "@/components/ui/data-table";
import { Dialog } from "@/components/ui/dialog";
import { Callout } from "@/components/ui/feedback";
import { Textarea } from "@/components/ui/input";
import { downloadCsv } from "@/lib/csv";
import { BULK_TEMPLATE, STATUS_LABEL, parseCsv, type ChannelResult, type PostStatus } from "@/lib/cx/publishing/core";
import { ChannelChip, StatusBadge } from "./shared";

export type PostListItem = {
  id: string;
  title: string;
  excerpt: string;
  status: PostStatus;
  channels: string[];
  campaign: string | null;
  author: string | null;
  scheduled_at: string | null;
  published_at: string | null;
  updated_at: string;
  results: Record<string, ChannelResult>;
  media: number;
};

/** Local date-time (client time zone; no hydration warning for server/client zone differences). */
export function LocalTime({ iso, empty = "—" }: { iso: string | null; empty?: string }) {
  if (!iso) return <span className="text-text-3">{empty}</span>;
  const d = new Date(iso);
  return (
    <time dateTime={iso} suppressHydrationWarning>
      {d.toLocaleString(undefined, { month: "short", day: "numeric", year: d.getFullYear() === new Date().getFullYear() ? undefined : "numeric", hour: "numeric", minute: "2-digit" })}
    </time>
  );
}

export function PostsTable({ brandId, rows, canAuthor, empty }: { brandId: string; rows: PostListItem[]; canAuthor: boolean; empty: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const act = (fn: () => Promise<{ ok: boolean; error?: string; data?: unknown }>, go?: (data: unknown) => void) =>
    start(async () => {
      const r = await fn();
      if (!r.ok) setError(r.error ?? "Failed.");
      else {
        setError(null);
        if (go) go(r.data);
        else router.refresh();
      }
    });
  const cols: Column<PostListItem>[] = [
    {
      key: "post",
      header: "Post",
      sortValue: (r) => r.title || r.excerpt,
      render: (r) => (
        <Link href={`/cx/publishing/${r.id}?brand=${brandId}`} className="block max-w-[520px] min-w-[180px]">
          <span className="line-clamp-1 font-medium text-link hover:underline">{r.title || r.excerpt || "Untitled post"}</span>
          {r.title && r.excerpt && <span className="line-clamp-1 text-[12px] text-text-3">{r.excerpt}</span>}
        </Link>
      ),
      csv: (r) => r.title || r.excerpt,
    },
    {
      key: "channels",
      header: "Channels",
      sortable: false,
      render: (r) => (
        <span className="flex flex-wrap gap-1">
          {r.channels.map((c) => (
            <span key={c} className="relative" title={r.results[c] ? `${c}: ${r.results[c].status.replace("_", " ")}${r.results[c].error ? ` — ${r.results[c].error}` : ""}` : c}>
              <ChannelChip kind={c} />
              {r.results[c] && (
                <span className={`absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full ${["published", "manual"].includes(r.results[c].status) ? "bg-good" : r.results[c].status === "failed" ? "bg-critical" : "bg-warning"}`} />
              )}
            </span>
          ))}
        </span>
      ),
      csv: (r) => r.channels.join("|"),
    },
    { key: "status", header: "Status", sortValue: (r) => STATUS_LABEL[r.status], render: (r) => <StatusBadge status={r.status} /> },
    { key: "when", header: "Scheduled / published", sortValue: (r) => r.published_at ?? r.scheduled_at ?? "", render: (r) => <LocalTime iso={r.published_at ?? r.scheduled_at} empty="Not scheduled" /> },
    { key: "campaign", header: "Campaign", hideOnMobile: true, sortValue: (r) => r.campaign ?? "", render: (r) => r.campaign ?? <span className="text-text-3">—</span> },
    { key: "author", header: "Author", hideOnMobile: true, sortValue: (r) => r.author ?? "", render: (r) => r.author ?? <span className="text-text-3">—</span> },
    {
      key: "actions",
      header: "",
      sortable: false,
      noExport: true,
      align: "right",
      render: (r) =>
        canAuthor && (
          <span className="flex justify-end gap-1">
            <Button size="icon" variant="ghost" title="Duplicate" disabled={pending} onClick={() => act(() => duplicatePostAction(brandId, r.id), (id) => router.push(`/cx/publishing/${id}?brand=${brandId}`))}>
              <Copy className="h-3.5 w-3.5" />
            </Button>
            <Button size="icon" variant="ghost" title="Delete" disabled={pending} onClick={() => confirm("Delete this post?") && act(() => deletePostAction(brandId, r.id))}>
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </span>
        ),
    },
  ];
  return (
    <>
      {error && <Callout tone="critical" className="mb-3">{error}</Callout>}
      <DataTable
        rows={rows}
        columns={cols}
        rowKey={(r) => r.id}
        searchable
        searchText={(r) => `${r.title} ${r.excerpt} ${r.campaign ?? ""} ${r.channels.join(" ")}`}
        searchPlaceholder="Filter posts"
        exportName="posts"
        emptyText={empty}
        defaultSort={{ key: "when", dir: "desc" }}
      />
    </>
  );
}

export function BulkUpload({ brandId }: { brandId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [csv, setCsv] = useState("");
  const [pending, start] = useTransition();
  const [result, setResult] = useState<{ created: number; pendingApproval: boolean; errors: { line: number; error: string }[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const rows = csv.trim() ? Math.max(0, parseCsv(csv).length - 1) : 0;
  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <FileUp className="h-4 w-4" /> Bulk schedule
      </Button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        size="lg"
        title="Bulk schedule from CSV"
        description="One row per post. Times are in your browser's time zone. Media refers to asset library file names."
        footer={
          <>
            <Button variant="ghost" onClick={() => downloadCsv("bulk-schedule-template", parseCsv(BULK_TEMPLATE))}>
              Download template
            </Button>
            <Button
              variant="primary"
              disabled={pending || !rows}
              onClick={() =>
                start(async () => {
                  const r = await bulkUploadAction(brandId, csv, new Date().getTimezoneOffset());
                  if (!r.ok) return setError(r.error);
                  setError(null);
                  setResult(r.data);
                  router.refresh();
                })
              }
            >
              {pending ? "Scheduling…" : `Schedule ${rows || ""} post${rows === 1 ? "" : "s"}`}
            </Button>
          </>
        }
      >
        <div className="grid gap-3">
          <p className="text-[12.5px] text-text-2">
            Columns: <code>date</code>, <code>time</code>, <code>channels</code> (facebook|instagram|linkedin|x|youtube), <code>text</code> (use <code>{"{link}"}</code> for the tracked link), <code>link</code>, <code>campaign</code>, <code>first_comment</code>, <code>media</code>.
          </p>
          <input
            type="file"
            accept=".csv,text/csv"
            className="text-[13px]"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (f) setCsv(await f.text());
            }}
          />
          <Textarea rows={8} value={csv} onChange={(e) => setCsv(e.target.value)} placeholder={BULK_TEMPLATE} className="font-mono text-[12px]" />
          {error && <Callout tone="critical">{error}</Callout>}
          {result && (
            <Callout tone={result.errors.length ? "warning" : "good"} title={`${result.created} post${result.created === 1 ? "" : "s"} ${result.pendingApproval ? "submitted for approval" : "scheduled"}`}>
              {result.errors.length > 0 && (
                <ul className="mt-1 list-disc pl-4">
                  {result.errors.map((e) => (
                    <li key={e.line}>
                      Line {e.line}: {e.error}
                    </li>
                  ))}
                </ul>
              )}
            </Callout>
          )}
        </div>
      </Dialog>
    </>
  );
}
