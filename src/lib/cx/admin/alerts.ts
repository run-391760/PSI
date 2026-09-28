import { randomUUID } from "node:crypto";
import { query } from "@/lib/db";
import { AppError } from "@/lib/domain";
import { decryptSecret, encryptSecret } from "@/lib/secrets";
import { audit } from "./audit";
import { sendAdminEmail } from "./mailer";
import { alertCsv, alertText, inActiveHours, matchAlert, readyToFire, slackPayload, telegramAllowed, telegramPayload, validSlackWebhook, validTelegramToken, type ActiveHours, type AlertDelivery, type AlertFilters, type AlertItem } from "./pure/alerts";
import { iso } from "./util";

/** Alerts centre (N1, N3, V8): rules on tickets or listening mentions, delivered by email, in-app, Slack and Telegram. */
export type AlertRow = { id: string; name: string; source: "tickets" | "mentions"; filters: AlertFilters; delivery: AlertDelivery; format: "text" | "csv"; delay_minutes: number; active_hours: ActiveHours; active: boolean; checked_at: string; last_fired_at: string | null; fired: number };
export type Integrations = { slack: { connected: boolean; channel: string }; telegram: { connected: boolean; chatId: string; bot: string } };

export async function listAlerts(projectId: string): Promise<AlertRow[]> {
  const rows = await query<AlertRow>("SELECT id,name,source,filters,delivery,format,delay_minutes,active_hours,active,checked_at,last_fired_at,fired FROM cx_admin_alerts WHERE project_id=$1 ORDER BY created_at", [projectId]);
  return rows.map((r) => ({ ...r, checked_at: iso(r.checked_at)!, last_fired_at: iso(r.last_fired_at) }));
}

export async function saveAlert(projectId: string, a: Omit<AlertRow, "id" | "checked_at" | "last_fired_at" | "fired"> & { id?: string }, actor: { id: string; name: string }) {
  const name = a.name.trim().slice(0, 80);
  if (!name) throw new AppError("Name the alert.");
  const clean = (xs: string[]) => [...new Set(xs.map((x) => x.trim()).filter(Boolean))].slice(0, 100);
  const email = (xs: string[]) => clean(xs).filter((x) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(x));
  const filters: AlertFilters = { keywords: clean(a.filters.keywords), exclude: clean(a.filters.exclude), channels: clean(a.filters.channels), sentiments: clean(a.filters.sentiments), priorities: clean(a.filters.priorities), minItems: Math.max(1, Math.round(a.filters.minItems || 1)) };
  const delivery: AlertDelivery = { inapp: a.delivery.inapp, emails: email(a.delivery.emails), bcc: email(a.delivery.bcc), slack: a.delivery.slack, telegram: a.delivery.telegram };
  if (!delivery.inapp && !delivery.emails.length && !delivery.bcc.length && !delivery.slack && !delivery.telegram) throw new AppError("Choose at least one delivery channel.");
  if (a.delivery.emails.length + a.delivery.bcc.length && !delivery.emails.length && !delivery.bcc.length) throw new AppError("Enter valid email addresses.");
  const hours = a.active_hours && /^\d{2}:\d{2}$/.test(a.active_hours.start) && /^\d{2}:\d{2}$/.test(a.active_hours.end) ? a.active_hours : null;
  const vals = [name, a.source, JSON.stringify(filters), JSON.stringify(delivery), a.format, Math.min(1440, Math.max(0, Math.round(a.delay_minutes || 0))), hours ? JSON.stringify(hours) : null, a.active];
  if (a.id) await query("UPDATE cx_admin_alerts SET name=$3,source=$4,filters=$5::jsonb,delivery=$6::jsonb,format=$7,delay_minutes=$8,active_hours=$9::jsonb,active=$10 WHERE id=$1 AND project_id=$2", [a.id, projectId, ...vals]);
  else await query("INSERT INTO cx_admin_alerts(id,project_id,name,source,filters,delivery,format,delay_minutes,active_hours,active) VALUES($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7,$8,$9::jsonb,$10)", [randomUUID(), projectId, ...vals]);
  await audit(projectId, actor, a.id ? "alert.update" : "alert.create", name);
}
export async function deleteAlert(projectId: string, id: string, actor: { id: string; name: string }) {
  const [r] = await query<{ name: string }>("DELETE FROM cx_admin_alerts WHERE id=$1 AND project_id=$2 RETURNING name", [id, projectId]);
  if (r) await audit(projectId, actor, "alert.delete", r.name);
}
export async function toggleAlert(projectId: string, id: string, active: boolean) {
  await query("UPDATE cx_admin_alerts SET active=$3, checked_at=CASE WHEN $3 THEN now() ELSE checked_at END WHERE id=$1 AND project_id=$2", [id, projectId, active]);
}

