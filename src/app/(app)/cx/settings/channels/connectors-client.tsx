"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { runOk } from "../_admin/k-ui";
import { Field, useRun } from "../_admin/ui";
import { saveConnectorAction } from "./connector-actions";

export type ConnectorDef = { kind: string; name: string; api: string; costNote: string; setup: string; delay: string };
export type ConnectorForm = { id?: string; kind: string; name: string; token: string; channelId: string; base: string; username: string };

/** Connect / edit a free connector (Discord bot, Discourse forum, Telegram bot). Verifies the credentials before saving. */
export function ConnectorDialog({ brand, def, initial, onClose }: { brand: string; def: ConnectorDef; initial?: Partial<ConnectorForm>; onClose: () => void }) {
  const { run, busy, error } = useRun();
  const [form, setForm] = useState<ConnectorForm>({ kind: def.kind, name: def.name, token: "", channelId: "", base: "", username: "", ...initial });
  const save = async () => {
    if (busy === "save") return;
    if (await runOk(run, "save", saveConnectorAction(brand, form.kind, form.name, { token: form.token, channelId: form.channelId, base: form.base, username: form.username }, form.id))) onClose();
  };
  return (
    <Dialog open onClose={onClose} title={form.id ? `Edit ${form.name}` : `Connect ${def.name}`} error={error} onSubmit={save}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button type="submit" variant="primary" loading={busy === "save"}>Verify and save</Button></>}>
      <div className="space-y-3">
        <div className="space-y-1">
          <p className="text-[12.5px] text-text-2">{def.setup}</p>
          <p className="text-[12px] text-text-3">{def.api} · {def.costNote} · {def.delay}</p>
        </div>
        <Field label="Name"><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
        {form.kind === "discourse" && (
          <>
            <Field label="Forum URL"><Input autoFocus value={form.base} placeholder="https://forum.example.com" onChange={(e) => setForm({ ...form, base: e.target.value })} /></Field>
            <Field label="API username"><Input value={form.username} placeholder="support" onChange={(e) => setForm({ ...form, username: e.target.value })} /></Field>
          </>
        )}
        <Field label={form.kind === "discourse" ? "API key" : "Bot token"} hint={form.id ? "Stored encrypted. Leave empty to keep the current one." : "Stored encrypted."}>
          <Input type="password" autoFocus={form.kind !== "discourse"} autoComplete="off" value={form.token} onChange={(e) => setForm({ ...form, token: e.target.value })} />
        </Field>
        {form.kind === "discord" && <Field label="Support channel id" hint="Discord → User settings → Advanced → Developer mode, then right-click the channel → Copy channel ID."><Input value={form.channelId} onChange={(e) => setForm({ ...form, channelId: e.target.value })} /></Field>}
      </div>
    </Dialog>
  );
}
