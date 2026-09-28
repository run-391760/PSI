"use client";

import { Film, Search, Trash2, Upload } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { deleteAssetAction, setAssetTagsAction } from "@/app/(app)/cx/publishing/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Callout, EmptyState } from "@/components/ui/feedback";
import { Field, Input, Select } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { LocalTime } from "./posts-table";

export type AssetItem = { id: string; filename: string; mime: string; size: number; tags: string[]; created_at: string; used: number };
const url = (id: string) => `/api/cx/publishing/assets/${id}`;
const size = (b: number) => (b > 1_048_576 ? `${(b / 1_048_576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);

export function AssetLibrary({ brandId, assets, tags, canAuthor, filtered }: { brandId: string; assets: AssetItem[]; tags: string[]; canAuthor: boolean; filtered: boolean }) {
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
              Drop files here or choose them. JPEG, PNG, GIF, WebP, MP4, MOV, WebM · up to 100 MB each.
            </div>
            <Field label="Tags for this upload" htmlFor="up-tags" className="w-full sm:w-56">
              <Input id="up-tags" value={uploadTags} onChange={(e) => setUploadTags(e.target.value)} placeholder="product, autumn" />
            </Field>
            <input ref={fileRef} type="file" multiple accept="image/jpeg,image/png,image/gif,image/webp,video/mp4,video/quicktime,video/webm" className="hidden" onChange={(e) => e.target.files && upload(e.target.files)} />
            <Button variant="primary" disabled={busy} onClick={() => fileRef.current?.click()}>
              <Upload className="h-4 w-4" /> {busy ? "Uploading…" : "Choose files"}
            </Button>
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
                ) : (
                  <img src={url(a.id)} alt={a.filename} loading="lazy" className="h-full w-full object-cover" />
                )}
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
              {open.mime.startsWith("video/") ? <video src={url(open.id)} controls className="max-h-[50vh]" /> : <img src={url(open.id)} alt={open.filename} className="max-h-[50vh] object-contain" />}
            </div>
            <div className="flex flex-wrap gap-2 text-[12.5px] text-text-2">
              <Badge>{open.mime}</Badge>
              <span>{size(open.size)}</span>
              <span>· uploaded <LocalTime iso={open.created_at} /></span>
              <span>· used in {open.used} post{open.used === 1 ? "" : "s"}</span>
            </div>
            <Field label="Tags (comma-separated)" htmlFor="as-tags">
              <Input id="as-tags" value={editTags} onChange={(e) => setEditTags(e.target.value)} disabled={!canAuthor} />
            </Field>
          </div>
        )}
      </Dialog>
    </div>
  );
}
