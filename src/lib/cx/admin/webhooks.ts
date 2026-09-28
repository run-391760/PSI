import { randomBytes, randomUUID } from "node:crypto";
import { query } from "@/lib/db";
import { AppError } from "@/lib/domain";
import { decryptSecret, encryptSecret } from "@/lib/secrets";
import { audit } from "./audit";
import { deliveredOk, MAX_RETRIES, nextAttemptAt, safeWebhookUrl, signPayload, WEBHOOK_EVENTS, type WebhookEvent } from "./pure/webhooks";
import { iso } from "./util";

/**
 * Outbound webhooks (V1): events are queued per subscribed webhook and delivered by the tick job with
 * HMAC signatures, retried 10 times with backoff, then the webhook is deactivated.
 * Other packages may emit: await emitEvent(projectId, "ticket.updated", { ticket_id, ... }).
 */
export type WebhookRow = { id: string; name: string; url: string; events: string[]; active: boolean; failures: number; last_status: number | null; last_error: string | null; last_delivery_at: string | null; deactivated_at: string | null; created_at: string };

export async function listWebhooks(projectId: string): Promise<WebhookRow[]> {
  const rows = await query<WebhookRow>("SELECT id,name,url,events,active,failures,last_status,last_error,last_delivery_at,deactivated_at,created_at FROM cx_admin_webhooks WHERE project_id=$1 ORDER BY created_at", [projectId]);
  return rows.map((r) => ({ ...r, last_delivery_at: iso(r.last_delivery_at), deactivated_at: iso(r.deactivated_at), created_at: iso(r.created_at)! }));
}

export async function saveWebhook(projectId: string, w: { id?: string; name: string; url: string; events: string[]; active: boolean }, actor: { id: string; name: string }) {
  const url = safeWebhookUrl(w.url);
  if (!url) throw new AppError("Enter a public http(s) URL (local and private addresses are not allowed).");
  const events = w.events.filter((e) => WEBHOOK_EVENTS.some((x) => x.key === e));
  if (!events.length) throw new AppError("Subscribe to at least one event.");
  if (w.id) {
    await query("UPDATE cx_admin_webhooks SET name=$3,url=$4,events=$5::jsonb,active=$6,failures=CASE WHEN $6 THEN 0 ELSE failures END,deactivated_at=CASE WHEN $6 THEN NULL ELSE deactivated_at END WHERE id=$1 AND project_id=$2", [w.id, projectId, w.name.slice(0, 80), url, JSON.stringify(events), w.active]);
    await audit(projectId, actor, "webhook.update", url);
    return { id: w.id, secret: null as string | null };
  }
  const id = randomUUID(), secret = `whsec_${randomBytes(24).toString("base64url")}`;
  await query("INSERT INTO cx_admin_webhooks(id,project_id,name,url,events,secret_enc,active) VALUES($1,$2,$3,$4,$5::jsonb,$6,$7)", [id, projectId, w.name.slice(0, 80), url, JSON.stringify(events), encryptSecret(secret), w.active]);
  await audit(projectId, actor, "webhook.create", url, events.join(", "));
  return { id, secret };
}
export async function deleteWebhook(projectId: string, id: string, actor: { id: string; name: string }) {
  const [r] = await query<{ url: string }>("DELETE FROM cx_admin_webhooks WHERE id=$1 AND project_id=$2 RETURNING url", [id, projectId]);
  if (r) await audit(projectId, actor, "webhook.delete", r.url);
}
export async function rotateWebhookSecret(projectId: string, id: string, actor: { id: string; name: string }) {
  const secret = `whsec_${randomBytes(24).toString("base64url")}`;
  await query("UPDATE cx_admin_webhooks SET secret_enc=$3 WHERE id=$1 AND project_id=$2", [id, projectId, encryptSecret(secret)]);
  await audit(projectId, actor, "webhook.rotate", id);
  return secret;
}

