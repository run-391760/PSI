"use client";

import { BookOpen, Braces, CornerDownRight, Languages, Link2, Lock, MessageSquareText, Mic, MicOff, Send, Sparkles, SpellCheck, StickyNote, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { aiRewriteAction, cannedUsedAction, replyAction } from "@/app/(app)/cx/inbox/actions";
import { groundedReplyAction } from "@/app/(app)/cx/ask/actions";
import type { KbHit } from "@/lib/cx/insights/kb";
import { Button } from "@/components/ui/button";
import { Dialog, Menu } from "@/components/ui/dialog";
import { Callout } from "@/components/ui/feedback";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import type { FieldDef } from "@/lib/cx/admin/fields";
import { BUILTIN_PLACEHOLDERS, crmLabel, fillTemplate, SETTABLE_STATUSES, type CrmStatus, type InboxSettings } from "@/lib/cx/inbox/model";
import type { Agent, Canned, MessageRow, TicketDetail } from "@/lib/cx/inbox/store";
import { dateTimeLabel } from "@/lib/format";
import { cn } from "@/lib/utils";
import { usePrefs } from "./prefs";
import { AttachButton, PendingFiles, useUploads } from "./ticket-dialogs";
import { channelLabel } from "./ui";

const SENDS = new Set(["email", "livechat", "webform"]);
type Speech = { lang: string; continuous: boolean; interimResults: boolean; start: () => void; stop: () => void; onresult: ((e: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null; onend: (() => void) | null; onerror: (() => void) | null };

export type ComposerProps = {
  brand: { id: string; name: string };
  me: { id: string; name: string };
  detail: TicketDetail;
  agents: Agent[];
  canned: Canned[];
  ai: boolean;
  settings: InboxSettings;
  hasSignature: boolean;
  fieldDefs: FieldDef[];
  disabled: string | null;
  replyTo: MessageRow | null;
  onClearReplyTo: () => void;
  onTyping: () => void;
};

export function Composer(p: ComposerProps) {
  const { brand, me, detail, settings } = p;
  const t = detail.ticket;
  const router = useRouter();
  const { prefs } = usePrefs();
  const [mode, setMode] = useState<"reply" | "note">("reply");
  const [text, setText] = useState("");
  const [status, setStatus] = useState<CrmStatus | "">("");
  const [signature, setSignature] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [linkOpen, setLinkOpen] = useState(false);
  const [mention, setMention] = useState<{ q: string; start: number } | null>(null);
  const [listening, setListening] = useState(false);
  const [sources, setSources] = useState<KbHit[] | null>(null);
  const recRef = useRef<Speech | null>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const uploads = useUploads(brand.id);
  const canSend = SENDS.has(t.channel_kind) || ["whatsapp", "facebook", "instagram", "discord", "discourse", "telegram"].includes(t.channel_kind);
  const isEmail = t.channel_kind === "email" || t.channel_kind === "webform";
  const [speechOk, setSpeechOk] = useState(false);
  useEffect(() => { const w = window as unknown as { SpeechRecognition?: unknown; webkitSpeechRecognition?: unknown }; setSpeechOk(!!(w.SpeechRecognition || w.webkitSpeechRecognition)); }, []);
  useEffect(() => { if (p.replyTo) setMode("reply"); }, [p.replyTo]);
  useEffect(() => () => recRef.current?.stop(), []);

  const vars = { name: t.contact_name, ticket: t.number, brand: brand.name, agent: me.name, fields: detail.fields.values, contact: (t as unknown as { contact_attributes?: Record<string, string> }).contact_attributes ?? {} };
  const insert = (s: string) => {
    const ta = taRef.current;
    if (!ta) return setText((x) => x + s);
    const a = ta.selectionStart ?? text.length, b = ta.selectionEnd ?? text.length;
    const next = text.slice(0, a) + s + text.slice(b);
    setText(next);
    requestAnimationFrame(() => { ta.focus(); ta.setSelectionRange(a + s.length, a + s.length); });
  };
  const mentionList = useMemo(() => (mention ? p.agents.filter((a) => a.id !== me.id && `${a.name} ${a.email}`.toLowerCase().includes(mention.q.toLowerCase())).slice(0, 6) : []), [mention, p.agents, me.id]);
  const pickMention = (a: Agent) => {
    if (!mention) return;
    const end = mention.start + 1 + mention.q.length;
    const next = `${text.slice(0, mention.start)}@${a.name} ${text.slice(end)}`;
    setText(next); setMention(null);
    requestAnimationFrame(() => taRef.current?.focus());
  };
  const needStatus = mode === "reply" && settings.requireStatusOnReply && !status;

  const send = async () => {
    if ((!text.trim() && !uploads.files.length) || busy || p.disabled || uploads.busy) return;
    if (needStatus) return setError("Choose the status to send with this reply.");
    setBusy("send"); setError(null); setNotice(null);
    const r = await replyAction(brand.id, t.id, { body: text, note: mode === "note", status: mode === "reply" ? status || null : null, attachmentIds: uploads.ids, replyToId: mode === "reply" ? p.replyTo?.id ?? null : null, signature: isEmail && p.hasSignature ? signature : false });
    setBusy(null);
    if (!r.ok) return setError(r.error);
    if (r.data.delivery === "failed") setError(`Not delivered: ${r.data.note}`);
    else if (r.data.note) setNotice(r.data.note);
    setText(""); setStatus(""); uploads.clear(); p.onClearReplyTo();
    router.refresh();
  };
  const ai = async (kind: "grammar" | "translate" | "suggest", lang?: string) => {
    setBusy(kind); setError(null);
    if (kind === "suggest") {
      const g = await groundedReplyAction(brand.id, t.id);
      setBusy(null);
      if (!g.ok) return setError(g.error);
      setSources(g.data.sources);
      if (!g.data.text) return setError(g.data.ai ? "The AI provider returned nothing. Try again." : "Connect an AI key to draft replies; related articles are listed below.");
      setText(g.data.text); setMode("reply");
      return;
    }
    const r = await aiRewriteAction(brand.id, kind, text, lang);
    setBusy(null);
    if (!r.ok) return setError(r.error);
    if (!r.data) return setError("The AI provider returned nothing. Try again.");
    setText(r.data);
  };
  const dictate = () => {
    if (listening) { recRef.current?.stop(); return; }
    const W = window as unknown as { SpeechRecognition?: new () => Speech; webkitSpeechRecognition?: new () => Speech };
    const R = W.SpeechRecognition ?? W.webkitSpeechRecognition;
    if (!R) return;
    const rec = new R();
    rec.lang = navigator.language || "en-US"; rec.continuous = true; rec.interimResults = false;
    rec.onresult = (e) => {
      let s = "";
      for (let i = e.resultIndex; i < e.results.length; i++) if (e.results[i].isFinal) s += e.results[i][0].transcript;
      if (s) setText((x) => (x && !/\s$/.test(x) ? `${x} ` : x) + s.trim());
    };
    rec.onend = () => setListening(false);
    rec.onerror = () => { setListening(false); setError("Dictation stopped (microphone permission or no speech detected)."); };
    recRef.current = rec;
    rec.start(); setListening(true);
  };
  const customPlaceholders = p.fieldDefs.filter((d) => d.scope === "ticket" && !d.hidden && !d.encrypted);
  const attrKeys = Object.keys(vars.contact);

  return (
    <div className="border-t border-border bg-surface p-3">
      <div className="mb-2 flex flex-wrap items-center gap-1">
        <button onClick={() => setMode("reply")} className={cn("inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-[12.5px]", mode === "reply" ? "bg-brand-soft font-medium text-link" : "text-text-2 hover:bg-surface-3")}><MessageSquareText className="h-3.5 w-3.5" />Reply</button>
        <button onClick={() => setMode("note")} className={cn("inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-[12.5px]", mode === "note" ? "bg-warning-soft font-medium text-warning-ink" : "text-text-2 hover:bg-surface-3")}><StickyNote className="h-3.5 w-3.5" />Internal note</button>
        <div className="ml-auto flex flex-wrap items-center gap-0.5">
          <AttachButton uploads={uploads} />
          <button type="button" onClick={() => setLinkOpen(true)} className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-[12.5px] text-text-2 hover:bg-surface-3" title="Insert hyperlink"><Link2 className="h-3.5 w-3.5" /><span className="hidden sm:inline">Link</span></button>
          <Menu align="right" trigger={() => <span className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-[12.5px] text-text-2 hover:bg-surface-3" title="Insert placeholder"><Braces className="h-3.5 w-3.5" /><span className="hidden md:inline">Fields</span></span>}>
            {(close) => (
              <div className="scroll-thin max-h-72 w-64 overflow-y-auto p-1 text-[12.5px]">
                <div className="px-2 py-1 text-[11px] font-medium text-text-3 uppercase">Ticket</div>
                {BUILTIN_PLACEHOLDERS.map((x) => <PlaceholderItem key={x.key} label={x.label} code={`{{${x.key}}}`} onPick={(c) => { insert(c); close(); }} />)}
                <div className="px-2 pt-2 pb-1 text-[11px] font-medium text-text-3 uppercase">Custom fields</div>
                {customPlaceholders.length ? customPlaceholders.map((d) => <PlaceholderItem key={d.id} label={d.label} code={`{{field.${d.key}}}`} onPick={(c) => { insert(c); close(); }} />) : <div className="px-2 py-1 text-text-3">None defined yet (Settings → Fields).</div>}
                {attrKeys.length > 0 && <div className="px-2 pt-2 pb-1 text-[11px] font-medium text-text-3 uppercase">Contact attributes</div>}
                {attrKeys.map((k) => <PlaceholderItem key={k} label={k} code={`{{contact.${k}}}`} onPick={(c) => { insert(c); close(); }} />)}
              </div>
            )}
          </Menu>
          <CannedPicker canned={p.canned} brand={brand.id} onPick={(c) => { setText((x) => (x ? `${x}\n\n` : "") + fillTemplate(c.body, vars)); cannedUsedAction(brand.id, c.id); }} />
          <button type="button" onClick={async () => { setBusy("kb"); const g = await groundedReplyAction(brand.id, t.id); setBusy(null); if (g.ok) setSources(g.data.sources); else setError(g.error); }} className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-[12.5px] text-text-2 hover:bg-surface-3" title="Knowledge base articles related to this ticket"><BookOpen className="h-3.5 w-3.5" /><span className="hidden md:inline">{busy === "kb" ? "Searching…" : "KB"}</span></button>
          {speechOk && <button type="button" onClick={dictate} className={cn("inline-flex h-7 items-center gap-1 rounded-md px-2 text-[12.5px] hover:bg-surface-3", listening ? "bg-critical-soft text-critical-ink" : "text-text-2")} title={listening ? "Stop dictation" : "Dictate (speech to text)"}>{listening ? <MicOff className="h-3.5 w-3.5" /> : <Mic className="h-3.5 w-3.5" />}<span className="hidden md:inline">{listening ? "Stop" : "Dictate"}</span></button>}
          {p.ai ? (
            <Menu align="right" trigger={() => <span className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-[12.5px] text-text-2 hover:bg-surface-3"><Sparkles className="h-3.5 w-3.5" />{busy && ["grammar", "translate", "suggest"].includes(busy) ? "Working…" : "AI"}</span>}>
              {(close) => (
                <div className="w-60 p-1 text-[12.5px]">
                  <AiItem icon={<Sparkles className="h-3.5 w-3.5" />} label="Suggest a reply" onClick={() => { close(); ai("suggest"); }} />
                  <AiItem icon={<SpellCheck className="h-3.5 w-3.5" />} label="Fix spelling & grammar" disabled={!text.trim()} onClick={() => { close(); ai("grammar"); }} />
                  <AiItem icon={<Languages className="h-3.5 w-3.5" />} label={`Translate to ${t.language && t.language !== "en" ? `customer language (${t.language.toUpperCase()})` : prefs.translateTo}`} disabled={!text.trim()} onClick={() => { close(); ai("translate", t.language && t.language !== "en" ? `the language with code "${t.language}"` : prefs.translateTo); }} />
                  {["Spanish", "French", "Hindi", "Arabic", "Portuguese"].map((l) => <AiItem key={l} icon={<Languages className="h-3.5 w-3.5 opacity-50" />} label={`Translate to ${l}`} disabled={!text.trim()} onClick={() => { close(); ai("translate", l); }} />)}
                </div>
              )}
            </Menu>
          ) : (
            <span className="hidden items-center gap-1 px-1 text-[11.5px] text-text-3 xl:inline-flex" title="Set ANTHROPIC_API_KEY or OPENAI_API_KEY on the server"><Sparkles className="h-3.5 w-3.5" />Connect an AI key for AI helpers</span>
          )}
        </div>
      </div>
      {p.replyTo && mode === "reply" && (
        <div className="mb-2 flex items-center gap-1.5 rounded-md bg-surface-2 px-2.5 py-1.5 text-[12px] text-text-2">
          <CornerDownRight className="h-3.5 w-3.5 shrink-0" /><span className="min-w-0 flex-1 truncate">Replying to {p.replyTo.author_name || "the customer"}’s email of {dateTimeLabel(p.replyTo.created_at)}: “{p.replyTo.body.slice(0, 80)}”</span>
          <button onClick={p.onClearReplyTo} className="rounded p-0.5 hover:bg-surface-3" aria-label="Cancel reply-to"><X className="h-3.5 w-3.5" /></button>
        </div>
      )}
      {mode === "reply" && !canSend && <p className="mb-2 text-[12px] text-text-3">{channelLabel(t.channel_kind)} has no reply integration: your reply is saved on this ticket only (marked “stored”). Respond on the original post{(detail.mentions ?? []).some((m) => m.url) ? " via View mention" : ""}.</p>}
      {mode === "reply" && t.channel_kind === "webform" && <p className="mb-2 text-[12px] text-text-3">Web form replies go by email to {t.contact_email ?? "the customer"} through your email channel.</p>}
      <div className="relative">
        <Textarea
          ref={taRef}
          value={text}
          disabled={!!p.disabled}
          onChange={(e) => {
            setText(e.target.value);
            p.onTyping();
            const pos = e.target.selectionStart ?? e.target.value.length;
            const m = mode === "note" ? /(^|\s)@([\w.-]{0,30})$/.exec(e.target.value.slice(0, pos)) : null;
            setMention(m ? { q: m[2], start: pos - m[2].length - 1 } : null);
          }}
          onPaste={(e) => {
            const files = [...e.clipboardData.files];
            if (files.length) { e.preventDefault(); uploads.upload(files.map((f, i) => (f.name && f.name !== "image.png" ? f : new File([f], `screenshot-${Date.now()}-${i}.${(f.type.split("/")[1] || "png").replace("jpeg", "jpg")}`, { type: f.type })))); }
          }}
          onKeyDown={(e) => {
            if (mention && mentionList.length && (e.key === "Enter" || e.key === "Tab")) { e.preventDefault(); pickMention(mentionList[0]); return; }
            if (e.key === "Escape") setMention(null);
            if (e.key !== "Enter" || e.nativeEvent.isComposing) return;
            if (e.metaKey || e.ctrlKey || (prefs.enterToSend && !e.shiftKey)) { e.preventDefault(); send(); }
          }}
          rows={4}
          placeholder={p.disabled ? p.disabled : mode === "note" ? "Internal note — only your team sees this. Type @ to mention a teammate." : `Reply to ${t.contact_name || "the customer"}…  (${prefs.enterToSend ? "Enter to send, Shift+Enter for a new line" : "⌘/Ctrl + Enter to send"}; paste screenshots)`}
          className={cn("text-[13.5px]", mode === "note" && "bg-warning-soft/40")}
          aria-label={mode === "note" ? "Internal note" : "Reply"}
        />
        {mention && mentionList.length > 0 && (
          <ul className="absolute bottom-full left-2 z-20 mb-1 w-64 rounded-md border border-border bg-surface p-1 shadow-card" role="listbox" aria-label="Mention a teammate">
            {mentionList.map((a) => (
              <li key={a.id}><button type="button" onMouseDown={(e) => { e.preventDefault(); pickMention(a); }} className="block w-full rounded px-2 py-1 text-left text-[12.5px] hover:bg-surface-3"><span className="font-medium text-text">{a.name}</span> <span className="text-text-3">{a.email}</span></button></li>
            ))}
          </ul>
        )}
      </div>
      <PendingFiles uploads={uploads} />
      {sources && (
        <div className="mt-2 rounded-md border border-border bg-surface-2 px-2.5 py-1.5 text-[12px]">
          <div className="mb-1 flex items-center justify-between text-text-3"><span>Knowledge base sources</span><button onClick={() => setSources(null)} className="rounded p-0.5 hover:bg-surface-3" aria-label="Hide sources"><X className="h-3 w-3" /></button></div>
          {sources.length === 0 ? <p className="text-text-3">No related articles. <Link href={`/cx/knowledge?brand=${brand.id}`} className="text-link hover:underline">Add articles →</Link></p> : (
            <ul className="space-y-1">
              {sources.map((s) => (
                <li key={s.id} className="flex items-start gap-1.5">
                  <BookOpen className="mt-0.5 h-3 w-3 shrink-0 text-text-3" />
                  <span className="min-w-0 flex-1"><a href={s.url} target="_blank" rel="noreferrer" className="font-medium text-link hover:underline">{s.title}</a> <span className="text-text-3">{s.snippet}</span></span>
                  <button type="button" onClick={() => insert(`[${s.title}](${s.url.startsWith("http") ? s.url : `${location.origin}${s.url}`})`)} className="shrink-0 text-link hover:underline">Insert link</button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {error && <Callout tone="critical" className="mt-2">{error}</Callout>}
      {notice && <Callout tone="warning" className="mt-2">{notice}</Callout>}
      <div className="mt-2 flex flex-wrap items-center justify-end gap-2">
        {mode === "reply" && isEmail && p.hasSignature && (
          <label className="mr-auto flex items-center gap-1.5 text-[12px] text-text-2"><input type="checkbox" checked={signature} onChange={(e) => setSignature(e.target.checked)} className="accent-brand" />Signature</label>
        )}
        {mode === "reply" && (
          <Select value={status} onChange={(e) => setStatus(e.target.value as CrmStatus | "")} className={cn("h-8 w-auto text-[12.5px]", needStatus && "border-warning")} aria-label="Status after sending">
            <option value="">{settings.requireStatusOnReply ? "Choose status (required)…" : `Keep status (${crmLabel(t.crm_status === "new" ? "open" : t.crm_status)})`}</option>
            {SETTABLE_STATUSES.filter((s) => s.id !== "new").map((s) => <option key={s.id} value={s.id}>Set {s.label}</option>)}
          </Select>
        )}
        <Button variant="primary" onClick={send} disabled={!!p.disabled || busy === "send" || (!text.trim() && !uploads.files.length) || uploads.busy || needStatus}>
          {mode === "note" ? <><Lock className="h-3.5 w-3.5" />Add note</> : <><Send className="h-3.5 w-3.5" />{busy === "send" ? "Sending…" : "Send"}</>}
        </Button>
      </div>
      {linkOpen && <LinkDialog selected={taRef.current ? text.slice(taRef.current.selectionStart, taRef.current.selectionEnd) : ""} onClose={() => setLinkOpen(false)} onInsert={(s) => { setLinkOpen(false); insert(s); }} />}
    </div>
  );
}

function PlaceholderItem({ label, code, onPick }: { label: string; code: string; onPick: (c: string) => void }) {
  return <button type="button" onClick={() => onPick(code)} className="flex w-full items-center justify-between gap-2 rounded px-2 py-1 text-left hover:bg-surface-3"><span className="truncate text-text">{label}</span><code className="shrink-0 text-[11px] text-text-3">{code}</code></button>;
}
function AiItem({ icon, label, onClick, disabled }: { icon: React.ReactNode; label: string; onClick: () => void; disabled?: boolean }) {
  return <button type="button" disabled={disabled} onClick={onClick} className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-text hover:bg-surface-3 disabled:opacity-40">{icon}{label}</button>;
}

function LinkDialog({ selected, onClose, onInsert }: { selected: string; onClose: () => void; onInsert: (s: string) => void }) {
  const [label, setLabel] = useState(selected);
  const [url, setUrl] = useState("https://");
  const ok = /^https?:\/\/[^\s]+\.[^\s]+/.test(url);
  return (
    <Dialog open onClose={onClose} size="sm" title="Insert link" description="Shown as a clickable link in email; chat and social channels get the text and URL."
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={!ok} onClick={() => onInsert(label.trim() ? `[${label.trim().replace(/[[\]]/g, "")}](${url.trim()})` : url.trim())}>Insert</Button></>}>
      <div className="space-y-3">
        <Field label="Text" htmlFor="ln-t"><Input id="ln-t" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Track your order" /></Field>
        <Field label="URL" htmlFor="ln-u"><Input id="ln-u" value={url} onChange={(e) => setUrl(e.target.value)} type="url" /></Field>
      </div>
    </Dialog>
  );
}

function CannedPicker({ canned, onPick, brand }: { canned: Canned[]; onPick: (c: Canned) => void; brand: string }) {
  const [q, setQ] = useState("");
  const list = useMemo(() => canned.filter((c) => !q || `${c.title} ${c.shortcut} ${c.body}`.toLowerCase().includes(q.toLowerCase())), [canned, q]);
  return (
    <Menu align="right" trigger={() => <span className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-[12.5px] text-text-2 hover:bg-surface-3"><MessageSquareText className="h-3.5 w-3.5" /><span className="hidden sm:inline">Canned</span></span>}>
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
