"use client";

import { FileText, MoreHorizontal, Pencil, Send, Trash2, Upload } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { assistantDeleteAction, assistantRenameAction, assistantSendAction, vaultDeleteAction, vaultPasteAction } from "@/app/(app)/cx/ask/actions";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/ui/confirm";
import { Dialog, Menu, MenuItem } from "@/components/ui/dialog";
import { Callout } from "@/components/ui/feedback";
import { Field, Input, Textarea } from "@/components/ui/input";

export const SUGGESTIONS = [
  "How many mentions did we get this week, and on which platforms?",
  "Which platform is most negative right now?",
  "What are the top complaints this month?",
  "What are people talking about on Reddit lately?",
  "Compare news and YouTube sentiment over the last 30 days",
  "How has our sentiment changed recently?",
];

/** Chat input with suggested questions. Sends to the current session (or starts one) and opens it. */
export function AssistantComposer({ brand, sessionId, ai, showSuggestions }: { brand: string; sessionId: string | null; ai: boolean; showSuggestions: boolean }) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [sent, setSent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const send = (q: string) =>
    start(async () => {
      setError(null);
      setSent(q);
      const r = await assistantSendAction(brand, sessionId, q);
      setSent(null);
      if (!r.ok) return setError(r.error);
      setText("");
      if (r.data.sessionId !== sessionId) router.push(`/cx/ask?brand=${brand}&session=${r.data.sessionId}`);
      else router.refresh();
    });
  return (
    <div className="space-y-2">
      {pending && sent && (
        <div className="space-y-2">
          <div className="ml-auto w-fit max-w-[85%] rounded-lg bg-brand-soft px-3 py-2 text-[13.5px] whitespace-pre-line text-text">{sent}</div>
          <div className="flex items-center gap-2 text-[12.5px] text-text-3">
            <span className="h-2 w-2 animate-pulse rounded-full bg-brand" /> Looking up your data and writing the answer…
          </div>
        </div>
      )}
      {error && <Callout tone="critical">{error}</Callout>}
      {showSuggestions && !pending && (
        <div className="flex flex-wrap gap-1.5">
          {SUGGESTIONS.map((x) => (
            <button key={x} type="button" disabled={!ai} onClick={() => send(x)} className="rounded-full border border-border bg-surface px-2.5 py-1 text-left text-[12px] text-text-2 hover:bg-surface-3 disabled:opacity-60">
              {x}
            </button>
          ))}
        </div>
      )}
      <form
        className="flex items-end gap-2 rounded-lg border border-border-strong bg-surface p-2 shadow-card"
        onSubmit={(e) => {
          e.preventDefault();
          if (text.trim() && !pending) send(text.trim());
        }}
      >
        <Textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              if (text.trim() && !pending) send(text.trim());
            }
          }}
          disabled={!ai}
          placeholder={ai ? "Ask about mentions, sentiment, platforms, support metrics or your own documents…" : "Connect an AI key on the server to chat"}
          aria-label="Message"
          maxLength={2000}
          rows={2}
          className="min-h-11 flex-1 resize-none border-0 shadow-none focus:ring-0"
        />
        <Button type="submit" variant="primary" loading={pending} disabled={!ai || pending || !text.trim()} aria-label="Send">
          <Send className="h-4 w-4" />
        </Button>
      </form>
      <p className="text-[11.5px] text-text-3">Enter to send · Shift+Enter for a new line · Answers use only your stored data and documents and can still be wrong: check the sources.</p>
    </div>
  );
}

/** Rename / delete one chat. */
export function SessionMenu({ brand, id, title, active }: { brand: string; id: string; title: string; active: boolean }) {
  const router = useRouter();
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(title);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const { confirm, confirmDialog } = useConfirm();
  return (
    <>
      <Menu align="right" trigger={() => <button type="button" aria-label="Chat options" className="rounded p-1 text-text-3 hover:bg-surface-3 hover:text-text"><MoreHorizontal className="h-4 w-4" /></button>}>
        <MenuItem icon={<Pencil className="h-3.5 w-3.5" />} onClick={() => setRenaming(true)}>Rename</MenuItem>
        <MenuItem
          danger
          icon={<Trash2 className="h-3.5 w-3.5" />}
          onClick={async () => {
            if (!(await confirm({ title: "Delete this chat?", description: "Its messages are deleted for good.", confirmLabel: "Delete" }))) return;
            const r = await assistantDeleteAction(brand, id);
            if (!r.ok) return setError(r.error);
            if (active) router.push(`/cx/ask?brand=${brand}`);
            else router.refresh();
          }}
        >
          Delete
        </MenuItem>
      </Menu>
      <Dialog
        open={renaming}
        onClose={() => setRenaming(false)}
        title="Rename chat"
        size="sm"
        error={error}
        onSubmit={(e) => {
          e.preventDefault();
          start(async () => {
            const r = await assistantRenameAction(brand, id, name);
            if (!r.ok) return setError(r.error);
            setRenaming(false);
            router.refresh();
          });
        }}
        footer={<><Button variant="ghost" type="button" onClick={() => setRenaming(false)}>Cancel</Button><Button variant="primary" type="submit" loading={pending}>Save</Button></>}
      >
        <Field label="Name" htmlFor="chat-name"><Input id="chat-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} /></Field>
      </Dialog>
      {confirmDialog}
    </>
  );
}

