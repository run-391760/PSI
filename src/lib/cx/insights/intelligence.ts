import { randomUUID } from "node:crypto";
import { query } from "@/lib/db";
import { aiConfigured, complete } from "@/lib/cx/ai";
import { getOverview } from "./overview";
import { articleTexts, searchKb, type KbHit } from "./kb";
import { brandMailer } from "./mailer";

/**
 * AI intelligence (S5, S14–S17, L33). Trust layer: the "Ask" and brief features send the model only
 * aggregated metrics (counts, averages, rates by channel/agent/intent) — never raw customer messages,
 * contact names, emails or phone numbers. Grounded replies send the ticket thread plus KB articles.
 */

const r1 = (x: number | null | undefined) => (x == null || !Number.isFinite(x) ? null : Math.round(x * 10) / 10);
const hours = (s: number | null | undefined) => (s == null ? null : r1(s / 3600));

/** Aggregated brand metrics for the last `days` (the only data the model sees in Ask and briefs). */
export async function metricsSnapshot(projectId: string, days: number, now = new Date()) {
  const o = await getOverview(projectId, days, now);
  const from = new Date(now.getTime() - days * 86400000);
  const [breakdown] = await query<{ intents: Record<string, number> | null; sentiments: Record<string, number> | null; tags: Record<string, number> | null; priorities: Record<string, number> | null; qa: number | null; qa_n: number; reopened: number }>(
    `SELECT
      (SELECT json_object_agg(k, n) FROM (SELECT COALESCE(intent,'unknown') k, count(*)::int n FROM cx_tickets WHERE project_id=$1 AND created_at>=$2 GROUP BY 1) a) AS intents,
      (SELECT json_object_agg(k, n) FROM (SELECT COALESCE(sentiment,'unknown') k, count(*)::int n FROM cx_tickets WHERE project_id=$1 AND created_at>=$2 GROUP BY 1) b) AS sentiments,
      (SELECT json_object_agg(k, n) FROM (SELECT tg k, count(*)::int n FROM cx_tickets, jsonb_array_elements_text(tags) tg WHERE project_id=$1 AND created_at>=$2 GROUP BY 1 ORDER BY 2 DESC LIMIT 15) c) AS tags,
      (SELECT json_object_agg(k, n) FROM (SELECT priority k, count(*)::int n FROM cx_tickets WHERE project_id=$1 AND created_at>=$2 GROUP BY 1) d) AS priorities,
      (SELECT avg(score)::float FROM cx_qa_reviews WHERE project_id=$1 AND status IN ('submitted','disputed','resolved') AND COALESCE(submitted_at,updated_at)>=$2) AS qa,
      (SELECT count(*)::int FROM cx_qa_reviews WHERE project_id=$1 AND status IN ('submitted','disputed','resolved') AND COALESCE(submitted_at,updated_at)>=$2) AS qa_n,
      (SELECT count(DISTINCT e.ticket_id)::int FROM cx_inbox_events e JOIN cx_tickets t ON t.id=e.ticket_id WHERE t.project_id=$1 AND e.created_at>=$2 AND (e.kind='reopen' OR e.detail ILIKE '%reopen%')) AS reopened`,
    [projectId, from],
  );
  const k = o.kpis;
  return {
    period: { days, from: from.toISOString().slice(0, 10), to: now.toISOString().slice(0, 10) },
    tickets: {
      created: k.created, createdChangePct: r1(k.createdDelta), openNow: k.open, urgentOpen: k.urgent, overdueNow: k.overdue,
      solved: o.trend.reduce((s, x) => s + x.solved, 0), reopened: breakdown?.reopened ?? 0,
      avgFirstResponseHours: hours(k.frt), firstResponseChangePct: r1(k.frtDelta), avgResolutionHours: hours(k.art), resolutionChangePct: r1(k.artDelta),
      slaCompliancePct: r1(k.sla), slaCompliancePrevPct: r1(k.slaPrev),
      byChannel: Object.fromEntries(o.channelMix.map((c) => [c.label, c.value])),
      byIntent: breakdown?.intents ?? {}, bySentiment: breakdown?.sentiments ?? {}, byPriority: breakdown?.priorities ?? {}, topTags: breakdown?.tags ?? {},
    },
    satisfaction: { csatPct: r1(k.csat), csatPrevPct: r1(k.csatPrev), csatResponses: k.csatN, nps: r1(k.nps), npsPrev: r1(k.npsPrev), npsResponses: k.npsN },
    quality: { avgQaScorePct: r1(breakdown?.qa), reviews: breakdown?.qa_n ?? 0 },
    listening: { mentions: k.mentions, mentionsChangePct: r1(k.mentionsDelta), netSentiment: r1(k.net), netSentimentPrev: r1(k.netPrev) },
    agents: o.leaderboard.map((a) => ({ agent: a.name, assigned: a.assigned, solved: a.solved, avgFirstResponseHours: hours(a.frt), avgResolutionHours: hours(a.art), slaPct: r1(a.sla), csatPct: r1(a.csat), qaPct: r1(a.qa) })),
  };
}
export type Snapshot = Awaited<ReturnType<typeof metricsSnapshot>>;

