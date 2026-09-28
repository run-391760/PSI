import { randomUUID } from "node:crypto";
import { z } from "zod";
import { query } from "@/lib/db";
import { AppError } from "@/lib/domain";
import { complete } from "@/lib/cx/ai";
import { sample, scoreReview, type QaAnswers, type QaSection } from "./metrics";

export type Scorecard = { id: string; project_id: string; name: string; description: string; sections: QaSection[]; pass_score: number; active: boolean; created_at: string; reviews?: number };
export type ReviewStatus = "queued" | "draft" | "submitted" | "disputed" | "resolved";
export type Review = {
  id: string; ticket_id: string; ticket_number: number; subject: string; channel_kind: string; scorecard_id: string | null; scorecard: string | null;
  agent_id: string | null; agent: string | null; reviewer: string | null; status: ReviewStatus; answers: QaAnswers; score: number | null; fatal: boolean;
  ai_suggestion: { answers: QaAnswers; notes: Record<string, string>; summary: string } | null; comment: string; coaching: string;
  dispute_reason: string | null; dispute_response: string | null; submitted_at: string | null; updated_at: string;
};

const criterion = z.object({ id: z.string().min(1).max(40), label: z.string().trim().min(1, "Every criterion needs a label").max(200), weight: z.number().min(0).max(100), fatal: z.boolean().optional(), description: z.string().max(500).optional() });
export const scorecardInput = z.object({
  name: z.string().trim().min(1, "Name is required").max(100),
  description: z.string().trim().max(300).default(""),
  pass_score: z.number().int().min(0).max(100).default(80),
  active: z.boolean().default(true),
  sections: z.array(z.object({ id: z.string().min(1).max(40), name: z.string().trim().min(1, "Every section needs a name").max(100), criteria: z.array(criterion).min(1, "Every section needs at least one criterion").max(30) })).min(1, "Add at least one section").max(12),
});

/** Starter template the user can create and then edit (configuration, not data). */
export const STARTER_SCORECARD: z.input<typeof scorecardInput> = {
  name: "Support conversation quality",
  description: "Greeting, understanding, resolution, tone and compliance.",
  pass_score: 80,
  sections: [
    { id: "s1", name: "Opening", criteria: [{ id: "c1", label: "Greets the customer and uses their name", weight: 5 }, { id: "c2", label: "Acknowledges the issue", weight: 10 }] },
    { id: "s2", name: "Resolution", criteria: [{ id: "c3", label: "Asks the right questions to understand the problem", weight: 15 }, { id: "c4", label: "Provides a correct and complete solution", weight: 30 }, { id: "c5", label: "Sets clear next steps / expectations", weight: 10 }] },
    { id: "s3", name: "Communication", criteria: [{ id: "c6", label: "Empathetic, professional tone", weight: 15 }, { id: "c7", label: "Clear grammar and formatting", weight: 10 }, { id: "c8", label: "Closes the conversation properly", weight: 5 }] },
    { id: "s4", name: "Compliance", criteria: [{ id: "c9", label: "No sharing of personal data or credentials", weight: 0, fatal: true }, { id: "c10", label: "No false promises about policy, refunds or pricing", weight: 0, fatal: true }] },
  ],
};

export async function listScorecards(projectId: string) {
  return query<Scorecard>("SELECT s.*, (SELECT count(*)::int FROM cx_qa_reviews r WHERE r.scorecard_id=s.id AND r.status<>'queued') AS reviews FROM cx_qa_scorecards s WHERE s.project_id=$1 ORDER BY s.created_at", [projectId]);
}
export async function getScorecard(projectId: string, id: string) {
  const [s] = await query<Scorecard>("SELECT * FROM cx_qa_scorecards WHERE id=$1 AND project_id=$2", [id, projectId]);
  if (!s) throw new AppError("Scorecard not found.", 404);
  return s;
}
export async function saveScorecard(projectId: string, raw: z.input<typeof scorecardInput>, id?: string) {
  const s = scorecardInput.parse(raw);
  if (!s.sections.some((x) => x.criteria.some((c) => !c.fatal && c.weight > 0))) throw new AppError("Give at least one non-fatal criterion a weight above 0.", 400);
  if (id) {
    await getScorecard(projectId, id);
    await query("UPDATE cx_qa_scorecards SET name=$3,description=$4,sections=$5,pass_score=$6,active=$7 WHERE id=$1 AND project_id=$2", [id, projectId, s.name, s.description, JSON.stringify(s.sections), s.pass_score, s.active]);
    return id;
  }
  const nid = randomUUID();
  await query("INSERT INTO cx_qa_scorecards(id,project_id,name,description,sections,pass_score,active) VALUES($1,$2,$3,$4,$5,$6,$7)", [nid, projectId, s.name, s.description, JSON.stringify(s.sections), s.pass_score, s.active]);
  return nid;
}
export async function deleteScorecard(projectId: string, id: string) {
  await query("DELETE FROM cx_qa_scorecards WHERE id=$1 AND project_id=$2", [id, projectId]);
}

