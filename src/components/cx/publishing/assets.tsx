"use client";

import { Check, Crop, FileText, Film, Search, Send, Trash2, Upload } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { decideAssetAction, deleteAssetAction, requestAssetApprovalAction, setAssetTagsAction } from "@/app/(app)/cx/publishing/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Callout, EmptyState } from "@/components/ui/feedback";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { AiCompose } from "./ai-compose";
import { ImageEditor } from "./image-editor";
import { LocalTime } from "./posts-table";

export type AssetItem = { id: string; filename: string; mime: string; size: number; tags: string[]; created_at: string; used: number; approval: string; approval_note: string; approval_by: string | null; approval_at: string | null; origin: string | null };
const APPROVAL: Record<string, { label: string; cls: string }> = {
  pending: { label: "Pending approval", cls: "bg-warning-soft text-warning-ink" },
  approved: { label: "Approved", cls: "bg-good-soft text-good-ink" },
  rejected: { label: "Rejected", cls: "bg-critical-soft text-critical-ink" },
};
const url = (id: string) => `/api/cx/publishing/assets/${id}`;
const size = (b: number) => (b > 1_048_576 ? `${(b / 1_048_576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);

export function AssetLibrary({ brandId, assets, tags, canAuthor, canApprove, approvers, imageAi, filtered }: { brandId: string; assets: AssetItem[]; tags: string[]; canAuthor: boolean; canApprove: boolean; approvers: { user_id: string; name: string }[]; imageAi: boolean; filtered: boolean }) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploadTags, setUploadTags] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState(sp.get("q") ?? "");
  const [open, setOpen] = useState<AssetItem | null>(null);
  const [editTags, setEditTags] = useState("");
  const [pending, start] = useTransition();
  const [drag, setDrag] = useState(false);
  const [note, setNote] = useState("");
  const [approver, setApprover] = useState("");
  const [editing, setEditing] = useState<AssetItem | null>(null);
  const act = (fn: () => Promise<{ ok: boolean; error?: string }>) =>
    start(async () => {
      const r = await fn();
      if (!r.ok) return setError(r.error ?? "Failed.");
      setError(null);
      setOpen(null);
      setNote("");
      router.refresh();
    });

  const nav = (patch: Record<string, string>) => {
    const p = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(patch)) (v ? p.set(k, v) : p.delete(k));
    router.push(`${pathname}?${p.toString()}`);
  };
  const upload = async (files: FileList | File[]) => {
    if (!files.length) return;
    setBusy(true);
    setError(null);
    const fd = new FormData();
    fd.set("brand", brandId);
    fd.set("tags", uploadTags);
    for (const f of Array.from(files)) fd.append("file", f);
    const res = await fetch("/api/cx/publishing/assets", { method: "POST", body: fd }).catch(() => null);
    const j = (await res?.json().catch(() => ({}))) as { error?: string; errors?: string[] } | undefined;
    setBusy(false);
    if (!res?.ok) setError(j?.error ?? j?.errors?.join(" ") ?? "Upload failed.");
    else if (j?.errors?.length) setError(j.errors.join(" "));
    if (fileRef.current) fileRef.current.value = "";
    router.refresh();
  };

  return (
    <div className="grid gap-4">
      {canAuthor && (
        <Card
          className={cn("border-dashed", drag && "border-brand bg-brand-soft")}
        >
          <div
            onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
            onDragLeave={() => setDrag(false)}
            onDrop={(e) => { e.preventDefault(); setDrag(false); upload(e.dataTransfer.files); }}
            className="flex flex-wrap items-end gap-3 p-4"
          >
            <div className="min-w-0 flex-1 text-[13px] text-text-2">
              <div className="font-medium text-text">Upload images or videos</div>
              Drop files here or choose them. JPEG, PNG, GIF, WebP, MP4, MOV, WebM, PDF · up to 100 MB each.
            </div>
            <Field label="Tags for this upload" htmlFor="up-tags" className="w-full sm:w-56">
              <Input id="up-tags" value={uploadTags} onChange={(e) => setUploadTags(e.target.value)} placeholder="product, autumn" />
            </Field>
            <input ref={fileRef} type="file" multiple accept="image/jpeg,image/png,image/gif,image/webp,video/mp4,video/quicktime,video/webm,application/pdf" className="hidden" onChange={(e) => e.target.files && upload(e.target.files)} />
            <Button variant="primary" disabled={busy} onClick={() => fileRef.current?.click()}>
              <Upload className="h-4 w-4" /> {busy ? "Uploading…" : "Choose files"}
            </Button>
            <AiCompose brandId={brandId} channel="instagram" postType="text" textAi={false} imageAi={imageAi} disabled={busy} onText={() => {}} onImage={() => router.refresh()} />
          </div>
        </Card>
      )}
      {error && <Callout tone="critical">{error}</Callout>}
      <div className="flex flex-wrap items-center gap-2">
        <form className="relative w-full sm:w-72" onSubmit={(e) => { e.preventDefault(); nav({ q }); }}>
          <Search className="absolute top-2.5 left-2.5 h-3.5 w-3.5 text-text-3" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search file names and tags" className="pl-8" />
        </form>
        <Select value={sp.get("kind") ?? ""} onChange={(e) => nav({ kind: e.target.value })} aria-label="Type" className="w-32">
          <option value="">All types</option>
          <option value="image">Images</option>
          <option value="video">Videos</option>
          <option value="document">Documents</option>
        </Select>
        <Select value={sp.get("approval") ?? ""} onChange={(e) => nav({ approval: e.target.value })} aria-label="Approval" className="w-44">
          <option value="">Any approval state</option>
          <option value="none">Not sent</option>
          <option value="pending">Pending approval</option>
          <option value="approved">Approved</option>
          <option value="rejected">Rejected</option>
        </Select>
        <div className="flex flex-wrap gap-1">
          {tags.map((t) => (
            <button key={t} type="button" onClick={() => nav({ tag: sp.get("tag") === t ? "" : t })} className={cn("rounded-full border px-2 py-0.5 text-[12px]", sp.get("tag") === t ? "border-brand bg-brand-soft" : "border-border text-text-2 hover:bg-surface-3")}>
              #{t}
            </button>
          ))}
        </div>
      </div>
      {assets.length ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-6">
          {assets.map((a) => (
            <button key={a.id} type="button" onClick={() => { setOpen(a); setEditTags(a.tags.join(", ")); }} className="group overflow-hidden rounded-lg border border-border bg-surface text-left shadow-card hover:border-border-strong">
              <div className="relative aspect-square bg-surface-3">
                {a.mime.startsWith("video/") ? (
                  <>
                    <video src={url(a.id)} className="h-full w-full object-cover" muted preload="metadata" />
                    <Film className="absolute top-2 right-2 h-4 w-4 text-white drop-shadow" />
                  </>
                ) : a.mime.startsWith("image/") ? (
                  <img src={url(a.id)} alt={a.filename} loading="lazy" className="h-full w-full object-cover" />
                ) : (
                  <span className="flex h-full w-full items-center justify-center text-text-3"><FileText className="h-8 w-8" /></span>
                )}
                {APPROVAL[a.approval] && <span className={cn("absolute bottom-1.5 left-1.5 rounded px-1.5 py-0.5 text-[10.5px] font-medium", APPROVAL[a.approval].cls)}>{APPROVAL[a.approval].label}</span>}
              </div>
              <div className="p-2">
                <div className="truncate text-[12.5px] font-medium">{a.filename}</div>
                <div className="truncate text-[11.5px] text-text-3">{size(a.size)}{a.tags.length ? ` · #${a.tags.join(" #")}` : ""}</div>
              </div>
            </button>
          ))}
        </div>
      ) : (
        <Card>
          <EmptyState title={filtered ? "No assets match" : "The library is empty"} description={filtered ? "Try another search or tag." : "Upload images and videos to attach them to posts."} />
        </Card>
      )}
      <Dialog
        open={!!open}
        onClose={() => setOpen(null)}
        title={open?.filename ?? ""}
        size="lg"
        footer={
          open &&
          canAuthor && (
            <>
              <Button variant="danger" disabled={pending} onClick={() => confirm("Delete this asset? Posts using it lose the media.") && start(async () => { await deleteAssetAction(brandId, open.id); setOpen(null); router.refresh(); })}>
                <Trash2 className="h-4 w-4" /> Delete
              </Button>
              {open.mime.startsWith("image/") && open.mime !== "image/gif" && (
                <Button disabled={pending} onClick={() => { setEditing(open); setOpen(null); }}>
                  <Crop className="h-4 w-4" /> Edit / crop
                </Button>
              )}
              <Button variant="primary" disabled={pending} onClick={() => start(async () => { await setAssetTagsAction(brandId, open.id, editTags.split(",")); setOpen(null); router.refresh(); })}>
                Save tags
              </Button>
            </>
          )
        }
      >
        {open && (
          <div className="grid gap-3">
            <div className="flex max-h-[50vh] justify-center overflow-hidden rounded-md bg-surface-3">
              {open.mime.startsWith("video/") ? (
                <video src={url(open.id)} controls className="max-h-[50vh]" />
              ) : open.mime.startsWith("image/") ? (
                <img src={url(open.id)} alt={open.filename} className="max-h-[50vh] object-contain" />
              ) : (
                <a href={url(open.id)} target="_blank" rel="noreferrer" className="flex items-center gap-2 p-8 text-link hover:underline"><FileText className="h-6 w-6" /> Open document</a>
              )}
            </div>
            <div className="flex flex-wrap gap-2 text-[12.5px] text-text-2">
              <Badge>{open.mime}</Badge>
              <span>{size(open.size)}</span>
              <span>· uploaded <LocalTime iso={open.created_at} /></span>
              <span>· used in {open.used} post{open.used === 1 ? "" : "s"}</span>
              {open.origin === "ai" && <Badge tone="info">AI-generated</Badge>}
            </div>
            <div className="grid gap-2 rounded-md border border-border p-3">
              <div className="flex flex-wrap items-center gap-2 text-[13px]">
                <span className="font-medium">Approval</span>
                <span className={cn("rounded px-1.5 py-0.5 text-[11.5px] font-medium", APPROVAL[open.approval]?.cls ?? "bg-surface-3 text-text-2")}>{APPROVAL[open.approval]?.label ?? "Not sent for approval"}</span>
                {open.approval_by && open.approval_at && (
                  <span className="text-[12px] text-text-3">
                    by {open.approval_by} · <LocalTime iso={open.approval_at} />
                  </span>
                )}
              </div>
              {open.approval_note && <p className={cn("text-[12.5px] whitespace-pre-wrap", open.approval === "rejected" ? "text-critical-ink" : "text-text-2")}>{open.approval_note}</p>}
              {canApprove && open.approval === "pending" ? (
                <>
                  <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (required to reject)" aria-label="Approval note" />
                  <div className="flex gap-2">
                    <Button size="sm" variant="primary" disabled={pending} onClick={() => act(() => decideAssetAction(brandId, open.id, "approved", note))}>
                      <Check className="h-3.5 w-3.5" /> Approve
                    </Button>
                    <Button size="sm" disabled={pending || !note.trim()} onClick={() => act(() => decideAssetAction(brandId, open.id, "rejected", note))}>
                      Reject
                    </Button>
                  </div>
                </>
              ) : (
                canAuthor &&
                open.approval !== "approved" && (
                  <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
                    <Field label="Approver" htmlFor="as-appr">
                      <Select id="as-appr" value={approver} onChange={(e) => setApprover(e.target.value)}>
                        <option value="">Owner + all approvers</option>
                        {approvers.map((a) => <option key={a.user_id} value={a.user_id}>{a.name}</option>)}
                      </Select>
                    </Field>
                    <Field label="Note" htmlFor="as-note">
                      <Input id="as-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Context for the approver" />
                    </Field>
                    <Button size="sm" disabled={pending} onClick={() => act(() => requestAssetApprovalAction(brandId, open.id, approver || null, note))}>
                      <Send className="h-3.5 w-3.5" /> {open.approval === "pending" ? "Resend" : "Send for approval"}
                    </Button>
                  </div>
                )
              )}
            </div>
            <Field label="Tags (comma-separated)" htmlFor="as-tags">
              <Input id="as-tags" value={editTags} onChange={(e) => setEditTags(e.target.value)} disabled={!canAuthor} />
            </Field>
          </div>
        )}
      </Dialog>
      <ImageEditor
        brandId={brandId}
        asset={editing}
        onClose={() => setEditing(null)}
        onSaved={() => {
          setEditing(null);
          router.refresh();
        }}
      />
    </div>
  );
}
