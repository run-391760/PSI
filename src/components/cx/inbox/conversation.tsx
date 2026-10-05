"use client";

import {
  AlarmClock, AlertTriangle, Zap, ArrowLeft, ArrowUpRight, Check, ChevronDown, ChevronRight, CornerDownRight, Download, ExternalLink, Eye, FileText, Forward, GitBranch, GitMerge,
  Languages, Lock, Mail, Maximize2, MoreHorizontal, Paperclip, Pencil, Plus, Send, Sparkles, Unlink, UserPlus, X, Bookmark, BookmarkCheck, ClipboardList, MessagesSquare,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { runQuickActionAction } from "@/app/(app)/cx/settings/automation/admin-actions";
import { mergeAction, moderateCommentAction, summarizeAction, translateMessageAction, unlinkParentAction, updateTicketsAction } from "@/app/(app)/cx/inbox/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, Menu } from "@/components/ui/dialog";
import { Callout } from "@/components/ui/feedback";
import { Checkbox, Input, Select } from "@/components/ui/input";
import { crmLabel, linkSegments, SETTABLE_STATUSES, type CrmStatus } from "@/lib/cx/inbox/model";
import type { Attachment, MessageRow, TicketDetail } from "@/lib/cx/inbox/store";
import { slaStatus } from "@/lib/cx/inbox/sla";
import { dateTimeLabel } from "@/lib/format";
import { cn } from "@/lib/utils";
import { toggleBookmarkAction } from "@/app/(app)/cx/bookmarks/actions";
import { updateTaskAction } from "@/app/(app)/cx/tasks/actions";
import { TaskDialog } from "@/components/cx/ops/task-dialog";
import { taskDueState, taskStatusLabel } from "@/lib/cx/ops/model";
import type { Task } from "@/lib/cx/ops/tasks";
import { Composer } from "./composer";
import { ticketHref } from "@/lib/cx/inbox/stream";
import type { InboxProps } from "./inbox-client";
import { playAlert, usePrefs } from "./prefs";
import { AssignDialog, ChildDialog, EmailDialog, FieldsPanel, fmtSize, ParentDialog, ReminderDialog, type EmailKind } from "./ticket-dialogs";
import { Ago, SlaClockRow, useNow } from "./time";
import { Avatar, ChannelIcon, channelLabel, KeyValue, SentimentBadge, statusLabel, StatusBadge } from "./ui";

export type ConversationProps = Pick<InboxProps, "brand" | "me" | "agents" | "teams" | "ai" | "settings" | "act" | "canned" | "emailSuggestions" | "fieldDefs" | "hasEmail" | "hasSignature" | "ops" | "quickActions" | "role" | "severities" | "signals" | "tickets" | "tree">;
/** `fullPage`: rendered by the One Ticket View (/cx/ticket/[id]); related-ticket links then stay in that view. */
type Props = ConversationProps & { detail: TicketDetail; backHref: string; fullPage?: boolean };
const INTENTS: Record<string, string> = { complaint: "Complaint", query: "Query", feedback: "Feedback", praise: "Praise", purchase: "Purchase intent", cancellation: "Cancellation / churn risk", spam: "Spam", other: "Other" };
type Live = { viewers: { name: string; typing: boolean }[]; lockedBy: { id: string; name: string } | null; visitorOnline: boolean | null; visitorTyping: boolean };
type DialogState = null | { kind: "reminder"; existing?: TicketDetail["reminders"][number] } | { kind: EmailKind } | { kind: "assign" | "child" | "parent" | "merge" } | { kind: "task"; existing?: Task };
const initialDialog = (act: string | null, readOnly: boolean): DialogState => (readOnly ? null : act === "compose" ? { kind: "compose" } : act === "child" ? { kind: "child" } : act === "task" ? { kind: "task" } : null);
type Item = MessageRow & { from_ticket?: number | null };

export function Conversation(props: Props) {
  const { brand, me, detail, backHref, agents, teams, ai, settings } = props;
  const router = useRouter();
  const { prefs } = usePrefs();
  const t = detail.ticket;
  const [live, setLive] = useState<Live>({ viewers: [], lockedBy: null, visitorOnline: null, visitorTyping: false });
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<"all" | "public" | "private">("all");
  const [replyTo, setReplyTo] = useState<MessageRow | null>(null);
  const readOnlyRole = props.role === "viewer";
  const [dialog, setDialog] = useState<DialogState>(() => initialDialog(props.act, readOnlyRole));
  const [bm, setBm] = useState<{ ticket: boolean; messages: string[] }>(props.ops?.bookmarks ?? { ticket: false, messages: [] });
  useEffect(() => setBm(props.ops?.bookmarks ?? { ticket: false, messages: [] }), [props.ops?.bookmarks]);
  const toggleBm = async (messageId?: string) => {
    const r = await toggleBookmarkAction(brand.id, { ticketId: t.id, messageId: messageId ?? null });
    if (!r.ok) return setError(r.error);
    setBm((x) => messageId ? { ...x, messages: r.data.bookmarked ? [...x.messages, messageId] : x.messages.filter((m) => m !== messageId) } : { ...x, ticket: r.data.bookmarked });
  };
  const tasks = props.ops?.tasks ?? [];
  // A card action (?act=compose|child|task) opened a dialog on mount: drop the param so refreshes don't reopen it.
  useEffect(() => {
    if (!props.act) return;
    const u = new URL(window.location.href);
    u.searchParams.delete("act");
    router.replace(`${u.pathname}?${u.searchParams.toString()}`, { scroll: false });
  }, [props.act, router]);
  const listRow = props.tickets.find((x) => x.id === t.id);
  const [summary, setSummary] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const lastTyped = useRef(0);
  const lastIn = useRef<string | null>(null);
  const takeover = useRef<(() => void) | null>(null);
  const threadRef = useRef<HTMLDivElement>(null);
  const version = `${t.updated_at}|${(detail.messages ?? []).length}`;
  const now = useNow(15_000);
  const sla = slaStatus(t, now);
  const isEmail = t.channel_kind === "email";
  // Public social threads (comments, mentions, reviews): agents can answer a specific comment; own-post comments can be moderated.
  const threadKey = (t as unknown as { external_thread_id?: string | null }).external_thread_id ?? "";
  const socialThread = /^(fbc|fbp|fbr|igc|igm|lic\||lip\|)/.test(threadKey);
  const moderatable = /^(fbc|igc):/.test(threadKey) && !readOnlyRole;
  const moderate = async (m: MessageRow, action: "hide" | "unhide" | "delete") => {
    if (action === "delete" && !confirm("Delete this comment on the platform? This can't be undone.")) return;
    const r = await moderateCommentAction(brand.id, t.id, m.id, action);
    if (!r.ok) setError(r.error);
    else router.refresh();
  };
  const collapsedMode = isEmail && prefs.emailCollapsed;
  const readOnly = props.role === "viewer";

  // Poll: presence + collision lock, visitor typing, new messages (sound) → refresh.
  useEffect(() => {
    let stop = false;
    const tick = async (method: "GET" | "POST" = "GET") => {
      if (method === "GET" && document.visibilityState !== "visible") return;
      try {
        const r = await fetch(`/api/cx/inbox/${t.id}?brand=${brand.id}${Date.now() - lastTyped.current < 5000 ? "&typing=1" : ""}${method === "POST" ? "&action=continue" : ""}`, { method, cache: "no-store" });
        if (!r.ok || stop) return;
        const d = (await r.json()) as Live & { version: string; lastIn: string | null };
        setLive({ viewers: d.viewers, lockedBy: d.lockedBy, visitorOnline: d.visitorOnline, visitorTyping: d.visitorTyping });
        if (lastIn.current && d.lastIn && d.lastIn !== lastIn.current && prefs.soundNewMessage) playAlert("message");
        lastIn.current = d.lastIn;
        if (d.version !== version) router.refresh();
      } catch {}
    };
    takeover.current = () => { void tick("POST"); };
    tick();
    const iv = setInterval(tick, 4000);
    return () => { stop = true; clearInterval(iv); };
  }, [t.id, brand.id, version, router, prefs.soundNewMessage]);

  useEffect(() => {
    if (!collapsedMode) threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight });
  }, [detail.messages?.length, tab, collapsedMode]);

  const patch = async (p: Parameters<typeof updateTicketsAction>[2]) => {
    setError(null);
    const r = await updateTicketsAction(brand.id, [t.id], p);
    if (!r.ok) setError(r.error);
    router.refresh();
  };
  const done = ["solved", "closed", "ignored"].includes(t.crm_status);
  const disabled = readOnly ? "Viewers can't reply." : detail.locked ? `Locked: resolved more than ${settings.lockDays} days ago, so it can't be edited or reopened.` : live.lockedBy ? `${live.lockedBy.name} is working on this ticket. Press Continue to take over.` : null;
  const editDisabled = readOnly || detail.locked || !!live.lockedBy;

  const items: Item[] = useMemo(() => {
    const all: Item[] = [...(detail.messages ?? []), ...(detail.familyNotes ?? [])].sort((a, b) => a.created_at.localeCompare(b.created_at));
    const filtered = !settings.publicPrivateTabs || tab === "all" ? all : tab === "public" ? all.filter((m) => m.direction !== "note") : all.filter((m) => m.direction === "note");
    return collapsedMode && tab !== "private" ? [...filtered].reverse() : filtered;
  }, [detail.messages, detail.familyNotes, tab, settings.publicPrivateTabs, collapsedMode]);
  const publicN = (detail.messages ?? []).filter((m) => m.direction !== "note").length;
  const privateN = (detail.messages ?? []).filter((m) => m.direction === "note").length + (detail.familyNotes ?? []).length;
  const byId = useMemo(() => new Map((detail.messages ?? []).map((m) => [m.id, m])), [detail.messages]);
  const agentName = (id: string) => agents.find((a) => a.id === id)?.name ?? "";
  const openTicket = (id: string) => (props.fullPage ? ticketHref(brand.id, id) : `/cx/inbox?brand=${brand.id}&view=all&t=${id}`);

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      {/* header */}
      <div className="flex flex-wrap items-start gap-2 border-b border-border px-4 py-3">
        <Link href={backHref} scroll={false} className={cn("-ml-1 rounded p-1 text-text-3 hover:bg-surface-3", !props.fullPage && "lg:hidden")} aria-label="Back to list"><ArrowLeft className="h-4 w-4" /></Link>
        <div className="min-w-[14rem] flex-1">
          <h2 className="text-[15px] font-semibold break-words text-text"><span className="font-normal text-text-3">#{t.number}</span> {t.subject}</h2>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12.5px] text-text-2">
            <span className="inline-flex items-center gap-1"><ChannelIcon kind={t.channel_kind} />{t.channel_name ?? channelLabel(t.channel_kind)}</span>
            <span>·</span>
            {t.contact_id ? <Link href={`/cx/contacts/${t.contact_id}?brand=${brand.id}`} className="text-link hover:underline">{t.contact_name || t.contact_email}</Link> : <span>Unknown contact</span>}
            {t.contact_email && t.contact_name && <span className="hidden text-text-3 sm:inline">{t.contact_email}</span>}
            {detail.parent && <Link href={openTicket(detail.parent.id)} className="inline-flex items-center gap-0.5 text-link hover:underline"><GitBranch className="h-3 w-3" />Child of #{detail.parent.number}</Link>}
            {(detail.mentions ?? []).map((m) => m.url && (
              <a key={m.id} href={m.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 text-link hover:underline">View mention<ExternalLink className="h-3 w-3" /></a>
            ))}
            {live.visitorOnline != null && <Badge tone={live.visitorOnline ? "good" : "neutral"}>{live.visitorOnline ? "Visitor online" : "Visitor away"}</Badge>}
            {t.escalated_at && <Badge tone="serious" title={`Escalated ${dateTimeLabel(t.escalated_at)}`}>Escalated</Badge>}
            {detail.locked && <Badge tone="neutral"><Lock className="mr-0.5 inline h-3 w-3" />Locked</Badge>}
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          {!props.fullPage && <Link href={ticketHref(brand.id, t.id)} className="rounded-md border border-border-strong p-1.5 text-text-2 hover:bg-surface-3" aria-label="Open One Ticket View" title="Open One Ticket View (full page)"><Maximize2 className="h-4 w-4" /></Link>}
          <button type="button" onClick={() => toggleBm()} className="rounded-md border border-border-strong p-1.5 text-text-2 hover:bg-surface-3" aria-label={bm.ticket ? "Remove bookmark" : "Bookmark ticket"} title={bm.ticket ? "Bookmarked (see Bookmarks)" : "Bookmark ticket"}>
            {bm.ticket ? <BookmarkCheck className="h-4 w-4 text-link" /> : <Bookmark className="h-4 w-4" />}
          </button>
          <StatusBadge status={t.crm_status} />
          {!readOnly && !detail.locked && (!done ? <Button size="sm" disabled={editDisabled} onClick={() => patch({ status: "solved" })}><Check className="h-3.5 w-3.5" />Resolve</Button> : <Button size="sm" disabled={editDisabled} onClick={() => patch({ status: "reopened" })}>Reopen</Button>)}
          <Menu align="right" trigger={() => <span className="inline-flex h-8 items-center gap-1 rounded-md border border-border-strong px-2 text-[12.5px] text-text-2 hover:bg-surface-3" aria-label="More actions"><MoreHorizontal className="h-4 w-4" /></span>}>
            {(close) => {
              const go = (d: DialogState) => () => { close(); setDialog(d); };
              const MI = ({ icon, label, onClick, href, off }: { icon: React.ReactNode; label: string; onClick?: () => void; href?: string; off?: boolean }) =>
                href ? <a href={href} onClick={close} className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-[13px] text-text hover:bg-surface-3">{icon}{label}</a>
                  : <button type="button" disabled={off} onClick={onClick} className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-[13px] text-text hover:bg-surface-3 disabled:opacity-40">{icon}{label}</button>;
              return (
                <div className="w-60 p-1">
                  {props.quickActions.length > 0 && <>
                    <div className="px-2 pt-1 pb-0.5 text-[11px] font-medium text-text-3 uppercase">Quick actions</div>
                    {props.quickActions.map((q) => <MI key={q.id} icon={<Zap className="h-3.5 w-3.5" />} label={q.name} off={editDisabled} onClick={async () => { close(); setError(null); const r = await runQuickActionAction(brand.id, q.id, [t.id]); if (!r.ok) setError(r.error); else if (r.data.failed) setError("The quick action could not be applied to this ticket."); router.refresh(); }} />)}
                    <div className="my-1 border-t border-border" />
                  </>}
                  <MI icon={<AlarmClock className="h-3.5 w-3.5" />} label="Set reminder" off={readOnly} onClick={go({ kind: "reminder" })} />
                  <MI icon={<ClipboardList className="h-3.5 w-3.5" />} label="Create task" off={readOnly} onClick={go({ kind: "task" })} />
                  {listRow?.post_key && <MI icon={<MessagesSquare className="h-3.5 w-3.5" />} label={`View all comments on this post${listRow.post_tickets > 1 ? ` (${listRow.post_tickets})` : ""}`} href={`/cx/inbox?brand=${brand.id}&view=all&post=${encodeURIComponent(listRow.post_key)}`} />}
                  <MI icon={<UserPlus className="h-3.5 w-3.5" />} label="Assign with note / media" off={editDisabled} onClick={go({ kind: "assign" })} />
                  <div className="my-1 border-t border-border" />
                  <MI icon={<ArrowUpRight className="h-3.5 w-3.5" />} label="Escalate via email" off={readOnly} onClick={go({ kind: "escalate" })} />
                  <MI icon={<Forward className="h-3.5 w-3.5" />} label="Forward" off={readOnly} onClick={go({ kind: "forward" })} />
                  <MI icon={<Mail className="h-3.5 w-3.5" />} label="Compose mail" off={readOnly} onClick={go({ kind: "compose" })} />
                  <div className="my-1 border-t border-border" />
                  <MI icon={<Plus className="h-3.5 w-3.5" />} label="New child ticket" off={readOnly || !!detail.parent} onClick={go({ kind: "child" })} />
                  {detail.parent
                    ? <MI icon={<Unlink className="h-3.5 w-3.5" />} label={`Unlink from #${detail.parent.number}`} off={readOnly} onClick={async () => { close(); const r = await unlinkParentAction(brand.id, t.id); if (!r.ok) setError(r.error); router.refresh(); }} />
                    : <MI icon={<GitBranch className="h-3.5 w-3.5" />} label="Link to parent ticket" off={readOnly || detail.children.length > 0} onClick={go({ kind: "parent" })} />}
                  <MI icon={<GitMerge className="h-3.5 w-3.5" />} label="Merge tickets" off={editDisabled} onClick={go({ kind: "merge" })} />
                  <div className="my-1 border-t border-border" />
                  <MI icon={<Download className="h-3.5 w-3.5" />} label="Download history (.txt)" href={`/api/cx/inbox/${t.id}/transcript?brand=${brand.id}`} />
                  <MI icon={<Download className="h-3.5 w-3.5" />} label="Download history (Excel)" href={`/api/cx/inbox/${t.id}/transcript?brand=${brand.id}&format=xlsx`} />
                </div>
              );
            }}
          </Menu>
        </div>
        {live.lockedBy && !detail.locked && (
          <div className="flex w-full flex-wrap items-center gap-2 rounded-md bg-warning-soft px-2.5 py-1.5 text-[12.5px] text-warning-ink">
            <Lock className="h-3.5 w-3.5" /><span className="flex-1">{live.lockedBy.name} is working on this ticket. Replies and changes are paused for you to avoid double handling.</span>
            {!readOnly && <Button size="sm" onClick={() => takeover.current?.()}>Continue</Button>}
          </div>
        )}
        {!live.lockedBy && live.viewers.length > 0 && (
          <div className="flex w-full items-center gap-1.5 rounded-md bg-surface-2 px-2.5 py-1.5 text-[12.5px] text-text-2">
            <Eye className="h-3.5 w-3.5" />{live.viewers.map((o) => `${o.name} is ${o.typing ? "typing a reply" : "viewing"}`).join(" · ")}
          </div>
        )}
        {detail.locked && <div className="flex w-full items-center gap-1.5 rounded-md bg-surface-2 px-2.5 py-1.5 text-[12.5px] text-text-2"><Lock className="h-3.5 w-3.5" />Locked: resolved more than {settings.lockDays} days ago. It can't be edited or reopened; a new customer message starts a new ticket.</div>}
        {error && <Callout tone="critical" className="w-full">{error}</Callout>}
      </div>

      <div className="flex min-h-0 flex-1 flex-col xl:flex-row">
        {/* thread + composer */}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          {settings.publicPrivateTabs && (
            <div className="scroll-thin flex items-center gap-1 overflow-x-auto border-b border-border bg-surface px-3 py-1.5" role="tablist" aria-label="Messages">
              {([["all", "All", publicN + privateN], ["public", "Public messages", publicN], ["private", "Private messages", privateN]] as const).map(([id, label, n]) => (
                <button key={id} role="tab" aria-selected={tab === id} onClick={() => setTab(id)} className={cn("shrink-0 rounded-md px-2.5 py-1 text-[12.5px] whitespace-nowrap", tab === id ? "bg-brand-soft font-medium text-link" : "text-text-2 hover:bg-surface-3")}>{label} <span className="text-text-3 tabular-nums">{n}</span></button>
              ))}
              {collapsedMode && tab !== "private" && <span className="ml-auto hidden text-[11.5px] text-text-3 sm:inline">Newest first</span>}
            </div>
          )}
          <div ref={threadRef} className="scroll-thin min-h-[240px] flex-1 space-y-3 overflow-y-auto bg-bg px-4 py-4">
            {items.length === 0 && <p className="py-8 text-center text-[13px] text-text-3">{tab === "private" ? "No private messages yet. Internal notes, escalations and child-ticket notes appear here." : "No messages."}</p>}
            {items.map((m, i) => (
              <Message
                key={`${m.id}-${m.from_ticket ?? ""}`} m={m} align={prefs.align} brand={brand.id} ai={ai} lang={prefs.translateTo}
                collapsible={collapsedMode && m.direction !== "note"} defaultOpen={!collapsedMode || i === 0 || m.direction === "note"}
                replyTo={m.reply_to ? byId.get(m.reply_to) ?? null : null}
                mentionNames={(m.mentions ?? []).map(agentName).filter(Boolean)}
                onReply={m.direction === "in" && !disabled && (isEmail || (socialThread && !!m.external_id && !m.external_id.startsWith("tag:"))) ? () => setReplyTo(m) : undefined}
                onModerate={moderatable && m.direction === "in" && !m.from_ticket && m.external_id && m.moderation !== "deleted" ? (a) => moderate(m, a) : undefined}
                bookmarked={bm.messages.includes(m.id)} onBookmark={m.from_ticket ? undefined : () => toggleBm(m.id)}
              />
            ))}
            {live.visitorTyping && <div className="text-[12px] text-text-3 italic">Visitor is typing…</div>}
          </div>
          <Composer
            brand={brand} me={me} detail={detail} agents={agents} canned={props.canned} ai={ai} settings={settings} hasSignature={props.hasSignature} fieldDefs={props.fieldDefs}
            disabled={disabled} replyTo={replyTo} onClearReplyTo={() => setReplyTo(null)} onTyping={() => { lastTyped.current = Date.now(); }}
          />
        </div>

        {/* properties */}
        <aside className="scroll-thin border-t border-border bg-surface px-4 py-3 xl:w-[300px] xl:shrink-0 xl:overflow-y-auto xl:border-t-0 xl:border-l" aria-label="Ticket properties">
          <div className="grid grid-cols-2 gap-2 xl:grid-cols-1">
            <Prop label="Status">
              <Select value={t.crm_status} disabled={editDisabled} onChange={(e) => patch({ status: e.target.value as CrmStatus })} className="h-8 text-[12.5px]" aria-label="Status">
                {["assigned", "responded"].includes(t.crm_status) && <option value={t.crm_status} disabled>{crmLabel(t.crm_status)}</option>}
                {SETTABLE_STATUSES.map((s) => <option key={s.id} value={s.id} title={s.hint}>{s.label}</option>)}
              </Select>
            </Prop>
            <Prop label="Priority">
              <Select value={t.priority} disabled={editDisabled} onChange={(e) => patch({ priority: e.target.value as typeof t.priority })} className="h-8 text-[12.5px]" aria-label="Priority">
                {["urgent", "high", "normal", "low"].map((s) => <option key={s} value={s}>{s[0].toUpperCase() + s.slice(1)}</option>)}
              </Select>
            </Prop>
            <Prop label="Severity">
              <Select value={t.severity ?? ""} disabled={editDisabled} onChange={(e) => patch({ severity: e.target.value || null })} className="h-8 text-[12.5px]" aria-label="Severity">
                <option value="">Not set</option>
                {[...new Set([...props.severities, ...(t.severity ? [t.severity] : [])])].map((s) => <option key={s} value={s}>{s}</option>)}
              </Select>
            </Prop>
            <Prop label={`Sentiment${(t as unknown as { sentiment_manual?: boolean }).sentiment_manual ? " (manual)" : ""}`}>
              <Select value={t.sentiment ?? ""} disabled={editDisabled} onChange={(e) => e.target.value && patch({ sentiment: e.target.value as "positive" })} className="h-8 text-[12.5px]" aria-label="Sentiment">
                {!t.sentiment && <option value="">n/a</option>}
                {["positive", "neutral", "negative", "mixed"].map((s) => <option key={s} value={s}>{s[0].toUpperCase() + s.slice(1)}</option>)}
              </Select>
            </Prop>
            <Prop label="Assignee">
              <div className="flex gap-1">
                <Select value={t.assignee_id ?? ""} disabled={editDisabled} onChange={(e) => patch({ assignee_id: e.target.value || null })} className="h-8 min-w-0 flex-1 text-[12.5px]" aria-label="Assignee">
                  <option value="">Unassigned</option>
                  {agents.map((a) => <option key={a.id} value={a.id}>{a.id === me.id ? `${a.name} (me)` : a.name}</option>)}
                </Select>
                <button type="button" disabled={editDisabled} title="Assign with a note and media" onClick={() => setDialog({ kind: "assign" })} className="rounded-md border border-border-strong px-1.5 text-text-2 hover:bg-surface-3 disabled:opacity-40"><Paperclip className="h-3.5 w-3.5" /></button>
              </div>
            </Prop>
            <Prop label="Team">
              <TeamInput value={t.team} teams={teams} disabled={editDisabled} onSave={(v) => patch({ team: v })} />
            </Prop>
          </div>
          <Prop label="Tags" className="mt-2">
            <TagEditor tags={t.tags ?? []} disabled={editDisabled} onAdd={(v) => patch({ addTags: [v] })} onRemove={(v) => patch({ removeTags: [v] })} />
          </Prop>

          <Section title={`Tasks${tasks.length ? ` (${tasks.filter((k) => !["done", "cancelled"].includes(k.status)).length} open)` : ""}`} action={!readOnly && <SmallBtn onClick={() => setDialog({ kind: "task" })}><Plus className="h-3 w-3" />Task</SmallBtn>}>
            {tasks.length === 0 ? <p className="text-[12px] text-text-3">No tasks. Create one to follow up on this ticket.</p> : (
              <ul className="space-y-1">
                {tasks.map((k) => {
                  const ds = taskDueState(k);
                  const done = ["done", "cancelled"].includes(k.status);
                  return (
                    <li key={k.id} className="flex items-start gap-1.5 text-[12px]">
                      <input type="checkbox" checked={done} disabled={readOnly} onChange={async (e) => { const r = await updateTaskAction(brand.id, k.id, { status: e.target.checked ? "done" : "open" }); if (!r.ok) setError(r.error); router.refresh(); }} className="mt-0.5 h-3.5 w-3.5 accent-[var(--brand)]" aria-label={`Mark T-${k.number} done`} />
                      <div className="min-w-0 flex-1">
                        <Link href={`/cx/tasks?brand=${brand.id}&view=all&task=${k.id}`} className={cn("block truncate font-medium hover:underline", done ? "text-text-3 line-through" : "text-text")}>T-{k.number} {k.title}</Link>
                        <span className={cn("block", ds === "overdue" ? "text-critical-ink" : ds === "today" ? "text-warning-ink" : "text-text-3")} suppressHydrationWarning>
                          {taskStatusLabel(k.status)}{k.due_at ? ` · due ${dateTimeLabel(k.due_at)}` : ""}{k.assignee_name ? ` · ${k.assignee_name}` : ""}
                        </span>
                      </div>
                      {!readOnly && <button className="rounded p-0.5 text-text-3 hover:bg-surface-3 hover:text-text" aria-label="Edit task" onClick={() => setDialog({ kind: "task", existing: k })}><Pencil className="h-3 w-3" /></button>}
                    </li>
                  );
                })}
              </ul>
            )}
          </Section>

          <Section title="Reminders" action={!readOnly && <SmallBtn onClick={() => setDialog({ kind: "reminder" })}><Plus className="h-3 w-3" />Add</SmallBtn>}>
            {detail.reminders.length === 0 ? <p className="text-[12px] text-text-3">No reminders.</p> : (
              <ul className="space-y-1">
                {detail.reminders.map((r) => (
                  <li key={r.id} className="flex items-start gap-1.5 text-[12px]">
                    <AlarmClock className={cn("mt-0.5 h-3.5 w-3.5 shrink-0", r.fired_at ? "text-text-3" : "text-warning-ink")} />
                    <div className="min-w-0 flex-1">
                      <span className={cn("font-medium", r.fired_at ? "text-text-3 line-through" : "text-text")} suppressHydrationWarning>{dateTimeLabel(r.remind_at)}</span>
                      {r.note && <span className="block truncate text-text-2">{r.note}</span>}
                      <span className="block text-text-3">{r.user_ids.map(agentName).filter(Boolean).join(", ")}</span>
                    </div>
                    {!readOnly && <button className="rounded p-0.5 text-text-3 hover:bg-surface-3 hover:text-text" aria-label="Edit reminder" onClick={() => setDialog({ kind: "reminder", existing: r })}><Pencil className="h-3 w-3" /></button>}
                  </li>
                ))}
              </ul>
            )}
          </Section>

          {(detail.parent || detail.children.length > 0) && (
            <Section title={detail.parent ? "Parent ticket" : `Child tickets (${detail.children.filter((c) => !["solved", "closed", "ignored"].includes(c.crm_status)).length} open)`} action={!detail.parent && !readOnly && <SmallBtn onClick={() => setDialog({ kind: "child" })}><Plus className="h-3 w-3" />Child</SmallBtn>}>
              <ul className="space-y-1">
                {(detail.parent ? [detail.parent] : detail.children).map((c) => (
                  <li key={c.id} className="flex items-center gap-1.5 text-[12px]">
                    <GitBranch className="h-3 w-3 shrink-0 text-text-3" />
                    <Link href={openTicket(c.id)} className="min-w-0 flex-1 truncate text-link hover:underline">#{c.number} {c.subject}</Link>
                    <StatusBadge status={c.crm_status} />
                  </li>
                ))}
              </ul>
              {!detail.parent && detail.children.some((c) => !["solved", "closed", "ignored"].includes(c.crm_status)) && <p className="mt-1 text-[11.5px] text-text-3">This ticket stays open until all child tickets are closed.</p>}
            </Section>
          )}

          <Section title="Classification & fields">
            {props.fieldDefs.length || props.tree.length ? (
              <FieldsPanel brand={brand.id} ticketId={t.id} defs={props.fieldDefs} tree={props.tree} values={detail.fields.values} classificationIds={detail.fields.classificationIds} disabled={editDisabled} />
            ) : (
              <p className="text-[12px] text-text-3">No classification or custom fields defined yet. <Link href={`/cx/settings/fields?brand=${brand.id}`} className="text-link hover:underline">Set them up →</Link></p>
            )}
          </Section>

          {props.signals && (
            <Section title="Signals">
              <KeyValue label="Predicted CSAT">{props.signals.csat.known ? `${props.signals.csat.value.toFixed(1)} / 5` : "n/a"}</KeyValue>
              <KeyValue label="Churn risk"><Badge tone={props.signals.churn.level === "high" ? "critical" : props.signals.churn.level === "medium" ? "warning" : "good"}>{props.signals.churn.level} · {props.signals.churn.score}</Badge></KeyValue>
              <KeyValue label="Escalation likelihood"><Badge tone={props.signals.escalation.level === "high" ? "critical" : props.signals.escalation.level === "medium" ? "warning" : "good"}>{props.signals.escalation.level} · {props.signals.escalation.score}</Badge></KeyValue>
              {[...props.signals.churn.reasons, ...props.signals.escalation.reasons].length > 0 && <p className="mt-1 text-[11.5px] text-text-3">{[...new Set([...props.signals.churn.reasons, ...props.signals.escalation.reasons])].slice(0, 4).join(" · ")}</p>}
            </Section>
          )}

          <Section title="SLA">
            <SlaClockRow label="First response" c={sla.firstResponse} />
            <SlaClockRow label="Resolution" c={sla.resolution} />
            {t.first_response_at && <KeyValue label="Responded">{dateTimeLabel(t.first_response_at)}</KeyValue>}
          </Section>

          {ai && (
            <Section title="AI summary" action={<SmallBtn onClick={async () => { setBusy("sum"); const r = await summarizeAction(brand.id, t.id); setBusy(null); if (r.ok) setSummary(r.data ?? "No summary returned."); else setError(r.error); }}><Sparkles className="h-3 w-3" />{busy === "sum" ? "Working…" : summary ? "Refresh" : "Summarise"}</SmallBtn>}>
              {summary ? <p className="text-[12.5px] whitespace-pre-wrap text-text">{summary}</p> : <p className="text-[12px] text-text-3">Summarise the thread: issue, actions so far, next step.</p>}
            </Section>
          )}

          <Section title="Details">
            <KeyValue label="CSAT">{t.csat == null ? <span className="text-text-3">not rated</span> : `${t.csat} / 5`}</KeyValue>
            <KeyValue label="Sentiment"><SentimentBadge sentiment={t.sentiment} /></KeyValue>
            <KeyValue label="Intent">{t.intent ? INTENTS[t.intent] ?? t.intent : "n/a"}</KeyValue>
            <KeyValue label="Language">{t.language?.toUpperCase() ?? "n/a"}</KeyValue>
            <KeyValue label="Created"><Ago iso={t.created_at} /></KeyValue>
            {(t as unknown as { reopen_count?: number }).reopen_count ? <KeyValue label="Reopened">{(t as unknown as { reopen_count: number }).reopen_count}×</KeyValue> : null}
            {detail.chat?.pageUrl && <KeyValue label="Chat page"><span className="block max-w-[160px] truncate" title={detail.chat.pageUrl}>{detail.chat.pageUrl.replace(/^https?:\/\//, "")}</span></KeyValue>}
          </Section>

          {detail.emails.length > 0 && (
            <Section title="Emails from this ticket">
              <ul className="space-y-1.5">
                {detail.emails.map((e) => (
                  <li key={e.id} className="text-[12px]">
                    <div className="flex items-center gap-1"><Badge tone={e.status === "failed" ? "critical" : e.kind === "escalate" ? "serious" : "neutral"}>{e.kind === "escalate" ? "Escalated" : e.kind === "forward" ? "Forwarded" : "Composed"}</Badge><Ago iso={e.created_at} className="text-text-3" /></div>
                    <div className="truncate text-text-2" title={e.to_addrs.join(", ")}>to {e.to_addrs.join(", ")}</div>
                    {e.status === "failed" && <div className="text-critical-ink">{e.error}</div>}
                  </li>
                ))}
              </ul>
            </Section>
          )}

          <Section title="Customer">
            <div className="flex items-center gap-2 py-1">
              <Avatar name={t.contact_name || t.contact_email || "?"} />
              <div className="min-w-0 text-[12.5px]">
                {t.contact_id ? <Link href={`/cx/contacts/${t.contact_id}?brand=${brand.id}`} className="block truncate font-medium text-link hover:underline">{t.contact_name || "Unnamed"}</Link> : <span>Unknown</span>}
                <div className="truncate text-text-3">{t.contact_email ?? (t as unknown as { contact_phone?: string }).contact_phone ?? ""}</div>
              </div>
            </div>
            {(detail.related ?? []).length > 0 && (
              <ul className="mt-1 space-y-1">
                {(detail.related ?? []).map((r) => (
                  <li key={r.id} className="flex items-center gap-1.5 text-[12px]">
                    <ChannelIcon kind={r.channel_kind} className="text-text-3" />
                    <Link href={openTicket(r.id)} className="min-w-0 flex-1 truncate text-link hover:underline">#{r.number} {r.subject}</Link>
                    <span className="text-text-3">{statusLabel(r.status)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          {(detail.events ?? []).length > 0 && (
            <Section title="Activity">
              <ul className="space-y-1.5">
                {(detail.events ?? []).slice(-15).reverse().map((e) => (
                  <li key={e.id} className="text-[12px] text-text-2"><span className="font-medium text-text">{e.actor}</span> {e.detail} <Ago iso={e.created_at} className="text-text-3" /></li>
                ))}
              </ul>
            </Section>
          )}
        </aside>
      </div>

      {dialog?.kind === "reminder" && <ReminderDialog brand={brand.id} ticketId={t.id} agents={agents} me={me} existing={dialog.existing} onClose={() => setDialog(null)} />}
      {dialog && (dialog.kind === "escalate" || dialog.kind === "forward" || dialog.kind === "compose") && <EmailDialog brand={brand.id} kind={dialog.kind} detail={detail} suggestions={props.emailSuggestions} settings={settings} hasEmail={props.hasEmail} hasSignature={props.hasSignature} onClose={() => setDialog(null)} />}
      {dialog?.kind === "assign" && <AssignDialog brand={brand.id} detail={detail} agents={agents} me={me} onClose={() => setDialog(null)} />}
      {dialog?.kind === "child" && <ChildDialog brand={brand.id} detail={detail} agents={agents} onClose={() => setDialog(null)} onCreated={(id) => { setDialog(null); router.push(openTicket(id)); }} />}
      {dialog?.kind === "parent" && <ParentDialog brand={brand.id} detail={detail} onClose={() => setDialog(null)} />}
      {dialog?.kind === "task" && <TaskDialog brand={brand.id} agents={agents} tree={props.tree} me={me} ticket={dialog.existing ? null : { id: t.id, number: t.number, subject: t.subject }} existing={dialog.existing ?? null} onClose={() => setDialog(null)} />}
      {dialog?.kind === "merge" && <MergeDialog brand={brand.id} detail={detail} onClose={() => setDialog(null)} onDone={() => { setDialog(null); router.refresh(); }} />}
    </div>
  );
}

// ---------------------------------------------------------------- messages

function Body({ text }: { text: string }) {
  return <>{linkSegments(text).map((s, i) => (s.href ? <a key={i} href={s.href} target="_blank" rel="noreferrer noopener" className="text-link underline">{s.text}</a> : <span key={i}>{s.text}</span>))}</>;
}

function Message({ m, align, brand, ai, lang, collapsible, defaultOpen, replyTo, mentionNames, onReply, bookmarked, onBookmark, onModerate }: { m: Item; align: "split" | "left"; brand: string; ai: boolean; lang: string; collapsible: boolean; defaultOpen: boolean; replyTo: MessageRow | null; mentionNames: string[]; onReply?: () => void; bookmarked?: boolean; onBookmark?: () => void; onModerate?: (action: "hide" | "unhide" | "delete") => void }) {
  const [open, setOpen] = useState(defaultOpen);
  const [tr, setTr] = useState<string | null>(null);
  const [trBusy, setTrBusy] = useState(false);
  const out = m.direction === "out", note = m.direction === "note";
  const right = align === "split" && (out || note);
  if (collapsible && !open)
    return (
      <button type="button" onClick={() => setOpen(true)} className="flex w-full items-center gap-2 rounded-lg border border-border bg-surface px-3 py-2 text-left hover:bg-surface-2">
        <ChevronRight className="h-3.5 w-3.5 shrink-0 text-text-3" />
        <span className="shrink-0 text-[12.5px] font-medium text-text">{m.author_name || (out ? "Agent" : "Customer")}</span>
        <span className="min-w-0 flex-1 truncate text-[12.5px] text-text-3">{m.body.replace(/\s+/g, " ").slice(0, 160)}</span>
        {(m.attachments ?? []).length > 0 && <Paperclip className="h-3 w-3 shrink-0 text-text-3" />}
        <time className="shrink-0 text-[11.5px] text-text-3" suppressHydrationWarning>{dateTimeLabel(m.created_at)}</time>
      </button>
    );
  return (
    <div className={cn("flex gap-2", right ? "justify-end" : "justify-start")}>
      <div className={cn("min-w-0 rounded-lg border px-3 py-2", collapsible ? "w-full" : "max-w-[85%]", note ? "border-warning/40 bg-warning-soft" : out ? "border-link/20 bg-brand-soft" : "border-border bg-surface")}>
        <div className="mb-0.5 flex flex-wrap items-center gap-x-2 text-[11.5px] text-text-3">
          {collapsible && <button type="button" onClick={() => setOpen(false)} className="-ml-1 rounded p-0.5 hover:bg-surface-3" aria-label="Collapse"><ChevronDown className="h-3.5 w-3.5" /></button>}
          <span className="font-medium text-text-2">{m.author_name || (out ? "Agent" : "Customer")}</span>
          {note && <span className="inline-flex items-center gap-0.5 text-warning-ink"><Lock className="h-3 w-3" />{m.from_ticket ? `Note from #${m.from_ticket}` : "Private"}</span>}
          <time title={dateTimeLabel(m.created_at)} suppressHydrationWarning>{dateTimeLabel(m.created_at)}</time>
          {onBookmark && <button type="button" onClick={onBookmark} className={cn("inline-flex items-center gap-0.5 hover:underline", bookmarked ? "text-link" : "text-text-3")} aria-label={bookmarked ? "Remove message bookmark" : "Bookmark message"} title={bookmarked ? "Bookmarked" : "Bookmark this message"}>{bookmarked ? <BookmarkCheck className="h-3 w-3" /> : <Bookmark className="h-3 w-3" />}{bookmarked ? "Saved" : ""}</button>}
          {onReply && <button type="button" onClick={onReply} className="inline-flex items-center gap-0.5 text-link hover:underline"><CornerDownRight className="h-3 w-3" />Reply to this</button>}
          {m.moderation === "hidden" && <span className="rounded bg-warning-soft px-1 text-warning-ink">Hidden on the platform</span>}
          {m.moderation === "deleted" && <span className="rounded bg-critical-soft px-1 text-critical-ink">Deleted on the platform</span>}
          {onModerate && <button type="button" onClick={() => onModerate(m.moderation === "hidden" ? "unhide" : "hide")} className="text-link hover:underline" title="Hide or show this comment for everyone except its author and their friends">{m.moderation === "hidden" ? "Unhide" : "Hide"}</button>}
          {onModerate && <button type="button" onClick={() => onModerate("delete")} className="text-critical-ink hover:underline">Delete</button>}
          {ai && m.direction === "in" && (
            <button type="button" disabled={trBusy} onClick={async () => { if (tr) return setTr(null); setTrBusy(true); const r = await translateMessageAction(brand, m.id, lang); setTrBusy(false); setTr(r.ok ? r.data ?? "No translation returned." : r.error); }} className="inline-flex items-center gap-0.5 text-link hover:underline">
              <Languages className="h-3 w-3" />{trBusy ? "Translating…" : tr ? "Hide translation" : `Translate`}
            </button>
          )}
        </div>
        {replyTo && <div className="mb-1 border-l-2 border-border-strong pl-2 text-[12px] text-text-3">↪ {replyTo.author_name}: {replyTo.body.slice(0, 100)}</div>}
        <div className="text-[13.5px] break-words whitespace-pre-wrap text-text [overflow-wrap:anywhere]">{m.body ? <Body text={m.body} /> : <span className="text-text-3 italic">(no text)</span>}</div>
        {tr && <div className="mt-1.5 border-t border-border pt-1.5 text-[13px] whitespace-pre-wrap text-text-2"><span className="text-[11px] text-text-3 uppercase">{lang}</span><br />{tr}</div>}
        {mentionNames.length > 0 && <div className="mt-1 text-[11.5px] text-text-3">Notified: {mentionNames.join(", ")}</div>}
        {(m.attachments ?? []).length > 0 && <Attachments list={m.attachments} />}
        {out && (
          <div className={cn("mt-1 flex items-center gap-1 text-[11px]", m.delivery === "failed" ? "text-critical-ink" : m.delivery === "sent" ? "text-good-ink" : "text-text-3")}>
            {m.delivery === "failed" ? <AlertTriangle className="h-3 w-3" /> : m.delivery === "sent" ? <Check className="h-3 w-3" /> : null}
            {m.delivery === "sent" ? `Sent${m.delivery_error ? ` — ${m.delivery_error}` : ""}` : m.delivery === "failed" ? `Failed: ${m.delivery_error ?? ""}` : `Stored only${m.delivery_error ? ` — ${m.delivery_error}` : ""}`}
          </div>
        )}
      </div>
    </div>
  );
}

function Attachments({ list }: { list: Attachment[] }) {
  return (
    <div className="mt-1.5 flex flex-wrap gap-1.5">
      {list.map((a, i) =>
        a.url && a.type?.startsWith("image/") ? (
          <a key={i} href={a.url} target="_blank" rel="noreferrer" className="block overflow-hidden rounded border border-border bg-surface" title={a.name}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={a.url} alt={a.name ?? "image"} className="h-20 max-w-[160px] object-cover" loading="lazy" />
          </a>
        ) : (
          <span key={i} className="inline-flex items-center gap-1 rounded border border-border bg-surface px-1.5 py-0.5 text-[11.5px] text-text-2">
            {a.url ? <FileText className="h-3 w-3" /> : <Paperclip className="h-3 w-3" />}
            {a.url ? <a href={a.url} target="_blank" rel="noreferrer" className="text-link">{a.name ?? a.type}</a> : a.name ?? a.type}
            {a.size ? ` · ${fmtSize(a.size)}` : ""}
          </span>
        ),
      )}
    </div>
  );
}

// ---------------------------------------------------------------- sidebar bits

function Prop({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={className}>
      <div className="mb-1 text-[11.5px] font-medium tracking-wide text-text-3 uppercase">{label}</div>
      {children}
    </div>
  );
}
function Section({ title, children, action }: { title: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="mt-3 border-t border-border pt-2.5">
      <div className="mb-1 flex items-center justify-between gap-2"><span className="text-[11.5px] font-medium tracking-wide text-text-3 uppercase">{title}</span>{action}</div>
      {children}
    </div>
  );
}
const SmallBtn = ({ onClick, children }: { onClick: () => void; children: React.ReactNode }) => <button type="button" onClick={onClick} className="inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[11.5px] text-link hover:bg-surface-3">{children}</button>;

function TeamInput({ value, teams, onSave, disabled }: { value: string | null; teams: string[]; onSave: (v: string | null) => void; disabled?: boolean }) {
  const [v, setV] = useState(value ?? "");
  useEffect(() => setV(value ?? ""), [value]);
  return (
    <form onSubmit={(e) => { e.preventDefault(); if ((v.trim() || null) !== value) onSave(v.trim() || null); }}>
      <Input list="cx-teams" disabled={disabled} value={v} onChange={(e) => setV(e.target.value)} onBlur={() => { if ((v.trim() || null) !== value) onSave(v.trim() || null); }} placeholder="No team" className="h-8 text-[12.5px]" aria-label="Team" />
      <datalist id="cx-teams">{teams.map((t) => <option key={t} value={t} />)}</datalist>
    </form>
  );
}

function TagEditor({ tags, onAdd, onRemove, disabled }: { tags: string[]; onAdd: (t: string) => void; onRemove: (t: string) => void; disabled?: boolean }) {
  const [v, setV] = useState("");
  return (
    <div className="flex flex-wrap items-center gap-1">
      {(tags ?? []).map((t, i) => (
        <span key={`${t}-${i}`} className="inline-flex items-center gap-0.5 rounded bg-surface-3 py-0.5 pr-0.5 pl-1.5 text-[12px] text-text-2">
          {t}{!disabled && <button onClick={() => onRemove(t)} className="rounded p-0.5 hover:bg-surface-2 hover:text-text" aria-label={`Remove tag ${t}`}><X className="h-3 w-3" /></button>}
        </span>
      ))}
      {!disabled && (
        <form onSubmit={(e) => { e.preventDefault(); if (v.trim()) { onAdd(v.trim()); setV(""); } }}>
          <Input value={v} onChange={(e) => setV(e.target.value)} placeholder="+ add tag" className="h-7 w-24 text-[12px]" aria-label="Add tag" />
        </form>
      )}
    </div>
  );
}

function MergeDialog({ brand, detail, onClose, onDone }: { brand: string; detail: TicketDetail; onClose: () => void; onDone: () => void }) {
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [numbers, setNumbers] = useState("");
  const [error, setError] = useState<string | null>(null);
  const candidates = (detail.related ?? []).filter((r) => r.status !== "closed");
  return (
    <Dialog open onClose={onClose} title={`Merge into #${detail.ticket.number}`} description="Messages of the selected tickets move into this ticket; those tickets are closed and tagged “merged”."
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" onClick={async () => {
        const nums = numbers.split(/[\s,#]+/).map(Number).filter((n) => Number.isInteger(n) && n > 0);
        const r = await mergeAction(brand, detail.ticket.id, [...picked], nums);
        if (r.ok) onDone(); else setError(r.error);
      }}><Send className="h-3.5 w-3.5" />Merge</Button></>}>
      <div className="space-y-3 text-[13px]">
        {candidates.length > 0 ? (
          <div>
            <div className="mb-1 text-text-2">Other open tickets from this customer</div>
            {candidates.map((r) => (
              <label key={r.id} className="flex items-center gap-2 py-1">
                <Checkbox checked={picked.has(r.id)} onChange={(e) => setPicked((s) => { const n = new Set(s); if (e.target.checked) n.add(r.id); else n.delete(r.id); return n; })} />
                <ChannelIcon kind={r.channel_kind} className="text-text-3" />#{r.number} {r.subject} <span className="text-text-3">({statusLabel(r.status)})</span>
              </label>
            ))}
          </div>
        ) : <p className="text-text-3">This customer has no other open tickets.</p>}
        <div>
          <label className="mb-1 block text-text-2" htmlFor="merge-n">Or ticket numbers</label>
          <Input id="merge-n" value={numbers} onChange={(e) => setNumbers(e.target.value)} placeholder="e.g. 12, 15" />
        </div>
        {error && <Callout tone="critical">{error}</Callout>}
      </div>
    </Dialog>
  );
}
