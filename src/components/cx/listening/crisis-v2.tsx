"use client";

import { Check, ClipboardList, FileText, Plus, Sparkles, Ticket, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  attachPlaybookAction,
  deletePlaybookAction,
  draftStatementAction,
  saveExtraSettingsAction,
  savePlaybookAction,
  ticketEventAction,
  toggleStepAction,
} from "@/app/(app)/cx/crisis/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/ui/confirm";
import { Callout } from "@/components/ui/feedback";
import { Checkbox, Field, Input, Select, Textarea } from "@/components/ui/input";
import { dateTimeLabel } from "@/lib/format";
import { cn } from "@/lib/utils";

type Msg = { ok: boolean; text: string } | null;
const Note = ({ msg }: { msg: Msg }) => (msg ? <span className={cn("text-[12.5px]", msg.ok ? "text-good-ink" : "text-critical-ink")}>{msg.text}</span> : null);

/** Auto-ticketing, review-drop and trending-alert settings. */
export function ExtraSettingsForm({ brandId, initial, compact }: { brandId: string; initial: { autoTicket: boolean; autoTicketAll: boolean; ratingDrop: number; trendingAlerts: boolean }; compact?: boolean }) {
  const router = useRouter();
  const [s, setS] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    const r = await saveExtraSettingsAction(brandId, s);
    setSaving(false);
    setMsg(r.ok ? { ok: true, text: "Saved." } : { ok: false, text: r.error });
    if (r.ok) router.refresh();
  };
  return (
    <form onSubmit={save} className="grid gap-3 px-4 pb-4">
      {!compact && (
        <>
          <label className="flex items-start gap-2 text-[13px]">
            <Checkbox checked={s.autoTicket} onChange={(e) => setS({ ...s, autoTicket: e.target.checked })} />
            <span>Auto-create inbox tickets for crisis mentions <span className="block text-[12px] text-text-3">Up to 25 per detection run, tagged “listening”.</span></span>
          </label>
          {s.autoTicket && (
            <label className="ml-6 flex items-center gap-2 text-[13px]">
              <Checkbox checked={s.autoTicketAll} onChange={(e) => setS({ ...s, autoTicketAll: e.target.checked })} /> Include non-negative mentions
            </label>
          )}
          <label className="flex items-center gap-2 text-[13px]">
            <Checkbox checked={s.trendingAlerts} onChange={(e) => setS({ ...s, trendingAlerts: e.target.checked })} /> Alert on trending issues (≥ 3× normal)
          </label>
        </>
      )}
      <Field label="Rating-drop alert (stars)" htmlFor="x-rd" hint="Alert when the 7-day average rating falls this much below the previous 30 days">
        <Input id="x-rd" type="number" step="0.1" min={0.1} max={4} value={s.ratingDrop} onChange={(e) => setS({ ...s, ratingDrop: Number(e.target.value) })} />
      </Field>
      <div className="flex items-center gap-3">
        <Button type="submit" variant={compact ? "secondary" : "primary"} loading={saving}>Save</Button>
        <Note msg={msg} />
      </div>
    </form>
  );
}