/** Upload files or paste text into the knowledge vault. */
export function VaultAdd({ brand, accept }: { brand: string; accept: string }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ tone: "good" | "critical" | "warning"; text: string } | null>(null);
  const [paste, setPaste] = useState(false);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const upload = async (files: FileList | null) => {
    if (!files?.length) return;
    setBusy(true);
    setResult(null);
    const fd = new FormData();
    for (const f of Array.from(files).slice(0, 10)) fd.append("file", f);
    try {
      const res = await fetch(`/api/cx/assistant/vault?brand=${brand}`, { method: "POST", body: fd });
      const j = (await res.json()) as { added?: { name: string; chunks: number }[]; failed?: { name: string; error: string }[]; error?: string };
      if (j.error) setResult({ tone: "critical", text: j.error });
      else {
        const ok = j.added ?? [];
        const bad = j.failed ?? [];
        setResult({
          tone: bad.length ? (ok.length ? "warning" : "critical") : "good",
          text: [ok.length ? `Added ${ok.map((a) => `${a.name} (${a.chunks} passages)`).join(", ")}.` : "", ...bad.map((b) => `${b.name}: ${b.error}`)].filter(Boolean).join(" "),
        });
      }
      router.refresh();
    } catch {
      setResult({ tone: "critical", text: "Upload failed. Check your connection and try again." });
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  };
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <input ref={input} type="file" multiple accept={accept} className="hidden" onChange={(e) => upload(e.target.files)} />
        <Button variant="primary" loading={busy} onClick={() => input.current?.click()}><Upload className="h-4 w-4" /> Upload files</Button>
        <Button onClick={() => { setPaste(true); setError(null); }}><FileText className="h-4 w-4" /> Paste text</Button>
      </div>
      {result && <Callout tone={result.tone}>{result.text}</Callout>}
      <Dialog
        open={paste}
        onClose={() => setPaste(false)}
        title="Add text to the vault"
        description="Paste a policy, FAQ, fee structure, press release or any reference text the assistant should answer from."
        size="lg"
        error={error}
        onSubmit={(e) => {
          e.preventDefault();
          start(async () => {
            const r = await vaultPasteAction(brand, title, body);
            if (!r.ok) return setError(r.error);
            setPaste(false);
            setTitle("");
            setBody("");
            setResult({ tone: "good", text: `Added “${title}” (${r.data.chunks} passages).` });
            router.refresh();
          });
        }}
        footer={<><Button variant="ghost" type="button" onClick={() => setPaste(false)}>Cancel</Button><Button variant="primary" type="submit" loading={pending}>Add to vault</Button></>}
      >
        <div className="space-y-3">
          <Field label="Title" htmlFor="v-title"><Input id="v-title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={160} placeholder="e.g. Hostel fee policy 2026" /></Field>
          <Field label="Text" htmlFor="v-body"><Textarea id="v-body" value={body} onChange={(e) => setBody(e.target.value)} rows={12} /></Field>
        </div>
      </Dialog>
    </div>
  );
}

export function VaultDelete({ brand, id, title }: { brand: string; id: string; title: string }) {
  const router = useRouter();
  const { confirm, confirmDialog } = useConfirm();
  const [pending, start] = useTransition();
  return (
    <>
      <Button
        size="icon"
        variant="ghost"
        aria-label={`Delete ${title}`}
        loading={pending}
        onClick={async () => (await confirm({ title: `Delete “${title}”?`, description: "The assistant stops using it.", confirmLabel: "Delete" })) && start(async () => { await vaultDeleteAction(brand, id); router.refresh(); })}
      >
        <Trash2 className="h-4 w-4" />
      </Button>
      {confirmDialog}
    </>
  );
}
