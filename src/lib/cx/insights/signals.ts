import { query } from "@/lib/db";
import { aiConfigured, complete } from "@/lib/cx/ai";

/**
 * Ticket signals (S8, S10, S13): predicted CSAT, churn risk and escalation likelihood, computed
 * heuristically from stored facts (sentiment, intent, reopens, SLA breaches, waiting time, history).
 * An AI override refines the heuristic when a key is configured. Pure functions are unit-tested.
 */
export type SignalInput = {
  sentiment: string | null;
  intent: string | null;
  priority?: string | null;
  reopens: number;
  frBreached: boolean;
  resBreached: boolean;
  /** Hours the customer has been waiting for a reply right now (0 when answered). */
  waitingHours: number;
  /** Other tickets from the same contact in the last 30 days. */
  recentTickets: number;
  /** Known CSAT on this ticket (1–5), if answered. */
  csat: number | null;
  /** Customer messages on the ticket. */
  inbound: number;
};
export type Level = "low" | "medium" | "high";
export type Signals = { csat: { value: number; known: boolean; reasons: string[] }; churn: { score: number; level: Level; reasons: string[] }; escalation: { score: number; level: Level; reasons: string[] } };

const clamp = (x: number, a: number, b: number) => Math.min(b, Math.max(a, x));
export const level = (score: number): Level => (score >= 60 ? "high" : score >= 30 ? "medium" : "low");

/** Predicted CSAT on a 1–5 scale (the actual rating when the customer answered). */
export function predictCsat(s: SignalInput) {
  if (s.csat != null) return { value: s.csat, known: true, reasons: ["Customer rating"] };
  let v = 4.2;
  const reasons: string[] = [];
  if (s.sentiment === "negative") (v -= 1.0), reasons.push("Negative sentiment");
  else if (s.sentiment === "positive") (v += 0.4), reasons.push("Positive sentiment");
  if (s.frBreached) (v -= 0.5), reasons.push("First response SLA breached");
  if (s.resBreached) (v -= 0.5), reasons.push("Resolution SLA breached");
  if (s.reopens) (v -= 0.4 * Math.min(2, s.reopens)), reasons.push(`Reopened ${s.reopens}×`);
  if (s.intent === "complaint") (v -= 0.3), reasons.push("Complaint");
  if (s.intent === "cancellation") (v -= 0.5), reasons.push("Cancellation intent");
  if (s.waitingHours >= 24) (v -= 0.4), reasons.push("Waiting over a day");
  else if (s.waitingHours >= 4) (v -= 0.2), reasons.push("Waiting over 4 hours");
  if (s.inbound >= 6) (v -= 0.2), reasons.push("Long back-and-forth");
  return { value: Math.round(clamp(v, 1, 5) * 10) / 10, known: false, reasons };
}

/** Churn risk 0–100. */
export function churnRisk(s: SignalInput) {
  let x = 0;
  const reasons: string[] = [];
  if (s.intent === "cancellation") (x += 40), reasons.push("Cancellation / refund language");
  if (s.sentiment === "negative") (x += 20), reasons.push("Negative sentiment");
  if (s.csat != null && s.csat <= 2) (x += 25), reasons.push(`Low CSAT (${s.csat})`);
  if (s.frBreached || s.resBreached) (x += 10 * (Number(s.frBreached) + Number(s.resBreached))), reasons.push("SLA breached");
  if (s.reopens) (x += Math.min(20, 10 * s.reopens)), reasons.push(`Reopened ${s.reopens}×`);
  if (s.recentTickets >= 3) (x += 10), reasons.push(`${s.recentTickets} other tickets in 30 days`);
  if (s.intent === "complaint") (x += 5), reasons.push("Complaint");
  const score = clamp(x, 0, 100);
  return { score, level: level(score), reasons };
}

/** Escalation likelihood 0–100. */
export function escalationLikelihood(s: SignalInput) {
  let x = 0;
  const reasons: string[] = [];
  if (s.priority === "urgent") (x += 25), reasons.push("Urgent priority");
  else if (s.priority === "high") (x += 15), reasons.push("High priority");
  if (s.sentiment === "negative") (x += 20), reasons.push("Negative sentiment");
  if (s.intent === "complaint") (x += 15), reasons.push("Complaint");
  if (s.frBreached) (x += 15), reasons.push("First response late");
  if (s.resBreached) (x += 10), reasons.push("Resolution late");
  if (s.waitingHours >= 8) (x += 10), reasons.push("Waiting over 8 hours");
  if (s.reopens) (x += 10), reasons.push("Reopened");
  if (s.inbound >= 5) (x += 5), reasons.push("Many customer follow-ups");
  const score = clamp(x, 0, 100);
  return { score, level: level(score), reasons };
}

export function computeSignals(s: SignalInput): Signals {
  return { csat: predictCsat(s), churn: churnRisk(s), escalation: escalationLikelihood(s) };
}

type Row = {
  id: string; number: number; subject: string; status: string; priority: string; sentiment: string | null; intent: string | null; csat: number | null; channel_kind: string;
  contact: string | null; agent: string | null; created_at: string; first_response_at: string | null; resolved_at: string | null; first_response_due: string | null; resolution_due: string | null;
  last_in: string | null; last_out: string | null; inbound: number; reopens: number; recent: number;
};