/** Event tools: tickets from crisis mentions, AI holding statement, debrief link. */
export function EventTools({ brandId, eventId, untickedNegative, aiReady }: { brandId: string; eventId: string; untickedNegative: number; aiReady: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<Msg>(null);
  const [draft, setDraft] = useState<string | null>(null);
  const tickets = async (all: boolean) => {
    setBusy(all ? "all" : "neg");
    const r = await ticketEventAction(brandId, eventId, all);
    setBusy(null);
    setMsg(r.ok ? { ok: true, text: r.data.created ? `Created ${r.data.created} ticket${r.data.created > 1 ? "s" : ""}.` : "No mentions left to ticket." } : { ok: false, text: r.error });
    router.refresh();
  };
  const statement = async () => {
    setBusy("ai");
    const r = await draftStatementAction(brandId, eventId);
    setBusy(null);
    if (!r.ok) setMsg({ ok: false, text: r.error });
    else setDraft(r.data.text ?? "");
  };
  return (
    <div className="grid gap-2">
      <Button variant="secondary" onClick={() => tickets(false)} loading={busy === "neg"} disabled={busy === "neg" || !untickedNegative}>
        <Ticket className="h-4 w-4" /> Ticket negative mentions ({untickedNegative})
      </Button>
      <Button variant="ghost" onClick={() => tickets(true)} loading={busy === "all"}>
        <Ticket className="h-4 w-4" /> Ticket all linked mentions
      </Button>
      <Link href={`/cx/crisis/debrief?brand=${brandId}&event=${eventId}`} className="inline-flex h-9 items-center justify-center gap-2 rounded-md border border-border-strong bg-surface px-3 text-[13px] font-medium text-text hover:bg-surface-2">
        <FileText className="h-4 w-4" /> Debrief report
      </Link>
      {aiReady ? (
        <Button variant="ghost" onClick={statement} loading={busy === "ai"}>
          <Sparkles className="h-4 w-4" /> Draft holding statement
        </Button>
      ) : (
        <p className="text-[12px] text-text-3">Connect an AI key (Anthropic, OpenAI, Gemini or Sarvam) to draft holding statements and reply templates.</p>
      )}
      <Note msg={msg} />
      {draft != null && (
        <Callout tone="info" title="AI draft: review before use">
          {draft ? <pre className="font-sans text-[12.5px] whitespace-pre-wrap">{draft}</pre> : "The AI provider returned no text."}
        </Callout>
      )}
    </div>
  );
}

type Item = { id: string; text: string; done: boolean; by: string | null; at: string | null };

/** Playbook checklists attached to an event, plus attaching another playbook. */
export function Checklists({ brandId, eventId, checklists, playbooks }: { brandId: string; eventId: string; checklists: { playbook_id: string; name: string; items: Item[] }[]; playbooks: { id: string; name: string }[] }) {
  const router = useRouter();
  const [pick, setPick] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const available = playbooks.filter((p) => !checklists.some((c) => c.playbook_id === p.id));
  const toggle = async (pb: string, id: string, done: boolean) => {
    setBusy(`${pb}:${id}`);
    const r = await toggleStepAction(brandId, eventId, pb, id, done);
    setBusy(null);
    if (!r.ok) setErr(r.error);
    router.refresh();
  };
  const attach = async () => {
    if (!pick) return;
    setBusy("attach");
    const r = await attachPlaybookAction(brandId, eventId, pick);
    setBusy(null);
    if (!r.ok) setErr(r.error);
    setPick("");
    router.refresh();
  };
  return (
    <div className="grid gap-4 px-4 pb-4">
      {checklists.map((c) => {
        const done = c.items.filter((i) => i.done).length;
        return (
          <div key={c.playbook_id}>
            <div className="mb-1.5 flex items-center justify-between gap-2">
              <span className="text-[13px] font-semibold">{c.name}</span>
              <Badge tone={done === c.items.length ? "good" : "neutral"}>{done}/{c.items.length}</Badge>
            </div>
            <ul className="grid gap-1">
              {c.items.map((i) => (
                <li key={i.id}>
                  <label className="flex items-start gap-2 text-[13px]">
                    <Checkbox checked={i.done} disabled={busy === `${c.playbook_id}:${i.id}`} onChange={(e) => toggle(c.playbook_id, i.id, e.target.checked)} />
                    <span className={cn(i.done && "text-text-3 line-through")}>
                      {i.text}
                      {i.done && i.at && <span className="block text-[11.5px] text-text-3 no-underline">{i.by} · {dateTimeLabel(i.at)}</span>}
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
      {!checklists.length && <p className="text-[12.5px] text-text-3">No playbook attached. Playbooks set to auto-attach are added when an event opens.</p>}
      {available.length > 0 ? (
        <div className="flex gap-2">
          <Select aria-label="Playbook" value={pick} onChange={(e) => setPick(e.target.value)} className="min-w-0 flex-1">
            <option value="">Attach a playbook…</option>
            {available.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </Select>
          <Button variant="secondary" onClick={attach} loading={busy === "attach"} disabled={busy === "attach" || !pick}>Attach</Button>
        </div>
      ) : (
        !playbooks.length && <Link className="text-[12.5px] text-link" href={`/cx/crisis/playbooks?brand=${brandId}`}>Create a playbook</Link>
      )}
      {err && <span className="text-[12.5px] text-critical-ink">{err}</span>}
    </div>
  );
}

type PB = { id: string; name: string; description: string; auto_attach: "none" | "any" | "critical"; steps: { id: string; text: string }[] };
const TEMPLATE = { name: "Negative spike response", description: "First-hour response to a negative sentiment spike.", autoAttach: "critical" as const, steps: ["Confirm the facts with the owning team", "Post a holding statement on affected channels", "Brief support agents with the reply template", "Reply to the top 10 most-followed authors", "Share an update within 4 hours", "Write the debrief once resolved"] };

/** Create / edit / delete playbooks (checklists of steps attached to crisis events). */
export function PlaybookManager({ brandId, playbooks }: { brandId: string; playbooks: PB[] }) {
  const router = useRouter();
  const [edit, setEdit] = useState<{ id?: string; name: string; description: string; autoAttach: "none" | "any" | "critical"; steps: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);
  const { confirm, confirmDialog } = useConfirm();
  const open = (p?: PB) => setEdit(p ? { id: p.id, name: p.name, description: p.description, autoAttach: p.auto_attach, steps: p.steps.map((s) => s.text).join("\n") } : { ...TEMPLATE, steps: TEMPLATE.steps.join("\n") });
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!edit) return;
    setSaving(true);
    const r = await savePlaybookAction(brandId, { name: edit.name, description: edit.description, autoAttach: edit.autoAttach, steps: edit.steps.split("\n") }, edit.id);
    setSaving(false);
    if (!r.ok) return setMsg({ ok: false, text: r.error });
    setEdit(null);
    setMsg({ ok: true, text: "Saved." });
    router.refresh();
  };
  const remove = async (p: PB) => {
    if (!(await confirm({ title: `Delete the playbook “${p.name}”?`, description: "Checklists attached to events are removed too." }))) return;
    const id = p.id;
    const r = await deletePlaybookAction(brandId, id);
    if (!r.ok) setMsg({ ok: false, text: r.error });
    router.refresh();
  };
  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_420px]">
      <div className="grid content-start gap-3">
        {playbooks.map((p) => (
          <div key={p.id} className="rounded-lg border border-border bg-surface p-4 shadow-card">
            <div className="flex flex-wrap items-center gap-2">
              <ClipboardList className="h-4 w-4 text-text-3" aria-hidden />
              <span className="text-[14px] font-semibold">{p.name}</span>
              <Badge tone={p.auto_attach === "none" ? "neutral" : "warning"}>{p.auto_attach === "none" ? "Manual" : p.auto_attach === "any" ? "Auto: every event" : "Auto: critical events"}</Badge>
              <span className="ml-auto flex gap-1">
                <Button size="sm" variant="ghost" onClick={() => open(p)}>Edit</Button>
                <Button size="sm" variant="ghost" onClick={() => remove(p)} aria-label={`Delete ${p.name}`}><Trash2 className="h-4 w-4" /></Button>
              </span>
            </div>
            {p.description && <p className="mt-1 text-[12.5px] text-text-2">{p.description}</p>}
            <ol className="mt-2 grid list-decimal gap-0.5 pl-5 text-[13px]">
              {p.steps.map((s) => <li key={s.id}>{s.text}</li>)}
            </ol>
          </div>
        ))}
        {!playbooks.length && <p className="rounded-lg border border-dashed border-border-strong p-6 text-center text-[13px] text-text-3">No playbooks yet. Start from the template and adapt the steps to your team.</p>}
        <div className="flex items-center gap-3">
          <Button variant="primary" onClick={() => open()}><Plus className="h-4 w-4" /> New playbook</Button>
          <Note msg={msg} />
        </div>
      </div>
      {edit && (
        <form onSubmit={save} className="grid content-start gap-3 rounded-lg border border-border bg-surface p-4 shadow-card">
          <h3 className="text-[14px] font-semibold">{edit.id ? "Edit playbook" : "New playbook"}</h3>
          <Field label="Name" htmlFor="pb-n"><Input id="pb-n" value={edit.name} maxLength={80} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></Field>
          <Field label="Description" htmlFor="pb-d"><Input id="pb-d" value={edit.description} maxLength={500} onChange={(e) => setEdit({ ...edit, description: e.target.value })} /></Field>
          <Field label="Attach automatically" htmlFor="pb-a">
            <Select id="pb-a" value={edit.autoAttach} onChange={(e) => setEdit({ ...edit, autoAttach: e.target.value as "none" })}>
              <option value="none">Never (attach manually)</option>
              <option value="any">To every new crisis event</option>
              <option value="critical">To new critical events</option>
            </Select>
          </Field>
          <Field label="Steps" htmlFor="pb-s" hint="One step per line">
            <Textarea id="pb-s" rows={8} value={edit.steps} onChange={(e) => setEdit({ ...edit, steps: e.target.value })} />
          </Field>
          <div className="flex gap-2">
            <Button type="submit" variant="primary" loading={saving}><Check className="h-4 w-4" /> Save</Button>
            <Button type="button" variant="ghost" onClick={() => setEdit(null)}>Cancel</Button>
          </div>
        </form>
      )}
      {confirmDialog}
    </div>
  );
}
