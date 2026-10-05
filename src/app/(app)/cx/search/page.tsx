import { ClipboardList, Contact, Ear, MessageSquare, Search, Ticket } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { BrandSwitcher } from "@/components/cx/brand-switcher";
import { ChannelIcon, NoBrand, SentimentBadge, StatusBadge } from "@/components/cx/inbox/ui";
import { QuickSearchBox } from "@/components/cx/ops/search-box";
import { Page, PageHeader } from "@/components/shell/page";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/feedback";
import { requirePageUser } from "@/lib/auth";
import { getFieldDefs } from "@/lib/cx/admin/fields";
import { cxContext } from "@/lib/cx/context";
import { sourceLabel } from "@/lib/cx/listening/sources";
import { snippet, taskStatusLabel } from "@/lib/cx/ops/model";
import { quickSearch, type SearchResults } from "@/lib/cx/ops/search";
import { parseSearch } from "@/lib/cx/inbox/model";
import { ticketHref } from "@/lib/cx/inbox/stream";
import { dateTimeLabel, num } from "@/lib/format";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Quick search" };

const SECTIONS: { key: keyof SearchResults; label: string; icon: typeof Ticket }[] = [
  { key: "tickets", label: "Tickets", icon: Ticket },
  { key: "messages", label: "Messages", icon: MessageSquare },
  { key: "contacts", label: "Contacts", icon: Contact },
  { key: "mentions", label: "Mentions", icon: Ear },
  { key: "tasks", label: "Tasks", icon: ClipboardList },
];

