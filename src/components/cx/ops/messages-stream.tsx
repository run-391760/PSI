"use client";

import { Bookmark, BookmarkCheck, ChevronLeft, ChevronRight, Lock, MessagesSquare, Paperclip, Search, X } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { toggleBookmarkAction } from "@/app/(app)/cx/bookmarks/actions";
import { Avatar, ChannelIcon, channelLabel, SentimentBadge, StatusBadge } from "@/components/cx/inbox/ui";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/feedback";
import { Input, Select } from "@/components/ui/input";
import { Segmented } from "@/components/ui/tabs";
import { toPlainText } from "@/lib/cx/inbox/model";
import { mediaLabel } from "@/lib/cx/ops/model";
import type { StreamMessage } from "@/lib/cx/ops/messages";
import { dateTimeLabel, num, timeAgo } from "@/lib/format";
import { cn } from "@/lib/utils";

type F = { q: string; direction: string; channel: string; group: string; media: string; from: string; to: string; agent: string; sentiment: string };

export function MessagesStream({ brand, filters, rows, total, page, pageSize, channels, groups, agents }: {
  brand: string; filters: F; rows: StreamMessage[]; total: number; page: number; pageSize: number; channels: string[]; groups: { id: string; name: string }[]; agents: { id: string; name: string }[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const [q, setQ] = useState(filters.q);
  useEffect(() => setQ(filters.q), [filters.q]);
  const go = (patch: Record<string, string | null>, keepPage = false) => {
    const p = new URLSearchParams(search.toString());
    for (const [k, v] of Object.entries(patch)) if (v) p.set(k, v); else p.delete(k);
    if (!keepPage) p.delete("page");
    router.push(`${pathname}?${p.toString()}`, { scroll: false });
  };
  // Live stream: refresh every 20 s on the first page.
  useEffect(() => {
    if (page !== 1) return;
    const t = setInterval(() => document.visibilityState === "visible" && router.refresh(), 20_000);
    return () => clearInterval(t);
  }, [page, router]);
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const active = (["q", "direction", "channel", "group", "media", "from", "to", "agent", "sentiment"] as const).some((k) => filters[k]);
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <form className="relative min-w-[200px] flex-1 sm:max-w-sm" onSubmit={(e) => { e.preventDefault(); go({ q: q.trim() || null }); }}>
          <Search className="pointer-events-none absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2 text-text-3" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search message text, author, subject, customer" className="h-8 pl-8 text-[13px]" aria-label="Search messages" />
        </form>
        <Segmented value={filters.direction || "all"} onChange={(v) => go({ direction: v === "all" ? null : v })} options={[{ value: "all", label: "All" }, { value: "in", label: "Received" }, { value: "out", label: "Sent" }, { value: "note", label: "Notes" }]} />
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        {groups.length > 0 && <Sel label="All profiles" value={filters.group} onChange={(v) => go({ group: v })} options={groups.map((g) => [g.id, g.name])} />}
        <Sel label="Any channel" value={filters.channel} onChange={(v) => go({ channel: v })} options={channels.map((c) => [c, channelLabel(c)])} />
        <Sel label="Any agent" value={filters.agent} onChange={(v) => go({ agent: v })} options={agents.map((a) => [a.id, a.name])} />
        <Sel label="Any sentiment" value={filters.sentiment} onChange={(v) => go({ sentiment: v })} options={[["negative", "Negative"], ["neutral", "Neutral"], ["positive", "Positive"], ["mixed", "Mixed"]]} />
        <Input type="date" aria-label="From" value={filters.from} onChange={(e) => go({ from: e.target.value || null })} className="h-7 w-auto text-[12px]" />
        <Input type="date" aria-label="To" value={filters.to} onChange={(e) => go({ to: e.target.value || null })} className="h-7 w-auto text-[12px]" />
        {active && <button className="inline-flex items-center gap-1 px-1 text-[12px] text-link hover:underline" onClick={() => go({ q: null, direction: null, channel: null, group: null, media: null, from: null, to: null, agent: null, sentiment: null })}><X className="h-3 w-3" />Clear</button>}
      </div>
      <Card>
        {rows.length === 0 ? (
          <EmptyState icon={<MessagesSquare className="h-5 w-5" />} title={active ? "No messages match" : "No messages yet"} description={active ? "Try a wider date range or fewer filters." : "Messages from every connected channel appear here as they arrive."} />
        ) : (
          <ul className="divide-y divide-border">
            {rows.map((m) => <Row key={m.id} m={m} brand={brand} />)}
          </ul>
        )}
        {total > pageSize && (
          <div className="flex items-center justify-between gap-2 border-t border-border px-3 py-2 text-[12.5px] text-text-2">
            <span>{num((page - 1) * pageSize + 1)}–{num(Math.min(total, page * pageSize))} of {num(total)}</span>
            <div className="flex items-center gap-1">
              <button disabled={page <= 1} onClick={() => go({ page: String(page - 1) }, true)} className="rounded border border-border-strong p-1 disabled:opacity-40" aria-label="Previous page"><ChevronLeft className="h-3.5 w-3.5" /></button>
              <span className="px-1">Page {page} of {pages}</span>
              <button disabled={page >= pages} onClick={() => go({ page: String(page + 1) }, true)} className="rounded border border-border-strong p-1 disabled:opacity-40" aria-label="Next page"><ChevronRight className="h-3.5 w-3.5" /></button>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}

function Row({ m, brand }: { m: StreamMessage; brand: string }) {
  const router = useRouter();
  const [bm, setBm] = useState(m.bookmarked);
  useEffect(() => setBm(m.bookmarked), [m.bookmarked]);
  const note = m.direction === "note", out = m.direction === "out";
  return (
    <li className={cn("flex gap-3 px-3 py-2.5 sm:px-4", note && "bg-warning-soft/40")}>
      <span className="relative h-fit shrink-0 self-start">
        <Avatar name={m.author_name || (out ? "Agent" : "Customer")} className={cn("h-8 w-8", (out || note) && "bg-surface-3 text-text-2")} />
        <span className="absolute -right-1 -bottom-1 rounded-full border border-border bg-surface p-0.5"><ChannelIcon kind={m.channel_kind} className="h-2.5 w-2.5 text-text-2" /></span>
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[12px]">
          <span className="font-medium text-text">{m.author_name || (out ? "Agent" : "Customer")}</span>
          {note ? <span className="inline-flex items-center gap-0.5 text-warning-ink"><Lock className="h-3 w-3" />Private note</span> : out ? <Badge tone="info">Reply</Badge> : <Badge>Customer</Badge>}
          <span className="text-text-3">{mediaLabel(m.media_type)}{m.channel_name ? ` · ${m.channel_name}` : ""}</span>
          <time className="ml-auto text-text-3" title={dateTimeLabel(m.created_at)} suppressHydrationWarning>{timeAgo(m.created_at)}</time>
          <button type="button" onClick={async () => { setBm((x) => !x); const r = await toggleBookmarkAction(brand, { ticketId: m.ticket_id, messageId: m.id }); if (!r.ok) setBm(m.bookmarked); else router.refresh(); }} className="rounded p-0.5 text-text-3 hover:bg-surface-3 hover:text-text" aria-label={bm ? "Remove bookmark" : "Bookmark message"}>
            {bm ? <BookmarkCheck className="h-3.5 w-3.5 text-link" /> : <Bookmark className="h-3.5 w-3.5" />}
          </button>
        </div>
        <p className="mt-0.5 line-clamp-3 text-[13px] break-words whitespace-pre-line text-text">{m.body ? toPlainText(m.body) : <span className="text-text-3 italic">(no text)</span>}</p>
        <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11.5px] text-text-3">
          <Link href={`/cx/inbox?brand=${brand}&view=all&t=${m.ticket_id}`} className="min-w-0 truncate text-link hover:underline">#{m.number} {m.subject}</Link>
          {m.contact_name && <span>· {m.contact_name}</span>}
          <StatusBadge status={m.status} />
          {m.sentiment && <SentimentBadge sentiment={m.sentiment} />}
          {m.attachments > 0 && <span className="inline-flex items-center gap-0.5"><Paperclip className="h-3 w-3" />{m.attachments}</span>}
          {out && m.delivery === "failed" && <Badge tone="critical">Delivery failed</Badge>}
        </div>
      </div>
    </li>
  );
}

function Sel({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string | null) => void; options: [string, string][] }) {
  return (
    <Select value={value} onChange={(e) => onChange(e.target.value || null)} className={cn("h-7 w-auto max-w-full py-0 text-[12px]", value && "border-link text-link")} aria-label={label}>
      <option value="">{label}</option>
      {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
    </Select>
  );
}
