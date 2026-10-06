"use client";

import { FileText, ImageIcon, Loader2, Paperclip, Trash, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useRef, useState } from "react";
import {
  assignAction, classifyAction, createChildAction, deleteReminderAction, linkParentAction, saveReminderAction, saveSettingsAction, saveSignatureAction, sendEmailAction,
} from "@/app/(app)/cx/inbox/actions";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Callout } from "@/components/ui/feedback";
import { Checkbox, Field, Input, Select, Textarea } from "@/components/ui/input";
import { Segmented, Tabs } from "@/components/ui/tabs";
import type { ClassificationNode, FieldDef } from "@/lib/cx/admin/fields";
import { blockedRecipients, composeSubject, parseAddresses, REMINDER_MIN_MINUTES, type InboxSettings } from "@/lib/cx/inbox/model";
import type { Agent, Attachment, TicketDetail } from "@/lib/cx/inbox/store";
import { cn } from "@/lib/utils";
import { usePrefs } from "./prefs";

// ---------------------------------------------------------------- uploads

export function useUploads(brand: string) {
  const [files, setFiles] = useState<Attachment[]>([]);
  const [busy, setBusy] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const upload = async (list: File[] | FileList) => {
    const arr = [...list].slice(0, 10);
    if (!arr.length) return;
    setError(null);
    setBusy((n) => n + arr.length);
    try {
      const fd = new FormData();
      for (const f of arr) fd.append("file", f, f.name || `screenshot-${Date.now()}.png`);
      const r = await fetch(`/api/cx/inbox/files?brand=${brand}`, { method: "POST", body: fd });
      const d = (await r.json().catch(() => ({}))) as { files?: Attachment[]; error?: string };
      if (!r.ok) setError(d.error ?? "Upload failed");
      else setFiles((x) => [...x, ...(d.files ?? [])].slice(0, 20));
    } catch {
      setError("Upload failed. Check your connection.");
    }
    setBusy((n) => n - arr.length);
  };
  return { files, busy: busy > 0, error, upload, remove: (id?: string) => setFiles((x) => x.filter((f) => f.id !== id)), clear: () => { setFiles([]); setError(null); }, ids: files.map((f) => f.id!).filter(Boolean) };
}
export type Uploads = ReturnType<typeof useUploads>;

export function AttachButton({ uploads, label = "Attach", className }: { uploads: Uploads; label?: string; className?: string }) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <>
      <button type="button" onClick={() => ref.current?.click()} className={cn("inline-flex h-7 items-center gap-1 rounded-md px-2 text-[12.5px] text-text-2 hover:bg-surface-3", className)} title="Attach files (images, video, PDF, Excel…; 25 MB each)">
        {uploads.busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Paperclip className="h-3.5 w-3.5" />}<span className="hidden sm:inline">{label}</span>
      </button>
      <input ref={ref} type="file" multiple hidden onChange={(e) => { if (e.target.files) uploads.upload(e.target.files); e.target.value = ""; }} />
    </>
  );
}
export function PendingFiles({ uploads }: { uploads: Uploads }) {
  if (!uploads.files.length && !uploads.error) return null;
  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
      {uploads.files.map((f) => (
        <span key={f.id} className="inline-flex max-w-[220px] items-center gap-1 rounded border border-border bg-surface-2 py-0.5 pr-0.5 pl-1.5 text-[11.5px] text-text-2">
          {f.type?.startsWith("image/") ? <ImageIcon className="h-3 w-3 shrink-0" /> : <FileText className="h-3 w-3 shrink-0" />}
          <span className="truncate">{f.name}</span>{f.size ? <span className="shrink-0 text-text-3">{fmtSize(f.size)}</span> : null}
          <button type="button" onClick={() => uploads.remove(f.id)} className="rounded p-0.5 hover:bg-surface-3" aria-label={`Remove ${f.name}`}><X className="h-3 w-3" /></button>
        </span>
      ))}
      {uploads.error && <span className="text-[12px] text-critical-ink">{uploads.error}</span>}
    </div>
  );
}
export const fmtSize = (n: number) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

