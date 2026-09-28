"use client";

import { Copy, KeyRound, Pencil, Plus, RefreshCw, Send, Trash2, Webhook } from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Callout, EmptyState } from "@/components/ui/feedback";
import { Input, Select, Textarea } from "@/components/ui/input";
import { MiniTable } from "@/components/ui/mini-table";
import type { ApiToken } from "@/lib/cx/admin/api";
import { API_ROUTES, MAX_RETRIES, WEBHOOK_EVENTS } from "@/lib/cx/admin/pure/webhooks";
import type { ExternalApi, WebhookRow } from "@/lib/cx/admin/webhooks";
import { CheckRow, Field, When, useRun } from "../_admin/ui";
import {
  createTokenAction, deleteExternalApiAction, deleteWebhookAction, redeliverAction, revokeTokenAction, rotateSecretAction, saveExternalApiAction,
  saveWebhookAction, testExternalApiAction, testWebhookAction, type ExternalApiInput,
} from "./actions";

function Secret({ label, value, onClose }: { label: string; value: string | null; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  return (
    <Dialog size="md" open={!!value} onClose={onClose} title={label} description="Copy it now. For security it won't be shown again." footer={<Button variant="primary" onClick={onClose}>Done</Button>}>
      <div className="flex gap-1.5">
        <Input readOnly value={value ?? ""} className="font-mono text-[12px]" onFocus={(e) => e.target.select()} />
        <Button onClick={() => { navigator.clipboard?.writeText(value ?? ""); setCopied(true); }}><Copy className="h-3.5 w-3.5" />{copied ? "Copied" : "Copy"}</Button>
      </div>
    </Dialog>
  );
}

export function TokensPanel({ brand, tokens, base }: { brand: string; tokens: ApiToken[]; base: string }) {
  const { run, busy, messages } = useRun();
  const [form, setForm] = useState<{ kind: "account" | "user"; name: string } | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader title="API tokens" description="An account token identifies this brand and is enough to read. Writes also need a user token, which acts as the member who created it."
 />
        <CardBody>
          <div className="mb-3 flex flex-wrap justify-end gap-2"><Button size="sm" onClick={() => setForm({ kind: "user", name: "" })}><Plus className="h-3.5 w-3.5" />User token</Button><Button size="sm" variant="primary" onClick={() => setForm({ kind: "account", name: "" })}><Plus className="h-3.5 w-3.5" />Account token</Button></div>
          {messages}
          <MiniTable columns={[{ header: "Name" }, { header: "Type" }, { header: "Token" }, { header: "Last used" }, { header: "" }]} empty="No tokens yet."
            rows={tokens.map((t) => [
              <div key="n" className="min-w-28"><div className="font-medium text-text">{t.name}</div>{t.user_name && <div className="text-[12px] text-text-3">acts as {t.user_name}</div>}</div>,
              <Badge key="k" tone={t.kind === "account" ? "brand" : "info"}>{t.kind}</Badge>,
              <code key="p" className="text-[12px] whitespace-nowrap">{t.prefix}</code>,
              <span key="u" className="text-[12px] whitespace-nowrap text-text-2">{t.revoked_at ? <Badge tone="critical">Revoked</Badge> : <When iso={t.last_used_at} />}</span>,
              t.revoked_at ? null : <Button key="r" size="sm" variant="ghost" onClick={() => confirm(`Revoke "${t.name}"? Apps using it stop working immediately.`) && run("rv", revokeTokenAction(brand, t.id))}>Revoke</Button>,
            ])} />
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Using the API" />
        <CardBody className="space-y-2 text-[13px] text-text-2">
          <p>Base URL <code className="rounded bg-surface-3 px-1 text-text">{base}</code>. Send <code>Authorization: Bearer cxa_…</code>, plus <code>X-User-Token: cxu_…</code> for writes. Responses are JSON; lists take <code>limit</code> (up to 500) and date filters in ISO 8601.</p>
          <pre className="scroll-thin overflow-x-auto rounded-md bg-surface-3 p-2.5 text-[12px] text-text">{`curl -H "Authorization: Bearer $CX_ACCOUNT_TOKEN" \\\n  "${base}/tickets?status=open&limit=50"`}</pre>
        </CardBody>
      </Card>
      <Dialog size="sm" open={!!form} onClose={() => setForm(null)} title={form?.kind === "account" ? "New account token" : "New user token"} description={form?.kind === "user" ? "Writes made with this token are recorded as you." : "Grants read access to this brand's data."}
        footer={<><Button onClick={() => setForm(null)}>Cancel</Button><Button variant="primary" loading={busy === "c"} onClick={async () => { if (!form) return; const t = await run("c", createTokenAction(brand, form.kind, form.name)); if (t) { setForm(null); setSecret(t); } }}>Create</Button></>}>
        {form && <Field label="Name"><Input autoFocus value={form.name} placeholder="Data warehouse sync" maxLength={60} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>}
      </Dialog>
      <Secret label="Your new token" value={secret} onClose={() => setSecret(null)} />
    </div>
  );
}