export async function alertLog(projectId: string, limit = 50) {
  const rows = await query<{ id: string; alert: string | null; channel: string; items: number; ok: boolean; error: string | null; created_at: string }>(
    "SELECT l.id,a.name AS alert,l.channel,l.items,l.ok,l.error,l.created_at FROM cx_admin_alert_log l LEFT JOIN cx_admin_alerts a ON a.id=l.alert_id WHERE l.project_id=$1 ORDER BY l.created_at DESC LIMIT $2", [projectId, limit]);
  return rows.map((r) => ({ ...r, created_at: iso(r.created_at)! }));
}

// ---------------------------------------------------------------- Slack / Telegram integrations

export async function getIntegrations(projectId: string): Promise<Integrations> {
  const rows = await query<{ kind: string; config: Record<string, string>; secret_enc: string | null }>("SELECT kind,config,secret_enc FROM cx_admin_integrations WHERE project_id=$1", [projectId]);
  const s = rows.find((r) => r.kind === "slack"), t = rows.find((r) => r.kind === "telegram");
  return { slack: { connected: !!s?.secret_enc, channel: s?.config.channel ?? "" }, telegram: { connected: !!t?.secret_enc && !!t.config.chatId, chatId: t?.config.chatId ?? "", bot: t?.config.bot ?? "" } };
}
async function secretOf(projectId: string, kind: string) {
  const [r] = await query<{ config: Record<string, string>; secret_enc: string | null }>("SELECT config,secret_enc FROM cx_admin_integrations WHERE project_id=$1 AND kind=$2", [projectId, kind]);
  return r?.secret_enc ? { secret: decryptSecret(r.secret_enc), config: r.config } : null;
}
export async function saveSlack(projectId: string, webhookUrl: string, channel: string, actor: { id: string; name: string }) {
  if (!webhookUrl.trim()) { await query("DELETE FROM cx_admin_integrations WHERE project_id=$1 AND kind='slack'", [projectId]); await audit(projectId, actor, "integration.slack", "disconnected"); return; }
  if (!validSlackWebhook(webhookUrl)) throw new AppError("Paste a Slack incoming webhook URL (https://hooks.slack.com/services/…).");
  await query("INSERT INTO cx_admin_integrations(project_id,kind,config,secret_enc) VALUES($1,'slack',$2::jsonb,$3) ON CONFLICT(project_id,kind) DO UPDATE SET config=excluded.config,secret_enc=excluded.secret_enc,updated_at=now()", [projectId, JSON.stringify({ channel: channel.slice(0, 80) }), encryptSecret(webhookUrl.trim())]);
  await audit(projectId, actor, "integration.slack", "connected", channel);
}
export async function saveTelegram(projectId: string, token: string | null, chatId: string, actor: { id: string; name: string }) {
  const cur = await secretOf(projectId, "telegram");
  const t = token?.trim() || cur?.secret;
  if (!t) throw new AppError("Paste the bot token from @BotFather.");
  if (!validTelegramToken(t)) throw new AppError("That doesn't look like a Telegram bot token (123456:ABC…).");
  const me = await fetch(`https://api.telegram.org/bot${t}/getMe`, { signal: AbortSignal.timeout(10_000) }).then((r) => r.json()).catch(() => null) as { ok?: boolean; result?: { username?: string }; description?: string } | null;
  if (!me?.ok) throw new AppError(`Telegram rejected the token${me?.description ? `: ${me.description}` : "."}`);
  await query("INSERT INTO cx_admin_integrations(project_id,kind,config,secret_enc) VALUES($1,'telegram',$2::jsonb,$3) ON CONFLICT(project_id,kind) DO UPDATE SET config=excluded.config,secret_enc=excluded.secret_enc,updated_at=now()", [projectId, JSON.stringify({ chatId: chatId.trim(), bot: me.result?.username ?? "" }), encryptSecret(t)]);
  await audit(projectId, actor, "integration.telegram", "connected", `@${me.result?.username ?? ""} → ${chatId}`);
  return me.result?.username ?? "";
}
export async function disconnectTelegram(projectId: string, actor: { id: string; name: string }) {
  await query("DELETE FROM cx_admin_integrations WHERE project_id=$1 AND kind='telegram'", [projectId]);
  await audit(projectId, actor, "integration.telegram", "disconnected");
}
/** Find chat ids that messaged the bot (to pick the alerts group). */
export async function telegramChats(projectId: string) {
  const s = await secretOf(projectId, "telegram");
  if (!s) throw new AppError("Connect the bot first.");
  const d = await fetch(`https://api.telegram.org/bot${s.secret}/getUpdates?limit=50`, { signal: AbortSignal.timeout(10_000) }).then((r) => r.json()).catch(() => null) as { result?: { message?: { chat: { id: number; title?: string; first_name?: string; type: string } } }[] } | null;
  const chats = new Map<string, string>();
  for (const u of d?.result ?? []) if (u.message?.chat) chats.set(String(u.message.chat.id), u.message.chat.title ?? u.message.chat.first_name ?? u.message.chat.type);
  return [...chats].map(([id, name]) => ({ id, name }));
}