/** Cancel + primary. Without `onSubmit` the primary is a submit button for a Dialog that has its own onSubmit (Enter submits). */
function Footer({ onClose, busy, label, onSubmit, disabled }: { onClose: () => void; busy: boolean; label: string; onSubmit?: () => void; disabled?: boolean }) {
  return (
    <>
      <Button variant="ghost" onClick={onClose}>Cancel</Button>
      {onSubmit ? (
        <Button variant="primary" loading={busy} disabled={busy || disabled} onClick={onSubmit}>{label}</Button>
      ) : (
        <Button type="submit" variant="primary" loading={busy} disabled={busy || disabled}>{label}</Button>
      )}
    </>
  );
}
function useSubmit(onDone: () => void) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (p: Promise<{ ok: true } | { ok: false; error: string }>) => {
    setBusy(true); setError(null);
    const r = await p;
    setBusy(false);
    if (!r.ok) { setError(r.error); return false; }
    router.refresh();
    onDone();
    return true;
  };
  return { busy, error, setError, submit };
}

// ---------------------------------------------------------------- reminders

const localInput = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
export function ReminderDialog({ brand, ticketId, agents, me, existing, onClose }: { brand: string; ticketId: string; agents: Agent[]; me: { id: string }; existing?: TicketDetail["reminders"][number] | null; onClose: () => void }) {
  const [at, setAt] = useState(localInput(existing ? new Date(existing.remind_at) : new Date(Date.now() + 60 * 60_000)));
  const [note, setNote] = useState(existing?.note ?? "");
  const [users, setUsers] = useState<Set<string>>(new Set(existing?.user_ids ?? [me.id]));
  const s = useSubmit(onClose);
  const presets = [["In 30 min", 30], ["In 1 hour", 60], ["In 4 hours", 240], ["Tomorrow 9:00", -1]] as const;
  return (
    <Dialog open onClose={onClose} title={existing ? "Edit reminder" : "Set reminder"} description={`A pop-up and a notification reach everyone selected at that time (at least ${REMINDER_MIN_MINUTES} minutes from now).`}
      error={s.error}
      footerStart={existing && <Button variant="ghost" className="text-critical-ink" disabled={s.busy} onClick={() => s.submit(deleteReminderAction(brand, existing.id))}><Trash className="h-3.5 w-3.5" />Delete</Button>}
      footer={<Footer onClose={onClose} busy={s.busy} label={existing ? "Save reminder" : "Set reminder"} disabled={!users.size} onSubmit={() => s.submit(saveReminderAction(brand, { id: existing?.id, ticketId, remindAt: new Date(at).toISOString(), note, userIds: [...users] }))} />}>
      <div className="space-y-3">
        <div className="flex flex-wrap gap-1.5">
          {presets.map(([l, m]) => (
            <button key={l} type="button" className="rounded-full border border-border px-2.5 py-1 text-[12px] text-text-2 hover:bg-surface-3" onClick={() => {
              const d = m > 0 ? new Date(Date.now() + m * 60_000) : (() => { const x = new Date(); x.setDate(x.getDate() + 1); x.setHours(9, 0, 0, 0); return x; })();
              setAt(localInput(d));
            }}>{l}</button>
          ))}
        </div>
        <Field label="Remind at" htmlFor="rm-at" hint="Reminders are logged in the ticket activity."><Input id="rm-at" type="datetime-local" value={at} min={localInput(new Date(Date.now() + REMINDER_MIN_MINUTES * 60_000))} onChange={(e) => setAt(e.target.value)} /></Field>
        <Field label="Note" htmlFor="rm-note"><Textarea id="rm-note" rows={2} value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Call back about the refund" /></Field>
        <div>
          <div className="mb-1 text-[13px] font-medium text-text">Remind</div>
          <div className="grid gap-1 sm:grid-cols-2">
            {agents.map((a) => (
              <label key={a.id} className="flex items-center gap-2 text-[13px]">
                <Checkbox checked={users.has(a.id)} onChange={(e) => setUsers((u) => { const n = new Set(u); if (e.target.checked) n.add(a.id); else n.delete(a.id); return n; })} />
                {a.name}{a.id === me.id && <span className="text-text-3">(me)</span>}
              </label>
            ))}
          </div>
        </div>
      </div>
    </Dialog>
  );
}

