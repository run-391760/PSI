"use client";

import { BellRing, Pencil, Plus, Send, Trash2 } from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/feedback";
import { Input, Select } from "@/components/ui/input";
import { MiniTable } from "@/components/ui/mini-table";
import { Segmented } from "@/components/ui/tabs";
import type { AlertRow, Integrations } from "@/lib/cx/admin/alerts";
import { TELEGRAM_MIN_INTERVAL_MIN } from "@/lib/cx/admin/pure/alerts";
import { CheckRow, Field, ListInput, When, useRun } from "../_admin/ui";
import { deleteAlertAction, disconnectTelegramAction, saveAlertAction, saveSlackAction, saveTelegramAction, telegramChatsAction, testAlertAction, toggleAlertAction, type AlertInput } from "./actions";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const blank = (): AlertInput => ({ name: "", source: "tickets", filters: { keywords: [], exclude: [], channels: [], sentiments: [], priorities: [], minItems: 1 }, delivery: { inapp: true, emails: [], bcc: [], slack: false, telegram: false }, format: "text", delay_minutes: 0, active_hours: null, active: true });

export function AlertsPanel({ brand, alerts, integrations, channels }: { brand: string; alerts: AlertRow[]; integrations: Integrations; channels: { value: string; label: string }[] }) {
  const { run, busy, messages } = useRun();
  const [edit, setEdit] = useState<AlertInput | null>(null);
  const toggleIn = (xs: string[], v: string, on: boolean) => (on ? [...new Set([...xs, v])] : xs.filter((x) => x !== v));
  const via = (a: AlertRow) => [a.delivery.inapp && "in-app", (a.delivery.emails.length || a.delivery.bcc.length) && `${a.delivery.emails.length + a.delivery.bcc.length} emails`, a.delivery.slack && "Slack", a.delivery.telegram && "Telegram"].filter(Boolean).join(", ");
  return (
    <Card>
      <CardHeader title="Alerts" description="Checked every minute. An alert fires when at least the minimum number of new matching items arrived, after the optional delay, within its active hours."
        actions={<Button size="sm" variant="primary" onClick={() => setEdit(blank())}><Plus className="h-3.5 w-3.5" />New alert</Button>} />
      <CardBody>
        {messages}
        {alerts.length ? (
          <ul className="divide-y divide-border">
            {alerts.map((a) => (
              <li key={a.id} className="flex flex-wrap items-start gap-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5 text-[13px] font-medium text-text">
                    {a.name}<Badge tone={a.active ? "good" : "neutral"}>{a.active ? "On" : "Off"}</Badge><Badge tone="info">{a.source === "tickets" ? "Tickets" : "Mentions"}</Badge>
                  </div>
                  <p className="text-[12px] text-text-2">
                    {a.filters.keywords.length ? `Keywords: ${a.filters.keywords.join(", ")}` : "Any content"}
                    {a.filters.channels.length ? ` · ${a.filters.channels.join(", ")}` : ""}{a.filters.sentiments.length ? ` · ${a.filters.sentiments.join(", ")}` : ""}
                    {a.filters.minItems > 1 ? ` · at least ${a.filters.minItems}` : ""}{a.delay_minutes ? ` · ${a.delay_minutes} min delay` : ""}
                  </p>
                  <p className="text-[12px] text-text-3">Via {via(a)} · fired {a.fired} times{a.last_fired_at && <>, last <When iso={a.last_fired_at} /></>}</p>
                </div>
                <div className="flex items-center gap-0.5">
                  <CheckRow checked={a.active} onChange={(v) => run("t", toggleAlertAction(brand, a.id, v))} label={<span className="sr-only">Active</span>} />
                  <Button size="sm" variant="ghost" loading={busy === `test-${a.id}`} onClick={() => run(`test-${a.id}`, testAlertAction(brand, a.id), (r) => `Test: ${r.map((x) => `${x.channel} ${x.error ? `failed (${x.error})` : "sent"}`).join(" · ")}`)}><Send className="h-3.5 w-3.5" />Test</Button>
                  <Button size="icon" variant="ghost" className="h-7 w-7" aria-label={`Edit ${a.name}`} onClick={() => setEdit({ ...a })}><Pencil className="h-3.5 w-3.5" /></Button>
                  <Button size="icon" variant="ghost" className="h-7 w-7" aria-label={`Delete ${a.name}`} onClick={() => confirm(`Delete "${a.name}"?`) && run("d", deleteAlertAction(brand, a.id))}><Trash2 className="h-3.5 w-3.5" /></Button>
                </div>
              </li>
            ))}
          </ul>
        ) : <EmptyState icon={<BellRing className="h-5 w-5" />} title="No alerts yet" description="Get told by email, in the app, on Slack or on Telegram when tickets or mentions match keywords, channels or negative sentiment." />}
      </CardBody>

      <Dialog size="xl" open={!!edit} onClose={() => setEdit(null)} title={edit?.id ? `Edit ${edit.name}` : "New alert"}
        footer={<><Button onClick={() => setEdit(null)}>Cancel</Button><Button variant="primary" loading={busy === "save"} onClick={async () => { if (edit && (await run("save", saveAlertAction(brand, edit)))) setEdit(null); }}>Save alert</Button></>}>
        {edit && (
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Name"><Input autoFocus value={edit.name} maxLength={80} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></Field>
              <Field label="Watch"><Segmented size="md" value={edit.source} onChange={(v) => setEdit({ ...edit, source: v })} options={[{ value: "tickets", label: "New tickets" }, { value: "mentions", label: "Listening mentions" }]} /></Field>
              <Field label="Keywords" hint="Any of these. Empty matches everything."><ListInput value={edit.filters.keywords} onChange={(v) => setEdit({ ...edit, filters: { ...edit.filters, keywords: v } })} placeholder="refund, outage" /></Field>
              <Field label="Exclude keywords"><ListInput value={edit.filters.exclude} onChange={(v) => setEdit({ ...edit, filters: { ...edit.filters, exclude: v } })} /></Field>
              <Field label="Channels" hint="Empty = all channels.">
                <ListInput value={edit.filters.channels} onChange={(v) => setEdit({ ...edit, filters: { ...edit.filters, channels: v } })} placeholder={channels.slice(0, 3).map((c) => c.value).join(", ")} />
              </Field>
              <Field label="Minimum items to fire"><Input type="number" min={1} value={edit.filters.minItems} onChange={(e) => setEdit({ ...edit, filters: { ...edit.filters, minItems: Number(e.target.value) } })} /></Field>
            </div>
            <div className="flex flex-wrap gap-x-6 gap-y-2">
              <div><div className="mb-1 text-[12.5px] font-medium text-text-2">Sentiment</div><div className="flex gap-3">{["negative", "neutral", "positive"].map((s) => <CheckRow key={s} checked={edit.filters.sentiments.includes(s)} onChange={(v) => setEdit({ ...edit, filters: { ...edit.filters, sentiments: toggleIn(edit.filters.sentiments, s, v) } })} label={s} />)}</div></div>
              {edit.source === "tickets" && <div><div className="mb-1 text-[12.5px] font-medium text-text-2">Priority</div><div className="flex gap-3">{["low", "normal", "high", "urgent"].map((s) => <CheckRow key={s} checked={edit.filters.priorities.includes(s)} onChange={(v) => setEdit({ ...edit, filters: { ...edit.filters, priorities: toggleIn(edit.filters.priorities, s, v) } })} label={s} />)}</div></div>}
            </div>
            <fieldset className="rounded-md border border-border p-3">
              <legend className="px-1 text-[12.5px] font-semibold text-text">Delivery</legend>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-2">
                  <CheckRow checked={edit.delivery.inapp} onChange={(v) => setEdit({ ...edit, delivery: { ...edit.delivery, inapp: v } })} label="In-app notification" />
                  <CheckRow disabled={!integrations.slack.connected} checked={edit.delivery.slack} onChange={(v) => setEdit({ ...edit, delivery: { ...edit.delivery, slack: v } })} label="Slack" hint={integrations.slack.connected ? integrations.slack.channel || "Connected" : "Connect Slack below first."} />
                  <CheckRow disabled={!integrations.telegram.connected} checked={edit.delivery.telegram} onChange={(v) => setEdit({ ...edit, delivery: { ...edit.delivery, telegram: v } })} label="Telegram" hint={integrations.telegram.connected ? `At most one message per ${TELEGRAM_MIN_INTERVAL_MIN} minutes.` : "Connect a Telegram bot below first."} />
                </div>
                <div className="space-y-2">
                  <Field label="Email to"><ListInput value={edit.delivery.emails} onChange={(v) => setEdit({ ...edit, delivery: { ...edit.delivery, emails: v } })} placeholder="ops@yourcompany.com" /></Field>
                  <Field label="Bcc"><ListInput value={edit.delivery.bcc} onChange={(v) => setEdit({ ...edit, delivery: { ...edit.delivery, bcc: v } })} /></Field>
                  <Field label="Email format"><Select value={edit.format} onChange={(e) => setEdit({ ...edit, format: e.target.value as AlertInput["format"] })}><option value="text">Summary in the email</option><option value="csv">Summary + CSV attachment</option></Select></Field>
                </div>
              </div>
            </fieldset>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Delay (minutes)" hint="Wait this long after the first match to batch items."><Input type="number" min={0} max={1440} value={edit.delay_minutes} onChange={(e) => setEdit({ ...edit, delay_minutes: Number(e.target.value) })} /></Field>
              <div>
                <CheckRow checked={!!edit.active_hours} onChange={(v) => setEdit({ ...edit, active_hours: v ? { start: "09:00", end: "18:00", timezone: Intl.DateTimeFormat().resolvedOptions().timeZone, days: [1, 2, 3, 4, 5] } : null })} label="Only during active hours" />
                {edit.active_hours && (
                  <div className="mt-2 space-y-2">
                    <div className="flex flex-wrap gap-1.5">
                      <Input aria-label="From" type="time" className="h-7.5 w-28" value={edit.active_hours.start} onChange={(e) => setEdit({ ...edit, active_hours: { ...edit.active_hours!, start: e.target.value } })} />
                      <Input aria-label="To" type="time" className="h-7.5 w-28" value={edit.active_hours.end} onChange={(e) => setEdit({ ...edit, active_hours: { ...edit.active_hours!, end: e.target.value } })} />
                      <Input aria-label="Time zone" className="h-7.5 w-40" value={edit.active_hours.timezone} onChange={(e) => setEdit({ ...edit, active_hours: { ...edit.active_hours!, timezone: e.target.value } })} />
                    </div>
                    <div className="flex flex-wrap gap-2.5">{DAYS.map((d, i) => <CheckRow key={d} checked={edit.active_hours!.days.includes(i)} onChange={(v) => setEdit({ ...edit, active_hours: { ...edit.active_hours!, days: v ? [...edit.active_hours!.days, i] : edit.active_hours!.days.filter((x) => x !== i) } })} label={d} />)}</div>
                  </div>
                )}
              </div>
            </div>
            <CheckRow checked={edit.active} onChange={(v) => setEdit({ ...edit, active: v })} label="Alert is on" />
          </div>
        )}
      </Dialog>
    </Card>
  );
}