export async function recentDeliveries(projectId: string, limit = 50) {
  const rows = await query<{ id: string; webhook_id: string; event: string; attempts: number; state: string; response_code: number | null; error: string | null; next_attempt_at: string; created_at: string }>(
    "SELECT id,webhook_id,event,attempts,state,response_code,error,next_attempt_at,created_at FROM cx_admin_webhook_deliveries WHERE project_id=$1 ORDER BY created_at DESC LIMIT $2", [projectId, limit]);
  return rows.map((r) => ({ ...r, next_attempt_at: iso(r.next_attempt_at)!, created_at: iso(r.created_at)! }));
}

/** Queue an event for every active webhook subscribed to it. */
export async function emitEvent(projectId: string, event: WebhookEvent, data: Record<string, unknown>) {
  const hooks = await query<{ id: string }>("SELECT id FROM cx_admin_webhooks WHERE project_id=$1 AND active AND events ? $2", [projectId, event]);
  for (const h of hooks)
    await query("INSERT INTO cx_admin_webhook_deliveries(id,webhook_id,project_id,event,payload) VALUES($1,$2,$3,$4,$5::jsonb)", [randomUUID(), h.id, projectId, event, JSON.stringify({ id: randomUUID(), event, brand_id: projectId, created_at: new Date().toISOString(), data })]);
  return hooks.length;
}

async function post(url: string, secret: string, body: string, event: string) {
  const ts = Math.floor(Date.now() / 1000);
  try {
    const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json", "user-agent": "SynapseCX-Webhooks/1", "x-cx-event": event, "x-cx-timestamp": String(ts), "x-cx-signature": signPayload(secret, ts, body) }, body, redirect: "manual", signal: AbortSignal.timeout(10_000) });
    return { status: r.status, error: deliveredOk(r.status) ? null : `HTTP ${r.status}` };
  } catch (e) {
    return { status: null, error: e instanceof Error ? e.message.slice(0, 200) : "Request failed" };
  }
}

/** Deliver due webhook attempts (retry with backoff; after 10 retries fail and deactivate the webhook). */
export async function deliverDue(projectId: string, limit = 50) {
  const due = await query<{ id: string; webhook_id: string; event: string; payload: unknown; attempts: number; url: string; secret_enc: string; active: boolean }>(
    `SELECT d.id,d.webhook_id,d.event,d.payload,d.attempts,w.url,w.secret_enc,w.active FROM cx_admin_webhook_deliveries d JOIN cx_admin_webhooks w ON w.id=d.webhook_id
      WHERE d.project_id=$1 AND d.state='pending' AND d.next_attempt_at <= now() ORDER BY d.created_at LIMIT $2`, [projectId, limit]);
  let ok = 0, failed = 0;
  for (const d of due) {
    if (!d.active) { await query("UPDATE cx_admin_webhook_deliveries SET state='failed', error='Webhook inactive' WHERE id=$1", [d.id]); continue; }
    const r = await post(d.url, decryptSecret(d.secret_enc), JSON.stringify(d.payload), d.event);
    const attempts = d.attempts + 1;
    await query("UPDATE cx_admin_webhooks SET last_status=$2,last_error=$3,last_delivery_at=now() WHERE id=$1", [d.webhook_id, r.status, r.error]);
    if (!r.error) {
      ok++;
      await query("UPDATE cx_admin_webhook_deliveries SET state='delivered',attempts=$2,response_code=$3,error=NULL WHERE id=$1", [d.id, attempts, r.status]);
      await query("UPDATE cx_admin_webhooks SET failures=0 WHERE id=$1", [d.webhook_id]);
      continue;
    }
    const next = nextAttemptAt(attempts);
    if (next) await query("UPDATE cx_admin_webhook_deliveries SET attempts=$2,response_code=$3,error=$4,next_attempt_at=$5 WHERE id=$1", [d.id, attempts, r.status, r.error, next]);
    else {
      failed++;
      await query("UPDATE cx_admin_webhook_deliveries SET state='failed',attempts=$2,response_code=$3,error=$4 WHERE id=$1", [d.id, attempts, r.status, r.error]);
      await query("UPDATE cx_admin_webhooks SET active=false, deactivated_at=now(), failures=failures+1 WHERE id=$1", [d.webhook_id]);
      await query("UPDATE cx_admin_webhook_deliveries SET state='failed', error='Webhook deactivated' WHERE webhook_id=$1 AND state='pending'", [d.webhook_id]);
      const { notify } = await import("@/lib/jobs/queue");
      const [p] = await query<{ owner_id: string }>("SELECT owner_id FROM projects WHERE id=$1", [projectId]);
      if (p) await notify({ ownerId: p.owner_id, projectId, tool: "CX Webhooks", severity: "critical", title: "Webhook deactivated", body: `${d.url} failed ${MAX_RETRIES} retries (${r.error}).`, link: `/cx/settings/api?brand=${projectId}&tab=webhooks` });
    }
  }
  return { ok, failed, attempted: due.length };
}