// ---------------------------------------------------------------- escalate / forward / compose

export type EmailKind = "escalate" | "forward" | "compose";
const KIND_TEXT: Record<EmailKind, { title: string; desc: string; send: string }> = {
  escalate: { title: "Escalate via email", desc: "Send this ticket to an internal team or manager. The ticket is marked escalated and the email is kept in its private messages.", send: "Escalate" },
  forward: { title: "Forward", desc: "Forward the conversation by email. Untick original attachments you don't want to include.", send: "Forward" },
  compose: { title: "Compose mail", desc: "Write a new email from this ticket. The ticket ID goes into the subject so replies come back to this ticket.", send: "Send email" },
};
export function EmailDialog({ brand, kind, detail, suggestions, settings, hasEmail, hasSignature, onClose }: { brand: string; kind: EmailKind; detail: TicketDetail; suggestions: string[]; settings: InboxSettings; hasEmail: boolean; hasSignature: boolean; onClose: () => void }) {
  const t = detail.ticket;
  const [f, setF] = useState({ to: kind === "compose" ? t.contact_email ?? "" : "", cc: "", bcc: "", subject: t.subject, body: "" });
  const [showCc, setShowCc] = useState(false);
  const [history, setHistory] = useState(true);
  const [sig, setSig] = useState(hasSignature);
  const originals = useMemo(() => detail.messages.flatMap((m) => (m.attachments ?? []).filter((a) => a.id)), [detail.messages]);
  const [keep, setKeep] = useState<Set<string>>(new Set(kind === "forward" ? originals.map((a) => a.id!) : []));
  const uploads = useUploads(brand);
  const s = useSubmit(onClose);
  const all = [f.to, f.cc, f.bcc].map((x) => parseAddresses(x));
  const invalid = all.flatMap((x) => x.invalid);
  const blocked = blockedRecipients(all.flatMap((x) => x.valid), settings.allowedEmailDomains);
  const set = (k: keyof typeof f, v: string) => setF((x) => ({ ...x, [k]: v }));
  const k = KIND_TEXT[kind];
  return (
    <Dialog open onClose={onClose} size="lg" title={k.title} description={k.desc} error={s.error}
      footer={<Footer onClose={onClose} busy={s.busy} label={k.send} disabled={!hasEmail || !all[0].valid.length || invalid.length > 0 || blocked.length > 0 || uploads.busy}
        onSubmit={() => s.submit(sendEmailAction(brand, t.id, { kind, ...f, attachmentIds: uploads.ids, originalAttachmentIds: [...keep], includeHistory: kind === "forward" && history, includeSignature: sig }).then((r) => (r.ok && r.data.status === "failed" ? { ok: false as const, error: `Not sent: ${r.data.error}` } : r)))} />}>
      <div className="space-y-3">
        {!hasEmail && <Callout tone="warning">Connect an email channel (Settings → Channels) to send email from tickets.</Callout>}
        <datalist id="cx-mail-suggest">{suggestions.map((e) => <option key={e} value={e} />)}</datalist>
        <Field label="To" htmlFor="em-to" hint="Separate addresses with commas."><Input id="em-to" list="cx-mail-suggest" value={f.to} onChange={(e) => set("to", e.target.value)} placeholder="team@yourcompany.com" autoComplete="off" /></Field>
        {showCc ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="CC" htmlFor="em-cc"><Input id="em-cc" list="cx-mail-suggest" value={f.cc} onChange={(e) => set("cc", e.target.value)} autoComplete="off" /></Field>
            <Field label="BCC" htmlFor="em-bcc"><Input id="em-bcc" list="cx-mail-suggest" value={f.bcc} onChange={(e) => set("bcc", e.target.value)} autoComplete="off" /></Field>
          </div>
        ) : <button type="button" className="text-[12.5px] text-link hover:underline" onClick={() => setShowCc(true)}>Add CC / BCC</button>}
        {invalid.length > 0 && <p className="text-[12.5px] text-critical-ink">Not an email address: {invalid.join(", ")}</p>}
        {blocked.length > 0 && <p className="text-[12.5px] text-critical-ink">Not allowed by your domain restriction ({settings.allowedEmailDomains.join(", ")}): {blocked.join(", ")}</p>}
        <Field label="Subject" htmlFor="em-s" hint={`Sent as “${composeSubject(f.subject || t.subject, t.number, kind)}”`}><Input id="em-s" value={f.subject} onChange={(e) => set("subject", e.target.value)} /></Field>
        <Field label="Message" htmlFor="em-b"><Textarea id="em-b" rows={6} value={f.body} onChange={(e) => set("body", e.target.value)} placeholder={kind === "escalate" ? "What do you need from the team?" : "Write your message. Links: [text](https://…)"} /></Field>
        {kind === "forward" && (
          <label className="flex items-center gap-2 text-[13px]"><Checkbox checked={history} onChange={(e) => setHistory(e.target.checked)} />Include the conversation ({detail.messages.filter((m) => m.direction !== "note").length} messages)</label>
        )}
        {originals.length > 0 && (
          <div>
            <div className="mb-1 text-[13px] font-medium text-text">Original attachments</div>
            {originals.map((a) => (
              <label key={a.id} className="flex items-center gap-2 py-0.5 text-[12.5px]">
                <Checkbox checked={keep.has(a.id!)} onChange={(e) => setKeep((x) => { const n = new Set(x); if (e.target.checked) n.add(a.id!); else n.delete(a.id!); return n; })} />
                <Paperclip className="h-3 w-3 text-text-3" />{a.name}{a.size ? <span className="text-text-3">{fmtSize(a.size)}</span> : null}
              </label>
            ))}
          </div>
        )}
        <div className="flex flex-wrap items-center gap-3">
          <AttachButton uploads={uploads} label="Attach files" className="border border-border" />
          <label className={cn("flex items-center gap-2 text-[13px]", !hasSignature && "text-text-3")} title={hasSignature ? "" : "Add a signature in Inbox settings → Signature"}>
            <Checkbox checked={sig} disabled={!hasSignature} onChange={(e) => setSig(e.target.checked)} />Add my signature
          </label>
        </div>
        <PendingFiles uploads={uploads} />
      </div>
    </Dialog>
  );
}