const REVIEW_SELECT = `SELECT r.*, t.number AS ticket_number, t.subject, t.channel_kind, c.name AS scorecard,
  COALESCE(NULLIF(a.name,''),a.email) AS agent, COALESCE(NULLIF(v.name,''),v.email) AS reviewer
  FROM cx_qa_reviews r JOIN cx_tickets t ON t.id=r.ticket_id LEFT JOIN cx_qa_scorecards c ON c.id=r.scorecard_id
  LEFT JOIN users a ON a.id=r.agent_id LEFT JOIN users v ON v.id=r.reviewer_id`;

export async function listReviews(projectId: string, status?: ReviewStatus[]) {
  return query<Review>(`${REVIEW_SELECT} WHERE r.project_id=$1 ${status ? "AND r.status = ANY($2)" : ""} ORDER BY r.updated_at DESC LIMIT 1000`, status ? [projectId, status] : [projectId]);
}
export async function getReview(projectId: string, id: string) {
  const [r] = await query<Review>(`${REVIEW_SELECT} WHERE r.id=$1 AND r.project_id=$2`, [id, projectId]);
  if (!r) throw new AppError("Review not found.", 404);
  return r;
}

/** Gets or creates the review of a ticket against a scorecard. */
export async function openReview(projectId: string, ticketId: string, scorecardId: string) {
  await getScorecard(projectId, scorecardId);
  const [t] = await query<{ assignee_id: string | null }>("SELECT assignee_id FROM cx_tickets WHERE id=$1 AND project_id=$2", [ticketId, projectId]);
  if (!t) throw new AppError("Ticket not found.", 404);
  const [r] = await query<{ id: string }>(
    `INSERT INTO cx_qa_reviews(id,project_id,ticket_id,scorecard_id,agent_id,status) VALUES($1,$2,$3,$4,$5,'draft')
     ON CONFLICT(ticket_id,scorecard_id) DO UPDATE SET agent_id=COALESCE(cx_qa_reviews.agent_id,excluded.agent_id) RETURNING id`,
    [randomUUID(), projectId, ticketId, scorecardId, t.assignee_id],
  );
  return r.id;
}

export async function saveReview(projectId: string, reviewerId: string, id: string, input: { answers: QaAnswers; comment: string; coaching: string; submit: boolean }) {
  const r = await getReview(projectId, id);
  if (!r.scorecard_id) throw new AppError("The scorecard of this review was deleted.", 400);
  const card = await getScorecard(projectId, r.scorecard_id);
  const answers: QaAnswers = {};
  for (const s of card.sections) for (const c of s.criteria) {
    const a = input.answers[c.id];
    if (a === 0 || a === 0.5 || a === 1) answers[c.id] = a;
  }
  const res = scoreReview(card.sections, answers);
  if (input.submit) {
    const missing = card.sections.flatMap((s) => s.criteria).filter((c) => !(c.id in input.answers));
    if (missing.length) throw new AppError(`Answer every criterion before submitting (${missing.length} left; choose N/A where it does not apply).`, 400);
  }
  const status = input.submit ? (r.status === "disputed" ? "resolved" : "submitted") : r.status === "queued" ? "draft" : r.status;
  await query(
    `UPDATE cx_qa_reviews SET answers=$3, score=$4, fatal=$5, comment=$6, coaching=$7, status=$8, reviewer_id=$9,
     submitted_at=CASE WHEN $10 THEN now() ELSE submitted_at END, updated_at=now() WHERE id=$1 AND project_id=$2`,
    [id, projectId, JSON.stringify({ ...answers, ...Object.fromEntries(Object.entries(input.answers).filter(([, v]) => v === null)) }), res.score, res.fatal, input.comment.slice(0, 4000), input.coaching.slice(0, 4000), status, reviewerId, input.submit],
  );
  return { ...res, status };
}

export async function disputeReview(projectId: string, id: string, reason: string) {
  const r = await getReview(projectId, id);
  if (r.status !== "submitted" && r.status !== "resolved") throw new AppError("Only submitted reviews can be disputed.", 400);
  await query("UPDATE cx_qa_reviews SET status='disputed', dispute_reason=$3, dispute_response=NULL, updated_at=now() WHERE id=$1 AND project_id=$2", [id, projectId, reason.slice(0, 2000)]);
}
export async function resolveDispute(projectId: string, id: string, response: string) {
  const r = await getReview(projectId, id);
  if (r.status !== "disputed") throw new AppError("This review is not disputed.", 400);
  await query("UPDATE cx_qa_reviews SET status='resolved', dispute_response=$3, updated_at=now() WHERE id=$1 AND project_id=$2", [id, projectId, response.slice(0, 2000)]);
}
export async function deleteReview(projectId: string, id: string) {
  await query("DELETE FROM cx_qa_reviews WHERE id=$1 AND project_id=$2", [id, projectId]);
}

