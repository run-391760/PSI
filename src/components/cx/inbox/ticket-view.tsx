"use client";

import { Copy, Download, ExternalLink, Inbox, Mail, Phone, Printer, Tag } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { NetworkIcon } from "@/components/cx/network-icon";
import { Menu } from "@/components/ui/dialog";
import type { TicketDetail } from "@/lib/cx/inbox/store";
import { ticketHref } from "@/lib/cx/inbox/stream";
import { profileBadge } from "@/lib/cx/ops/model";
import { cn } from "@/lib/utils";
import { Conversation, type ConversationProps } from "./conversation";
import { PrefsProvider } from "./prefs";
import { ACCENT_BG, ACCENT_TEXT } from "./stream-ui";
import { Ago, SlaChip } from "./time";
import { Avatar, ChannelIcon, PriorityBadge, StatusBadge, statusLabel } from "./ui";

type Props = ConversationProps & { detail: TicketDetail; mediaType: string; backHref: string };

/**
 * One Ticket View (/cx/ticket/[id]?brand=): the full-page ticket. Header bar (ticket id, status, priority, channel-profile
 * badge, SLA, print / transcript), the contact panel with activity, and the inbox Conversation component (thread,
 * composer with reply / comment / private reply / note, every action and the properties sidebar).
 */
export function TicketView(props: Props & { prefs: Parameters<typeof PrefsProvider>[0]["initial"] }) {
  const { detail, brand, mediaType } = props;
  const t = detail.ticket;
  const [copied, setCopied] = useState(false);
  // Keep the thread live (the Conversation component polls presence and refreshes on new messages).
  useEffect(() => { document.title = `#${t.number} ${t.subject} · Ticket`; }, [t.number, t.subject]);
  return (
    <PrefsProvider brand={brand.id} initial={props.prefs}>
      <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-md border border-border bg-surface px-3 py-2.5 shadow-card sm:px-4">
        <span className={cn("text-[12.5px] font-semibold tracking-wider uppercase", ACCENT_TEXT)}>Ticket ID: {t.number}</span>
        <StatusBadge status={t.crm_status} />
        <PriorityBadge priority={t.priority} />
        <span className={cn("max-w-full truncate rounded px-1.5 py-0.5 text-[10.5px] font-semibold tracking-wide uppercase", ACCENT_BG)}>{profileBadge(mediaType, t.channel_name)}</span>
        <SlaChip ticket={t} />
        {t.assignee_name && <span className="text-[12.5px] text-text-2">Assigned to <span className="font-medium text-text">{t.assignee_name}</span></span>}
        <span className="text-[12px] text-text-3">Created <Ago iso={t.created_at} /></span>
        <span className="no-print ml-auto flex flex-wrap items-center gap-1.5">
          <Link href={`/cx/inbox?brand=${brand.id}&view=all&t=${t.id}`} className="inline-flex h-8 items-center gap-1 rounded-md border border-border-strong px-2.5 text-[12.5px] text-text-2 hover:bg-surface-3"><Inbox className="h-3.5 w-3.5" /><span className="hidden sm:inline">Open in inbox</span></Link>
          <button type="button" onClick={() => window.print()} className="inline-flex h-8 items-center gap-1 rounded-md border border-border-strong px-2.5 text-[12.5px] text-text-2 hover:bg-surface-3" title="Print or save as PDF"><Printer className="h-3.5 w-3.5" /><span className="hidden sm:inline">Print</span></button>
          <Menu align="right" trigger={() => <span className="inline-flex h-8 items-center gap-1 rounded-md border border-border-strong px-2.5 text-[12.5px] text-text-2 hover:bg-surface-3"><Download className="h-3.5 w-3.5" /><span className="hidden sm:inline">Transcript</span></span>}>
            {(close) => (
              <div className="w-56 p-1 text-[13px]">
                <a onClick={close} href={`/api/cx/inbox/${t.id}/transcript?brand=${brand.id}`} className="block rounded px-2 py-1.5 text-text hover:bg-surface-3">Download transcript (.txt)</a>
                <a onClick={close} href={`/api/cx/inbox/${t.id}/transcript?brand=${brand.id}&format=xlsx`} className="block rounded px-2 py-1.5 text-text hover:bg-surface-3">Download history (Excel)</a>
              </div>
            )}
          </Menu>
          <button type="button" onClick={() => { void navigator.clipboard?.writeText(`${window.location.origin}${ticketHref(brand.id, t.id)}`).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }); }} className="inline-flex h-8 items-center gap-1 rounded-md border border-border-strong px-2.5 text-[12.5px] text-text-2 hover:bg-surface-3" title="Copy link to this ticket"><Copy className="h-3.5 w-3.5" /><span className="hidden sm:inline">{copied ? "Copied" : "Copy link"}</span></button>
        </span>
      </div>
      <div className="grid gap-3 xl:grid-cols-[280px_minmax(0,1fr)]">
        <ContactPanel detail={detail} brand={brand.id} />
        <div className="order-1 flex min-h-[640px] overflow-hidden rounded-md xl:order-none border border-border bg-surface shadow-card xl:h-[calc(100dvh-210px)] print:h-auto print:overflow-visible">
          <Conversation {...props} fullPage />
        </div>
      </div>
    </PrefsProvider>
  );
}

/** "@handle" for social accounts; sites, phone numbers and existing "@…" values as they are. */
function showHandle(kind: string, v: string) {
  if (v.startsWith("@") || /^\+?\d[\d\s-]+$/.test(v) || /^www\./i.test(v) || ["news", "web", "blogs", "hackernews", "appstore"].includes(kind)) return v;
  return `@${v}`;
}