// ---------------------------------------------------------------- assign with note + media

export function AssignDialog({ brand, detail, agents, me, onClose }: { brand: string; detail: TicketDetail; agents: Agent[]; me: { id: string }; onClose: () => void }) {
  const [assignee, setAssignee] = useState(detail.ticket.assignee_id ?? me.id);
  const [note, setNote] = useState("");
  const uploads = useUploads(brand);
  const s = useSubmit(onClose);
  return (
    <Dialog open onClose={onClose} title={`Assign #${detail.ticket.number}`} description="Hand the ticket over with context. The note and files are added to the private messages and the assignee is notified."
      error={s.error}
      footer={<Footer onClose={onClose} busy={s.busy} label="Assign" disabled={uploads.busy} onSubmit={() => s.submit(assignAction(brand, detail.ticket.id, { assigneeId: assignee || null, note, attachmentIds: uploads.ids }))} />}>
      <div className="space-y-3">
        <Field label="Assign to" htmlFor="as-a">
          <Select id="as-a" value={assignee} onChange={(e) => setAssignee(e.target.value)}>
            <option value="">Unassigned</option>
            {agents.map((a) => <option key={a.id} value={a.id}>{a.id === me.id ? `${a.name} (me)` : a.name}</option>)}
          </Select>
        </Field>
        <Field label="Note (optional)" htmlFor="as-n"><Textarea id="as-n" rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="What should they know?" /></Field>
        <div className="flex items-center gap-2"><AttachButton uploads={uploads} label="Attach media" className="border border-border" /></div>
        <PendingFiles uploads={uploads} />
      </div>
    </Dialog>
  );
}

