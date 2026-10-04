"use client";

import { Bookmark, BookmarkCheck, ClipboardList, GitBranchPlus, Mail, MessageSquareReply, MessagesSquare, Quote } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toggleBookmarkAction } from "@/app/(app)/cx/bookmarks/actions";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/input";
import { toPlainText } from "@/lib/cx/inbox/model";
import type { TicketListRow } from "@/lib/cx/inbox/store";
import { profileBadge } from "@/lib/cx/ops/model";
import { cn } from "@/lib/utils";
import { SlaChip, Ago } from "./time";
import { Avatar, ChannelIcon, PriorityBadge, SentimentBadge, StatusBadge } from "./ui";

const COMMENT_TYPES = new Set(["facebook_comments", "facebook_posts", "instagram_comments", "instagram_mentions", "instagram_tags", "youtube", "reddit", "forums", "news", "mastodon", "bluesky", "x", "discourse"]);

/**
 * Konnect-style ticket card: author, handle, platform, latest message, the FIRST CONVERSATION quote, sentiment,
 * channel-profile badge, ticket id and per-card actions (reply/comment, compose mail, child ticket, task,
 * bookmark, view all comments on the same post).
 */
export function TicketCard({ t, brand, href, checked, onCheck, readOnly }: { t: TicketListRow; brand: string; href: (p: Record<string, string | null>) => string; checked: boolean; onCheck: (v: boolean) => void; readOnly: boolean }) {
  const router = useRouter();
  const [bm, setBm] = useState(t.bookmarked);
  const isComment = COMMENT_TYPES.has(t.media_type);
  const latest = t.last_body ? toPlainText(t.last_body) : "";
  const first = t.first_body ? toPlainText(t.first_body) : "";
  const sameAsFirst = t.messages <= 1 || first === latest;
  const unanswered = t.last_direction === "in" && !["solved", "closed", "ignored"].includes(t.crm_status);
  const open = href({ t: t.id, ticket: null });
  const Action = ({ icon, label, to, onClick, off }: { icon: React.ReactNode; label: string; to?: string; onClick?: () => void; off?: boolean }) =>
    to && !off ? (
      <Link href={to} scroll={false} className="inline-flex items-center gap-1 rounded px-1.5 py-1 text-[12px] whitespace-nowrap text-link hover:bg-surface-3">{icon}{label}</Link>
    ) : (
      <button type="button" disabled={off} onClick={onClick} className="inline-flex items-center gap-1 rounded px-1.5 py-1 text-[12px] whitespace-nowrap text-link hover:bg-surface-3 disabled:text-text-3 disabled:hover:bg-transparent">{icon}{label}</button>
    );
  return (
    <li className={cn("rounded-lg border bg-surface shadow-card", checked ? "border-link" : "border-border")}>
      <div className="flex gap-3 px-3 pt-3 sm:px-4">
        <Checkbox checked={checked} onChange={(e) => onCheck(e.target.checked)} className="mt-2.5" aria-label={`Select ticket ${t.number}`} />
        <span className="relative h-fit shrink-0 self-start">
          <Avatar name={t.contact_name || t.contact_email || "?"} className="h-10 w-10" />
          <span className="absolute -right-1 -bottom-1 rounded-full border border-border bg-surface p-0.5" title={t.channel_name ?? t.channel_kind}><ChannelIcon kind={t.channel_kind} className="h-3 w-3 text-text-2" /></span>
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2">
            <Link href={open} scroll={false} className={cn("truncate text-[13.5px] text-text hover:underline", unanswered ? "font-semibold" : "font-medium")}>{t.contact_name || t.contact_email || "Unknown"}</Link>
            {(t.contact_handle || t.contact_email) && <span className="truncate text-[12px] text-text-3">{t.contact_handle ? (t.contact_handle.startsWith("@") ? t.contact_handle : t.contact_handle.length < 30 ? `@${t.contact_handle}` : "") : t.contact_email}</span>}
            <span className="ml-auto flex items-center gap-2">
              <Ago iso={t.last_at ?? t.updated_at} className="text-[11.5px] text-text-3" />
              <button type="button" onClick={async () => { setBm((x) => !x); const r = await toggleBookmarkAction(brand, { ticketId: t.id }); if (!r.ok) setBm(t.bookmarked); else router.refresh(); }} className="rounded p-0.5 text-text-3 hover:bg-surface-3 hover:text-text" aria-label={bm ? "Remove bookmark" : "Bookmark ticket"} title={bm ? "Bookmarked" : "Bookmark"}>
                {bm ? <BookmarkCheck className="h-4 w-4 text-link" /> : <Bookmark className="h-4 w-4" />}
              </button>
            </span>
          </div>
          <Link href={open} scroll={false} className="mt-0.5 block text-[12.5px] text-text-2 hover:underline"><span className="text-text-3">#{t.number}</span> {t.subject}</Link>
          {latest && <p className="mt-1.5 line-clamp-3 text-[13px] break-words whitespace-pre-line text-text">{t.last_direction === "out" ? <span className="text-text-3">You: </span> : null}{latest}</p>}
          {first && !sameAsFirst && (
            <blockquote className="mt-2 rounded-md border-l-2 border-border-strong bg-surface-2 px-2.5 py-1.5">
              <div className="mb-0.5 flex items-center gap-1 text-[10.5px] font-semibold tracking-wider text-text-3 uppercase"><Quote className="h-3 w-3" />First conversation{t.first_at && <> · <Ago iso={t.first_at} className="normal-case tracking-normal" /></>}</div>
              <p className="line-clamp-2 text-[12.5px] break-words text-text-2">{t.first_author ? <span className="font-medium">{t.first_author}: </span> : null}{first}</p>
            </blockquote>
          )}
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {t.sentiment && <span className="uppercase"><SentimentBadge sentiment={t.sentiment} /></span>}
            <Badge tone="info">{profileBadge(t.media_type, t.channel_name)}</Badge>
            <span className="text-[11px] font-semibold tracking-wide text-text-2">TICKET ID: {t.number}</span>
            <StatusBadge status={t.crm_status} />
            <PriorityBadge priority={t.priority} />
            {t.severity && <span className="rounded border border-border px-1 text-[11px] text-text-2">{t.severity}</span>}
            {t.assignee_name ? <span className="text-[11.5px] text-text-3">{t.assignee_name}</span> : !["solved", "closed", "ignored"].includes(t.crm_status) && <span className="text-[11.5px] text-warning-ink">Unassigned</span>}
            {t.tasks_open > 0 && <span className="inline-flex items-center gap-0.5 text-[11.5px] text-text-3" title="Open tasks"><ClipboardList className="h-3 w-3" />{t.tasks_open}</span>}
            <span className="ml-auto"><SlaChip ticket={t} /></span>
          </div>
        </div>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-0.5 border-t border-border px-2 py-1 sm:px-3">
        <Action icon={<MessageSquareReply className="h-3.5 w-3.5" />} label={isComment ? "Comment" : "Reply"} to={open} />
        <Action icon={<Mail className="h-3.5 w-3.5" />} label="Compose mail" to={href({ t: t.id, act: "compose" })} off={readOnly} />
        <Action icon={<GitBranchPlus className="h-3.5 w-3.5" />} label="Create child ticket" to={href({ t: t.id, act: "child" })} off={readOnly || !!t.parent_id} />
        <Action icon={<ClipboardList className="h-3.5 w-3.5" />} label="Create task" to={href({ t: t.id, act: "task" })} off={readOnly} />
        {t.post_key && (
          <Action icon={<MessagesSquare className="h-3.5 w-3.5" />} label={`View all comments${t.post_tickets > 1 ? ` (${t.post_tickets})` : ""}`} to={href({ post: t.post_key, view: "all", status: null, t: null })} />
        )}
      </div>
    </li>
  );
}