/** Queues a random sample of solved tickets (not yet reviewed with this scorecard) for review. */
export async function sampleForReview(projectId: string, scorecardId: string, opts: { count: number; days: number; agentId?: string | null; channel?: string | null }) {
  await getScorecard(projectId, scorecardId);
  const pool = await query<{ id: string; assignee_id: string | null }>(
    `SELECT t.id,t.assignee_id FROM cx_tickets t WHERE t.project_id=$1 AND t.status IN ('solved','closed')
     AND COALESCE(t.resolved_at,t.updated_at) > now() - ($3 * interval '1 day')
     AND ($4::text IS NULL OR t.assignee_id=$4) AND ($5::text IS NULL OR t.channel_kind=$5)
     AND NOT EXISTS (SELECT 1 FROM cx_qa_reviews r WHERE r.ticket_id=t.id AND r.scorecard_id=$2)
     AND EXISTS (SELECT 1 FROM cx_messages m WHERE m.ticket_id=t.id AND m.direction='out')
     LIMIT 5000`,
    [projectId, scorecardId, opts.days, opts.agentId || null, opts.channel || null],
  );
  const picked = sample(pool, Math.min(50, Math.max(1, opts.count)));
  for (const t of picked)
    await query("INSERT INTO cx_qa_reviews(id,project_id,ticket_id,scorecard_id,agent_id,status) VALUES($1,$2,$3,$4,$5,'queued') ON CONFLICT DO NOTHING", [randomUUID(), projectId, t.id, scorecardId, t.assignee_id]);
  return { eligible: pool.length, queued: picked.length };
}

export async function ticketThread(projectId: string, ticketId: string) {
  const [ticket] = await query<{ id: string; number: number; subject: string; status: string; priority: string; channel_kind: string; created_at: string; resolved_at: string | null; first_response_at: string | null; csat: number | null; contact: string | null; agent: string | null }>(
    `SELECT t.id,t.number,t.subject,t.status,t.priority,t.channel_kind,t.created_at,t.resolved_at,t.first_response_at,t.csat,
            COALESCE(NULLIF(c.name,''),c.email) AS contact, COALESCE(NULLIF(u.name,''),u.email) AS agent
     FROM cx_tickets t LEFT JOIN cx_contacts c ON c.id=t.contact_id LEFT JOIN users u ON u.id=t.assignee_id WHERE t.id=$1 AND t.project_id=$2`,
    [ticketId, projectId],
  );
  if (!ticket) throw new AppError("Ticket not found.", 404);
  const messages = await query<{ id: string; direction: "in" | "out" | "note"; author_name: string; body: string; created_at: string }>(
    "SELECT id,direction,author_name,body,created_at FROM cx_messages WHERE ticket_id=$1 ORDER BY created_at LIMIT 500",
    [ticketId],
  );
  return { ticket, messages };
}

/** Parses the model's JSON pre-score, keeping only known criteria and valid values. Pure; unit-tested. */
export function parseAiScore(text: string, sections: QaSection[]) {
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return null;
  let raw: { answers?: Record<string, unknown>; notes?: Record<string, unknown>; summary?: unknown };
  try {
    raw = JSON.parse(m[0]);
  } catch {
    return null;
  }
  const ids = new Set(sections.flatMap((s) => s.criteria.map((c) => c.id)));
  const answers: QaAnswers = {}, notes: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw.answers ?? {})) if (ids.has(k) && (v === 0 || v === 0.5 || v === 1 || v === null)) answers[k] = v as number | null;
  for (const [k, v] of Object.entries(raw.notes ?? {})) if (ids.has(k) && typeof v === "string") notes[k] = v.slice(0, 400);
  return { answers, notes, summary: typeof raw.summary === "string" ? raw.summary.slice(0, 1000) : "" };
}