// ---------------------------------------------------------------- parent–child

export function ChildDialog({ brand, detail, agents, onClose, onCreated }: { brand: string; detail: TicketDetail; agents: Agent[]; onClose: () => void; onCreated: (id: string) => void }) {
  const [f, setF] = useState({ subject: `${detail.ticket.subject}`, body: "", assigneeId: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <Dialog open onClose={onClose} title={`New child ticket of #${detail.ticket.number}`} description="Same customer and channel as the parent." error={error}
      onSubmit={async () => {
        if (busy || !f.subject.trim()) return;
        setBusy(true); setError(null);
        const r = await createChildAction(brand, detail.ticket.id, { ...f, assigneeId: f.assigneeId || null });
        setBusy(false);
        if (r.ok) onCreated(r.data.id); else setError(r.error);
      }}
      footer={<Footer onClose={onClose} busy={busy} label="Create child ticket" disabled={!f.subject.trim()} />}>
      <div className="space-y-3">
        <p className="text-[12.5px] text-text-2">The parent stays open until every child is closed; notes of the family show together.</p>
        <Field label="Subject" htmlFor="ch-s"><Input id="ch-s" autoFocus value={f.subject} onChange={(e) => setF({ ...f, subject: e.target.value })} /></Field>
        <Field label="Internal note" htmlFor="ch-b"><Textarea id="ch-b" rows={3} value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} placeholder="What needs to happen in this child ticket?" /></Field>
        <Field label="Assignee" htmlFor="ch-a">
          <Select id="ch-a" value={f.assigneeId} onChange={(e) => setF({ ...f, assigneeId: e.target.value })}>
            <option value="">Unassigned</option>
            {agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </Select>
        </Field>
      </div>
    </Dialog>
  );
}
export function ParentDialog({ brand, detail, onClose }: { brand: string; detail: TicketDetail; onClose: () => void }) {
  const [n, setN] = useState("");
  const s = useSubmit(onClose);
  const num = Number(n.replace(/^#/, ""));
  const valid = Number.isInteger(num) && num > 0;
  return (
    <Dialog open onClose={onClose} size="sm" title="Link to a parent ticket" description="This ticket becomes a child; the parent can't be resolved until its children are closed."
      error={s.error}
      onSubmit={() => valid && !s.busy && s.submit(linkParentAction(brand, detail.ticket.id, num))}
      footer={<Footer onClose={onClose} busy={s.busy} label="Link" disabled={!valid} />}>
      <Field label="Parent ticket number" htmlFor="pa-n"><Input id="pa-n" autoFocus value={n} onChange={(e) => setN(e.target.value)} placeholder="#123" inputMode="numeric" /></Field>
    </Dialog>
  );
}

// ---------------------------------------------------------------- inbox settings (personal + ticket settings)

export function SettingsDialog({ brand, canAdmin, settings, signature, onClose }: { brand: string; canAdmin: boolean; settings: InboxSettings; signature: { body: string; imageFileId: string | null; imageUrl: string | null; enabled: boolean }; onClose: () => void }) {
  const { prefs, setPrefs } = usePrefs();
  const [st, setSt] = useState(settings);
  const [domains, setDomains] = useState(settings.allowedEmailDomains.join(", "));
  const [sig, setSig] = useState(signature);
  const uploads = useUploads(brand);
  const s = useSubmit(() => {});
  const [saved, setSaved] = useState<string | null>(null);
  const img = uploads.files.at(-1);
  const Toggle = ({ label, hint, checked, onChange, disabled }: { label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) => (
    <label className={cn("flex items-start gap-2 py-1.5 text-[13px]", disabled && "opacity-60")}>
      <Checkbox className="mt-0.5" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span><span className="text-text">{label}</span>{hint && <span className="block text-[12px] text-text-3">{hint}</span>}</span>
    </label>
  );
  return (
    <Dialog open onClose={onClose} size="lg" title="Inbox settings" description="Your workspace preferences apply to you only; ticket settings apply to everyone on this brand." error={s.error} initialFocus="none">
      <Tabs variant="pill" tabs={[
        {
          id: "view", label: "My workspace", content: (
            <div className="space-y-2 px-1 pt-2">
              <div className="flex flex-wrap items-center gap-2 text-[13px]"><span className="w-32 text-text-2">List layout</span><Segmented value={prefs.layout} onChange={(v) => setPrefs({ layout: v })} options={[{ value: "ticket", label: "Ticket view" }, { value: "chat", label: "Chat view" }]} /></div>
              <div className="flex flex-wrap items-center gap-2 text-[13px]"><span className="w-32 text-text-2">Messages</span><Segmented value={prefs.align} onChange={(v) => setPrefs({ align: v })} options={[{ value: "split", label: "Left-right aligned" }, { value: "left", label: "Left aligned" }]} /></div>
              <div className="flex flex-wrap items-center gap-2 text-[13px]"><span className="w-32 text-text-2">Translate into</span><Input className="h-8 w-44" value={prefs.translateTo} onChange={(e) => setPrefs({ translateTo: e.target.value })} aria-label="Translation language" /></div>
              <Toggle label="Normal date" hint="Show absolute dates and times instead of “2 hours ago”." checked={prefs.absoluteDates} onChange={(v) => setPrefs({ absoluteDates: v })} />
              <Toggle label="Alert me on new tickets" hint="Play a sound when a new ticket arrives in the list." checked={prefs.soundNewTicket} onChange={(v) => setPrefs({ soundNewTicket: v })} />
              <Toggle label="Sound on new message" hint="Play a sound when the customer writes in the conversation you have open." checked={prefs.soundNewMessage} onChange={(v) => setPrefs({ soundNewMessage: v })} />
              <Toggle label="Enter to send" hint="Enter sends, Shift+Enter adds a new line (otherwise ⌘/Ctrl+Enter sends)." checked={prefs.enterToSend} onChange={(v) => setPrefs({ enterToSend: v })} />
              <Toggle label="Collapse email threads" hint="Email tickets show messages newest first, older ones collapsed." checked={prefs.emailCollapsed} onChange={(v) => setPrefs({ emailCollapsed: v })} />
              <p className="pt-1 text-[12px] text-text-3">Saved automatically.</p>
            </div>
          ),
        },
        {
          id: "sig", label: "Signature", content: (
            <div className="space-y-3 px-1 pt-2">
              <Toggle label="Add my signature to email replies" checked={sig.enabled} onChange={(v) => setSig({ ...sig, enabled: v })} />
              <Field label="Signature" htmlFor="sig-b" hint="Plain text; links as [text](https://…)."><Textarea id="sig-b" rows={4} value={sig.body} onChange={(e) => setSig({ ...sig, body: e.target.value })} placeholder={"Priya Shah\nCustomer Care · Acme\n[acme.com](https://acme.com)"} /></Field>
              <div className="flex flex-wrap items-center gap-3">
                {(img?.url ?? sig.imageUrl) && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={img?.url ?? sig.imageUrl!} alt="Signature image" className="max-h-14 rounded border border-border bg-white p-1" />
                )}
                <AttachButton uploads={uploads} label={sig.imageUrl || img ? "Replace image" : "Add image (logo)"} className="border border-border" />
                {(sig.imageFileId || img) && <Button size="sm" variant="ghost" onClick={() => { uploads.clear(); setSig({ ...sig, imageFileId: null, imageUrl: null }); }}>Remove image</Button>}
              </div>
              <PendingFiles uploads={uploads} />
              <div className="flex items-center justify-end gap-2">
                {saved === "sig" && <span className="text-[12.5px] text-good-ink">Saved</span>}
                <Button variant="primary" size="sm" loading={s.busy} disabled={uploads.busy} onClick={async () => { setSaved(null); if (await s.submit(saveSignatureAction(brand, { body: sig.body, enabled: sig.enabled, imageFileId: img?.id ?? sig.imageFileId }))) setSaved("sig"); }}>Save signature</Button>
              </div>
            </div>
          ),
        },
        {
          id: "ticket", label: "Ticket settings", content: (
            <div className="space-y-1 px-1 pt-2">
              {!canAdmin && <Callout tone="info" className="mb-2">Only brand admins can change ticket settings.</Callout>}
              <Toggle disabled={!canAdmin} label="Status change required with every reply" hint="Agents must pick a status (WIP, Follow-up, Resolved…) when replying; no “reply only”." checked={st.requireStatusOnReply} onChange={(v) => setSt({ ...st, requireStatusOnReply: v })} />
              <Toggle disabled={!canAdmin} label="Reopen WIP tickets when the customer replies" checked={st.reopenWip} onChange={(v) => setSt({ ...st, reopenWip: v })} />
              <Toggle disabled={!canAdmin} label="Public / Private message tabs" hint="Split One Ticket View into customer-facing and internal messages." checked={st.publicPrivateTabs} onChange={(v) => setSt({ ...st, publicPrivateTabs: v })} />
              <Toggle disabled={!canAdmin} label="Merge contacts that share a phone number" hint="Automatic, unless both contacts have different email addresses." checked={st.autoMergePhone} onChange={(v) => setSt({ ...st, autoMergePhone: v })} />
              <div className="grid gap-3 pt-2 sm:grid-cols-2">
                <Field label="Lock tickets after (days)" htmlFor="st-lock" hint="Resolved/closed tickets become read-only; 0 = never."><Input id="st-lock" type="number" min={0} max={3650} disabled={!canAdmin} value={st.lockDays} onChange={(e) => setSt({ ...st, lockDays: Number(e.target.value) })} /></Field>
                <Field label="Allowed email domains" htmlFor="st-dom" hint="Escalate / forward / compose only to these (empty = any)."><Input id="st-dom" disabled={!canAdmin} value={domains} onChange={(e) => setDomains(e.target.value)} placeholder="acme.com, partner.in" /></Field>
              </div>
              <div className="flex items-center justify-end gap-2 pt-2">
                {saved === "ticket" && <span className="text-[12.5px] text-good-ink">Saved</span>}
                <Button variant="primary" size="sm" loading={s.busy} disabled={s.busy || !canAdmin} onClick={async () => { setSaved(null); if (await s.submit(saveSettingsAction(brand, { ...st, allowedEmailDomains: domains.split(/[\s,;]+/).filter(Boolean) }))) setSaved("ticket"); }}>Save ticket settings</Button>
              </div>
            </div>
          ),
        },
      ]} />
    </Dialog>
  );
}

// ---------------------------------------------------------------- classification & custom fields (from Settings → Fields)

export function FieldsPanel({ brand, ticketId, defs, tree, values, classificationIds, disabled }: { brand: string; ticketId: string; defs: FieldDef[]; tree: ClassificationNode[]; values: Record<string, unknown>; classificationIds: string[]; disabled?: boolean }) {
  const [path, setPath] = useState<string[]>(classificationIds);
  const [v, setV] = useState<Record<string, unknown>>(values);
  const [tried, setTried] = useState(false);
  const s = useSubmit(() => {});
  const [ok, setOk] = useState(false);
  const visible = defs.filter((d) => d.scope === "ticket" && !d.hidden && d.group !== "system").sort((a, b) => a.order - b.order);
  const levels: ClassificationNode[][] = [];
  const roots = tree.filter((n) => !n.parentId && !n.hidden);
  if (roots.length) levels.push(roots);
  for (let i = 0; i < path.length; i++) {
    const kids = tree.filter((n) => n.parentId === path[i] && !n.hidden);
    if (kids.length) levels.push(kids); else break;
  }
  const missing = visible.filter((d) => d.required && (v[d.key] == null || v[d.key] === "" || (Array.isArray(v[d.key]) && !(v[d.key] as unknown[]).length)));
  const invalid = visible.filter((d) => {
    const x = v[d.key];
    if (x == null || x === "" || !d.validation) return false;
    const str = String(x);
    if (d.validation.minLength && str.length < d.validation.minLength) return true;
    if (d.validation.maxLength && str.length > d.validation.maxLength) return true;
    try { return !!d.validation.regex && !new RegExp(d.validation.regex).test(str); } catch { return false; }
  });
  return (
    <div className="space-y-2">
      {levels.map((opts, i) => (
        <Select key={i} value={path[i] ?? ""} disabled={disabled} className="h-8 text-[12.5px]" aria-label={`Classification level ${i + 1}`} onChange={(e) => setPath([...path.slice(0, i), ...(e.target.value ? [e.target.value] : [])])}>
          <option value="">{i === 0 ? "Classification…" : "Sub-classification…"}</option>
          {opts.map((n) => <option key={n.id} value={n.id}>{n.label}</option>)}
        </Select>
      ))}
      {visible.map((d) => {
        const bad = tried && (missing.includes(d) || invalid.includes(d));
        const cls = cn("h-8 text-[12.5px]", bad && "border-critical");
        const val = v[d.key];
        const set = (x: unknown) => setV((o) => ({ ...o, [d.key]: x }));
        return (
          <div key={d.id}>
            <label className="mb-0.5 block text-[11.5px] text-text-3" htmlFor={`fd-${d.id}`}>{d.label}{d.required && <span className="text-critical-ink"> *</span>}</label>
            {d.type === "select" ? (
              <Select id={`fd-${d.id}`} className={cls} disabled={disabled} value={String(val ?? "")} onChange={(e) => set(e.target.value)}><option value="">—</option>{d.options.map((o) => <option key={o} value={o}>{o}</option>)}</Select>
            ) : d.type === "multiselect" ? (
              <div className="flex flex-wrap gap-x-3 gap-y-1">{d.options.map((o) => { const arr = Array.isArray(val) ? (val as string[]) : []; return <label key={o} className="flex items-center gap-1 text-[12.5px]"><Checkbox disabled={disabled} checked={arr.includes(o)} onChange={(e) => set(e.target.checked ? [...arr, o] : arr.filter((x) => x !== o))} />{o}</label>; })}</div>
            ) : d.type === "checkbox" ? (
              <Checkbox id={`fd-${d.id}`} disabled={disabled} checked={!!val} onChange={(e) => set(e.target.checked)} />
            ) : d.type === "textarea" ? (
              <Textarea id={`fd-${d.id}`} rows={2} className={cn("text-[12.5px]", bad && "border-critical")} disabled={disabled} value={String(val ?? "")} onChange={(e) => set(e.target.value)} />
            ) : (
              <Input id={`fd-${d.id}`} className={cls} disabled={disabled} type={d.type === "number" ? "number" : d.type === "date" ? "date" : d.type === "email" ? "email" : d.type === "url" ? "url" : d.type === "phone" ? "tel" : "text"} value={String(val ?? "")} onChange={(e) => set(e.target.value)} />
            )}
          </div>
        );
      })}
      {tried && (missing.length > 0 || invalid.length > 0) && <p className="text-[12px] text-critical-ink">{missing.length ? `Required: ${missing.map((d) => d.label).join(", ")}. ` : ""}{invalid.length ? `Check: ${invalid.map((d) => d.label).join(", ")}.` : ""}</p>}
      {s.error && <p className="text-[12px] text-critical-ink">{s.error}</p>}
      <div className="flex items-center justify-end gap-2">
        {ok && <span className="text-[12px] text-good-ink">Saved</span>}
        <Button size="sm" disabled={disabled || s.busy} onClick={async () => {
          setTried(true); setOk(false);
          if (missing.length || invalid.length) return;
          if (await s.submit(classifyAction(brand, ticketId, { classificationIds: path, values: v }))) setOk(true);
        }}>Save classification</Button>
      </div>
    </div>
  );
}
