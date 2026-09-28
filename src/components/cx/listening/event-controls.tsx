"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { addNoteAction, updateEventAction } from "@/app/(app)/cx/crisis/actions";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/feedback";
import { Field, Input, Select, Textarea } from "@/components/ui/input";

/** Status / severity / owner controls and the note composer of a crisis event. */
export function EventControls({ brandId, id, status, severity, owner }: { brandId: string; id: string; status: string; severity: string; owner: string }) {
  const router = useRouter();
  const [ownerVal, setOwner] = useState(owner);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const update = async (key: string, patch: Parameters<typeof updateEventAction>[2]) => {
    setBusy(key);
    setError(null);
    const r = await updateEventAction(brandId, id, patch);
    setBusy(null);
    if (!r.ok) setError(r.error);
    else router.refresh();
  };
  const addNote = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy("note");
    setError(null);
    const r = await addNoteAction(brandId, id, note);
    setBusy(null);
    if (!r.ok) return setError(r.error);
    setNote("");
    router.refresh();
  };
  return (
    <div className="grid gap-3">
      {error && <Callout tone="critical">{error}</Callout>}
      <div className="grid grid-cols-2 gap-3">
        <Field label="Status" htmlFor="e-status">
          <Select id="e-status" value={status} disabled={busy === "status"} onChange={(e) => update("status", { status: e.target.value as "open" })}>
            <option value="open">Open</option>
            <option value="monitoring">Monitoring</option>
            <option value="resolved">Resolved</option>
          </Select>
        </Field>
        <Field label="Severity" htmlFor="e-sev">
          <Select id="e-sev" value={severity} disabled={busy === "severity"} onChange={(e) => update("severity", { severity: e.target.value as "warning" })}>
            <option value="warning">Warning</option>
            <option value="critical">Critical</option>
          </Select>
        </Field>
      </div>
      <form
        className="flex items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          update("owner", { owner: ownerVal.trim() });
        }}
      >
        <Field label="Escalation owner" htmlFor="e-owner" className="flex-1">
          <Input id="e-owner" value={ownerVal} onChange={(e) => setOwner(e.target.value)} maxLength={120} placeholder="Name or email" />
        </Field>
        <Button type="submit" loading={busy === "owner"} disabled={ownerVal.trim() === owner}>Assign</Button>
      </form>
      <form onSubmit={addNote} className="grid gap-2">
        <Field label="Add a note" htmlFor="e-note">
          <Textarea id="e-note" rows={3} value={note} onChange={(e) => setNote(e.target.value)} maxLength={4000} placeholder="Actions taken, statements issued, next steps…" />
        </Field>
        <div>
          <Button type="submit" variant="primary" loading={busy === "note"} disabled={!note.trim()}>Add note</Button>
        </div>
      </form>
    </div>
  );
}