type Delivery = { id: string; webhook_id: string; event: string; attempts: number; state: string; response_code: number | null; error: string | null; next_attempt_at: string; created_at: string };
export function WebhooksPanel({ brand, hooks, deliveries }: { brand: string; hooks: WebhookRow[]; deliveries: Delivery[] }) {
  const { run, busy, messages } = useRun();
  const [edit, setEdit] = useState<{ id?: string; name: string; url: string; events: string[]; active: boolean } | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader title="Webhooks" description={`Events are POSTed as JSON, signed with HMAC-SHA256 in X-CX-Signature (over "timestamp.body"). Failed deliveries retry ${MAX_RETRIES} times with backoff; after that the webhook is switched off.`}
          actions={<Button size="sm" variant="primary" onClick={() => setEdit({ name: "", url: "", events: ["ticket.created"], active: true })}><Plus className="h-3.5 w-3.5" />Add webhook</Button>} />
        <CardBody>
          {messages}
          {hooks.length ? (
            <ul className="divide-y divide-border">
              {hooks.map((h) => (
                <li key={h.id} className="flex flex-wrap items-start gap-2 py-2.5">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5 text-[13px] font-medium text-text">
                      {h.name || "Webhook"}
                      {h.deactivated_at ? <Badge tone="critical">Deactivated after failures</Badge> : <Badge tone={h.active ? "good" : "neutral"}>{h.active ? "Active" : "Off"}</Badge>}
                      {h.failures > 0 && !h.deactivated_at && <Badge tone="warning">{h.failures} failures</Badge>}
                    </div>
                    <p className="truncate font-mono text-[12px] text-text-2">{h.url}</p>
                    <p className="text-[12px] text-text-3">{h.events.join(", ")} · last delivery <When iso={h.last_delivery_at} />{h.last_status ? ` (HTTP ${h.last_status})` : ""}{h.last_error ? ` · ${h.last_error}` : ""}</p>
                  </div>
                  <div className="flex gap-0.5">
                    <Button size="sm" variant="ghost" loading={busy === `t-${h.id}`} onClick={() => run(`t-${h.id}`, testWebhookAction(brand, h.id), (r) => (r.error ? `Test failed: ${r.error}` : `Test delivered (HTTP ${r.status}).`))}><Send className="h-3.5 w-3.5" />Test</Button>
                    <Button size="icon" variant="ghost" className="h-7 w-7" aria-label="Rotate secret" title="Rotate signing secret" onClick={async () => { if (!confirm("Rotate the signing secret? Your receiver must switch to the new one.")) return; const s = await run("rot", rotateSecretAction(brand, h.id)); if (s) setSecret(s); }}><RefreshCw className="h-3.5 w-3.5" /></Button>
                    <Button size="icon" variant="ghost" className="h-7 w-7" aria-label="Edit webhook" onClick={() => setEdit({ id: h.id, name: h.name, url: h.url, events: h.events, active: h.active && !h.deactivated_at })}><Pencil className="h-3.5 w-3.5" /></Button>
                    <Button size="icon" variant="ghost" className="h-7 w-7" aria-label="Delete webhook" onClick={() => confirm("Delete this webhook?") && run("d", deleteWebhookAction(brand, h.id))}><Trash2 className="h-3.5 w-3.5" /></Button>
                  </div>
                </li>
              ))}
            </ul>
          ) : <EmptyState icon={<Webhook className="h-5 w-5" />} title="No webhooks" description="Push ticket, message, SLA and alert events to your own systems as they happen." />}
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Recent deliveries" />
        <CardBody>
          <MiniTable columns={[{ header: "When" }, { header: "Event" }, { header: "State" }, { header: "Attempts", align: "right" }, { header: "" }]} empty="Nothing delivered yet."
            rows={deliveries.map((d) => [
              <span key="w" className="whitespace-nowrap text-[12px]"><When iso={d.created_at} /></span>,
              <code key="e" className="text-[12px]">{d.event}</code>,
              <span key="s">{d.state === "delivered" ? <Badge tone="good">Delivered</Badge> : d.state === "failed" ? <Badge tone="critical">Failed</Badge> : <Badge tone="warning">Retrying {<When iso={d.next_attempt_at} time />}</Badge>}{d.error && <span className="ml-1 text-[12px] text-text-3">{d.response_code ? `HTTP ${d.response_code}` : d.error}</span>}</span>,
              d.attempts,
              d.state === "failed" ? <Button key="r" size="sm" variant="ghost" onClick={() => run("rd", redeliverAction(brand, d.id), () => "Queued for redelivery.")}>Redeliver</Button> : null,
            ])} />
        </CardBody>
      </Card>
      <Dialog size="lg" open={!!edit} onClose={() => setEdit(null)} title={edit?.id ? "Edit webhook" : "Add webhook"}
        footer={<><Button onClick={() => setEdit(null)}>Cancel</Button><Button variant="primary" loading={busy === "save"} onClick={async () => { if (!edit) return; const r = await run("save", saveWebhookAction(brand, edit)); if (r) { setEdit(null); if (r.secret) setSecret(r.secret); } }}>Save</Button></>}>
        {edit && (
          <div className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Name"><Input autoFocus value={edit.name} maxLength={80} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></Field>
              <Field label="URL"><Input value={edit.url} placeholder="https://example.com/hooks/cx" onChange={(e) => setEdit({ ...edit, url: e.target.value })} /></Field>
            </div>
            <fieldset><legend className="mb-1.5 text-[12.5px] font-medium text-text-2">Events</legend>
              <div className="grid gap-1.5 sm:grid-cols-2">{WEBHOOK_EVENTS.map((e) => <CheckRow key={e.key} checked={edit.events.includes(e.key)} onChange={(v) => setEdit({ ...edit, events: v ? [...edit.events, e.key] : edit.events.filter((x) => x !== e.key) })} label={e.label} hint={e.key} />)}</div>
            </fieldset>
            <CheckRow checked={edit.active} onChange={(v) => setEdit({ ...edit, active: v })} label="Active" hint="Re-activating a deactivated webhook resets its failure count." />
          </div>
        )}
      </Dialog>
      <Secret label="Signing secret" value={secret} onClose={() => setSecret(null)} />
    </div>
  );
}

