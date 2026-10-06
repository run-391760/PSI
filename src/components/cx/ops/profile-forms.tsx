"use client";

import { Check } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { saveInboxPrefsAction, saveNotifyAction, saveSignatureAction, updateNameAction } from "@/app/(app)/cx/profile/actions";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/input";
import type { NotifyPrefs } from "@/lib/cx/ops/model";
import { cn } from "@/lib/utils";

function Saved({ show }: { show: boolean }) {
  return show ? <span className="inline-flex items-center gap-1 text-[12.5px] text-good-ink" role="status"><Check className="h-3.5 w-3.5" /> Saved</span> : null;
}

export function NameForm({ name, email }: { name: string; email: string }) {
  const router = useRouter();
  const [value, setValue] = useState(name);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, start] = useTransition();
  const trimmed = value.trim();
  const invalid = trimmed.length < 1 ? "Enter your name." : trimmed.length > 80 ? "Use at most 80 characters." : null;
  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (invalid) { setError(invalid); return; }
        start(async () => {
          setError(null); setSaved(false);
          const r = await updateNameAction(trimmed);
          if (!r.ok) { setError(r.error); return; }
          setValue(r.data.name); setSaved(true);
          router.refresh();
        });
      }}
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Name" htmlFor="profile-name" error={error} hint={`${trimmed.length}/80 · shown to teammates on tickets, notes and tasks`}>
          <Input id="profile-name" value={value} onChange={(e) => { setValue(e.target.value); setSaved(false); }} maxLength={120} autoComplete="name" aria-invalid={!!error} />
        </Field>
        <Field label="Email" htmlFor="profile-email" hint="Your sign-in email can't be changed here.">
          <Input id="profile-email" value={email} readOnly disabled />
        </Field>
      </div>
      <div className="flex items-center gap-3">
        <Button type="submit" variant="primary" size="sm" loading={pending} disabled={pending || trimmed === name.trim() || !!invalid}>Save name</Button>
        <Saved show={saved} />
      </div>
    </form>
  );
}

export function SignatureForm({ brand, brandName, body, enabled, imageUrl }: { brand: string; brandName: string; body: string; enabled: boolean; imageUrl: string | null }) {
  const [text, setText] = useState(body);
  const [on, setOn] = useState(enabled);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, start] = useTransition();
  const dirty = text !== body || on !== enabled;
  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          setError(null); setSaved(false);
          const r = await saveSignatureAction(brand, { body: text, enabled: on });
          if (!r.ok) setError(r.error); else setSaved(true);
        });
      }}
    >
      <ToggleRow label="Add my signature to emails" hint={`Appended to email replies you send for ${brandName}.`} checked={on} onChange={(v) => { setOn(v); setSaved(false); }} />
      <Field label="Signature" htmlFor="profile-signature" error={error} hint={`${text.length}/2000`}>
        <Textarea id="profile-signature" value={text} onChange={(e) => { setText(e.target.value); setSaved(false); }} maxLength={2000} rows={5} placeholder={"Best regards,\nYour name\nSupport team"} className={cn(!on && "opacity-70")} />
      </Field>
      {imageUrl && (
        <div className="flex items-center gap-3 text-[12.5px] text-text-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={imageUrl} alt="Signature image" className="h-10 max-w-[160px] rounded border border-border object-contain" />
          <span>Signature image is kept. Change it from the inbox composer.</span>
        </div>
      )}
      <div className="flex items-center gap-3">
        <Button type="submit" variant="primary" size="sm" loading={pending} disabled={pending || !dirty}>Save signature</Button>
        <Saved show={saved} />
      </div>
    </form>
  );
}