export function IntegrationsPanel({ brand, integrations }: { brand: string; integrations: Integrations }) {
  const { run, busy, messages } = useRun();
  const [slack, setSlack] = useState({ url: "", channel: integrations.slack.channel });
  const [tg, setTg] = useState({ token: "", chatId: integrations.telegram.chatId });
  const [chats, setChats] = useState<{ id: string; name: string }[] | null>(null);
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="lg:col-span-2">{messages}</div>
      <Card>
        <CardHeader title="Slack" description="Create an incoming webhook in Slack (Apps → Incoming Webhooks) for the alerts channel and paste its URL." actions={<Badge tone={integrations.slack.connected ? "good" : "neutral"}>{integrations.slack.connected ? "Connected" : "Not connected"}</Badge>} />
        <CardBody className="space-y-3">
          <Field label="Webhook URL" hint={integrations.slack.connected ? "Stored encrypted. Paste a new URL to replace it, or save empty to disconnect." : undefined}><Input type="password" autoComplete="off" value={slack.url} placeholder="https://hooks.slack.com/services/…" onChange={(e) => setSlack({ ...slack, url: e.target.value })} /></Field>
          <Field label="Channel label"><Input value={slack.channel} placeholder="#cx-alerts" onChange={(e) => setSlack({ ...slack, channel: e.target.value })} /></Field>
          <div className="flex justify-end"><Button variant="primary" loading={busy === "slack"} onClick={() => run("slack", saveSlackAction(brand, slack.url, slack.channel), () => (slack.url ? "Slack connected." : "Slack disconnected."))}>Save</Button></div>
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Telegram" description="Create a bot with @BotFather, add it to your alerts group and send any message there so the bot can see the chat." actions={<Badge tone={integrations.telegram.connected ? "good" : "neutral"}>{integrations.telegram.connected ? `@${integrations.telegram.bot}` : "Not connected"}</Badge>} />
        <CardBody className="space-y-3">
          <Field label="Bot token" hint={integrations.telegram.bot ? "Stored encrypted. Leave empty to keep the current bot." : undefined}><Input type="password" autoComplete="off" value={tg.token} placeholder="123456:ABC…" onChange={(e) => setTg({ ...tg, token: e.target.value })} /></Field>
          <Field label="Chat id">
            <div className="flex gap-1.5">
              <Input value={tg.chatId} placeholder="-1001234567890" onChange={(e) => setTg({ ...tg, chatId: e.target.value })} />
              <Button disabled={!integrations.telegram.bot} loading={busy === "chats"} onClick={async () => { const r = await run("chats", telegramChatsAction(brand)); if (r) setChats(r); }}>Find</Button>
            </div>
          </Field>
          {chats && (chats.length ? <div className="flex flex-wrap gap-1.5">{chats.map((c) => <Button key={c.id} size="sm" variant="ghost" onClick={() => setTg({ ...tg, chatId: c.id })}>{c.name} <span className="text-text-3">{c.id}</span></Button>)}</div> : <p className="text-[12px] text-text-3">No chats yet. Send a message in the group, then try again.</p>)}
          <div className="flex justify-end gap-2">
            {integrations.telegram.bot && <Button variant="ghost" loading={busy === "tgd"} onClick={() => run("tgd", disconnectTelegramAction(brand), () => "Telegram disconnected.")}>Disconnect</Button>}
            <Button variant="primary" loading={busy === "tg"} onClick={() => run("tg", saveTelegramAction(brand, tg.token || null, tg.chatId), (bot) => `Connected @${bot}.`)}>Save</Button>
          </div>
        </CardBody>
      </Card>
    </div>
  );
}

export function AlertLogPanel({ log }: { log: { id: string; alert: string | null; channel: string; items: number; ok: boolean; error: string | null; created_at: string }[] }) {
  return (
    <Card>
      <CardHeader title="Delivery log" description="The last 100 alert deliveries." />
      <CardBody>
        <MiniTable columns={[{ header: "When" }, { header: "Alert" }, { header: "Channel" }, { header: "Items", align: "right" }, { header: "Result" }]} empty="No alerts sent yet."
          rows={log.map((l) => [<span key="w" className="whitespace-nowrap text-[12px]"><When iso={l.created_at} /></span>, l.alert ?? "Deleted alert", l.channel, l.items, l.ok ? <Badge key="r" tone="good">Sent</Badge> : <span key="r" className="text-[12px] text-critical-ink">{l.error}</span>])} />
      </CardBody>
    </Card>
  );
}
