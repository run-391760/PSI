"use client";

import {
  ArrowLeft, Ban, BookOpen, ChevronDown, CircleCheck, Copy, Download, ExternalLink, FileText, Globe, Inbox, LayoutGrid, Link2, Loader2, Mail, MessageCircle,
  MessagesSquare, MoreHorizontal, Pencil, PlayCircle, Send, Smile, SquareCheckBig, SquarePlus, Trash2, UserPlus, Zap,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { bookmarkNoteAction, deleteBookmarkAction, toggleBookmarkAction } from "@/app/(app)/cx/bookmarks/actions";
import { replyAction, updateTicketsAction } from "@/app/(app)/cx/inbox/actions";
import { removeFromQueueAction } from "@/app/(app)/cx/inbox/queued/actions";
import { createTicketFromMentionAction, mentionSentimentAction, mentionStatusAction, ticketThreadAction, type ThreadMessage } from "@/app/(app)/cx/ticket/actions";
import { NetworkIcon } from "@/components/cx/network-icon";
import { TaskDialog } from "@/components/cx/ops/task-dialog";
import { Button } from "@/components/ui/button";
import { Dialog, Menu } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/input";
import { SETTABLE_STATUSES, type CrmStatus } from "@/lib/cx/inbox/model";
import type { TicketPatch } from "@/lib/cx/inbox/store";
import { isImage, isVideo, needsClamp, richSegments, ticketHref, type CardItem, type CardMedia } from "@/lib/cx/inbox/stream";
import { profileBadge } from "@/lib/cx/ops/model";
import { dateTimeLabel } from "@/lib/format";
import { cn } from "@/lib/utils";
import { ACCENT_BG, ACCENT_TEXT, useStream, useStreamHref } from "./stream-ui";
import { Ago } from "./time";
import { Avatar, SentimentBadge, StatusBadge } from "./ui";

export type CardVariant = "ticket" | "queued" | "message" | "bookmark";
const DONE = new Set(["solved", "closed", "ignored"]);

/**
 * Konnect ticket card: header (avatar + network badge, author, @handle, bookmark / real-time / related icons, relative
 * time), body with READ MORE clamp, #hashtag links and media thumbnails, the FIRST CONVERSATION panel, a footer with
 * Reply/Comment, the channel-profile badge and the hover action toolbar, and the TICKET ID bar with an inline thread.
 * `align` renders the conversational view (inbound left; replies right for "split").
 */
export function StreamCard({ c, variant, align }: { c: CardItem; variant: CardVariant; align?: "split" | "left" | null }) {
  const { brand, readOnly } = useStream();
  const router = useRouter();
  const { href } = useStreamHref();
  const [bm, setBm] = useState(c.bookmarked);
  useEffect(() => setBm(c.bookmarked), [c.bookmarked]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [replying, setReplying] = useState(false);
  const [dialog, setDialog] = useState<null | "task" | "note">(null);
  const isTicket = !!c.ticketId;
  const mention = c.kind === "mention";
  const showBar = isTicket && (variant === "ticket" || variant === "queued" || (variant === "bookmark" && c.kind === "ticket"));
  const detailHref = c.ticketId ? ticketHref(brand, c.ticketId) : null;

  const act = async (key: string, fn: () => Promise<{ ok: boolean; error?: string }>, after?: () => void) => {
    setBusy(key); setError(null);
    const r = await fn();
    setBusy(null);
    if (!r.ok) return setError(r.error ?? "Something went wrong.");
    after?.();
    router.refresh();
  };
  const patch = (key: string, p: TicketPatch) => act(key, () => updateTicketsAction(brand, [c.ticketId!], p));
  const toggleBm = () => {
    if (!c.ticketId) return;
    const was = bm;
    setBm(!was);
    act("bm", async () => {
      const r = c.bookmarkId && was ? await deleteBookmarkAction(brand, c.bookmarkId) : await toggleBookmarkAction(brand, { ticketId: c.ticketId!, messageId: c.kind === "message" ? c.messageId : null });
      if (!r.ok) setBm(was);
      return r;
    });
  };
  const createTicket = () => act("create", async () => {
    const r = await createTicketFromMentionAction(brand, c.mentionId!);
    if (r.ok) router.push(ticketHref(brand, r.data.id));
    return r;
  });

  const bubbleRight = align === "split" && (c.direction === "out" || c.direction === "note");
  return (
    <li className={cn("group/card list-none", align && "flex", bubbleRight ? "justify-end" : "justify-start")}>
      <article className={cn("rounded-md border border-border bg-surface shadow-card", align ? "w-full max-w-[88%]" : "w-full", c.direction === "note" && "border-warning/40", bubbleRight && c.direction === "out" && "bg-brand-soft/40")} aria-label={`${mention ? "Mention" : c.kind === "message" ? "Message" : "Ticket"} from ${c.author}`}>
        <div className="flex gap-3 px-3 pt-3 sm:gap-3.5 sm:px-5 sm:pt-4">
          <span className="relative h-fit shrink-0">
            <Avatar name={c.author} className="h-10 w-10 bg-surface-3 text-text-2" />
            <span className="absolute -bottom-1 -left-1 flex h-5 w-5 items-center justify-center rounded-full border border-border bg-surface" title={c.profile ?? c.network}>
              <NetworkIcon kind={c.network} className="h-3 w-3 text-text" />
            </span>
          </span>
          <div className="min-w-0 flex-1">
            {/* header */}
            <div className="flex items-start gap-2">
              <div className="min-w-0 flex-1">
                {detailHref ? <Link href={detailHref} className="block truncate text-[14px] font-semibold text-text hover:underline">{c.author}</Link> : <span className="block truncate text-[14px] font-semibold text-text">{c.author}</span>}
                {c.handle && <span className="block truncate text-[12px] text-text-3">{c.handle}</span>}
              </div>
              <div className="flex shrink-0 items-center gap-1.5 pt-0.5">
                {c.direction === "out" && <span className="rounded bg-surface-3 px-1.5 text-[10.5px] font-semibold tracking-wide text-text-2 uppercase">Reply</span>}
                {c.direction === "note" && <span className="rounded bg-warning-soft px-1.5 text-[10.5px] font-semibold tracking-wide text-warning-ink uppercase">Note</span>}
                {bm && isTicket && <button type="button" onClick={toggleBm} disabled={busy === "bm"} className={cn("rounded p-0.5 hover:bg-surface-3", ACCENT_TEXT)} title="Bookmarked: click to remove" aria-label="Remove bookmark"><BookOpen className="h-4 w-4" /></button>}
                {c.realtime && <span className={ACCENT_TEXT} title="Real-time: arrived by webhook / live widget"><Zap className="h-4 w-4" aria-label="Real-time" /></span>}
                {c.related > 0 && c.postKey && <Link href={href({ post: c.postKey, view: "all", status: null, t: null })} className="text-good-ink" title={`${c.related} related ticket${c.related === 1 ? "" : "s"} on the same post`}><LayoutGrid className="h-4 w-4" aria-label="Related" /></Link>}
                {c.sentiment && c.sentiment !== "neutral" && <span className="hidden uppercase sm:inline"><SentimentBadge sentiment={c.sentiment} /></span>}
                <Ago iso={c.at} className="text-[13px] whitespace-nowrap text-text-2" />
              </div>
            </div>
            {/* body */}
            <Body text={c.body} media={c.media} />
            {c.note && <p className="mt-1.5 rounded bg-surface-2 px-2 py-1 text-[12px] text-text-2"><span className="font-medium">Bookmark note:</span> {c.note}</p>}
            {/* first conversation */}
            {c.first && (c.first.body || c.first.media.length > 0) && (
              <div className="relative mt-4 rounded bg-surface-3 px-3 pt-8 pb-3 sm:px-5">
                <span className={cn("absolute top-2.5 -left-2 rounded-sm px-3 py-1 text-[10.5px] font-semibold tracking-wider uppercase shadow-card", ACCENT_BG)}>First conversation</span>
                <Ago iso={c.first.at} className="absolute top-3 right-3 text-[11.5px] font-semibold tracking-wider text-text-2 uppercase sm:right-4" />
                <Body text={c.first.body} media={c.first.media} small />
              </div>
            )}
            {/* footer */}
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 pb-2">
              {mention ? (
                c.url ? <a href={c.url} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1.5 text-[14px] text-text-2 hover:text-text" title="This source has no reply API: comment on the original post"><MessageCircle className="h-4 w-4" />Comment</a>
                  : <span className="inline-flex items-center gap-1.5 text-[14px] text-text-3" title="No reply API for this source"><MessageCircle className="h-4 w-4" />Comment</span>
              ) : (
                <button type="button" disabled={readOnly || !isTicket} onClick={() => setReplying((x) => !x)} className="inline-flex items-center gap-1.5 text-[14px] text-text-2 hover:text-text disabled:opacity-50" aria-expanded={replying}>
                  {c.isPublic ? <MessageCircle className="h-4 w-4" /> : <Send className="h-4 w-4" />}{c.isPublic ? "Comment" : "Reply"}
                </button>
              )}
              {variant === "queued" && isTicket && !readOnly && (
                <button type="button" disabled={busy === "dequeue"} onClick={() => act("dequeue", () => removeFromQueueAction(brand, [c.ticketId!]))} className="inline-flex items-center gap-1.5 text-[14px] text-text-2 hover:text-text">
                  <ArrowLeft className="h-4 w-4" />Remove From Queue
                </button>
              )}
              <span className="ml-auto flex min-w-0 flex-wrap items-center justify-end gap-1.5">
                <span className={cn("max-w-full truncate rounded px-1.5 py-0.5 text-[10px] font-semibold tracking-wide whitespace-nowrap uppercase", ACCENT_BG)} title={c.profile ?? undefined}>{profileBadge(c.mediaType, c.profile)}</span>
                <Toolbar c={c} variant={variant} busy={busy} bm={bm} onBookmark={toggleBm} onPatch={patch} onCreate={createTicket} onTask={() => setDialog("task")} onNote={() => setDialog("note")}
                  onMention={(k, fn) => act(k, fn)} />
              </span>
            </div>
            {error && <p className="pb-2 text-[12px] text-critical-ink" role="alert">{error}</p>}
            {replying && isTicket && <QuickReply c={c} onDone={() => { setReplying(false); router.refresh(); }} />}
          </div>
        </div>
        {/* ticket id bar */}
        {showBar && (
          <div className="flex items-center gap-2 border-t border-border px-3 py-2 sm:px-5">
            <Link href={detailHref!} className={cn("text-[12px] font-semibold tracking-wider uppercase hover:underline", ACCENT_TEXT)}>Ticket ID: {c.number}</Link>
            {variant === "queued" && c.queued?.assigned ? <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-semibold tracking-wide", ACCENT_BG)}>ASSIGNED</span> : c.status ? <StatusBadge status={c.status} /> : null}
            {variant === "queued" && c.queued?.position != null && <span className="text-[11.5px] text-text-3">#{c.queued.position} in queue</span>}
            {c.assigneeName && variant !== "queued" && <span className="hidden truncate text-[11.5px] text-text-3 sm:inline">{c.assigneeName}</span>}
            <span className="ml-auto flex items-center gap-2">
              {c.messages > 1 && <span className={cn("text-[12px] font-semibold tabular-nums", ACCENT_TEXT)} title={`${c.messages} messages`}>{c.messages}</span>}
              <button type="button" onClick={() => setExpanded((x) => !x)} className="rounded p-0.5 text-text-2 hover:bg-surface-3" aria-expanded={expanded} aria-label={expanded ? "Collapse thread" : "Expand thread"}>
                <ChevronDown className={cn("h-4 w-4 transition-transform", expanded && "rotate-180")} />
              </button>
            </span>
          </div>
        )}
        {expanded && c.ticketId && <Thread ticketId={c.ticketId} />}
      </article>
      {dialog === "task" && c.ticketId && <TaskFor c={c} onClose={() => setDialog(null)} />}
      {dialog === "note" && c.bookmarkId && <NoteDialog c={c} onClose={() => setDialog(null)} />}
    </li>
  );
}

// ---------------------------------------------------------------- body

function Body({ text, media, small }: { text: string; media: CardMedia[]; small?: boolean }) {
  const { href } = useStreamHref();
  const [open, setOpen] = useState(false);
  const clamp = needsClamp(text) || media.length > 3;
  if (!text && !media.length) return null;
  return (
    <div className="mt-1.5">
      <div className={cn("break-words whitespace-pre-line text-text", small ? "text-[13.5px] leading-6" : "text-[14px] leading-6", clamp && !open && "line-clamp-3")}>
        {richSegments(text).map((s, i) =>
          s.kind === "link" ? <a key={i} href={s.href} target="_blank" rel="noreferrer noopener" className={cn("hover:underline", ACCENT_TEXT)}>{s.text}</a>
          : s.kind === "hashtag" ? <Link key={i} href={href({ q: `#${s.tag}`, t: null })} className={cn("hover:underline", ACCENT_TEXT)} scroll={false}>{s.text}</Link>
          : s.kind === "handle" ? <span key={i} className={ACCENT_TEXT}>{s.text}</span>
          : <span key={i}>{s.text}</span>,
        )}
      </div>
      {media.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-2">
          {(open ? media : media.slice(0, 3)).map((m, i) => (
            <a key={i} href={m.url} target="_blank" rel="noreferrer noopener" className="block overflow-hidden rounded border border-border bg-surface-2" title={m.name ?? m.type}>
              {isImage(m) ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={m.url} alt={m.name ?? "Attached image"} loading="lazy" className="h-20 max-w-[180px] object-cover" />
              ) : (
                <span className="flex h-20 w-28 flex-col items-center justify-center gap-1 text-[11px] text-text-2">
                  {isVideo(m) ? <PlayCircle className="h-6 w-6" /> : <FileText className="h-6 w-6" />}<span className="max-w-24 truncate">{m.name ?? m.type}</span>
                </span>
              )}
            </a>
          ))}
        </div>
      )}
      {clamp && (
        <div className="mt-2 text-center">
          <button type="button" onClick={() => setOpen((x) => !x)} className={cn("text-[12px] font-semibold tracking-[0.12em] uppercase hover:underline", ACCENT_TEXT)}>{open ? "Read less" : "Read more"}</button>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- toolbar

function Tool({ icon, label, onClick, href, external, off, active, busy }: { icon: ReactNode; label: string; onClick?: () => void; href?: string | null; external?: boolean; off?: boolean; active?: boolean; busy?: boolean }) {
  const cls = cn("inline-flex h-7 w-7 items-center justify-center rounded text-text-2 hover:bg-surface-3 hover:text-text", active && ACCENT_TEXT, off && "pointer-events-none opacity-35");
  const inner = busy ? <Loader2 className="h-4 w-4 animate-spin" /> : icon;
  if (href && !off) return external ? <a href={href} target="_blank" rel="noreferrer noopener" className={cls} title={label} aria-label={label}>{inner}</a> : <Link href={href} className={cls} title={label} aria-label={label}>{inner}</Link>;
  return <button type="button" onClick={onClick} disabled={off} className={cls} title={label} aria-label={label}>{inner}</button>;
}

function Toolbar({ c, variant, busy, bm, onBookmark, onPatch, onCreate, onTask, onNote, onMention }: {
  c: CardItem; variant: CardVariant; busy: string | null; bm: boolean; onBookmark: () => void; onPatch: (key: string, p: TicketPatch) => void; onCreate: () => void; onTask: () => void; onNote: () => void;
  onMention: (key: string, fn: () => Promise<{ ok: boolean; error?: string }>) => void;
}) {
  const { brand, readOnly, agents, me } = useStream();
  const { href } = useStreamHref();
  const done = !!c.status && DONE.has(c.status);
  const ignored = c.status === "ignored" || c.mentionStatus === "ignored";
  const wrap = "flex flex-wrap items-center gap-0.5 sm:hidden sm:group-hover/card:flex sm:group-focus-within/card:flex";
  const sentimentMenu = (
    <Menu align="right" trigger={() => <span className={cn("inline-flex h-7 w-7 items-center justify-center rounded text-text-2 hover:bg-surface-3 hover:text-text", readOnly && "pointer-events-none opacity-35")} title="Sentiment" aria-label="Sentiment"><Smile className="h-4 w-4" /></span>}>
      {(close) => (
        <div className="w-40 py-0.5">
          <div className="px-3 pt-1 pb-0.5 text-[11px] font-medium text-text-3 uppercase">Sentiment</div>
          {(["positive", "neutral", "negative"] as const).map((s) => (
            <button key={s} type="button" onClick={() => { close(); if (c.kind === "mention") onMention("sent", () => mentionSentimentAction(brand, c.mentionId!, s)); else onPatch("sent", { sentiment: s }); }} className={cn("flex w-full items-center justify-between px-3 py-1.5 text-left text-[13px] capitalize hover:bg-surface-3", c.sentiment === s ? ACCENT_TEXT : "text-text")}>
              {s}{c.sentiment === s && <span aria-hidden>✓</span>}
            </button>
          ))}
        </div>
      )}
    </Menu>
  );

  if (c.kind === "mention") {
    return (
      <span className={wrap}>
        <Tool icon={<SquarePlus className="h-4 w-4" />} label={c.ticketId ? "Open ticket" : "Create ticket"} href={c.ticketId ? ticketHref(brand, c.ticketId) : null} onClick={onCreate} off={readOnly && !c.ticketId} busy={busy === "create"} />
        <Tool icon={<Globe className="h-4 w-4" />} label={c.url ? "View original" : "No public link"} href={c.url} external off={!c.url} />
        <Tool icon={<Ban className="h-4 w-4" />} label={ignored ? "Restore (not spam)" : "Ignore / spam"} active={ignored} off={readOnly} busy={busy === "ignore"} onClick={() => onMention("ignore", () => mentionStatusAction(brand, [c.mentionId!], ignored ? "read" : "ignored"))} />
        {sentimentMenu}
        <Menu align="right" trigger={() => <span className="inline-flex h-7 w-7 items-center justify-center rounded border border-border text-text-2 hover:bg-surface-3" title="More" aria-label="More actions"><MoreHorizontal className="h-4 w-4" /></span>}>
          {(close) => (
            <div className="w-56 py-0.5 text-[13px]">
              {!readOnly && <MI icon={<CircleCheck className="h-3.5 w-3.5" />} label="Mark as actioned" onClick={() => { close(); onMention("st", () => mentionStatusAction(brand, [c.mentionId!], "actioned")); }} />}
              {!readOnly && <MI icon={<Inbox className="h-3.5 w-3.5" />} label="Mark as read" onClick={() => { close(); onMention("st", () => mentionStatusAction(brand, [c.mentionId!], "read")); }} />}
              <MI icon={<ExternalLink className="h-3.5 w-3.5" />} label="Open in Listening" href={`/cx/listening?brand=${brand}&q=${encodeURIComponent(c.author)}`} />
              {c.url && <MI icon={<Copy className="h-3.5 w-3.5" />} label="Copy link" onClick={() => { close(); void navigator.clipboard?.writeText(c.url!); }} />}
            </div>
          )}
        </Menu>
      </span>
    );
  }

  const id = c.ticketId!;
  return (
    <span className={wrap}>
      <Tool icon={<FileText className="h-4 w-4" />} label="Ticket details" href={ticketHref(brand, id)} />
      <Tool icon={<SquarePlus className="h-4 w-4" />} label="Create child ticket" href={ticketHref(brand, id, { act: "child" })} off={readOnly || !!c.parentId} />
      <Tool icon={<Globe className="h-4 w-4" />} label={c.url ? "View original" : "No public link for this conversation"} href={c.url} external off={!c.url} />
      <Tool icon={<Mail className="h-4 w-4" />} label="Compose mail" href={ticketHref(brand, id, { act: "compose" })} off={readOnly} />
      <Tool icon={<Ban className="h-4 w-4" />} label={ignored ? "Reopen (not spam)" : "Ignore / spam"} active={ignored} off={readOnly} busy={busy === "ignore"} onClick={() => onPatch("ignore", { status: ignored ? "reopened" : "ignored" })} />
      {sentimentMenu}
      <Tool icon={<BookOpen className="h-4 w-4" />} label={bm ? "Remove bookmark" : "Bookmark"} active={bm} busy={busy === "bm"} onClick={onBookmark} />
      <Menu align="right" trigger={() => <span className={cn("inline-flex h-7 w-7 items-center justify-center rounded text-text-2 hover:bg-surface-3 hover:text-text", readOnly && "pointer-events-none opacity-35")} title="Assign" aria-label="Assign"><UserPlus className="h-4 w-4" /></span>}>
        {(close) => (
          <div className="max-h-72 w-56 overflow-y-auto py-0.5 text-[13px]">
            <div className="px-3 pt-1 pb-0.5 text-[11px] font-medium text-text-3 uppercase">Assign to</div>
            <MI label={`Me (${me.name})`} onClick={() => { close(); onPatch("assign", { assignee_id: me.id }); }} />
            {agents.filter((a) => a.id !== me.id).map((a) => <MI key={a.id} label={a.name} active={c.assigneeId === a.id} onClick={() => { close(); onPatch("assign", { assignee_id: a.id }); }} />)}
            {c.assigneeId && <MI label="Unassign" onClick={() => { close(); onPatch("assign", { assignee_id: null }); }} />}
          </div>
        )}
      </Menu>
      <Tool icon={<CircleCheck className="h-4 w-4" />} label={done ? "Reopen" : "Close ticket"} active={done} off={readOnly} busy={busy === "close"} onClick={() => onPatch("close", { status: done ? "reopened" : "closed" })} />
      <Tool icon={<SquareCheckBig className="h-4 w-4" />} label="Create task" off={readOnly} onClick={onTask} />
      <Menu align="right" trigger={() => <span className="inline-flex h-7 w-7 items-center justify-center rounded border border-border text-text-2 hover:bg-surface-3" title="More" aria-label="More actions"><MoreHorizontal className="h-4 w-4" /></span>}>
        {(close) => (
          <div className="max-h-80 w-60 overflow-y-auto py-0.5 text-[13px]">
            <MI icon={<FileText className="h-3.5 w-3.5" />} label="Open One Ticket View" href={ticketHref(brand, id)} />
            <MI icon={<Inbox className="h-3.5 w-3.5" />} label="Open in inbox" href={`/cx/inbox?brand=${brand}&view=all&t=${id}`} />
            {c.postKey && <MI icon={<MessagesSquare className="h-3.5 w-3.5" />} label={`View all comments on this post${c.related ? ` (${c.related + 1})` : ""}`} href={href({ post: c.postKey, view: "all", status: null, t: null })} />}
            {!readOnly && (
              <>
                <div className="my-1 border-t border-border" />
                <div className="px-3 pt-0.5 pb-0.5 text-[11px] font-medium text-text-3 uppercase">Status</div>
                {SETTABLE_STATUSES.filter((s) => s.id !== "new").map((s) => <MI key={s.id} label={s.label} active={c.status === s.id} onClick={() => { close(); onPatch("status", { status: s.id as CrmStatus }); }} />)}
                <div className="my-1 border-t border-border" />
                <div className="px-3 pt-0.5 pb-0.5 text-[11px] font-medium text-text-3 uppercase">Priority</div>
                {(["urgent", "high", "normal", "low"] as const).map((p) => <MI key={p} label={p[0].toUpperCase() + p.slice(1)} active={c.priority === p} onClick={() => { close(); onPatch("prio", { priority: p }); }} />)}
              </>
            )}
            <div className="my-1 border-t border-border" />
            {variant === "bookmark" && c.bookmarkId && <MI icon={<Pencil className="h-3.5 w-3.5" />} label={c.note ? "Edit bookmark note" : "Add bookmark note"} onClick={() => { close(); onNote(); }} />}
            {variant === "bookmark" && c.bookmarkId && <MI icon={<Trash2 className="h-3.5 w-3.5" />} label="Remove bookmark" onClick={() => { close(); onBookmark(); }} />}
            <MI icon={<Link2 className="h-3.5 w-3.5" />} label="Copy ticket link" onClick={() => { close(); void navigator.clipboard?.writeText(`${window.location.origin}${ticketHref(brand, id)}`); }} />
            <MI icon={<Download className="h-3.5 w-3.5" />} label="Download transcript (.txt)" href={`/api/cx/inbox/${id}/transcript?brand=${brand}`} plain />
          </div>
        )}
      </Menu>
    </span>
  );
}

function MI({ icon, label, onClick, href, active, plain }: { icon?: ReactNode; label: string; onClick?: () => void; href?: string; active?: boolean; plain?: boolean }) {
  const cls = cn("flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-surface-3", active ? ACCENT_TEXT : "text-text");
  if (href) return plain ? <a href={href} className={cls}>{icon}{label}</a> : <Link href={href} className={cls}>{icon}{label}</Link>;
  return <button type="button" onClick={onClick} className={cls}>{icon}<span className="flex-1">{label}</span>{active && <span aria-hidden>✓</span>}</button>;
}

// ---------------------------------------------------------------- inline thread, quick reply, dialogs

function Thread({ ticketId }: { ticketId: string }) {
  const { brand } = useStream();
  const [state, setState] = useState<{ loading: boolean; error?: string; messages?: ThreadMessage[] }>({ loading: true });
  useEffect(() => {
    let live = true;
    void ticketThreadAction(brand, ticketId).then((r) => { if (live) setState(r.ok ? { loading: false, messages: r.data.messages } : { loading: false, error: r.error }); });
    return () => { live = false; };
  }, [brand, ticketId]);
  return (
    <div className="space-y-2 border-t border-border bg-surface-2 px-3 py-3 sm:px-5">
      {state.loading && <p className="flex items-center gap-1.5 text-[12.5px] text-text-3"><Loader2 className="h-3.5 w-3.5 animate-spin" />Loading thread…</p>}
      {state.error && <p className="text-[12.5px] text-critical-ink">{state.error}</p>}
      {state.messages?.map((m) => (
        <div key={m.id} className={cn("flex", m.direction === "in" ? "justify-start" : "justify-end")}>
          <div className={cn("max-w-[85%] rounded-md border px-2.5 py-1.5", m.direction === "note" ? "border-warning/40 bg-warning-soft" : m.direction === "out" ? "border-border bg-brand-soft" : "border-border bg-surface")}>
            <div className="mb-0.5 flex gap-2 text-[11px] text-text-3"><span className="font-medium text-text-2">{m.author_name || (m.direction === "in" ? "Customer" : "Agent")}</span>{m.direction === "note" && <span>Private note</span>}<time suppressHydrationWarning>{dateTimeLabel(m.created_at)}</time></div>
            <p className="line-clamp-6 text-[13px] break-words whitespace-pre-line text-text">{m.body || <span className="text-text-3 italic">(attachment)</span>}</p>
          </div>
        </div>
      ))}
      {state.messages && state.messages.length === 0 && <p className="text-[12.5px] text-text-3">No messages.</p>}
      {state.messages && <Link href={ticketHref(brand, ticketId)} className={cn("inline-block text-[12px] font-semibold hover:underline", ACCENT_TEXT)}>Open full ticket →</Link>}
    </div>
  );
}

function QuickReply({ c, onDone }: { c: CardItem; onDone: () => void }) {
  const { brand } = useStream();
  const [text, setText] = useState("");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState<"reply" | "note" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const send = async (note: boolean) => {
    if (!text.trim()) return setError("Write a message first.");
    setBusy(note ? "note" : "reply"); setError(null);
    const r = await replyAction(brand, c.ticketId!, { body: text.trim(), note, status: note ? null : ((status || null) as CrmStatus | null) });
    setBusy(null);
    if (!r.ok) return setError(r.error);
    setText("");
    onDone();
  };
  return (
    <div className="mb-3 rounded-md border border-border bg-surface-2 p-2">
      <Textarea rows={3} autoFocus value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void send(false); }}
        placeholder={c.isPublic ? `Public comment to ${c.author} (⌘/Ctrl + Enter to send)` : `Reply to ${c.author} (⌘/Ctrl + Enter to send)`} className="text-[13.5px]" aria-label={c.isPublic ? "Comment" : "Reply"} />
      {error && <p className="mt-1 text-[12px] text-critical-ink" role="alert">{error}</p>}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <select value={status} onChange={(e) => setStatus(e.target.value)} className="h-8 rounded-md border border-border-strong bg-surface px-2 text-[12.5px] text-text" aria-label="Status after sending">
          <option value="">Keep status</option>
          {SETTABLE_STATUSES.filter((s) => s.id !== "new").map((s) => <option key={s.id} value={s.id}>Then: {s.label}</option>)}
        </select>
        <Link href={ticketHref(brand, c.ticketId!)} className={cn("text-[12px] hover:underline", ACCENT_TEXT)}>Full composer (attachments, canned, private reply) →</Link>
        <span className="ml-auto flex gap-2">
          <Button size="sm" variant="ghost" disabled={!!busy} loading={busy === "note"} onClick={() => send(true)}>Add note</Button>
          <Button size="sm" variant="primary" disabled={!!busy} loading={busy === "reply"} onClick={() => send(false)}>{busy !== "reply" && <Send className="h-3.5 w-3.5" />}{c.isPublic ? "Comment" : "Reply"}</Button>
        </span>
      </div>
    </div>
  );
}

function TaskFor({ c, onClose }: { c: CardItem; onClose: () => void }) {
  const { brand, agents, tree, me } = useStream();
  return <TaskDialog brand={brand} agents={agents} tree={tree} me={me} ticket={{ id: c.ticketId!, number: c.number ?? 0, subject: c.body.slice(0, 80) }} onClose={onClose} />;
}

function NoteDialog({ c, onClose }: { c: CardItem; onClose: () => void }) {
  const { brand } = useStream();
  const router = useRouter();
  const [note, setNote] = useState(c.note ?? "");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const save = async () => {
    if (saving) return;
    setSaving(true);
    setError(null);
    const r = await bookmarkNoteAction(brand, c.bookmarkId!, note);
    setSaving(false);
    if (!r.ok) return setError(r.error);
    onClose();
    router.refresh();
  };
  return (
    <Dialog open onClose={onClose} title="Bookmark note" size="sm" error={error} onSubmit={save} footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button type="submit" variant="primary" loading={saving}>Save</Button></>}>
      <Textarea rows={3} value={note} maxLength={500} autoFocus onChange={(e) => setNote(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void save(); } }} aria-label="Note" placeholder="Why you saved this (only you see it)" />
    </Dialog>
  );
}
