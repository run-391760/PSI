"use client";

import { Copy, Download, FileUp, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { bulkUploadAction, deletePostAction, duplicatePostAction, type BulkPreviewRow } from "@/app/(app)/cx/publishing/actions";
import { Button, buttonClass } from "@/components/ui/button";
import { DataTable, type Column } from "@/components/ui/data-table";
import { Dialog } from "@/components/ui/dialog";
import { Callout } from "@/components/ui/feedback";
import { Textarea } from "@/components/ui/input";
import { downloadCsv } from "@/lib/csv";
import { BULK_TEMPLATE, PUB_CHANNELS, STATUS_LABEL, parseCsv, type ChannelResult, type PostStatus } from "@/lib/cx/publishing/core";
import { postTypeLabel } from "@/lib/cx/publishing/options";
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
  post_type?: string;
  content_tags?: string[];
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
          {!!r.content_tags?.length && <span className="line-clamp-1 text-[11.5px] text-text-3">#{r.content_tags.join(" #")}</span>}
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
    { key: "type", header: "Type", hideOnMobile: true, sortValue: (r) => r.post_type ?? "text", render: (r) => <span className="text-[12.5px] text-text-2">{postTypeLabel(r.post_type ?? "text")}</span>, csv: (r) => r.post_type ?? "text" },
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

type BulkResult = { created: number; pendingApproval: boolean; errors: { line: number; error: string }[]; preview: BulkPreviewRow[]; valid: number };

async function toBase64(f: File) {
  const bytes = new Uint8Array(await f.arrayBuffer());
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

/** Bulk scheduling from an Excel (.xlsx) or CSV file: template, validation with per-row status, then scheduling. */
export function BulkUpload({ brandId }: { brandId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [csv, setCsv] = useState("");
  const [xlsx, setXlsx] = useState<{ name: string; b64: string } | null>(null);
  const [pending, start] = useTransition();
  const [checked, setChecked] = useState<BulkResult | null>(null);
  const [result, setResult] = useState<BulkResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const file = xlsx ? { xlsx: xlsx.b64 } : { csv };
  const hasInput = !!xlsx || !!csv.trim();
  const reset = () => {
    setChecked(null);
    setResult(null);
    setError(null);
  };
  const call = (dry: boolean) =>
    start(async () => {
      const r = await bulkUploadAction(brandId, file, new Date().getTimezoneOffset(), dry);
      if (!r.ok) return setError(r.error);
      setError(null);
      if (dry) setChecked(r.data);
      else {
        setResult(r.data);
        setChecked(null);
        router.refresh();
      }
    });
  const shown = result ?? checked;
  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <FileUp className="h-4 w-4" /> Bulk schedule
      </Button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        size="xl"
        title="Bulk schedule from Excel or CSV"
        description="One row per post. Times are in your browser's time zone. Media refers to asset library file names."
        footer={
          <>
            <a href="/api/cx/publishing/bulk-template" className={buttonClass("ghost")} download>
              <Download className="h-4 w-4" /> Excel template
            </a>
            <Button variant="ghost" onClick={() => downloadCsv("bulk-schedule-template", parseCsv(BULK_TEMPLATE))}>
              CSV template
            </Button>
            <Button disabled={pending || !hasInput} onClick={() => call(true)}>
              {pending && !checked ? "Checking…" : "Check file"}
            </Button>
            <Button variant="primary" disabled={pending || !checked?.valid} onClick={() => call(false)}>
              {pending && checked ? "Scheduling…" : `Schedule ${checked?.valid ?? ""} valid post${checked?.valid === 1 ? "" : "s"}`}
            </Button>
          </>
        }
      >
        <div className="grid gap-3">
          <p className="text-[12.5px] text-text-2">
            Columns: <code>date</code>, <code>time</code>, <code>channels</code> ({PUB_CHANNELS.map((c) => c.kind).join("|")}), <code>text</code> (use <code>{"{link}"}</code> for the tracked link), <code>link</code>, <code>campaign</code>, <code>first_comment</code>, <code>media</code>, <code>post_type</code> (text, story, reel, poll, document, event), <code>tags</code>, <code>poll_options</code> (for polls: 2–4 answers separated by <code>|</code>). The Excel template has a Guide sheet.
          </p>
          <input
            type="file"
            accept=".xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            className="text-[13px]"
            aria-label="Spreadsheet file"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              reset();
              if (!f) return;
              if (/\.xlsx$/i.test(f.name)) {
                if (f.size > 5_000_000) return setError("The spreadsheet is larger than 5 MB.");
                setCsv("");
                setXlsx({ name: f.name, b64: await toBase64(f) });
              } else {
                setXlsx(null);
                setCsv(await f.text());
              }
            }}
          />
          {xlsx ? (
            <p className="text-[12.5px] text-text-2">
              Excel file: <span className="font-medium text-text">{xlsx.name}</span>{" "}
              <button type="button" className="text-link hover:underline" onClick={() => { setXlsx(null); reset(); }}>Remove</button>
            </p>
          ) : (
            <Textarea rows={6} value={csv} onChange={(e) => { setCsv(e.target.value); reset(); }} placeholder={BULK_TEMPLATE} className="font-mono text-[12px]" aria-label="CSV text" />
          )}
          {error && <Callout tone="critical">{error}</Callout>}
          {result && (
            <Callout tone={result.errors.length ? "warning" : "good"} title={`${result.created} post${result.created === 1 ? "" : "s"} ${result.pendingApproval ? "submitted for approval" : "scheduled"}${result.errors.length ? ` · ${result.errors.length} row${result.errors.length === 1 ? "" : "s"} skipped` : ""}`} />
          )}
          {checked && !result && (
            <Callout tone={checked.errors.length ? "warning" : "good"} title={`${checked.valid} row${checked.valid === 1 ? "" : "s"} ready${checked.errors.length ? ` · ${checked.errors.length} with errors (skipped)` : ""}`} />
          )}
          {shown && shown.preview.length > 0 && (
            <div className="scroll-thin max-h-72 overflow-auto rounded-md border border-border">
              <table className="w-full text-[12.5px]">
                <thead className="sticky top-0 bg-surface-2 text-left text-text-2">
                  <tr>
                    <th className="px-2 py-1.5 font-medium">Row</th>
                    <th className="px-2 py-1.5 font-medium">When</th>
                    <th className="px-2 py-1.5 font-medium">Channels</th>
                    <th className="px-2 py-1.5 font-medium">Post</th>
                    <th className="px-2 py-1.5 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.preview.map((r) => (
                    <tr key={r.line} className="border-t border-border align-top">
                      <td className="px-2 py-1.5 text-text-3">{r.line}</td>
                      <td className="px-2 py-1.5 whitespace-nowrap">{r.at ? <LocalTime iso={r.at} /> : "—"}</td>
                      <td className="px-2 py-1.5">{r.channels.join(", ") || "—"}</td>
                      <td className="max-w-[260px] px-2 py-1.5"><span className="line-clamp-2">{r.text || "—"}</span>{r.postType && r.postType !== "text" && <span className="text-text-3"> · {postTypeLabel(r.postType)}</span>}</td>
                      <td className="px-2 py-1.5">{r.error ? <span className="text-critical-ink">{r.error}</span> : <span className="text-good-ink">{result ? "Created" : "OK"}</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </Dialog>
    </>
  );
}
