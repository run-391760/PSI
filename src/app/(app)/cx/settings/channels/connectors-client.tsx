"use client";

import { Plug, RefreshCw } from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Field, When, useRun } from "../_admin/ui";
import { saveConnectorAction, syncConnectorAction } from "./connector-actions";

type Connector = { kind: string; name: string; api: string; costNote: string; setup: string; delay: string };
type Card_ = { kind: string; name: string; api: string; cost: string; costNote: string; env: readonly string[]; configured: boolean };
type Row = { id: string; kind: string; name: string; config: Record<string, unknown>; status: string; last_error: string | null; last_synced_at: string | null; tickets: number };
type Form = { id?: string; kind: string; name: string; token: string; channelId: string; base: string; username: string };

export function ConnectorsSection({ brand, connectors, cards, rows }: { brand: string; connectors: Connector[]; cards: Card_[]; rows: Row[] }) {
  const { run, busy, messages } = useRun();
  const [form, setForm] = useState<Form | null>(null);
  const def = connectors.find((c) => c.kind === form?.kind);
  const detail = (r: Row) => (r.kind === "discord" ? `#${String(r.config.channelName ?? r.config.channelId ?? "")}` : r.kind === "discourse" ? String(r.config.base ?? "") : `@${String(r.config.bot ?? "")}`);
  return (
    <div className="mt-6 space-y-4">
      <Card>
        <CardHeader title="Community and messaging connectors" description="Free connectors that turn Discord channel messages, Discourse forum posts and Telegram bot chats into tickets, and send agent replies back." />
        <CardBody className="space-y-3">
          {messages}
          <div className="grid gap-3 md:grid-cols-3">
            {connectors.map((c) => {
              const mine = rows.filter((r) => r.kind === c.kind);
              return (
                <div key={c.kind} className="flex flex-col rounded-md border border-border p-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[13.5px] font-semibold text-text">{c.name}</span>
                    <Badge tone="good">{c.costNote}</Badge>
                  </div>
                  <p className="mt-0.5 text-[12px] text-text-3">{c.api} · {c.delay}</p>
                  <ul className="mt-2 flex-1 space-y-1.5">
                    {mine.map((r) => (
                      <li key={r.id} className="rounded bg-surface-2 px-2 py-1.5 text-[12.5px]">
                        <div className="flex items-center gap-1.5">
                          <span className="min-w-0 flex-1 truncate font-medium text-text">{r.name}</span>
                          <Badge tone={r.status === "error" ? "critical" : r.status === "paused" ? "neutral" : "good"}>{r.status}</Badge>
                        </div>
                        <div className="truncate text-[11.5px] text-text-3">{detail(r)} · {r.tickets} tickets · {r.last_synced_at ? <>synced <When iso={r.last_synced_at} time /></> : "not synced yet"}</div>
                        {r.last_error && <div className="text-[11.5px] text-critical-ink">{r.last_error}</div>}
                        <div className="mt-1 flex gap-1">
                          <Button size="sm" variant="ghost" className="h-6 px-1.5" loading={busy === `s-${r.id}`} onClick={() => run(`s-${r.id}`, syncConnectorAction(brand, r.id), (x) => `${r.name}: ${x.created} new tickets, ${x.threaded} replies threaded.`)}><RefreshCw className="h-3 w-3" />Sync now</Button>
                          <Button size="sm" variant="ghost" className="h-6 px-1.5" onClick={() => setForm({ id: r.id, kind: r.kind, name: r.name, token: "", channelId: String(r.config.channelId ?? ""), base: String(r.config.base ?? ""), username: String(r.config.username ?? "") })}>Edit</Button>
                        </div>
                      </li>
                    ))}
                  </ul>
                  <Button size="sm" className="mt-2 self-start" onClick={() => setForm({ kind: c.kind, name: c.name, token: "", channelId: "", base: "", username: "" })}><Plug className="h-3.5 w-3.5" />Connect {c.name}</Button>
                </div>
              );
            })}
          </div>
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Channels that need a platform partnership" description="These platforms only open their APIs to approved apps or paid plans. Add the server keys listed on each card (ask your administrator), then connect." />
        <CardBody>
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
            {cards.map((c) => (
              <div key={c.kind} className="rounded-md border border-border p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[13px] font-semibold text-text">{c.name}</span>
                  <Badge tone={c.configured ? "good" : c.cost === "paid" ? "warning" : "neutral"}>{c.configured ? "Keys set" : c.cost === "paid" ? "Paid" : "Needs approval"}</Badge>
                </div>
                <p className="mt-0.5 text-[12px] text-text-2">{c.api}</p>
                <p className="text-[12px] text-text-3">{c.costNote}</p>
                <p className="mt-1.5 font-mono text-[11px] break-all text-text-3">{c.env.join(", ")}</p>
              </div>
            ))}
          </div>
        </CardBody>
      </Card>
      <Dialog open={!!form} onClose={() => setForm(null)} title={form?.id ? `Edit ${form.name}` : `Connect ${def?.name ?? ""}`} description={def?.setup}
        footer={<><Button onClick={() => setForm(null)}>Cancel</Button><Button variant="primary" loading={busy === "save"} onClick={async () => { if (!form) return; if (await run("save", saveConnectorAction(brand, form.kind, form.name, { token: form.token, channelId: form.channelId, base: form.base, username: form.username }, form.id), () => "Connected. New messages arrive on the next sync.")) setForm(null); }}>Verify and save</Button></>}>
        {form && (
          <div className="space-y-3">
            <Field label="Name"><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
            {form.kind === "discourse" && (
              <>
                <Field label="Forum URL"><Input value={form.base} placeholder="https://forum.example.com" onChange={(e) => setForm({ ...form, base: e.target.value })} /></Field>
                <Field label="API username"><Input value={form.username} placeholder="support" onChange={(e) => setForm({ ...form, username: e.target.value })} /></Field>
              </>
            )}
            <Field label={form.kind === "discourse" ? "API key" : "Bot token"} hint={form.id ? "Stored encrypted. Leave empty to keep the current one." : "Stored encrypted."}>
              <Input type="password" autoComplete="off" value={form.token} onChange={(e) => setForm({ ...form, token: e.target.value })} />
            </Field>
            {form.kind === "discord" && <Field label="Support channel id" hint="Discord → User settings → Advanced → Developer mode, then right-click the channel → Copy channel ID."><Input value={form.channelId} onChange={(e) => setForm({ ...form, channelId: e.target.value })} /></Field>}
          </div>
        )}
      </Dialog>
    </div>
  );
}