type InboxToggles = { soundNewTicket: boolean; soundNewMessage: boolean; enterToSend: boolean };
const NOTIFY_ROWS: { key: keyof NotifyPrefs; label: string; hint: string }[] = [
  { key: "taskAssigned", label: "A task is assigned to me", hint: "When a teammate assigns you a CRM task." },
  { key: "taskDue", label: "Task due reminders", hint: "Reminder before a task you own is due, and when it becomes overdue." },
  { key: "ticketAssigned", label: "A ticket is assigned to me", hint: "When a conversation is routed or assigned to you." },
  { key: "mentions", label: "@mentions", hint: "When someone mentions you in an internal note or task comment." },
  { key: "dailyDigest", label: "Daily digest", hint: "One summary a day of your open tickets and tasks." },
];
const INBOX_ROWS: { key: keyof InboxToggles; label: string; hint: string }[] = [
  { key: "soundNewTicket", label: "Sound for new tickets", hint: "Play a chime in the inbox when a new ticket arrives." },
  { key: "soundNewMessage", label: "Sound for new messages", hint: "Play a tone when a new message arrives in the open conversation." },
  { key: "enterToSend", label: "Enter to send", hint: "Press Enter to send a reply (Shift+Enter for a new line)." },
];

export function PrefsForm({ notify, inbox }: { notify: NotifyPrefs; inbox: InboxToggles }) {
  const [n, setN] = useState(notify);
  const [i, setI] = useState(inbox);
  const [error, setError] = useState<string | null>(null);
  const [savedKey, setSavedKey] = useState<string | null>(null);
  const [, start] = useTransition();
  const saveNotify = (k: keyof NotifyPrefs, v: boolean) => {
    const prev = n;
    setN({ ...n, [k]: v });
    start(async () => {
      setError(null);
      const r = await saveNotifyAction({ [k]: v });
      if (!r.ok) { setN(prev); setError(r.error); } else { setN(r.data); setSavedKey(k); }
    });
  };
  const saveInbox = (k: keyof InboxToggles, v: boolean) => {
    const prev = i;
    setI({ ...i, [k]: v });
    start(async () => {
      setError(null);
      const r = await saveInboxPrefsAction({ [k]: v });
      if (!r.ok) { setI(prev); setError(r.error); } else setSavedKey(k);
    });
  };
  return (
    <div className="space-y-4">
      <section>
        <h3 className="mb-1 text-[12px] font-semibold tracking-wide text-text-3 uppercase">Notify me when</h3>
        <div className="divide-y divide-border">
          {NOTIFY_ROWS.map((r) => <ToggleRow key={r.key} label={r.label} hint={r.hint} checked={n[r.key]} onChange={(v) => saveNotify(r.key, v)} saved={savedKey === r.key} />)}
        </div>
        <p className="mt-1 text-[12px] text-text-3">Notifications appear in the bell menu and on the Alerts page.</p>
      </section>
      <section>
        <h3 className="mb-1 text-[12px] font-semibold tracking-wide text-text-3 uppercase">Inbox</h3>
        <div className="divide-y divide-border">
          {INBOX_ROWS.map((r) => <ToggleRow key={r.key} label={r.label} hint={r.hint} checked={i[r.key]} onChange={(v) => saveInbox(r.key, v)} saved={savedKey === r.key} />)}
        </div>
      </section>
      {error && <p className="text-[12px] text-critical-ink" role="alert">{error}</p>}
    </div>
  );
}

function ToggleRow({ label, hint, checked, onChange, saved }: { label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void; saved?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-3 py-2">
      <div className="min-w-0">
        <div className="flex items-center gap-2 text-[13px] font-medium text-text">{label}{saved && <Check className="h-3.5 w-3.5 text-good-ink" aria-label="Saved" />}</div>
        {hint && <p className="text-[12px] text-text-3">{hint}</p>}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
        className={cn("relative mt-0.5 inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors", checked ? "bg-brand" : "bg-border-strong")}
      >
        <span className={cn("inline-block h-4 w-4 rounded-full bg-white shadow transition-transform", checked ? "translate-x-4.5" : "translate-x-0.5")} />
      </button>
    </div>
  );
}