/** Send a test event right away (not retried). */
export async function testWebhook(projectId: string, id: string) {
  const [w] = await query<{ url: string; secret_enc: string }>("SELECT url,secret_enc FROM cx_admin_webhooks WHERE id=$1 AND project_id=$2", [id, projectId]);
  if (!w) throw new AppError("Webhook not found.", 404);
  const body = JSON.stringify({ id: randomUUID(), event: "test", brand_id: projectId, created_at: new Date().toISOString(), data: { message: "Test delivery" } });
  const r = await post(w.url, decryptSecret(w.secret_enc), body, "test");
  await query("UPDATE cx_admin_webhooks SET last_status=$2,last_error=$3,last_delivery_at=now() WHERE id=$1", [id, r.status, r.error]);
  return r;
}

export async function redeliver(projectId: string, deliveryId: string) {
  await query("UPDATE cx_admin_webhook_deliveries SET state='pending', attempts=0, next_attempt_at=now() WHERE id=$1 AND project_id=$2", [deliveryId, projectId]);
}

// ---------------------------------------------------------------- External APIs (V2, K10)

export type ExternalApi = { id: string; name: string; target: "ticket" | "contact"; method: "GET" | "POST"; url: string; body: string; mapping: { label: string; path: string }[]; active: boolean; has_headers: boolean };

export async function listExternalApis(projectId: string): Promise<ExternalApi[]> {
  return query<ExternalApi>("SELECT id,name,target,method,url,body,mapping,active,(headers_enc IS NOT NULL) AS has_headers FROM cx_admin_external_apis WHERE project_id=$1 ORDER BY name", [projectId]);
}
export async function saveExternalApi(projectId: string, a: { id?: string; name: string; target: "ticket" | "contact"; method: "GET" | "POST"; url: string; body: string; headers: string; mapping: { label: string; path: string }[]; active: boolean }, actor: { id: string; name: string }) {
  if (!a.name.trim()) throw new AppError("Name the API.");
  if (!safeWebhookUrl(a.url.replace(/\{\{[^}]+\}\}/g, "x"))) throw new AppError("Enter a public http(s) URL.");
  const mapping = a.mapping.filter((m) => m.label.trim() && m.path.trim()).slice(0, 20);
  const headers = a.headers.trim() ? encryptSecret(a.headers.trim()) : null;
  if (a.id) await query("UPDATE cx_admin_external_apis SET name=$3,target=$4,method=$5,url=$6,body=$7,mapping=$8::jsonb,active=$9,headers_enc=COALESCE($10,headers_enc) WHERE id=$1 AND project_id=$2", [a.id, projectId, a.name.trim(), a.target, a.method, a.url.trim(), a.body, JSON.stringify(mapping), a.active, headers]);
  else await query("INSERT INTO cx_admin_external_apis(id,project_id,name,target,method,url,body,mapping,active,headers_enc) VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10)", [randomUUID(), projectId, a.name.trim(), a.target, a.method, a.url.trim(), a.body, JSON.stringify(mapping), a.active, headers]);
  await audit(projectId, actor, "external_api.save", a.name);
}
export async function deleteExternalApi(projectId: string, id: string) {
  await query("DELETE FROM cx_admin_external_apis WHERE id=$1 AND project_id=$2", [id, projectId]);
}