const blankApi = (): ExternalApiInput => ({ name: "", target: "ticket", method: "GET", url: "", body: "", headers: "", mapping: [{ label: "", path: "" }], active: true });
export function ExternalApisPanel({ brand, apis }: { brand: string; apis: ExternalApi[] }) {
  const { run, busy, messages } = useRun();
  const [edit, setEdit] = useState<(ExternalApiInput & { has_headers?: boolean }) | null>(null);
  const [result, setResult] = useState<{ sample: string; result: { api: string; ok: boolean; error: string | null; rows: { label: string; value: string }[] } | null } | null>(null);
  return (
    <Card>
      <CardHeader title="External APIs" description="Look up your own systems (orders, CRM, billing) and show the answer on the ticket or contact panel. Placeholders: {{contact.email}}, {{contact.phone}}, {{ticket.number}}, {{field.key}}."
        actions={<Button size="sm" variant="primary" onClick={() => setEdit(blankApi())}><Plus className="h-3.5 w-3.5" />Add API</Button>} />
      <CardBody>
        {messages}
        {result && (
          <Callout tone={result.result?.ok ? "good" : "warning"} className="mb-3" title={`Test on ${result.sample}`}>
            {result.result?.ok ? result.result.rows.map((r) => <div key={r.label}><span className="text-text-3">{r.label}:</span> {r.value}</div>) : result.result?.error ?? "No response."}
          </Callout>
        )}
        {apis.length ? (
          <ul className="divide-y divide-border">
            {apis.map((a) => (
              <li key={a.id} className="flex flex-wrap items-start gap-2 py-2.5">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5 text-[13px] font-medium text-text">{a.name}<Badge tone={a.active ? "good" : "neutral"}>{a.active ? "On" : "Off"}</Badge><Badge>{a.target}</Badge></div>
                  <p className="truncate font-mono text-[12px] text-text-2">{a.method} {a.url}</p>
                  <p className="text-[12px] text-text-3">Shows {a.mapping.map((m) => m.label).join(", ") || "nothing yet"}</p>
                </div>
                <Button size="sm" variant="ghost" loading={busy === `t-${a.id}`} onClick={async () => { const r = await run(`t-${a.id}`, testExternalApiAction(brand, a.id, a.target)); if (r) setResult(r); }}><Send className="h-3.5 w-3.5" />Test</Button>
                <Button size="icon" variant="ghost" className="h-7 w-7" aria-label={`Edit ${a.name}`} onClick={() => setEdit({ ...a, headers: "" })}><Pencil className="h-3.5 w-3.5" /></Button>
                <Button size="icon" variant="ghost" className="h-7 w-7" aria-label={`Delete ${a.name}`} onClick={() => confirm(`Delete "${a.name}"?`) && run("d", deleteExternalApiAction(brand, a.id))}><Trash2 className="h-3.5 w-3.5" /></Button>
              </li>
            ))}
          </ul>
        ) : <EmptyState icon={<KeyRound className="h-5 w-5" />} title="No External APIs" description="For example, call your order service with the customer's email and show their last order and plan next to the conversation." />}
      </CardBody>
      <Dialog size="xl" open={!!edit} onClose={() => setEdit(null)} title={edit?.id ? `Edit ${edit.name}` : "Add External API"}
        footer={<><Button onClick={() => setEdit(null)}>Cancel</Button><Button variant="primary" loading={busy === "save"} onClick={async () => { if (edit && (await run("save", saveExternalApiAction(brand, edit)))) setEdit(null); }}>Save</Button></>}>
        {edit && (
          <div className="grid gap-3 sm:grid-cols-4">
            <Field label="Name" className="sm:col-span-2"><Input autoFocus value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></Field>
            <Field label="Shows on"><Select value={edit.target} onChange={(e) => setEdit({ ...edit, target: e.target.value as "ticket" | "contact" })}><option value="ticket">Tickets</option><option value="contact">Contacts</option></Select></Field>
            <Field label="Method"><Select value={edit.method} onChange={(e) => setEdit({ ...edit, method: e.target.value as "GET" | "POST" })}><option>GET</option><option>POST</option></Select></Field>
            <Field label="URL" className="sm:col-span-4"><Input className="font-mono text-[12.5px]" value={edit.url} placeholder="https://orders.example.com/api/customers?email={{contact.email}}" onChange={(e) => setEdit({ ...edit, url: e.target.value })} /></Field>
            <Field label="Headers" className="sm:col-span-2" hint={edit.has_headers ? "Stored encrypted. Leave empty to keep them." : "One per line, e.g. Authorization: Bearer …"}><Textarea className="min-h-20 font-mono text-[12px]" value={edit.headers} onChange={(e) => setEdit({ ...edit, headers: e.target.value })} /></Field>
            <Field label="Body (POST)" className="sm:col-span-2"><Textarea className="min-h-20 font-mono text-[12px]" disabled={edit.method === "GET"} value={edit.body} placeholder={'{"email": "{{contact.email}}"}'} onChange={(e) => setEdit({ ...edit, body: e.target.value })} /></Field>
            <div className="space-y-1.5 sm:col-span-4">
              <div className="text-[12.5px] font-medium text-text-2">Show these values (JSON path in the response, e.g. data.orders.0.status)</div>
              {edit.mapping.map((m, i) => (
                <div key={i} className="flex gap-1.5">
                  <Input aria-label="Label" placeholder="Last order" value={m.label} onChange={(e) => setEdit({ ...edit, mapping: edit.mapping.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)) })} />
                  <Input aria-label="JSON path" className="font-mono text-[12.5px]" placeholder="orders.0.status" value={m.path} onChange={(e) => setEdit({ ...edit, mapping: edit.mapping.map((x, j) => (j === i ? { ...x, path: e.target.value } : x)) })} />
                  <Button size="icon" variant="ghost" aria-label="Remove" onClick={() => setEdit({ ...edit, mapping: edit.mapping.filter((_, j) => j !== i) })}><Trash2 className="h-3.5 w-3.5" /></Button>
                </div>
              ))}
              <Button size="sm" variant="ghost" onClick={() => setEdit({ ...edit, mapping: [...edit.mapping, { label: "", path: "" }] })}><Plus className="h-3.5 w-3.5" />Add value</Button>
            </div>
            <div className="sm:col-span-4"><CheckRow checked={edit.active} onChange={(v) => setEdit({ ...edit, active: v })} label="Show to agents" /></div>
          </div>
        )}
      </Dialog>
    </Card>
  );
}

export function ApiDocsPanel({ base }: { base: string }) {
  return (
    <Card>
      <CardHeader title="Endpoints" description={`All paths are relative to ${base}. Write endpoints need a user token.`} />
      <CardBody>
        <MiniTable columns={[{ header: "Method" }, { header: "Path" }, { header: "What it does" }]}
          rows={API_ROUTES.map((r) => [
            <Badge key="m" tone={r.write ? "warning" : "info"}>{r.method}</Badge>,
            <code key="p" className="text-[12px] whitespace-nowrap">/{r.path}</code>,
            <span key="d" className="text-[12.5px] text-text-2">{r.description}</span>,
          ])} />
      </CardBody>
    </Card>
  );
}