async function sendSlack(projectId: string, name: string, items: AlertItem[]) {
  const s = await secretOf(projectId, "slack");
  if (!s) return "Slack is not connected.";
  const r = await fetch(s.secret, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(slackPayload(name, items)), signal: AbortSignal.timeout(10_000) }).catch((e) => e as Error);
  return r instanceof Error ? r.message : r.ok ? null : `Slack HTTP ${r.status}`;
}
async function sendTelegram(projectId: string, name: string, items: AlertItem[]) {
  const s = await secretOf(projectId, "telegram");
  if (!s?.config.chatId) return "Telegram is not connected.";
  const r = await fetch(`https://api.telegram.org/bot${s.secret}/sendMessage`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(telegramPayload(s.config.chatId, name, items)), signal: AbortSignal.timeout(10_000) }).catch((e) => e as Error);
  if (r instanceof Error) return r.message;
  const d = (await r.json().catch(() => ({}))) as { ok?: boolean; description?: string };
  return d.ok ? null : d.description ?? `Telegram HTTP ${r.status}`;
}

async function deliver(projectId: string, a: Pick<AlertRow, "id" | "name" | "delivery" | "format" | "last_fired_at">, items: AlertItem[], test = false) {
  const results: { channel: string; error: string | null }[] = [];
  const [p] = await query<{ owner_id: string }>("SELECT owner_id FROM projects WHERE id=$1", [projectId]);
  if (a.delivery.inapp && p) {
    const { notify } = await import("@/lib/jobs/queue");
    await notify({ ownerId: p.owner_id, projectId, tool: "CX Alerts", severity: "warning", title: `${a.name}: ${items.length} new item${items.length === 1 ? "" : "s"}`, body: items.slice(0, 3).map((i) => i.title || i.body.slice(0, 80)).join(" · "), link: items.length === 1 ? items[0].url : `/cx/settings/alerts?brand=${projectId}` });
    results.push({ channel: "in-app", error: null });
  }
  if (a.delivery.emails.length || a.delivery.bcc.length) {
    const r = await sendAdminEmail(projectId, { to: a.delivery.emails, bcc: a.delivery.bcc, subject: `${test ? "[Test] " : ""}${a.name}: ${items.length} new`, text: alertText(a.name, items, 50), attachments: a.format === "csv" ? [{ filename: "alert.csv", content: alertCsv(items) }] : undefined });
    results.push({ channel: "email", error: r.error });
  }
  if (a.delivery.slack) results.push({ channel: "slack", error: await sendSlack(projectId, a.name, items) });
  if (a.delivery.telegram) results.push({ channel: "telegram", error: test || telegramAllowed(a.last_fired_at) ? await sendTelegram(projectId, a.name, items) : "Skipped: Telegram alerts are limited to one per 10 minutes." });
  for (const r of results) await query("INSERT INTO cx_admin_alert_log(id,alert_id,project_id,channel,items,ok,error) VALUES($1,$2,$3,$4,$5,$6,$7)", [randomUUID(), a.id, projectId, r.channel, items.length, !r.error, r.error]);
  return results;
}

