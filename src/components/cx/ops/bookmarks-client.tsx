"use client";

import { Bookmark, MessageSquare, Pencil, Search, Ticket, Trash2, X } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { bookmarkNoteAction, deleteBookmarkAction } from "@/app/(app)/cx/bookmarks/actions";
import { ChannelIcon, StatusBadge } from "@/components/cx/inbox/ui";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Callout, EmptyState } from "@/components/ui/feedback";
import { Input } from "@/components/ui/input";
import { toPlainText } from "@/lib/cx/inbox/model";
import type { Bookmark as B } from "@/lib/cx/ops/bookmarks";
import { dateTimeLabel, timeAgo } from "@/lib/format";

export function BookmarksClient({ brand, rows, q }: { brand: string; rows: B[]; q: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const [text, setText] = useState(q);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => setText(q), [q]);
  const go = (v: string) => { const p = new URLSearchParams(search.toString()); if (v) p.set("q", v); else p.delete("q"); router.push(`${pathname}?${p.toString()}`, { scroll: false }); };
  return (
    <div className="space-y-3">
      <form className="relative max-w-sm" onSubmit={(e) => { e.preventDefault(); go(text.trim()); }}>
        <Search className="pointer-events-none absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2 text-text-3" />
        <Input value={text} onChange={(e) => setText(e.target.value)} placeholder="Search bookmarks and notes" className="h-8 pl-8 text-[13px]" aria-label="Search bookmarks" />
      </form>
      {error && <Callout tone="critical">{error}</Callout>}
      <Card>
        {rows.length === 0 ? (
          <EmptyState icon={<Bookmark className="h-5 w-5" />} title={q ? "No bookmarks match" : "No bookmarks yet"} description="Use the bookmark icon on a ticket (header or card) or on any message to save it here." action={<Link href={`/cx/inbox?brand=${brand}`} className="text-[13px] text-link hover:underline">Go to the inbox →</Link>} />
        ) : (
          <ul className="divide-y divide-border">
            {rows.map((b) => <Item key={b.id} b={b} brand={brand} onError={setError} onChange={() => router.refresh()} />)}
          </ul>
        )}
      </Card>
    </div>
  );
}

function Item({ b, brand, onError, onChange }: { b: B; brand: string; onError: (e: string) => void; onChange: () => void }) {
  const [editing, setEditing] = useState(false);
  const [note, setNote] = useState(b.note);
  const href = `/cx/inbox?brand=${brand}&view=all&t=${b.ticket_id}`;
  return (
    <li className="flex gap-3 px-3 py-3 sm:px-4">
      <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-soft text-link">{b.message_id ? <MessageSquare className="h-3.5 w-3.5" /> : <Ticket className="h-3.5 w-3.5" />}</span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[12px] text-text-3">
          <ChannelIcon kind={b.channel_kind} />
          <Link href={href} className="min-w-0 truncate text-[13px] font-medium text-link hover:underline">#{b.number} {b.subject}</Link>
          <StatusBadge status={b.status} />
          {b.contact_name && <span>{b.contact_name}</span>}
          <span className="ml-auto" title={dateTimeLabel(b.created_at)} suppressHydrationWarning>saved {timeAgo(b.created_at)}</span>
        </div>
        {b.message_id && (
          <blockquote className="mt-1.5 rounded-md border-l-2 border-border-strong bg-surface-2 px-2.5 py-1.5 text-[12.5px] text-text">
            <div className="mb-0.5 text-[11px] text-text-3">{b.message_author || (b.message_direction === "in" ? "Customer" : "Agent")}{b.message_direction === "note" ? " · private note" : ""}{b.message_at && <> · <span suppressHydrationWarning>{dateTimeLabel(b.message_at)}</span></>}</div>
            <p className="line-clamp-4 whitespace-pre-line break-words">{toPlainText(b.message_body ?? "")}</p>
          </blockquote>
        )}
        {editing ? (
          <form className="mt-1.5 flex gap-1.5" onSubmit={async (e) => { e.preventDefault(); const r = await bookmarkNoteAction(brand, b.id, note); if (!r.ok) onError(r.error); else { setEditing(false); onChange(); } }}>
            <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Why you saved it" className="h-7 text-[12.5px]" autoFocus maxLength={500} />
            <Button size="sm" type="submit">Save</Button>
            <Button size="sm" variant="ghost" type="button" onClick={() => { setEditing(false); setNote(b.note); }}><X className="h-3.5 w-3.5" /></Button>
          </form>
        ) : b.note ? <p className="mt-1 text-[12.5px] text-text-2"><span className="text-text-3">Note:</span> {b.note}</p> : null}
      </div>
      <div className="flex shrink-0 items-start gap-0.5">
        <button onClick={() => setEditing(true)} className="rounded p-1 text-text-3 hover:bg-surface-3 hover:text-text" aria-label="Edit note" title="Add or edit a note"><Pencil className="h-3.5 w-3.5" /></button>
        <button onClick={async () => { const r = await deleteBookmarkAction(brand, b.id); if (!r.ok) onError(r.error); else onChange(); }} className="rounded p-1 text-text-3 hover:bg-surface-3 hover:text-critical-ink" aria-label="Remove bookmark" title="Remove bookmark"><Trash2 className="h-3.5 w-3.5" /></button>
      </div>
    </li>
  );
}
