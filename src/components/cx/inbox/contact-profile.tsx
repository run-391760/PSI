"use client";

import { ExternalLink, GitMerge, Plus, Trash, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { addNoteAction, deleteContactAction, deleteNoteAction, mergeContactsAction, updateContactAction } from "@/app/(app)/cx/contacts/actions";
import { TrendChart } from "@/components/charts/trend-chart";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Callout, EmptyState } from "@/components/ui/feedback";
import { Field, Input, Textarea } from "@/components/ui/input";
import { Metric, MetricStrip } from "@/components/ui/metric";
import { Segmented, Tabs } from "@/components/ui/tabs";
import { journeyWindow, type JourneyItem } from "@/lib/cx/inbox/model";
import type { ContactDetail } from "@/lib/cx/inbox/contacts";
import { dateTimeLabel } from "@/lib/format";
import { Ago } from "./time";
import { Avatar, ChannelIcon, channelLabel, KeyValue, PriorityBadge, SentimentBadge, StatusBadge } from "./ui";

type Dupe = { id: string; name: string; email: string | null; phone: string | null; reason: string };

export function ContactProfile({ brand, detail, duplicates }: { brand: string; detail: ContactDetail; duplicates: Dupe[] }) {
  const router = useRouter();
  const c = detail.contact;
  const [error, setError] = useState<string | null>(null);
  const [edit, setEdit] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const run = async (p: Promise<{ ok: boolean; error?: string }>) => {
    setError(null);
    const r = await p;
    if (!r.ok) setError(r.error ?? "Failed");
    router.refresh();
    return r.ok;
  };
  const inbound = detail.messages.filter((m) => m.direction === "in");
  const channels = [...new Set(detail.tickets.map((t) => t.channel_kind))];
  const csat = detail.tickets.filter((t) => t.csat != null);
  const avgScore = detail.trend.length ? detail.trend.reduce((s, w) => s + w.score * w.messages, 0) / detail.trend.reduce((s, w) => s + w.messages, 0) : null;

  return (
    <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
      <div className="space-y-4">
        <Card>
          <CardBody className="pt-4">
            <div className="flex items-center gap-3">
              <Avatar name={c.name || c.email || "?"} className="h-11 w-11 text-[14px]" />
              <div className="min-w-0">
                <div className="truncate text-[15px] font-semibold text-text">{c.name || "Unnamed"}</div>
                <div className="flex gap-1.5 text-text-3">{channels.map((k) => <span key={k} title={channelLabel(k)}><ChannelIcon kind={k} /></span>)}</div>
              </div>
              <Button size="sm" variant="ghost" className="ml-auto" onClick={() => setEdit(true)}>Edit</Button>
            </div>
            <div className="mt-3 divide-y divide-border">
              <KeyValue label="Email">{c.email ?? <span className="text-text-3">n/a</span>}</KeyValue>
              <KeyValue label="Phone">{c.phone ?? <span className="text-text-3">n/a</span>}</KeyValue>
              {Object.entries(c.handles).map(([k, v]) => <KeyValue key={k} label={channelLabel(k)}><span className="font-mono text-[11.5px]">{v.length > 18 ? `${v.slice(0, 8)}…` : v}</span></KeyValue>)}
              <KeyValue label="First seen"><Ago iso={c.first_seen} /></KeyValue>
              <KeyValue label="Last seen"><Ago iso={c.last_seen} /></KeyValue>
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Tags" />
          <CardBody><Tags tags={c.tags} onChange={(tags) => run(updateContactAction(brand, c.id, { tags }))} /></CardBody>
        </Card>

        <Card>
          <CardHeader title="Attributes" description="Custom fields (plan, account id, city…)." />
          <CardBody><Attributes attrs={c.attributes} onSave={(attributes) => run(updateContactAction(brand, c.id, { attributes }))} /></CardBody>
        </Card>

        <Card>
          <CardHeader title="Possible duplicates" info="Same phone number, same name or same email user name. Merging moves tickets and notes into this contact." />
          <CardBody>
            {duplicates.length === 0 ? <p className="text-[12.5px] text-text-3">No likely duplicates found.</p> : (
              <ul className="space-y-2">
                {duplicates.map((d) => (
                  <li key={d.id} className="flex items-center gap-2 text-[12.5px]">
                    <div className="min-w-0 flex-1">
                      <Link href={`/cx/contacts/${d.id}?brand=${brand}`} className="block truncate text-link hover:underline">{d.name || "Unnamed"}</Link>
                      <span className="text-text-3">{d.reason} · {d.email ?? d.phone ?? ""}</span>
                    </div>
                    <Button size="sm" onClick={() => run(mergeContactsAction(brand, c.id, [d.id]))}><GitMerge className="h-3.5 w-3.5" />Merge here</Button>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
        <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(true)}><Trash className="h-3.5 w-3.5" />Delete contact</Button>
      </div>

      <div className="min-w-0 space-y-4">
        {error && <Callout tone="critical">{error}</Callout>}
        <Card>
          <MetricStrip className="border-0 shadow-none">
            <Metric label="Tickets" value={detail.tickets.length} size="sm" />
            <Metric label="Messages from contact" value={inbound.length} size="sm" />
            <Metric label="Avg. sentiment" value={avgScore == null ? "n/a" : avgScore.toFixed(2)} size="sm" info="Mean lexicon sentiment of the customer's own messages (-1 negative … +1 positive)." />
            <Metric label="CSAT" value={csat.length ? `${(csat.reduce((s, t) => s + (t.csat ?? 0), 0) / csat.length).toFixed(1)} / 5` : "n/a"} size="sm" />
          </MetricStrip>
        </Card>

        <Card>
          <CardHeader title="Sentiment trend" description="Weekly average sentiment of this customer's messages across all channels." />
          <CardBody>
            {detail.trend.length < 2 ? (
              <p className="py-6 text-center text-[13px] text-text-3">{detail.trend.length === 0 ? "No customer messages yet." : `One week of messages so far (score ${detail.trend[0].score.toFixed(2)}). The trend appears after messages in a second week.`}</p>
            ) : (
              <TrendChart data={detail.trend} xKey="week" xFormat="day" yFormat="raw" yDomain={[-1, 1]} height={200} series={[{ key: "score", label: "Sentiment score" }]} />
            )}
          </CardBody>
        </Card>

        <Card>
          <Tabs
            className="pt-1"
            tabs={[
              { id: "journey", label: "User journey", content: <JourneyTab brand={brand} detail={detail} /> },
              { id: "tickets", label: `Tickets (${detail.tickets.length})`, content: <TicketsTab brand={brand} tickets={detail.tickets} /> },
              { id: "messages", label: `Messages (${detail.messages.length})`, content: <MessagesTab brand={brand} messages={detail.messages} /> },
              { id: "mentions", label: `Mentions (${detail.mentions.length})`, content: <MentionsTab mentions={detail.mentions} /> },
              { id: "notes", label: `Notes (${detail.notes.length})`, content: <NotesTab notes={detail.notes} onAdd={(b) => run(addNoteAction(brand, c.id, b))} onDelete={(id) => run(deleteNoteAction(brand, id))} /> },
            ]}
          />
        </Card>
      </div>

      {edit && <EditContact c={c} onClose={() => setEdit(false)} onSave={async (p) => { if (await run(updateContactAction(brand, c.id, p))) setEdit(false); }} error={error} />}
      <Dialog open={confirmDelete} onClose={() => setConfirmDelete(false)} size="sm" title="Delete contact?" description="Tickets stay in the inbox without a linked contact."
        footer={<><Button onClick={() => setConfirmDelete(false)}>Cancel</Button><Button variant="danger" onClick={async () => { const r = await deleteContactAction(brand, c.id); if (r.ok) router.push(`/cx/contacts?brand=${brand}`); else setError(r.error); }}>Delete</Button></>}>
        <p className="text-[13px] text-text-2">{c.name}</p>
      </Dialog>
    </div>
  );
}

/** User Journey: every touchpoint across channels, ascending/descending, last 30/60/180 days or all time. */
function JourneyTab({ brand, detail }: { brand: string; detail: ContactDetail }) {
  const [order, setOrder] = useState<"desc" | "asc">("desc");
  const [days, setDays] = useState<"30" | "60" | "180" | "0">("30");
  const all = useMemo<JourneyItem[]>(() => [
    ...detail.tickets.map((t) => ({ at: t.created_at, kind: "ticket" as const, title: `Opened #${t.number}: ${t.subject}`, channel: t.channel_kind, ticketId: t.id })),
    ...detail.tickets.filter((t) => t.csat != null).map((t) => ({ at: t.updated_at, kind: "csat" as const, title: `Rated #${t.number} ${t.csat}/5`, channel: t.channel_kind, ticketId: t.id })),
    ...detail.messages.map((m) => ({ at: m.created_at, kind: "message" as const, title: m.direction === "in" ? `${m.author_name || "Customer"} wrote on #${m.number}` : `${m.author_name} replied on #${m.number}`, body: m.body, channel: m.channel_kind, ticketId: m.ticket_id, direction: m.direction })),
    ...detail.mentions.filter((m) => m.published_at).map((m) => ({ at: m.published_at!, kind: "mention" as const, title: `Mentioned you on ${channelLabel(m.source)}`, body: m.title || m.body, channel: m.source })),
    ...detail.notes.map((n) => ({ at: n.created_at, kind: "note" as const, title: `Note by ${n.author_name}`, body: n.body })),
  ], [detail]);
  const items = journeyWindow(all, Number(days), order);
  return (
    <div className="p-4">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Segmented value={days} onChange={setDays} options={[{ value: "30", label: "30 days" }, { value: "60", label: "60 days" }, { value: "180", label: "180 days" }, { value: "0", label: "All" }]} />
        <Segmented value={order} onChange={setOrder} options={[{ value: "desc", label: "Newest first" }, { value: "asc", label: "Oldest first" }]} />
        <span className="text-[12px] text-text-3">{items.length} of {all.length} events</span>
      </div>
      {items.length === 0 ? <p className="py-6 text-center text-[13px] text-text-3">No activity in this period.</p> : (
        <ol className="relative space-y-3 border-l border-border pl-4">
          {items.slice(0, 300).map((i, k) => (
            <li key={`${i.kind}-${i.at}-${k}`} className="relative">
              <span className={`absolute top-1.5 -left-[21px] h-2.5 w-2.5 rounded-full border-2 border-surface ${i.kind === "ticket" ? "bg-brand" : i.kind === "mention" ? "bg-warning" : i.kind === "csat" ? "bg-good" : i.kind === "note" ? "bg-text-3" : i.direction === "in" ? "bg-link" : "bg-border-strong"}`} />
              <div className="flex flex-wrap items-center gap-2 text-[12px] text-text-3">
                {i.channel && <ChannelIcon kind={i.channel} />}
                <span suppressHydrationWarning>{dateTimeLabel(i.at)}</span>
                {i.ticketId && <Link href={`/cx/inbox?brand=${brand}&view=all&t=${i.ticketId}`} className="text-link hover:underline">Open ticket</Link>}
              </div>
              <div className="text-[13px] font-medium text-text">{i.title}</div>
              {i.body && <p className="line-clamp-2 text-[12.5px] whitespace-pre-wrap text-text-2">{i.body}</p>}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function TicketsTab({ brand, tickets }: { brand: string; tickets: ContactDetail["tickets"] }) {
  if (!tickets.length) return <EmptyState title="No tickets" />;
  return (
    <ul className="divide-y divide-border">
      {tickets.map((t) => (
        <li key={t.id} className="flex flex-wrap items-center gap-2 px-4 py-2.5 text-[13px]">
          <ChannelIcon kind={t.channel_kind} className="text-text-3" />
          <Link href={`/cx/inbox?brand=${brand}&view=all&t=${t.id}`} className="min-w-0 flex-1 truncate text-link hover:underline"><span className="text-text-3">#{t.number}</span> {t.subject}</Link>
          <StatusBadge status={t.status} /><PriorityBadge priority={t.priority} /><SentimentBadge sentiment={t.sentiment} />
          {t.csat != null && <Badge tone="info">CSAT {t.csat}/5</Badge>}
          <Ago iso={t.updated_at} className="w-20 text-right text-[12px] text-text-3" />
        </li>
      ))}
    </ul>
  );
}
function MessagesTab({ brand, messages }: { brand: string; messages: ContactDetail["messages"] }) {
  if (!messages.length) return <EmptyState title="No messages" />;
  return (
    <ul className="divide-y divide-border">
      {messages.map((m) => (
        <li key={m.id} className="px-4 py-2.5">
          <div className="flex flex-wrap items-center gap-2 text-[12px] text-text-3">
            <ChannelIcon kind={m.channel_kind} />
            <span className="font-medium text-text-2">{m.direction === "in" ? m.author_name || "Customer" : `${m.author_name} (agent)`}</span>
            <Link href={`/cx/inbox?brand=${brand}&view=all&t=${m.ticket_id}`} className="text-link hover:underline">#{m.number}</Link>
            <span suppressHydrationWarning>{dateTimeLabel(m.created_at)}</span>
          </div>
          <p className="mt-0.5 line-clamp-3 text-[13px] whitespace-pre-wrap text-text">{m.body}</p>
        </li>
      ))}
    </ul>
  );
}
function MentionsTab({ mentions }: { mentions: ContactDetail["mentions"] }) {
  if (!mentions.length) return <EmptyState title="No mentions linked" description="Social listening mentions appear here when they are converted into a ticket for this contact or match one of the contact's social handles." />;
  return (
    <ul className="divide-y divide-border">
      {mentions.map((m) => (
        <li key={m.id} className="px-4 py-2.5">
          <div className="flex flex-wrap items-center gap-2 text-[12px] text-text-3">
            <ChannelIcon kind={m.source} /><span>{channelLabel(m.source)}</span><SentimentBadge sentiment={m.sentiment} />
            {m.published_at && <Ago iso={m.published_at} />}
            {m.url && <a href={m.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 text-link hover:underline">Open<ExternalLink className="h-3 w-3" /></a>}
          </div>
          {m.title && <div className="mt-0.5 text-[13px] font-medium text-text">{m.title}</div>}
          <p className="line-clamp-3 text-[13px] text-text-2">{m.body}</p>
        </li>
      ))}
    </ul>
  );
}
function NotesTab({ notes, onAdd, onDelete }: { notes: ContactDetail["notes"]; onAdd: (b: string) => Promise<boolean>; onDelete: (id: string) => void }) {
  const [v, setV] = useState("");
  return (
    <div className="space-y-3 p-4">
      <form onSubmit={async (e) => { e.preventDefault(); if (v.trim() && (await onAdd(v))) setV(""); }} className="space-y-2">
        <Textarea value={v} onChange={(e) => setV(e.target.value)} rows={3} placeholder="Add a note about this customer (visible to your team only)" aria-label="New note" />
        <div className="flex justify-end"><Button size="sm" variant="primary" type="submit" disabled={!v.trim()}>Add note</Button></div>
      </form>
      <ul className="space-y-2">
        {notes.map((n) => (
          <li key={n.id} className="rounded-md border border-border bg-surface-2 px-3 py-2">
            <div className="flex items-center gap-2 text-[12px] text-text-3"><span className="font-medium text-text-2">{n.author_name}</span><Ago iso={n.created_at} /><button className="ml-auto rounded p-0.5 hover:text-critical-ink" onClick={() => onDelete(n.id)} aria-label="Delete note"><X className="h-3.5 w-3.5" /></button></div>
            <p className="mt-0.5 text-[13px] whitespace-pre-wrap text-text">{n.body}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Tags({ tags, onChange }: { tags: string[]; onChange: (t: string[]) => void }) {
  const [v, setV] = useState("");
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {tags.map((t) => <span key={t} className="inline-flex items-center gap-0.5 rounded bg-surface-3 py-0.5 pr-0.5 pl-1.5 text-[12px] text-text-2">{t}<button onClick={() => onChange(tags.filter((x) => x !== t))} className="rounded p-0.5 hover:text-text" aria-label={`Remove ${t}`}><X className="h-3 w-3" /></button></span>)}
      <form onSubmit={(e) => { e.preventDefault(); if (v.trim()) { onChange([...tags, v.trim()]); setV(""); } }}>
        <Input value={v} onChange={(e) => setV(e.target.value)} placeholder="+ tag" className="h-7 w-24 text-[12px]" aria-label="Add tag" />
      </form>
    </div>
  );
}

function Attributes({ attrs, onSave }: { attrs: Record<string, string>; onSave: (a: Record<string, string>) => void }) {
  const [rows, setRows] = useState<[string, string][]>(Object.entries(attrs));
  const dirty = JSON.stringify(Object.fromEntries(rows.filter(([k]) => k.trim()))) !== JSON.stringify(attrs);
  return (
    <div className="space-y-1.5">
      {rows.map(([k, v], i) => (
        <div key={i} className="flex gap-1.5">
          <Input value={k} onChange={(e) => setRows((r) => r.map((x, j) => (j === i ? [e.target.value, x[1]] : x)))} placeholder="Field" className="h-7 w-28 text-[12px]" aria-label="Attribute name" />
          <Input value={v} onChange={(e) => setRows((r) => r.map((x, j) => (j === i ? [x[0], e.target.value] : x)))} placeholder="Value" className="h-7 flex-1 text-[12px]" aria-label="Attribute value" />
          <button onClick={() => setRows((r) => r.filter((_, j) => j !== i))} className="rounded px-1 text-text-3 hover:text-text" aria-label="Remove attribute"><X className="h-3.5 w-3.5" /></button>
        </div>
      ))}
      <div className="flex items-center gap-2">
        <Button size="sm" variant="ghost" onClick={() => setRows((r) => [...r, ["", ""]])}><Plus className="h-3.5 w-3.5" />Add field</Button>
        {dirty && <Button size="sm" variant="primary" onClick={() => onSave(Object.fromEntries(rows.filter(([k]) => k.trim())))}>Save</Button>}
      </div>
    </div>
  );
}

function EditContact({ c, onClose, onSave, error }: { c: ContactDetail["contact"]; onClose: () => void; onSave: (p: { name: string; email: string | null; phone: string | null }) => void; error: string | null }) {
  const [f, setF] = useState({ name: c.name, email: c.email ?? "", phone: c.phone ?? "" });
  return (
    <Dialog open onClose={onClose} title="Edit contact" footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" onClick={() => onSave({ name: f.name, email: f.email || null, phone: f.phone || null })}>Save</Button></>}>
      <div className="space-y-3">
        <Field label="Name" htmlFor="c-n"><Input id="c-n" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <Field label="Email" htmlFor="c-e"><Input id="c-e" type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
        <Field label="Phone" htmlFor="c-p"><Input id="c-p" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></Field>
        {error && <Callout tone="critical">{error}</Callout>}
      </div>
    </Dialog>
  );
}
