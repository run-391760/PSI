"use client";

import { Copy, ExternalLink, Pencil, Plus, Ticket, Trash2, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { deleteBoardAction, saveBoardAction } from "@/app/(app)/cx/command/actions";
import { createTicketAction } from "@/app/(app)/cx/listening/actions";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Select } from "@/components/ui/input";
import type { StreamDef, StreamItem } from "@/lib/cx/listening/command";
import { timeAgo } from "@/lib/format";
import { cn } from "@/lib/utils";
import { SourceIcon } from "./source-icon";

type Opt = { value: string; label: string };

/** Stream columns (scrolling mention cards) with share/open/ticket actions. */
export function StreamColumns({ brandId, streams }: { brandId: string; streams: (StreamDef & { items: StreamItem[] })[] }) {
  const router = useRouter();
  const [flash, setFlash] = useState<string | null>(null);
  const share = async (m: StreamItem) => {
    const text = `${m.author}: ${(m.title || m.body).slice(0, 200)}${m.url ? `\n${m.url}` : ""}`;
    try {
      if (navigator.share) await navigator.share({ title: `Mention by ${m.author}`, text, url: m.url ?? undefined });
      else {
        await navigator.clipboard.writeText(text);
        setFlash(m.id);
        setTimeout(() => setFlash(null), 1500);
      }
    } catch {}
  };
  const ticket = async (m: StreamItem) => {
    const r = await createTicketAction(brandId, m.id);
    if (r.ok) router.push(`/cx/inbox?brand=${brandId}&ticket=${r.data.ticketId}`);
  };
  return (
    <div className="scroll-thin flex snap-x gap-3 overflow-x-auto pb-2">
      {streams.map((s) => (
        <section key={s.id} className="flex max-h-[75vh] w-[300px] shrink-0 snap-start flex-col rounded-lg border border-border bg-surface sm:w-[340px]">
          <h3 className="border-b border-border px-3 py-2 text-[13px] font-semibold text-text">{s.name} <span className="font-normal text-text-3">({s.items.length})</span></h3>
          <ul className="scroll-thin grid flex-1 content-start gap-2 overflow-y-auto p-2">
            {s.items.map((m) => {
              const media = m.media?.[0];
              return (
                <li key={m.id} className={cn("rounded-md border-l-4 bg-surface-2 p-2 text-[12.5px]", m.sentiment === "negative" ? "border-l-[var(--critical)]" : m.sentiment === "positive" ? "border-l-[var(--good)]" : "border-l-border-strong")}>
                  <div className="flex items-center gap-1.5 text-text-3">
                    <SourceIcon source={m.source} />
                    <span className="truncate font-medium text-text-2">{m.author}</span>
                    <span className="ml-auto shrink-0">{m.published_at ? timeAgo(m.published_at) : ""}</span>
                  </div>
                  {media?.preview && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={media.preview} alt="" loading="lazy" referrerPolicy="no-referrer" className="mt-1.5 max-h-40 w-full rounded object-cover" />
                  )}
                  <p className="mt-1 line-clamp-4 text-text">{m.title ? <b className="font-medium">{m.title} </b> : null}{m.body}</p>
                  <div className="mt-1.5 flex items-center gap-1">
                    <button type="button" onClick={() => share(m)} className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-text-2 hover:bg-surface-3" aria-label="Share mention">
                      <Copy className="h-3 w-3" /> {flash === m.id ? "Copied" : "Share"}
                    </button>
                    {m.url && <a href={m.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-text-2 hover:bg-surface-3"><ExternalLink className="h-3 w-3" /> Open</a>}
                    {m.ticket_id ? (
                      <Link href={`/cx/inbox?brand=${brandId}&ticket=${m.ticket_id}`} className="ml-auto rounded px-1.5 py-0.5 text-link hover:bg-surface-3">Ticket</Link>
                    ) : (
                      <button type="button" onClick={() => ticket(m)} className="ml-auto inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-text-2 hover:bg-surface-3"><Ticket className="h-3 w-3" /> To ticket</button>
                    )}
                  </div>
                </li>
              );
            })}
            {!s.items.length && <li className="p-4 text-center text-[12.5px] text-text-3">No mentions match this stream.</li>}
          </ul>
        </section>
      ))}
    </div>
  );
}

type Draft = { id?: string; name: string; streams: { id?: string; name: string; topic?: string; source?: string; sentiment?: string; q?: string }[] };

/** Create / edit / delete a board (a set of streams). */
export function BoardEditor({ brandId, board, topics, sources, compact }: { brandId: string; board?: Draft; topics: Opt[]; sources: Opt[]; compact?: boolean }) {
  const router = useRouter();
  const [d, setD] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const start = () =>
    setD(board ? structuredClone(board) : { name: "War room", streams: [{ name: "All mentions" }, { name: "Negative", sentiment: "negative" }, ...topics.slice(0, 2).map((t) => ({ name: t.label, topic: t.value }))] });
  const save = async () => {
    if (!d) return;
    setSaving(true);
    const clean = d.streams.map((s) => ({ ...s, topic: s.topic || undefined, source: s.source || undefined, sentiment: s.sentiment || undefined, q: s.q || undefined }));
    const r = await saveBoardAction(brandId, { name: d.name, streams: clean as never }, d.id);
    setSaving(false);
    if (!r.ok) return setErr(r.error);
    setD(null);
    router.push(`/cx/command/streams?brand=${brandId}&board=${r.data.id}`);
    router.refresh();
  };
  const remove = async () => {
    if (!board?.id || !confirm("Delete this board?")) return;
    await deleteBoardAction(brandId, board.id);
    router.push(`/cx/command/streams?brand=${brandId}`);
    router.refresh();
  };
  const upd = (i: number, patch: Partial<Draft["streams"][number]>) => setD((x) => (x ? { ...x, streams: x.streams.map((s, k) => (k === i ? { ...s, ...patch } : s)) } : x));
  return (
    <>
      <span className="flex gap-1">
        <Button size="sm" variant={compact ? "ghost" : "primary"} onClick={start}>{board ? <><Pencil className="h-3.5 w-3.5" /> Edit board</> : <><Plus className="h-3.5 w-3.5" /> New board</>}</Button>
        {board && <Button size="sm" variant="ghost" onClick={remove} aria-label="Delete board"><Trash2 className="h-3.5 w-3.5" /></Button>}
      </span>
      {d && (
        <Dialog open onClose={() => setD(null)} title={d.id ? "Edit board" : "New board"} description="A board is a set of streams; each stream is a filtered, live column of mentions." size="lg">
          <div className="grid gap-3">
            <Field label="Board name" htmlFor="b-n"><Input id="b-n" value={d.name} maxLength={60} onChange={(e) => setD({ ...d, name: e.target.value })} /></Field>
            {d.streams.map((s, i) => (
              <div key={i} className="grid grid-cols-2 gap-2 rounded-md border border-border p-2 sm:grid-cols-[1.2fr_1fr_1fr_1fr_1fr_auto]">
                <Input aria-label="Stream name" value={s.name} maxLength={40} onChange={(e) => upd(i, { name: e.target.value })} placeholder="Name" />
                <Select aria-label="Topic" value={s.topic ?? ""} onChange={(e) => upd(i, { topic: e.target.value })}>
                  <option value="">All topics</option>
                  {topics.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                </Select>
                <Select aria-label="Source" value={s.source ?? ""} onChange={(e) => upd(i, { source: e.target.value })}>
                  <option value="">All sources</option>
                  {sources.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                </Select>
                <Select aria-label="Sentiment" value={s.sentiment ?? ""} onChange={(e) => upd(i, { sentiment: e.target.value })}>
                  <option value="">Any sentiment</option>
                  <option value="positive">Positive</option>
                  <option value="neutral">Neutral</option>
                  <option value="negative">Negative</option>
                </Select>
                <Input aria-label="Keyword" value={s.q ?? ""} maxLength={80} onChange={(e) => upd(i, { q: e.target.value })} placeholder="Keyword" />
                <Button variant="ghost" size="sm" aria-label="Remove stream" onClick={() => setD({ ...d, streams: d.streams.filter((_, k) => k !== i) })}><X className="h-4 w-4" /></Button>
              </div>
            ))}
            {d.streams.length < 8 && <Button variant="secondary" size="sm" className="justify-self-start" onClick={() => setD({ ...d, streams: [...d.streams, { name: `Stream ${d.streams.length + 1}` }] })}><Plus className="h-3.5 w-3.5" /> Add stream</Button>}
            {err && <p className="text-[12.5px] text-critical-ink">{err}</p>}
            <div className="flex gap-2">
              <Button variant="primary" onClick={save} loading={saving}>Save board</Button>
              <Button variant="ghost" onClick={() => setD(null)}>Cancel</Button>
            </div>
          </div>
        </Dialog>
      )}
    </>
  );
}