export default async function SearchPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requirePageUser();
  const sp = await searchParams;
  const { brand, switcher } = await cxContext(user.id, sp);
  const crumbs = [{ label: "CX" }, { label: "Quick search" }];
  if (!brand) return <NoBrand title="Quick search" breadcrumbs={crumbs} redirect="/cx/search" />;
  const q = typeof sp.q === "string" ? sp.q.slice(0, 300) : "";
  const only = SECTIONS.find((s) => s.key === sp.in)?.key;
  const [res, defs] = await Promise.all([quickSearch(brand.id, user.id, q, only), getFieldDefs(brand.id).catch(() => [])]);
  const text = parseSearch(q).text;
  const total = SECTIONS.reduce((a, s) => a + res[s.key].length, 0);
  const base = (extra: string) => `/cx/search?brand=${brand.id}&q=${encodeURIComponent(q)}${extra}`;
  const b = brand.id;
  return (
    <Page>
      <PageHeader title="Quick search" subject={brand.name} breadcrumbs={crumbs} description="One search across tickets, messages, contacts, listening mentions and tasks. Supports the inbox's field:value syntax (status:wip, assignee:me, sentiment:negative, email:…, #123, -tag:spam)." actions={<BrandSwitcher brands={switcher} current={brand.id} />}>
        <QuickSearchBox brand={brand.id} initial={q} only={only ?? ""} fields={defs.filter((d) => d.scope === "ticket" && !d.hidden && !d.encrypted).map((d) => ({ key: d.key, label: d.label, options: d.options }))} />
      </PageHeader>
      {!q ? (
        <Card><EmptyState icon={<Search className="h-5 w-5" />} title="Search everything" description="Type a name, email, phone, ticket number, words from a message, or field filters like status:pending priority:urgent." /></Card>
      ) : (
        <>
          <nav className="scroll-thin mb-4 flex gap-1 overflow-x-auto" aria-label="Result types">
            <Link href={base("")} className={cn("inline-flex shrink-0 items-center gap-1 rounded-full border px-3 py-1 text-[12.5px]", !only ? "border-link bg-brand-soft font-medium text-link" : "border-border text-text-2 hover:bg-surface-3")}>All {!only && <span className="text-text-3">{num(total)}</span>}</Link>
            {SECTIONS.map((s) => (
              <Link key={s.key} href={base(`&in=${s.key}`)} className={cn("inline-flex shrink-0 items-center gap-1 rounded-full border px-3 py-1 text-[12.5px]", only === s.key ? "border-link bg-brand-soft font-medium text-link" : "border-border text-text-2 hover:bg-surface-3")}>
                <s.icon className="h-3.5 w-3.5" />{s.label}{(!only || only === s.key) && <span className="text-text-3">{num(res[s.key].length)}{!only && res[s.key].length >= 25 ? "+" : ""}</span>}
              </Link>
            ))}
          </nav>
          {total === 0 && <Card><EmptyState title="No results" description="Nothing matches in tickets, messages, contacts, mentions or tasks. Field filters that only apply to tickets (e.g. channel:, tag:) hide the other result types." /></Card>}
          <div className="space-y-4">
            {res.tickets.length > 0 && (
              <Card>
                <CardHeader title={`Tickets (${num(res.tickets.length)})`} actions={<Link href={`/cx/inbox?brand=${b}&view=all&q=${encodeURIComponent(q)}`} className="text-[12.5px] text-link hover:underline">Open in inbox →</Link>} />
                <ul className="divide-y divide-border border-t border-border">
                  {res.tickets.map((t) => (
                    <li key={t.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 text-[13px]">
                      <ChannelIcon kind={t.channel_kind} className="text-text-3" />
                      <Link href={ticketHref(b, t.id)} className="min-w-0 flex-1 truncate text-link hover:underline"><span className="text-text-3">#{t.number}</span> {t.subject}</Link>
                      <span className="text-[12px] text-text-2">{t.contact_name || t.contact_email}</span>
                      <StatusBadge status={t.crm_status} />
                      <span className="text-[11.5px] text-text-3" suppressHydrationWarning>{dateTimeLabel(t.updated_at)}</span>
                    </li>
                  ))}
                </ul>
              </Card>
            )}
            {res.messages.length > 0 && (
              <Card>
                <CardHeader title={`Messages (${num(res.messages.length)})`} actions={<Link href={`/cx/messages?brand=${b}&q=${encodeURIComponent(text)}`} className="text-[12.5px] text-link hover:underline">Open in All messages →</Link>} />
                <ul className="divide-y divide-border border-t border-border">
                  {res.messages.map((m) => (
                    <li key={m.id} className="px-4 py-2 text-[13px]">
                      <div className="flex flex-wrap items-center gap-2 text-[12px] text-text-3">
                        <ChannelIcon kind={m.channel_kind} /><span className="font-medium text-text-2">{m.author_name || (m.direction === "in" ? "Customer" : "Agent")}</span>
                        {m.direction === "note" ? <Badge tone="warning">Note</Badge> : m.direction === "out" ? <Badge tone="info">Reply</Badge> : null}
                        <Link href={ticketHref(b, m.ticket_id)} className="min-w-0 truncate text-link hover:underline">#{m.number} {m.subject}</Link>
                        <span className="ml-auto" suppressHydrationWarning>{dateTimeLabel(m.created_at)}</span>
                      </div>
                      <p className="mt-0.5 text-text"><Hl text={snippet(m.body, text, 200)} q={text} /></p>
                    </li>
                  ))}
                </ul>
              </Card>
            )}
            {res.contacts.length > 0 && (
              <Card>
                <CardHeader title={`Contacts (${num(res.contacts.length)})`} actions={<Link href={`/cx/contacts?brand=${b}&q=${encodeURIComponent(text)}`} className="text-[12.5px] text-link hover:underline">Open in Contacts →</Link>} />
                <ul className="divide-y divide-border border-t border-border">
                  {res.contacts.map((c) => (
                    <li key={c.id} className="flex flex-wrap items-center gap-x-3 gap-y-0.5 px-4 py-2 text-[13px]">
                      <Link href={`/cx/contacts/${c.id}?brand=${b}`} className="font-medium text-link hover:underline">{c.name || "Unnamed"}</Link>
                      <span className="text-text-2">{[c.email, c.phone].filter(Boolean).join(" · ")}</span>
                      <span className="ml-auto text-[12px] text-text-3">{num(c.tickets)} ticket{c.tickets === 1 ? "" : "s"}</span>
                    </li>
                  ))}
                </ul>
              </Card>
            )}
            {res.mentions.length > 0 && (
              <Card>
                <CardHeader title={`Mentions (${num(res.mentions.length)})`} actions={<Link href={`/cx/listening?brand=${b}&q=${encodeURIComponent(text)}`} className="text-[12.5px] text-link hover:underline">Open in Mentions →</Link>} />
                <ul className="divide-y divide-border border-t border-border">
                  {res.mentions.map((m) => (
                    <li key={m.id} className="px-4 py-2 text-[13px]">
                      <div className="flex flex-wrap items-center gap-2 text-[12px] text-text-3">
                        <span className="font-medium text-text-2">{m.author || "Unknown"}</span><span>{sourceLabel(m.source)}</span>
                        <SentimentBadge sentiment={m.sentiment} />
                        {m.ticket_id && <Link href={ticketHref(b, m.ticket_id)} className="text-link hover:underline">Ticket</Link>}
                        {m.url && <a href={m.url} target="_blank" rel="noreferrer" className="text-link hover:underline">Original ↗</a>}
                        <span className="ml-auto" suppressHydrationWarning>{m.published_at ? dateTimeLabel(m.published_at) : "n/a"}</span>
                      </div>
                      <p className="mt-0.5 text-text">{m.title && <span className="font-medium">{m.title} · </span>}<Hl text={snippet(m.body, text, 200)} q={text} /></p>
                    </li>
                  ))}
                </ul>
              </Card>
            )}
            {res.tasks.length > 0 && (
              <Card>
                <CardHeader title={`Tasks (${num(res.tasks.length)})`} actions={<Link href={`/cx/tasks?brand=${b}&view=all&q=${encodeURIComponent(text)}`} className="text-[12.5px] text-link hover:underline">Open in Tasks →</Link>} />
                <ul className="divide-y divide-border border-t border-border">
                  {res.tasks.map((t) => (
                    <li key={t.id} className="flex flex-wrap items-center gap-x-3 gap-y-0.5 px-4 py-2 text-[13px]">
                      <Link href={`/cx/tasks?brand=${b}&view=all&task=${t.id}`} className="min-w-0 flex-1 truncate text-link hover:underline"><span className="text-text-3">T-{t.number}</span> {t.title}</Link>
                      <Badge>{taskStatusLabel(t.status)}</Badge>
                      <span className="text-[12px] text-text-2">{t.assignee_name ?? "Unassigned"}</span>
                      <span className="text-[11.5px] text-text-3" suppressHydrationWarning>{t.due_at ? `due ${dateTimeLabel(t.due_at)}` : "no due date"}</span>
                    </li>
                  ))}
                </ul>
              </Card>
            )}
          </div>
        </>
      )}
    </Page>
  );
}

/** Highlight occurrences of q (case-insensitive). */
function Hl({ text, q }: { text: string; q: string }) {
  if (!q) return <>{text}</>;
  const parts = text.split(new RegExp(`(${q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "ig"));
  return <>{parts.map((p, i) => (p.toLowerCase() === q.toLowerCase() ? <mark key={i} className="rounded bg-warning-soft px-0.5 text-text">{p}</mark> : <span key={i}>{p}</span>))}</>;
}
