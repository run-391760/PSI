"use client";

import { Copy, ExternalLink, Play } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { clearConsentAction, setConsentAction } from "@/app/(app)/cx/listening/actions";
import { Badge, type Tone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Textarea } from "@/components/ui/input";
import type { UgcItem } from "@/lib/cx/listening/ugc";
import { dateTimeLabel, timeAgo } from "@/lib/format";
import { cn } from "@/lib/utils";
import { SourceIcon } from "./source-icon";

type Item = UgcItem & { defaultRequest: string };
const TONE: Record<string, Tone> = { requested: "warning", granted: "good", denied: "critical", withdrawn: "neutral" };
const FILTERS = [
  { k: "consent", v: undefined, l: "All" },
  { k: "consent", v: "none", l: "Not requested" },
  { k: "consent", v: "requested", l: "Requested" },
  { k: "consent", v: "granted", l: "Granted" },
  { k: "consent", v: "denied", l: "Denied" },
];

/** Media grid with a consent tracker: request (copy the message, open the post), then record the answer. */
export function UgcBoard({ brandId, items, filter }: { brandId: string; items: Item[]; filter: { consent?: string; type?: string; sentiment?: string } }) {
  const router = useRouter();
  const [open, setOpen] = useState<Item | null>(null);
  const [text, setText] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const href = (patch: Record<string, string | undefined>) => {
    const p = new URLSearchParams({ brand: brandId });
    const f = { ...filter, ...patch };
    for (const [k, v] of Object.entries(f)) if (v) p.set(k, v);
    return `/cx/listening/ugc?${p}`;
  };
  const show = (i: Item) => {
    setOpen(i);
    setText(i.request_text || i.defaultRequest);
    setNote(i.rights_note ?? "");
    setErr(null);
    setCopied(false);
  };
  const set = async (status: "requested" | "granted" | "denied" | "withdrawn") => {
    if (!open) return;
    setBusy(status);
    const r = await setConsentAction(brandId, { mentionId: open.id, status, requestText: text, note });
    setBusy(null);
    if (!r.ok) return setErr(r.error);
    setOpen(null);
    router.refresh();
  };
  const clear = async () => {
    if (!open) return;
    setBusy("clear");
    await clearConsentAction(brandId, open.id);
    setBusy(null);
    setOpen(null);
    router.refresh();
  };
  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {FILTERS.map((f) => (
          <Link key={f.l} href={href({ consent: f.v })} className={cn("rounded-full border px-3 py-1 text-[12.5px]", filter.consent === f.v ? "border-brand bg-brand-soft text-brand-ink" : "border-border-strong text-text-2 hover:text-text")}>
            {f.l}
          </Link>
        ))}
        <span className="mx-1 h-4 w-px bg-border" />
        {[undefined, "image", "video"].map((t) => (
          <Link key={t ?? "any"} href={href({ type: t })} className={cn("rounded-full border px-3 py-1 text-[12.5px]", filter.type === t ? "border-brand bg-brand-soft text-brand-ink" : "border-border-strong text-text-2 hover:text-text")}>
            {t ? `${t[0].toUpperCase()}${t.slice(1)}s` : "Any media"}
          </Link>
        ))}
      </div>
      {!items.length && <p className="rounded-lg border border-dashed border-border-strong p-8 text-center text-[13px] text-text-3">No media posts match these filters.</p>}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {items.map((i) => {
          const m = i.media[0];
          return (
            <article key={i.id} className="flex flex-col overflow-hidden rounded-lg border border-border bg-surface shadow-card">
              <button type="button" onClick={() => show(i)} className="relative block aspect-[4/3] bg-surface-3" aria-label={`Open post by ${i.author}`}>
                {m?.preview || m?.type === "image" ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={m.preview ?? m.url} alt={m.alt ?? `Post by ${i.author}`} loading="lazy" referrerPolicy="no-referrer" className="h-full w-full object-cover" />
                ) : (
                  <span className="flex h-full items-center justify-center text-text-3"><Play className="h-8 w-8" /></span>
                )}
                {m?.type === "video" && <span className="absolute top-2 left-2 rounded bg-black/60 px-1.5 py-0.5 text-[11px] text-white">Video</span>}
                {i.media.length > 1 && <span className="absolute top-2 right-2 rounded bg-black/60 px-1.5 py-0.5 text-[11px] text-white">+{i.media.length - 1}</span>}
              </button>
              <div className="flex flex-1 flex-col gap-1.5 p-3 text-[12.5px]">
                <div className="flex min-w-0 items-center gap-1.5">
                  <SourceIcon source={i.source} />
                  <span className="truncate font-medium text-text">{i.author}</span>
                  <span className="ml-auto shrink-0 text-text-3">{i.published_at ? timeAgo(i.published_at) : ""}</span>
                </div>
                <p className="line-clamp-2 text-text-2">{i.title || i.body}</p>
                <div className="mt-auto flex items-center gap-2 pt-1">
                  {i.consent ? <Badge tone={TONE[i.consent]}>{i.consent}</Badge> : <Badge>not requested</Badge>}
                  <Button size="sm" variant="ghost" className="ml-auto" onClick={() => show(i)}>{i.consent ? "Update" : "Request rights"}</Button>
                </div>
              </div>
            </article>
          );
        })}
      </div>
      {open && (
        <Dialog open onClose={() => setOpen(null)} title="Reuse rights" description={`${open.author}${open.author_handle ? ` (${open.author_handle})` : ""} · ${open.published_at ? dateTimeLabel(open.published_at) : ""}`}>
          <div className="grid gap-3">
            <div className="flex gap-2 overflow-x-auto">
              {open.media.map((m, k) =>
                m.preview || m.type === "image" ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <a key={k} href={m.url} target="_blank" rel="noreferrer"><img src={m.preview ?? m.url} alt={m.alt ?? ""} referrerPolicy="no-referrer" className="h-24 w-32 shrink-0 rounded object-cover" /></a>
                ) : (
                  <a key={k} href={m.url} target="_blank" rel="noreferrer" className="flex h-24 w-32 shrink-0 items-center justify-center rounded bg-surface-3 text-text-3"><Play className="h-6 w-6" /></a>
                ),
              )}
            </div>
            <p className="text-[13px] text-text-2">{open.body}</p>
            <Field label="Consent request" htmlFor="ugc-t" hint="Copy it, reply to the post on the network, then record the answer here.">
              <Textarea id="ugc-t" rows={3} value={text} onChange={(e) => setText(e.target.value)} />
            </Field>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="secondary" onClick={() => navigator.clipboard.writeText(text).then(() => setCopied(true), () => setErr("Copy failed; select the text manually."))}>
                <Copy className="h-3.5 w-3.5" /> {copied ? "Copied" : "Copy message"}
              </Button>
              {open.url && (
                <a href={open.url} target="_blank" rel="noreferrer" className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border-strong px-2.5 text-[12.5px] font-medium hover:bg-surface-2">
                  <ExternalLink className="h-3.5 w-3.5" /> Open post
                </a>
              )}
            </div>
            <Field label="Rights note" htmlFor="ugc-n" hint="e.g. where the answer was given, usage limits, credit line">
              <Input id="ugc-n" value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} />
            </Field>
            {open.history?.length ? (
              <ol className="grid gap-1 rounded-md bg-surface-2 p-2 text-[12px] text-text-2">
                {open.history.map((h, k) => <li key={k}>{dateTimeLabel(h.at)} · {h.by}: {h.status}{h.note ? ` (${h.note})` : ""}</li>)}
              </ol>
            ) : null}
            {err && <p className="text-[12.5px] text-critical-ink">{err}</p>}
            <div className="flex flex-wrap gap-2">
              <Button variant="primary" onClick={() => set("requested")} loading={busy === "requested"}>Mark requested</Button>
              <Button variant="secondary" onClick={() => set("granted")} loading={busy === "granted"}>Granted</Button>
              <Button variant="secondary" onClick={() => set("denied")} loading={busy === "denied"}>Denied</Button>
              {open.consent === "granted" && <Button variant="ghost" onClick={() => set("withdrawn")} loading={busy === "withdrawn"}>Withdrawn</Button>}
              {open.consent && <Button variant="ghost" onClick={clear} loading={busy === "clear"}>Clear</Button>}
            </div>
          </div>
        </Dialog>
      )}
    </>
  );
}