const ASK_SYSTEM = `You are a customer-experience analyst. Answer the question using ONLY the aggregated metrics JSON provided.
Rules: quote the exact numbers you use; null means unknown (say "not available", never guess); do not invent causes you cannot see in the data;
if the data can't answer the question, say which metric would be needed. Be concise: at most 150 words, plain text, optional short bullet list.`;

/** Natural-language Q&A over aggregated metrics (null when AI is not configured). */
export async function askMetrics(projectId: string, userId: string, question: string, days = 30) {
  if (!aiConfigured()) return null;
  const q = question.trim().slice(0, 500);
  const snap = await metricsSnapshot(projectId, days);
  const answer = await complete(ASK_SYSTEM, `Metrics (last ${days} days):\n${JSON.stringify(snap)}\n\nQuestion: ${q}`, 700);
  if (!answer) return null;
  await query("INSERT INTO cx_ask_log(id,project_id,user_id,question,answer) VALUES($1,$2,$3,$4,$5)", [randomUUID(), projectId, userId, q, answer]);
  return { answer, snapshot: snap };
}

export async function askHistory(projectId: string, limit = 20) {
  return query<{ id: string; question: string; answer: string; created_at: string; asker: string | null }>(
    "SELECT l.id,l.question,l.answer,l.created_at,COALESCE(NULLIF(u.name,''),u.email) AS asker FROM cx_ask_log l LEFT JOIN users u ON u.id=l.user_id WHERE l.project_id=$1 ORDER BY l.created_at DESC LIMIT $2",
    [projectId, limit],
  );
}

/** ~120-word insight for one chart from its plotted values only (null when AI is not configured). */
export async function chartInsight(chart: { title: string; metric: string; range: string; rows: { key: string; value: number | null }[]; total: number | null; previous: number | null }) {
  if (!aiConfigured()) return null;
  const data = { ...chart, rows: chart.rows.slice(0, 60) };
  return complete(
    "You explain a single dashboard chart to a support manager in about 120 words: the headline, the notable change or outlier, and one concrete next step. Use only the numbers given; null means unknown. Plain text, no headings.",
    JSON.stringify(data),
    400,
  );
}

/**
 * Grounded reply suggestion for the inbox (S5): searches the knowledge base with the customer's latest
 * messages and drafts a reply that cites the articles used.
 *   const r = await groundedReply(projectId, ticketId);
 *   // r = { text: string | null (null = AI off), sources: KbHit[], ai: boolean }
 */
export async function groundedReply(projectId: string, ticketId: string, opts: { tone?: string } = {}): Promise<{ text: string | null; sources: KbHit[]; ai: boolean }> {
  const [t] = await query<{ subject: string; brand: string }>("SELECT t.subject, p.name AS brand FROM cx_tickets t JOIN projects p ON p.id=t.project_id WHERE t.id=$1 AND t.project_id=$2", [ticketId, projectId]);
  if (!t) return { text: null, sources: [], ai: aiConfigured() };
  const msgs = (await query<{ direction: "in" | "out"; body: string }>("SELECT direction,body FROM cx_messages WHERE ticket_id=$1 AND direction IN ('in','out') ORDER BY created_at DESC LIMIT 12", [ticketId])).reverse();
  const lastIn = msgs.filter((m) => m.direction === "in").slice(-2).map((m) => m.body).join(" ");
  const sources = await searchKb(projectId, `${t.subject} ${lastIn}`.slice(0, 1000), 3);
  if (!aiConfigured()) return { text: null, sources, ai: false };
  const arts = await articleTexts(projectId, sources.map((s) => s.id));
  const kb = arts.map((a, i) => `[${i + 1}] ${a.title}\n${a.body}`).join("\n\n");
  const text = await complete(
    `You are a support agent for ${t.brand}. Write the next reply to the customer (${opts.tone ?? "friendly, concise, helpful"}). Use the knowledge-base articles when relevant and do not invent policies, prices or facts beyond them and the conversation. If the articles don't cover the question, say you will check. Reply with the message text only; do not include citation markers.`,
    `Knowledge base:\n${kb || "(no matching articles)"}\n\nConversation:\n${msgs.map((m) => `${m.direction === "in" ? "Customer" : "Agent"}: ${m.body.slice(0, 3000)}`).join("\n")}`,
    700,
  );
  return { text, sources, ai: true };
}