const SQL = `SELECT t.id,t.number,t.subject,t.status,t.priority,t.sentiment,t.intent,t.csat,t.channel_kind,t.created_at,t.first_response_at,t.resolved_at,t.first_response_due,t.resolution_due,
  COALESCE(NULLIF(c.name,''),c.email) AS contact, COALESCE(NULLIF(u.name,''),u.email) AS agent,
  (SELECT max(created_at) FROM cx_messages m WHERE m.ticket_id=t.id AND m.direction='in') AS last_in,
  (SELECT max(created_at) FROM cx_messages m WHERE m.ticket_id=t.id AND m.direction='out') AS last_out,
  (SELECT count(*)::int FROM cx_messages m WHERE m.ticket_id=t.id AND m.direction='in') AS inbound,
  (SELECT count(*)::int FROM cx_inbox_events e WHERE e.ticket_id=t.id AND (e.kind='reopen' OR e.detail ILIKE '%reopen%' OR (e.detail ILIKE 'status → open%' AND EXISTS (SELECT 1 FROM cx_inbox_events e2 WHERE e2.ticket_id=t.id AND e2.created_at < e.created_at AND e2.detail ~* 'status → (solved|closed)')))) AS reopens,
  (SELECT count(*)::int FROM cx_tickets o WHERE o.project_id=t.project_id AND o.contact_id=t.contact_id AND o.id<>t.id AND o.created_at > now() - interval '30 days') AS recent
  FROM cx_tickets t LEFT JOIN cx_contacts c ON c.id=t.contact_id LEFT JOIN users u ON u.id=t.assignee_id`;

export function inputOf(r: Omit<Row, "id" | "number" | "subject" | "status" | "channel_kind" | "contact" | "agent">, now = Date.now()): SignalInput {
  const ms = (v: string | null) => (v ? new Date(v).getTime() : null);
  const late = (due: string | null, done: string | null) => {
    const d = ms(due);
    if (d == null) return false;
    const x = ms(done);
    return x != null ? x > d : now > d;
  };
  const lastIn = ms(r.last_in), lastOut = ms(r.last_out);
  const waiting = r.resolved_at == null && lastIn != null && (lastOut == null || lastIn > lastOut) ? (now - lastIn) / 3600000 : 0;
  return {
    sentiment: r.sentiment, intent: r.intent, priority: r.priority, reopens: r.reopens ?? 0, csat: r.csat, inbound: r.inbound ?? 0, recentTickets: r.recent ?? 0,
    frBreached: late(r.first_response_due, r.first_response_at), resBreached: late(r.resolution_due, r.resolved_at), waitingHours: Math.max(0, waiting),
  };
}

/**
 * Signals for one ticket (exported for the inbox): `await ticketSignals(projectId, ticketId)` →
 * { csat: {value, known, reasons}, churn: {score, level, reasons}, escalation: {...} } or null.
 */
export async function ticketSignals(projectId: string, ticketId: string): Promise<Signals | null> {
  const [r] = await query<Row>(`${SQL} WHERE t.project_id=$1 AND t.id=$2`, [projectId, ticketId]);
  return r ? computeSignals(inputOf(r)) : null;
}

/** Open and recently solved tickets ranked by churn risk (Signals view). */
export async function brandSignals(projectId: string, days = 30, limit = 300) {
  const rows = await query<Row>(`${SQL} WHERE t.project_id=$1 AND (t.status IN ('new','open','pending','on_hold') OR t.resolved_at > now() - ($2 * interval '1 day')) ORDER BY t.updated_at DESC LIMIT $3`, [projectId, days, limit]);
  return rows
    .map((r) => ({ id: r.id, number: r.number, subject: r.subject, status: r.status, channel: r.channel_kind, contact: r.contact, agent: r.agent, ...computeSignals(inputOf(r)) }))
    .sort((a, b) => b.churn.score - a.churn.score || b.escalation.score - a.escalation.score);
}

/** Optional AI refinement for one ticket: returns the model's CSAT/churn read with a reason, or null. */
export async function aiSignalOverride(projectId: string, ticketId: string) {
  if (!aiConfigured()) return null;
  const msgs = await query<{ direction: string; body: string }>(
    "SELECT m.direction,m.body FROM cx_messages m JOIN cx_tickets t ON t.id=m.ticket_id WHERE t.project_id=$1 AND m.ticket_id=$2 AND m.direction<>'note' ORDER BY m.created_at DESC LIMIT 20",
    [projectId, ticketId],
  );
  if (!msgs.length) return null;
  const out = await complete(
    'Assess a support conversation. Respond with JSON only: {"csat": 1-5 number, "churn": 0-100 number, "reason": "one sentence"}.',
    msgs.reverse().map((m) => `${m.direction === "in" ? "Customer" : "Agent"}: ${m.body.slice(0, 1500)}`).join("\n\n"),
    300,
  );
  const m = out?.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    const j = JSON.parse(m[0]) as { csat?: number; churn?: number; reason?: string };
    return { csat: clamp(Number(j.csat) || 3, 1, 5), churn: clamp(Number(j.churn) || 0, 0, 100), reason: String(j.reason ?? "").slice(0, 300) };
  } catch {
    return null;
  }
}