const pick = (obj: unknown, path: string) => path.split(".").reduce<unknown>((o, k) => (o && typeof o === "object" ? (o as Record<string, unknown>)[k] : undefined), obj);
const fill = (s: string, v: Record<string, string>, enc: boolean) => s.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, k) => (enc ? encodeURIComponent(v[k] ?? "") : (v[k] ?? "")));

/**
 * Run the brand's active External APIs for a ticket or contact and return mapped label/value rows.
 * WP1 renders these on the ticket and contact panels: await externalData(projectId, "ticket", ticketId).
 */
export async function externalData(projectId: string, target: "ticket" | "contact", id: string, onlyApiId?: string) {
  const apis = (await listExternalApis(projectId)).filter((a) => a.target === target && (onlyApiId ? a.id === onlyApiId : a.active));
  if (!apis.length) return [];
  const [row] = target === "ticket"
    ? await query<Record<string, string>>("SELECT t.number::text AS \"ticket.number\", t.id AS \"ticket.id\", t.subject AS \"ticket.subject\", c.email AS \"contact.email\", c.phone AS \"contact.phone\", c.name AS \"contact.name\", c.id AS \"contact.id\" FROM cx_tickets t LEFT JOIN cx_contacts c ON c.id=t.contact_id WHERE t.id=$1 AND t.project_id=$2", [id, projectId])
    : await query<Record<string, string>>("SELECT c.email AS \"contact.email\", c.phone AS \"contact.phone\", c.name AS \"contact.name\", c.id AS \"contact.id\" FROM cx_contacts c WHERE c.id=$1 AND c.project_id=$2", [id, projectId]);
  if (!row) return [];
  const vars: Record<string, string> = { ...row };
  if (target === "ticket") {
    const { getTicketFields } = await import("./fields");
    for (const [k, v] of Object.entries((await getTicketFields(id, { reveal: true })).values)) vars[`field.${k}`] = String(v);
  }
  const out: { api: string; ok: boolean; error: string | null; rows: { label: string; value: string }[] }[] = [];
  for (const a of apis) {
    try {
      const url = safeWebhookUrl(fill(a.url, vars, true));
      if (!url) throw new Error("URL resolves to a private address");
      const [h] = await query<{ headers_enc: string | null }>("SELECT headers_enc FROM cx_admin_external_apis WHERE id=$1", [a.id]);
      const headers: Record<string, string> = { accept: "application/json" };
      for (const line of (h?.headers_enc ? decryptSecret(h.headers_enc) : "").split("\n")) { const i = line.indexOf(":"); if (i > 0) headers[line.slice(0, i).trim()] = line.slice(i + 1).trim(); }
      if (a.method === "POST") headers["content-type"] ??= "application/json";
      const r = await fetch(url, { method: a.method, headers, body: a.method === "POST" ? fill(a.body, vars, false) : undefined, redirect: "manual", signal: AbortSignal.timeout(8000) });
      const data = await r.json().catch(() => null);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      out.push({ api: a.name, ok: true, error: null, rows: a.mapping.map((m) => { const v = pick(data, m.path); return { label: m.label, value: v == null ? "n/a" : typeof v === "object" ? JSON.stringify(v).slice(0, 200) : String(v) }; }) });
    } catch (e) {
      out.push({ api: a.name, ok: false, error: e instanceof Error ? e.message : "Failed", rows: [] });
    }
  }
  return out;
}