/** AI pre-score via the configured LLM; returns null when no AI key is configured. */
export async function aiPrescore(projectId: string, id: string) {
  const r = await getReview(projectId, id);
  if (!r.scorecard_id) throw new AppError("The scorecard of this review was deleted.", 400);
  const card = await getScorecard(projectId, r.scorecard_id);
  const { messages } = await ticketThread(projectId, r.ticket_id);
  const transcript = messages.filter((m) => m.direction !== "note").map((m) => `${m.direction === "in" ? "Customer" : "Agent"} (${m.author_name || "unknown"}): ${m.body}`).join("\n\n").slice(0, 30000);
  const criteria = card.sections.flatMap((s) => s.criteria.map((c) => `- ${c.id} [${s.name}${c.fatal ? ", FATAL" : ""}]: ${c.label}${c.description ? ` — ${c.description}` : ""}`)).join("\n");
  const out = await complete(
    "You are a strict customer-support quality reviewer. Evaluate only the agent messages against each criterion. Answer 1 (meets), 0.5 (partially), 0 (does not meet) or null (not applicable). For FATAL criteria answer 0 only when the agent clearly violated it. Respond with JSON only: {\"answers\":{\"<id>\":1},\"notes\":{\"<id>\":\"short reason\"},\"summary\":\"two sentences of coaching\"}.",
    `Criteria:\n${criteria}\n\nConversation:\n${transcript || "(no messages)"}`,
    1500,
  );
  if (out == null) return null;
  const parsed = parseAiScore(out, card.sections);
  if (!parsed) throw new AppError("The AI response could not be read. Try again or score manually.", 502);
  await query("UPDATE cx_qa_reviews SET ai_suggestion=$3, updated_at=now() WHERE id=$1 AND project_id=$2", [id, projectId, JSON.stringify(parsed)]);
  return parsed;
}

/** Per-agent QA results with weekly trend (submitted, disputed and resolved reviews). */
export async function agentQaStats(projectId: string, days = 90) {
  const rows = await query<{ agent_id: string | null; agent: string | null; week: string; n: number; avg: number | null; fatal: number; disputes: number }>(
    `SELECT r.agent_id, COALESCE(NULLIF(u.name,''),u.email,'Unassigned') AS agent,
            to_char(date_trunc('week', COALESCE(r.submitted_at,r.updated_at) AT TIME ZONE 'UTC'),'YYYY-MM-DD') AS week,
            count(*)::int AS n, avg(r.score)::float AS avg, count(*) FILTER (WHERE r.fatal)::int AS fatal,
            count(*) FILTER (WHERE r.status='disputed')::int AS disputes
     FROM cx_qa_reviews r LEFT JOIN users u ON u.id=r.agent_id
     WHERE r.project_id=$1 AND r.status IN ('submitted','disputed','resolved') AND COALESCE(r.submitted_at,r.updated_at) > now() - ($2 * interval '1 day')
     GROUP BY 1,2,3 ORDER BY 3`,
    [projectId, days],
  );
  const agents = new Map<string, { id: string | null; name: string; n: number; sum: number; scored: number; fatal: number; disputes: number }>();
  for (const r of rows) {
    const k = r.agent_id ?? "none";
    const a = agents.get(k) ?? { id: r.agent_id, name: r.agent ?? "Unassigned", n: 0, sum: 0, scored: 0, fatal: 0, disputes: 0 };
    a.n += r.n;
    a.fatal += r.fatal;
    a.disputes += r.disputes;
    if (r.avg != null) {
      a.sum += r.avg * r.n;
      a.scored += r.n;
    }
    agents.set(k, a);
  }
  const weeks = [...new Set(rows.map((r) => r.week))].sort();
  const top = [...agents.values()].sort((a, b) => b.n - a.n).slice(0, 6);
  const trend = weeks.map((w) => {
    const row: Record<string, string | number | null> = { week: w };
    for (const a of top) {
      const x = rows.find((r) => r.week === w && (r.agent_id ?? "none") === (a.id ?? "none"));
      row[a.id ?? "none"] = x?.avg ?? null;
    }
    return row;
  });
  return {
    agents: [...agents.values()].map((a) => ({ ...a, avg: a.scored ? a.sum / a.scored : null, fatalRate: a.n ? (a.fatal / a.n) * 100 : null })).sort((a, b) => (b.avg ?? -1) - (a.avg ?? -1)),
    trend,
    trendSeries: top.map((a) => ({ key: a.id ?? "none", label: a.name })),
  };
}

/** Solved tickets available for review (latest first). */
export async function reviewableTickets(projectId: string, limit = 200) {
  return query<{ id: string; number: number; subject: string; channel_kind: string; agent: string | null; resolved_at: string | null; csat: number | null; reviews: number }>(
    `SELECT t.id,t.number,t.subject,t.channel_kind,COALESCE(NULLIF(u.name,''),u.email) AS agent,t.resolved_at,t.csat,
            (SELECT count(*)::int FROM cx_qa_reviews r WHERE r.ticket_id=t.id AND r.status<>'queued') AS reviews
     FROM cx_tickets t LEFT JOIN users u ON u.id=t.assignee_id WHERE t.project_id=$1 AND t.status IN ('solved','closed')
     ORDER BY COALESCE(t.resolved_at,t.updated_at) DESC LIMIT $2`,
    [projectId, limit],
  );
}