// ------------------------------------------------------------- executive briefs (S15)

export type BriefSettings = { brief_cadence: "off" | "weekly" | "monthly"; brief_recipients: string[]; brief_next_at: string | null };
export async function getAiSettings(projectId: string): Promise<BriefSettings> {
  const [r] = await query<BriefSettings>("SELECT brief_cadence,brief_recipients,brief_next_at FROM cx_ai_settings WHERE project_id=$1", [projectId]);
  return r ? { ...r, brief_next_at: r.brief_next_at ? new Date(r.brief_next_at).toISOString() : null } : { brief_cadence: "off", brief_recipients: [], brief_next_at: null };
}
export function nextBriefAt(cadence: "weekly" | "monthly", from = new Date()) {
  if (cadence === "monthly") return new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth() + 1, 1, 7));
  const d = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate() + 1, 7));
  while (d.getUTCDay() !== 1) d.setUTCDate(d.getUTCDate() + 1);
  return d;
}
export async function saveAiSettings(projectId: string, s: { cadence: BriefSettings["brief_cadence"]; recipients: string[] }) {
  const next = s.cadence === "off" ? null : nextBriefAt(s.cadence);
  await query(
    `INSERT INTO cx_ai_settings(project_id,brief_cadence,brief_recipients,brief_next_at) VALUES($1,$2,$3,$4)
     ON CONFLICT(project_id) DO UPDATE SET brief_cadence=excluded.brief_cadence, brief_recipients=excluded.brief_recipients, brief_next_at=excluded.brief_next_at, updated_at=now()`,
    [projectId, s.cadence, JSON.stringify(s.recipients), next],
  );
}

/** Generates (and emails, when a mailbox is connected) an executive brief; null when AI is not configured. */
export async function generateBrief(projectId: string, period: "weekly" | "monthly", recipients: string[] = []) {
  if (!aiConfigured()) return null;
  const days = period === "weekly" ? 7 : 30;
  const snap = await metricsSnapshot(projectId, days);
  const body = await complete(
    "Write an executive CX brief for leadership from the aggregated metrics JSON: a one-line headline, then 4–6 bullets (volume, speed/SLA, satisfaction, quality, listening, agents) with exact numbers and changes vs the previous period, then 2 recommended actions. Null means unknown; say so rather than guessing. Plain text, under 250 words.",
    JSON.stringify(snap),
    900,
  );
  if (!body) return null;
  const id = randomUUID();
  await query("INSERT INTO cx_ai_briefs(id,project_id,period,body,metrics) VALUES($1,$2,$3,$4,$5)", [id, projectId, period, body, JSON.stringify(snap)]);
  let emailed = 0;
  if (recipients.length) {
    const mailer = await brandMailer(projectId);
    if (mailer) for (const to of recipients) await mailer.send({ to, subject: `CX ${period} brief (${snap.period.from} to ${snap.period.to})`, text: body }).then(() => emailed++).catch(() => {});
  }
  return { id, body, emailed };
}
export async function listBriefs(projectId: string, limit = 12) {
  return query<{ id: string; period: string; body: string; created_at: string }>("SELECT id,period,body,created_at FROM cx_ai_briefs WHERE project_id=$1 ORDER BY created_at DESC LIMIT $2", [projectId, limit]);
}
export async function runDueBriefs(projectId: string, now = new Date()) {
  const s = await getAiSettings(projectId);
  if (s.brief_cadence === "off" || !s.brief_next_at || new Date(s.brief_next_at) > now || !aiConfigured()) return { brief: false };
  await query("UPDATE cx_ai_settings SET brief_next_at=$2 WHERE project_id=$1", [projectId, nextBriefAt(s.brief_cadence, now)]);
  const r = await generateBrief(projectId, s.brief_cadence, s.brief_recipients);
  return { brief: !!r };
}
