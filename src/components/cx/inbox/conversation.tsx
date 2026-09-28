"use client";

import { AlertTriangle, ArrowLeft, Check, ExternalLink, Eye, GitMerge, Lock, MessageSquareText, Paperclip, Send, Sparkles, StickyNote, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { cannedUsedAction, mergeAction, replyAction, suggestReplyAction, updateTicketsAction } from "@/app/(app)/cx/inbox/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, Menu } from "@/components/ui/dialog";
import { Callout } from "@/components/ui/feedback";
import { Checkbox, Input, Select, Textarea } from "@/components/ui/input";
import type { MessageRow, Status, TicketDetail } from "@/lib/cx/inbox/store";
import { slaStatus } from "@/lib/cx/inbox/sla";
import { dateTimeLabel } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { InboxProps } from "./inbox-client";
import { Ago, SlaClockRow, useNow } from "./time";
import { Avatar, ChannelIcon, channelLabel, KeyValue, SentimentBadge, statusLabel, StatusBadge } from "./ui";

type Props = InboxProps & { detail: TicketDetail; backHref: string };
const SENDS = new Set(["email", "livechat", "webform"]);
const INTENTS: Record<string, string> = { complaint: "Complaint", query: "Query", feedback: "Feedback", praise: "Praise", purchase: "Purchase intent", cancellation: "Cancellation / churn risk", spam: "Spam", other: "Other" };

/** Template placeholders, mirrored from store.fillTemplate (client-side preview). */
function fill(body: string, v: { name?: string | null; ticket: number; brand: string; agent: string }) {
  const first = (v.name ?? "").trim().split(/\s+/)[0] ?? "";
  return body.replace(/\{\{\s*first_name\s*\}\}/g, first || "there").replace(/\{\{\s*name\s*\}\}/g, v.name?.trim() || "there").replace(/\{\{\s*ticket\s*\}\}/g, `#${v.ticket}`).replace(/\{\{\s*brand\s*\}\}/g, v.brand).replace(/\{\{\s*agent\s*\}\}/g, v.agent);
}

export function Conversation({ brand, me, detail, backHref, agents, teams, canned, ai }: Props) {
  const router = useRouter();
  const t = detail.ticket;
  const [mode, setMode] = useState<"reply" | "note">("reply");
  const [text, setText] = useState("");
  const [sendStatus, setSendStatus] = useState<Status | "">("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [aiNote, setAiNote] = useState<string | null>(null);
  const [live, setLive] = useState<{ viewers: { name: string; typing: boolean }[]; visitorOnline: boolean | null; visitorTyping: boolean }>({ viewers: [], visitorOnline: null, visitorTyping: false });
  const [mergeOpen, setMergeOpen] = useState(false);
  const lastTyped = useRef(0);
  const threadRef = useRef<HTMLDivElement>(null);
  const version = `${t.updated_at}|${(detail.messages ?? []).length}`;
  const now = useNow(15_000);
  const sla = slaStatus(t, now);
  const canSend = SENDS.has(t.channel_kind) || ["whatsapp", "facebook", "instagram"].includes(t.channel_kind);

  // Poll: presence heartbeat (collision indicator), visitor typing, and new messages → refresh.
  useEffect(() => {
    let stop = false;
    const tick = async () => {
      if (document.visibilityState !== "visible") return;
      try {
        const r = await fetch(`/api/cx/inbox/${t.id}?brand=${brand.id}${Date.now() - lastTyped.current < 5000 ? "&typing=1" : ""}`, { cache: "no-store" });
        if (!r.ok || stop) return;
        const d = (await r.json()) as { version: string; viewers: { name: string; typing: boolean }[]; visitorOnline: boolean | null; visitorTyping: boolean };
        setLive({ viewers: d.viewers, visitorOnline: d.visitorOnline, visitorTyping: d.visitorTyping });
        if (d.version !== version) router.refresh();
      } catch {}
    };
    tick();
    const iv = setInterval(tick, 4000);
    return () => { stop = true; clearInterval(iv); };
  }, [t.id, brand.id, version, router]);

  useEffect(() => {
    threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight });
  }, [detail.messages?.length]);

  const patch = async (p: Parameters<typeof updateTicketsAction>[2]) => {
    setError(null);
    const r = await updateTicketsAction(brand.id, [t.id], p);
    if (!r.ok) setError(r.error);
    router.refresh();
  };
  const send = async () => {
    if (!text.trim()) return;
    setBusy("send"); setError(null); setNotice(null);
    const r = await replyAction(brand.id, t.id, text, mode === "note", sendStatus || null);
    setBusy(null);
    if (!r.ok) return setError(r.error);
    if (r.data.delivery === "failed") setError(`Not delivered: ${r.data.note}`);
    else if (r.data.note) setNotice(r.data.note);
    setText(""); setSendStatus("");
    router.refresh();
  };
  const suggest = async () => {
    setBusy("ai"); setAiNote(null);
    const r = await suggestReplyAction(brand.id, t.id);
    setBusy(null);
    if (!r.ok) return setError(r.error);
    if (!r.data) setAiNote("The AI provider returned no suggestion.");
    else { setMode("reply"); setText(r.data); }
  };
  const vars = { name: t.contact_name, ticket: t.number, brand: brand.name, agent: me.name };
  const others = live.viewers;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* header */}
      <div className="flex flex-wrap items-start gap-2 border-b border-border px-4 py-3">
        <Link href={backHref} scroll={false} className="-ml-1 rounded p-1 text-text-3 hover:bg-surface-3 lg:hidden" aria-label="Back to list"><ArrowLeft className="h-4 w-4" /></Link>
        <div className="min-w-0 flex-1">
          <h2 className="text-[15px] font-semibold break-words text-text"><span className="font-normal text-text-3">#{t.number}</span> {t.subject}</h2>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12.5px] text-text-2">
            <span className="inline-flex items-center gap-1"><ChannelIcon kind={t.channel_kind} />{t.channel_name ?? channelLabel(t.channel_kind)}</span>
            <span>·</span>
            {t.contact_id ? <Link href={`/cx/contacts/${t.contact_id}?brand=${brand.id}`} className="text-link hover:underline">{t.contact_name || t.contact_email}</Link> : <span>Unknown contact</span>}
            {t.contact_email && t.contact_name && <span className="text-text-3">{t.contact_email}</span>}
            {(detail.mentions ?? []).map((m) => m.url && (
              <a key={m.id} href={m.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 text-link hover:underline">View mention<ExternalLink className="h-3 w-3" /></a>
            ))}
            {live.visitorOnline != null && <Badge tone={live.visitorOnline ? "good" : "neutral"}>{live.visitorOnline ? "Visitor online" : "Visitor away"}</Badge>}
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <StatusBadge status={t.status} />
          <Button size="sm" variant="ghost" onClick={() => setMergeOpen(true)}><GitMerge className="h-3.5 w-3.5" />Merge</Button>
          {!["solved", "closed"].includes(t.status) ? <Button size="sm" onClick={() => patch({ status: "solved" })}><Check className="h-3.5 w-3.5" />Solve</Button> : <Button size="sm" onClick={() => patch({ status: "open" })}>Reopen</Button>}
        </div>
        {others.length > 0 && (
          <div className="flex w-full items-center gap-1.5 rounded-md bg-warning-soft px-2.5 py-1.5 text-[12.5px] text-warning-ink">
            <Eye className="h-3.5 w-3.5" />
            {others.map((o) => `${o.name} is ${o.typing ? "typing a reply" : "viewing"}`).join(" · ")} — coordinate before replying.
          </div>
        )}
      </div>

      <div className="flex min-h-0 flex-1 flex-col xl:flex-row">
        {/* thread + composer */}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <div ref={threadRef} className="scroll-thin min-h-[240px] flex-1 space-y-3 overflow-y-auto bg-bg px-4 py-4">
            {(detail.messages ?? []).map((m) => <Message key={m.id} m={m} />)}
            {live.visitorTyping && <div className="text-[12px] text-text-3 italic">Visitor is typing…</div>}
          </div>

          <div className="border-t border-border bg-surface p-3">
            <div className="mb-2 flex flex-wrap items-center gap-1">
              <button onClick={() => setMode("reply")} className={cn("inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-[12.5px]", mode === "reply" ? "bg-brand-soft font-medium text-link" : "text-text-2 hover:bg-surface-3")}><MessageSquareText className="h-3.5 w-3.5" />Reply</button>
              <button onClick={() => setMode("note")} className={cn("inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-[12.5px]", mode === "note" ? "bg-warning-soft font-medium text-warning-ink" : "text-text-2 hover:bg-surface-3")}><StickyNote className="h-3.5 w-3.5" />Internal note</button>
              <div className="ml-auto flex items-center gap-1">
                <CannedPicker canned={canned} onPick={(c) => { setText((x) => (x ? `${x}\n\n` : "") + fill(c.body, vars)); cannedUsedAction(brand.id, c.id); }} brand={brand.id} />
                {ai ? (
                  <Button size="sm" variant="ghost" onClick={suggest} disabled={busy === "ai"}><Sparkles className="h-3.5 w-3.5" />{busy === "ai" ? "Thinking…" : "Suggest reply"}</Button>
                ) : (
                  <span className="hidden items-center gap-1 px-1 text-[11.5px] text-text-3 sm:inline-flex" title="Set ANTHROPIC_API_KEY or OPENAI_API_KEY on the server"><Sparkles className="h-3.5 w-3.5" />Connect an AI key for suggested replies</span>
                )}
              </div>
            </div>
            {mode === "reply" && !canSend && <p className="mb-2 text-[12px] text-text-3">{channelLabel(t.channel_kind)} has no reply integration: your reply is saved on this ticket only (marked “stored”). Respond on the original post{(detail.mentions ?? []).some((m) => m.url) ? " via View mention" : ""}.</p>}
            {mode === "reply" && t.channel_kind === "webform" && <p className="mb-2 text-[12px] text-text-3">Web form replies go by email to {t.contact_email ?? "the customer"} through your email channel.</p>}
            <Textarea
              value={text}
              onChange={(e) => { setText(e.target.value); lastTyped.current = Date.now(); }}
              onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); send(); } }}
              rows={4}
              placeholder={mode === "note" ? "Internal note — only your team sees this" : `Reply to ${t.contact_name || "the customer"}…  (⌘/Ctrl + Enter to send)`}
              className={cn("text-[13.5px]", mode === "note" && "bg-warning-soft/40")}
              aria-label={mode === "note" ? "Internal note" : "Reply"}
            />
            {aiNote && <p className="mt-1 text-[12px] text-text-3">{aiNote}</p>}
            {error && <Callout tone="critical" className="mt-2">{error}</Callout>}
            {notice && <Callout tone="warning" className="mt-2">{notice}</Callout>}
            <div className="mt-2 flex flex-wrap items-center justify-end gap-2">
              {mode === "reply" && (
                <Select value={sendStatus} onChange={(e) => setSendStatus(e.target.value as Status | "")} className="h-8 w-auto text-[12.5px]" aria-label="Status after sending">
                  <option value="">Keep status ({statusLabel(t.status === "new" ? "open" : t.status)})</option>
                  <option value="pending">Set pending</option>
                  <option value="on_hold">Set on hold</option>
                  <option value="solved">Set solved</option>
                </Select>
              )}
              <Button variant="primary" onClick={send} disabled={busy === "send" || !text.trim()}>
                {mode === "note" ? <><Lock className="h-3.5 w-3.5" />Add note</> : <><Send className="h-3.5 w-3.5" />{busy === "send" ? "Sending…" : "Send"}</>}
              </Button>
            </div>
          </div>
        </div>

        {/* properties */}
        <aside className="scroll-thin border-t border-border bg-surface px-4 py-3 xl:w-[290px] xl:shrink-0 xl:overflow-y-auto xl:border-t-0 xl:border-l" aria-label="Ticket properties">
          <div className="grid grid-cols-2 gap-2 xl:grid-cols-1">
            <Prop label="Status">
              <Select value={t.status} onChange={(e) => patch({ status: e.target.value as Status })} className="h-8 text-[12.5px]" aria-label="Status">
                {["new", "open", "pending", "on_hold", "solved", "closed"].map((s) => <option key={s} value={s}>{statusLabel(s)}</option>)}
              </Select>
            </Prop>
            <Prop label="Priority">
              <Select value={t.priority} onChange={(e) => patch({ priority: e.target.value as typeof t.priority })} className="h-8 text-[12.5px]" aria-label="Priority">
                {["urgent", "high", "normal", "low"].map((s) => <option key={s} value={s}>{s[0].toUpperCase() + s.slice(1)}</option>)}
              </Select>
            </Prop>
            <Prop label="Assignee">
              <Select value={t.assignee_id ?? ""} onChange={(e) => patch({ assignee_id: e.target.value || null })} className="h-8 text-[12.5px]" aria-label="Assignee">
                <option value="">Unassigned</option>
                {agents.map((a) => <option key={a.id} value={a.id}>{a.id === me.id ? `${a.name} (me)` : a.name}</option>)}
              </Select>
            </Prop>
            <Prop label="Team">
              <TeamInput value={t.team} teams={teams} onSave={(v) => patch({ team: v })} />
            </Prop>
          </div>
          <Prop label="Tags" className="mt-2">
            <TagEditor tags={t.tags ?? []} onAdd={(v) => patch({ addTags: [v] })} onRemove={(v) => patch({ removeTags: [v] })} />
          </Prop>

          <Section title="SLA">
            <SlaClockRow label="First response" c={sla.firstResponse} />
            <SlaClockRow label="Resolution" c={sla.resolution} />
            {t.first_response_at && <KeyValue label="Responded">{dateTimeLabel(t.first_response_at)}</KeyValue>}
          </Section>

          <Section title="Details">
            <KeyValue label="CSAT">{t.csat == null ? <span className="text-text-3">not rated</span> : `${t.csat} / 5`}</KeyValue>
            <KeyValue label="Sentiment"><SentimentBadge sentiment={t.sentiment} /></KeyValue>
            <KeyValue label="Intent">{t.intent ? INTENTS[t.intent] ?? t.intent : "n/a"}</KeyValue>
            <KeyValue label="Language">{t.language?.toUpperCase() ?? "n/a"}</KeyValue>
            <KeyValue label="Created"><Ago iso={t.created_at} /></KeyValue>
            {detail.chat?.pageUrl && <KeyValue label="Chat page"><span className="block max-w-[160px] truncate" title={detail.chat.pageUrl}>{detail.chat.pageUrl.replace(/^https?:\/\//, "")}</span></KeyValue>}
          </Section>

          <Section title="Customer">
            <div className="flex items-center gap-2 py-1">
              <Avatar name={t.contact_name || t.contact_email || "?"} />
              <div className="min-w-0 text-[12.5px]">
                {t.contact_id ? <Link href={`/cx/contacts/${t.contact_id}?brand=${brand.id}`} className="block truncate font-medium text-link hover:underline">{t.contact_name || "Unnamed"}</Link> : <span>Unknown</span>}
                <div className="truncate text-text-3">{t.contact_email ?? t.contact_phone ?? ""}</div>
              </div>
            </div>
            {(detail.related ?? []).length > 0 && (
              <ul className="mt-1 space-y-1">
                {(detail.related ?? []).map((r) => (
                  <li key={r.id} className="flex items-center gap-1.5 text-[12px]">
                    <ChannelIcon kind={r.channel_kind} className="text-text-3" />
                    <Link href={`/cx/inbox?brand=${brand.id}&view=all&t=${r.id}`} className="min-w-0 flex-1 truncate text-link hover:underline">#{r.number} {r.subject}</Link>
                    <span className="text-text-3">{statusLabel(r.status)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          {(detail.events ?? []).length > 0 && (
            <Section title="Activity">
              <ul className="space-y-1.5">
                {(detail.events ?? []).slice(-12).reverse().map((e) => (
                  <li key={e.id} className="text-[12px] text-text-2"><span className="font-medium text-text">{e.actor}</span> {e.detail} <Ago iso={e.created_at} className="text-text-3" /></li>
                ))}
              </ul>
            </Section>
          )}
        </aside>
      </div>
      {mergeOpen && <MergeDialog brand={brand.id} detail={detail} onClose={() => setMergeOpen(false)} onDone={() => { setMergeOpen(false); router.refresh(); }} />}
    </div>
  );
}

function Message({ m }: { m: MessageRow }) {
  const out = m.direction === "out", note = m.direction === "note";
  return (
    <div className={cn("flex gap-2", out || note ? "justify-end" : "justify-start")}>
      <div className={cn("max-w-[85%] rounded-lg border px-3 py-2", note ? "border-warning/40 bg-warning-soft" : out ? "border-link/20 bg-brand-soft" : "border-border bg-surface")}>
        <div className="mb-0.5 flex flex-wrap items-center gap-x-2 text-[11.5px] text-text-3">
          <span className="font-medium text-text-2">{m.author_name || (out ? "Agent" : "Customer")}</span>
          {note && <span className="inline-flex items-center gap-0.5 text-warning-ink"><Lock className="h-3 w-3" />Internal note</span>}
          <time title={dateTimeLabel(m.created_at)} suppressHydrationWarning>{dateTimeLabel(m.created_at)}</time>
        </div>
        <div className="text-[13.5px] break-words whitespace-pre-wrap text-text">{m.body || <span className="text-text-3 italic">(no text)</span>}</div>
        {(m.attachments ?? []).length > 0 && (
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {(m.attachments ?? []).map((a, i) => (
              <span key={i} className="inline-flex items-center gap-1 rounded border border-border bg-surface px-1.5 py-0.5 text-[11.5px] text-text-2"><Paperclip className="h-3 w-3" />{a.url ? <a href={a.url} target="_blank" rel="noreferrer" className="text-link">{a.name ?? a.type}</a> : a.name ?? a.type}{a.size ? ` · ${Math.round(a.size / 1024)} KB` : ""}</span>
            ))}
          </div>
        )}
        {out && (
          <div className={cn("mt-1 flex items-center gap-1 text-[11px]", m.delivery === "failed" ? "text-critical-ink" : m.delivery === "sent" ? "text-good-ink" : "text-text-3")}>
            {m.delivery === "failed" ? <AlertTriangle className="h-3 w-3" /> : m.delivery === "sent" ? <Check className="h-3 w-3" /> : null}
            {m.delivery === "sent" ? "Sent" : m.delivery === "failed" ? `Failed: ${m.delivery_error ?? ""}` : `Stored only${m.delivery_error ? ` — ${m.delivery_error}` : ""}`}
          </div>
        )}
      </div>
    </div>
  );
}

function Prop({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={className}>
      <div className="mb-1 text-[11.5px] font-medium tracking-wide text-text-3 uppercase">{label}</div>
      {children}
    </div>
  );
}
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mt-3 border-t border-border pt-2.5">
      <div className="mb-1 text-[11.5px] font-medium tracking-wide text-text-3 uppercase">{title}</div>
      {children}
    </div>
  );
}

function TeamInput({ value, teams, onSave }: { value: string | null; teams: string[]; onSave: (v: string | null) => void }) {
  const [v, setV] = useState(value ?? "");
  useEffect(() => setV(value ?? ""), [value]);
  return (
    <form onSubmit={(e) => { e.preventDefault(); if ((v.trim() || null) !== value) onSave(v.trim() || null); }}>
      <Input list="cx-teams" value={v} onChange={(e) => setV(e.target.value)} onBlur={() => { if ((v.trim() || null) !== value) onSave(v.trim() || null); }} placeholder="No team" className="h-8 text-[12.5px]" aria-label="Team" />
      <datalist id="cx-teams">{teams.map((t) => <option key={t} value={t} />)}</datalist>
    </form>
  );
}

function TagEditor({ tags, onAdd, onRemove }: { tags: string[]; onAdd: (t: string) => void; onRemove: (t: string) => void }) {
  const [v, setV] = useState("");
  return (
    <div className="flex flex-wrap items-center gap-1">
      {(tags ?? []).map((t, i) => (
        <span key={`${t}-${i}`} className="inline-flex items-center gap-0.5 rounded bg-surface-3 py-0.5 pr-0.5 pl-1.5 text-[12px] text-text-2">
          {t}<button onClick={() => onRemove(t)} className="rounded p-0.5 hover:bg-surface-2 hover:text-text" aria-label={`Remove tag ${t}`}><X className="h-3 w-3" /></button>
        </span>
      ))}
      <form onSubmit={(e) => { e.preventDefault(); if (v.trim()) { onAdd(v.trim()); setV(""); } }}>
        <Input value={v} onChange={(e) => setV(e.target.value)} placeholder="+ add tag" className="h-7 w-24 text-[12px]" aria-label="Add tag" />
      </form>
    </div>
  );
}

function CannedPicker({ canned, onPick, brand }: { canned: InboxProps["canned"]; onPick: (c: InboxProps["canned"][number]) => void; brand: string }) {
  const [q, setQ] = useState("");
  const list = useMemo(() => canned.filter((c) => !q || `${c.title} ${c.shortcut} ${c.body}`.toLowerCase().includes(q.toLowerCase())), [canned, q]);
  return (
    <Menu align="right" trigger={() => <span className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-[12.5px] text-text-2 hover:bg-surface-3"><MessageSquareText className="h-3.5 w-3.5" />Canned</span>}>
      {(close) => (
        <div className="w-72 p-1">
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search responses" className="mb-1 h-7 text-[12.5px]" aria-label="Search canned responses" autoFocus />
          <div className="scroll-thin max-h-64 overflow-y-auto">
            {list.map((c) => (
              <button key={c.id} onClick={() => { onPick(c); close(); }} className="block w-full rounded px-2 py-1.5 text-left hover:bg-surface-3">
                <div className="text-[12.5px] font-medium text-text">{c.title}{c.shortcut && <span className="ml-1 font-normal text-text-3">/{c.shortcut}</span>}</div>
                <div className="truncate text-[11.5px] text-text-3">{c.body}</div>
              </button>
            ))}
            {list.length === 0 && <div className="px-2 py-2 text-[12px] text-text-3">No canned responses{canned.length ? " match" : " yet"}.</div>}
          </div>
          <Link href={`/cx/settings/automation?brand=${brand}#canned`} className="mt-1 block border-t border-border px-2 pt-1.5 text-[12px] text-link hover:underline">Manage canned responses →</Link>
        </div>
      )}
    </Menu>
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
      }}>Merge</Button></>}>
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