function ContactPanel({ detail, brand }: { detail: TicketDetail; brand: string }) {
  const t = detail.ticket as TicketDetail["ticket"] & { contact_phone?: string | null; contact_handles?: Record<string, string>; contact_tags?: string[]; contact_attributes?: Record<string, string> };
  // Visitor / session ids (live chat, web form) are not handles worth showing.
  const handles = Object.entries(t.contact_handles ?? {}).filter(([, v]) => v && v.length <= 40 && !/^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(v));
  const attrs = Object.entries(t.contact_attributes ?? {}).filter(([, v]) => v != null && String(v).trim()).slice(0, 12);
  const events = (detail.events ?? []).slice(-30).reverse();
  return (
    <aside className="scroll-thin order-2 space-y-3 xl:order-none xl:max-h-[calc(100dvh-210px)] xl:overflow-y-auto" aria-label="Contact">
      <section className="rounded-md border border-border bg-surface p-3 shadow-card">
        <h2 className="mb-2 text-[11.5px] font-bold tracking-[0.12em] text-text uppercase">Contact</h2>
        <div className="flex items-center gap-2.5">
          <span className="relative">
            <Avatar name={t.contact_name || t.contact_email || "?"} className="h-11 w-11" />
            <span className="absolute -bottom-1 -left-1 flex h-5 w-5 items-center justify-center rounded-full border border-border bg-surface"><NetworkIcon kind={t.channel_kind} className="h-3 w-3 text-text" /></span>
          </span>
          <div className="min-w-0">
            {t.contact_id ? <Link href={`/cx/contacts/${t.contact_id}?brand=${brand}`} className="block truncate text-[14px] font-semibold text-link hover:underline">{t.contact_name || t.contact_email || "Unnamed contact"}</Link> : <span className="text-[14px] font-semibold text-text">Unknown contact</span>}
            {handles[0] && <span className="block truncate text-[12px] text-text-3">{showHandle(handles[0][0], handles[0][1])}</span>}
          </div>
        </div>
        <ul className="mt-3 space-y-1.5 text-[12.5px]">
          {t.contact_email && <li className="flex items-center gap-2 text-text-2"><Mail className="h-3.5 w-3.5 shrink-0 text-text-3" /><a href={`mailto:${t.contact_email}`} className="truncate hover:underline">{t.contact_email}</a></li>}
          {t.contact_phone && <li className="flex items-center gap-2 text-text-2"><Phone className="h-3.5 w-3.5 shrink-0 text-text-3" /><a href={`tel:${t.contact_phone}`} className="truncate hover:underline">{t.contact_phone}</a></li>}
          {handles.map(([k, v]) => <li key={k} className="flex items-center gap-2 text-text-2"><ChannelIcon kind={k} className="text-text-3" /><span className="truncate">{v}</span></li>)}
          {(detail.mentions ?? []).filter((m) => m.url).slice(0, 3).map((m) => <li key={m.id}><a href={m.url!} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1 text-link hover:underline"><ExternalLink className="h-3 w-3" />View original post</a></li>)}
        </ul>
        {(t.contact_tags ?? []).length > 0 && <div className="mt-2 flex flex-wrap gap-1">{(t.contact_tags ?? []).map((g) => <span key={g} className="inline-flex items-center gap-0.5 rounded bg-surface-3 px-1.5 text-[11.5px] text-text-2"><Tag className="h-3 w-3" />{g}</span>)}</div>}
        {attrs.length > 0 && (
          <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 border-t border-border pt-2 text-[12px]">
            {attrs.map(([k, v]) => <div key={k} className="contents"><dt className="text-text-3">{k}</dt><dd className="truncate text-right text-text">{String(v)}</dd></div>)}
          </dl>
        )}
      </section>
      <section className="rounded-md border border-border bg-surface p-3 shadow-card">
        <h2 className="mb-2 text-[11.5px] font-bold tracking-[0.12em] text-text uppercase">Other tickets ({(detail.related ?? []).length})</h2>
        {(detail.related ?? []).length === 0 ? <p className="text-[12px] text-text-3">No other tickets from this contact.</p> : (
          <ul className="space-y-1.5">
            {(detail.related ?? []).slice(0, 12).map((r) => (
              <li key={r.id} className="flex items-center gap-1.5 text-[12.5px]">
                <ChannelIcon kind={r.channel_kind} className="text-text-3" />
                <Link href={ticketHref(brand, r.id)} className="min-w-0 flex-1 truncate text-link hover:underline">#{r.number} {r.subject}</Link>
                <span className="shrink-0 text-[11.5px] text-text-3">{statusLabel(r.status)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className="rounded-md border border-border bg-surface p-3 shadow-card">
        <h2 className="mb-2 text-[11.5px] font-bold tracking-[0.12em] text-text uppercase">Activity</h2>
        {events.length === 0 ? <p className="text-[12px] text-text-3">No activity yet.</p> : (
          <ol className="relative space-y-2 border-l border-border pl-3">
            {events.map((e) => (
              <li key={e.id} className="relative text-[12px] text-text-2">
                <span className="absolute top-0 -left-[15.5px] mt-1.5 h-1.5 w-1.5 rounded-full bg-text-3" aria-hidden />
                <span className="font-medium text-text">{e.actor}</span> {e.detail}
                <Ago iso={e.created_at} className="block text-[11px] text-text-3" />
              </li>
            ))}
          </ol>
        )}
      </section>
    </aside>
  );
}