async function itemsSince(projectId: string, source: AlertRow["source"], since: string): Promise<AlertItem[]> {
  if (source === "mentions") {
    const rows = await query<{ id: string; title: string; body: string; source: string; sentiment: string | null; author: string; url: string | null; fetched_at: string }>(
      "SELECT id,title,body,source,sentiment,author,url,fetched_at FROM cx_mentions WHERE project_id=$1 AND fetched_at > $2 ORDER BY fetched_at LIMIT 500", [projectId, since]);
    return rows.map((r) => ({ id: r.id, kind: "mention", title: r.title, body: r.body, channel: r.source, sentiment: r.sentiment, priority: null, author: r.author, url: r.url ?? `/cx/listening?brand=${projectId}`, at: iso(r.fetched_at)! }));
  }
  const rows = await query<{ id: string; subject: string; body: string | null; channel_kind: string; sentiment: string | null; priority: string; author: string | null; created_at: string }>(
    "SELECT t.id,t.subject,(SELECT m.body FROM cx_messages m WHERE m.ticket_id=t.id ORDER BY m.created_at LIMIT 1) AS body,t.channel_kind,t.sentiment,t.priority,c.name AS author,t.created_at FROM cx_tickets t LEFT JOIN cx_contacts c ON c.id=t.contact_id WHERE t.project_id=$1 AND t.created_at > $2 ORDER BY t.created_at LIMIT 500", [projectId, since]);
  return rows.map((r) => ({ id: r.id, kind: "ticket", title: r.subject, body: r.body ?? "", channel: r.channel_kind, sentiment: r.sentiment, priority: r.priority, author: r.author ?? "", url: `/cx/inbox?brand=${projectId}&ticket=${r.id}`, at: iso(r.created_at)! }));
}

/** Evaluate every active alert (tick job): immediate alerts fire now, delayed ones batch until the delay passes. */
export async function runAlerts(projectId: string) {
  const alerts = (await listAlerts(projectId)).filter((a) => a.active);
  let fired = 0;
  for (const a of alerts) {
    const items = (await itemsSince(projectId, a.source, a.checked_at)).filter((i) => matchAlert(a.filters, i));
    if (!items.length) {
      await query("UPDATE cx_admin_alerts SET checked_at=now() WHERE id=$1", [a.id]);
      continue;
    }
    if (!inActiveHours(a.active_hours)) continue; // hold until active hours start
    if (items.length < a.filters.minItems) {
      // Volume threshold counts items within a sliding 60-minute window: drop the oldest once it ages out.
      if (readyToFire(items[0].at, 60)) await query("UPDATE cx_admin_alerts SET checked_at=$2 WHERE id=$1", [a.id, items[0].at]);
      continue;
    }
    if (a.delay_minutes && !readyToFire(items[0].at, a.delay_minutes)) continue;
    await deliver(projectId, a, items);
    await query("UPDATE cx_admin_alerts SET checked_at=$2,last_fired_at=now(),fired=fired+1 WHERE id=$1", [a.id, items.at(-1)!.at]);
    const { emitEvent } = await import("./webhooks");
    await emitEvent(projectId, "alert.fired", { alert_id: a.id, name: a.name, items: items.slice(0, 50).map((i) => ({ kind: i.kind, id: i.id, title: i.title, channel: i.channel, url: i.url })) });
    fired++;
  }
  return fired;
}

/** Send a test alert with the most recent matching items (or a sample line when none match). */
export async function testAlert(projectId: string, id: string) {
  const [a] = (await listAlerts(projectId)).filter((x) => x.id === id);
  if (!a) throw new AppError("Alert not found.", 404);
  let items = (await itemsSince(projectId, a.source, new Date(Date.now() - 30 * 86400_000).toISOString())).filter((i) => matchAlert(a.filters, i)).slice(-5);
  if (!items.length) items = [{ id: "test", kind: a.source === "mentions" ? "mention" : "ticket", title: "Test alert", body: "This is a test of the alert delivery. No items matched in the last 30 days.", channel: "test", sentiment: null, priority: null, author: "", url: `/cx/settings/alerts?brand=${projectId}`, at: new Date().toISOString() }];
  return deliver(projectId, a, items, true);
}
