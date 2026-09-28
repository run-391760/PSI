import { randomUUID } from "node:crypto";
import { z } from "zod";
import { query } from "@/lib/db";
import { AppError } from "@/lib/domain";
import { aiConfigured, complete } from "@/lib/cx/ai";
import { notify } from "@/lib/jobs/queue";
import { autoScore, earlyWarnings, sample, scaleFraction, scoreReview, type QaAnswers, type QaSection } from "./metrics";

export type FormType = "evaluation" | "coaching";
export type Scorecard = { id: string; project_id: string; name: string; description: string; sections: QaSection[]; pass_score: number; active: boolean; created_at: string; reviews?: number; form_type: FormType; team_id: string | null; due_days: number | null; auto_accept: boolean; tags: string[] };
export type ReviewStatus = "queued" | "draft" | "submitted" | "disputed" | "resolved";
export type Review = {
  id: string; ticket_id: string; ticket_number: number; subject: string; channel_kind: string; scorecard_id: string | null; scorecard: string | null;
  agent_id: string | null; agent: string | null; reviewer: string | null; status: ReviewStatus; answers: QaAnswers; score: number | null; fatal: boolean;
  ai_suggestion: { answers: QaAnswers; notes: Record<string, string>; summary: string } | null; comment: string; coaching: string;
  dispute_reason: string | null; dispute_response: string | null; submitted_at: string | null; updated_at: string;
  tags: string[]; supervisor_id: string | null; supervisor: string | null; text_answers: Record<string, string>; due_at: string | null; accepted_at: string | null; auto_accepted: boolean; form_type: FormType | null;
};

const criterion = z.object({
  id: z.string().min(1).max(40),
  label: z.string().trim().min(1, "Every criterion needs a label").max(200),
  weight: z.number().min(0).max(100),
  fatal: z.boolean().optional(),
  description: z.string().max(500).optional(),
  type: z.enum(["yesno", "input", "scale", "scale_text", "auto"]).optional(),
  scaleMax: z.number().int().min(2).max(10).optional(),
  auto: z.object({ metric: z.enum(["frt", "resolution", "csat", "sentiment"]), target: z.number().min(0).max(10000) }).optional(),
});
export const scorecardInput = z.object({
  name: z.string().trim().min(1, "Name is required").max(100),
  description: z.string().trim().max(300).default(""),
  pass_score: z.number().int().min(0).max(100).default(80),
  active: z.boolean().default(true),
  form_type: z.enum(["evaluation", "coaching"]).default("evaluation"),
  team_id: z.string().max(64).nullable().default(null),
  due_days: z.number().int().min(1).max(90).nullable().default(null),
  auto_accept: z.boolean().default(false),
  tags: z.array(z.string().trim().toLowerCase().min(1).max(40)).max(30).default([]),
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
  if (s.form_type === "evaluation" && !s.sections.some((x) => x.criteria.some((c) => !c.fatal && c.type !== "input" && c.weight > 0))) throw new AppError("Give at least one scored, non-fatal criterion a weight above 0.", 400);
  for (const c of s.sections.flatMap((x) => x.criteria)) if (c.type === "auto" && !c.auto) throw new AppError(`Pick the metric for auto-scaled “${c.label}”.`, 400);
  if (s.team_id) {
    const [t] = await query("SELECT 1 FROM cx_teams WHERE id=$1 AND project_id=$2", [s.team_id, projectId]);
    if (!t) throw new AppError("User group not found.", 404);
  }
  const vals = [s.name, s.description, JSON.stringify(s.sections), s.pass_score, s.active, s.form_type, s.team_id, s.due_days, s.auto_accept, JSON.stringify(s.tags)];
  if (id) {
    await getScorecard(projectId, id);
    await query("UPDATE cx_qa_scorecards SET name=$3,description=$4,sections=$5,pass_score=$6,active=$7,form_type=$8,team_id=$9,due_days=$10,auto_accept=$11,tags=$12 WHERE id=$1 AND project_id=$2", [id, projectId, ...vals]);
    return id;
  }
  const nid = randomUUID();
  await query("INSERT INTO cx_qa_scorecards(id,project_id,name,description,sections,pass_score,active,form_type,team_id,due_days,auto_accept,tags) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)", [nid, projectId, ...vals]);
  return nid;
}
export async function deleteScorecard(projectId: string, id: string) {
  await query("DELETE FROM cx_qa_scorecards WHERE id=$1 AND project_id=$2", [id, projectId]);
}

const REVIEW_SELECT = `SELECT r.*, t.number AS ticket_number, t.subject, t.channel_kind, c.name AS scorecard, c.form_type,
  COALESCE(NULLIF(a.name,''),a.email) AS agent, COALESCE(NULLIF(v.name,''),v.email) AS reviewer, COALESCE(NULLIF(s.name,''),s.email) AS supervisor
  FROM cx_qa_reviews r JOIN cx_tickets t ON t.id=r.ticket_id LEFT JOIN cx_qa_scorecards c ON c.id=r.scorecard_id
  LEFT JOIN users a ON a.id=r.agent_id LEFT JOIN users v ON v.id=r.reviewer_id LEFT JOIN users s ON s.id=r.supervisor_id`;

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

/** Ticket facts used by auto-scaled criteria. */
async function ticketFacts(ticketId: string) {
  const [t] = await query<{ created_at: string; first_response_at: string | null; resolved_at: string | null; csat: number | null; sentiment: string | null }>(
    "SELECT created_at,first_response_at,resolved_at,csat,sentiment FROM cx_tickets WHERE id=$1",
    [ticketId],
  );
  const h = (a: string | null) => (t && a ? (new Date(a).getTime() - new Date(t.created_at).getTime()) / 3600000 : null);
  return { frtHours: h(t?.first_response_at ?? null), resolutionHours: h(t?.resolved_at ?? null), csat: t?.csat ?? null, sentiment: t?.sentiment ?? null };
}

/** Normalizes raw answers against the form (scale values → fractions, auto criteria computed). Pure. */
export function normalizeAnswers(sections: QaSection[], raw: Record<string, number | null | undefined>, facts: Parameters<typeof autoScore>[1] | null) {
  const answers: QaAnswers = {};
  for (const c of sections.flatMap((x) => x.criteria)) {
    const a = raw[c.id];
    if (c.type === "input") continue;
    if (c.type === "auto") {
      if (c.auto && facts) answers[c.id] = autoScore(c.auto, facts);
      continue;
    }
    if (a === null) answers[c.id] = null;
    else if (typeof a === "number" && Number.isFinite(a)) {
      // Scale answers arrive as the chosen point (1..scaleMax) and are stored as a 0–1 fraction.
      if (c.type === "scale" || c.type === "scale_text") {
        if (Number.isInteger(a) && a >= 1 && a <= (c.scaleMax ?? 5)) answers[c.id] = scaleFraction(a, c.scaleMax ?? 5);
      }
      else if (a === 0 || a === 0.5 || a === 1) answers[c.id] = a;
    }
  }
  return answers;
}

export async function saveReview(
  projectId: string,
  reviewerId: string,
  id: string,
  input: { answers: QaAnswers; comment: string; coaching: string; submit: boolean; texts?: Record<string, string>; tags?: string[]; supervisorId?: string | null },
) {
  const r = await getReview(projectId, id);
  if (!r.scorecard_id) throw new AppError("The scorecard of this review was deleted.", 400);
  const card = await getScorecard(projectId, r.scorecard_id);
  const crit = card.sections.flatMap((s) => s.criteria);
  const answers = normalizeAnswers(card.sections, input.answers, await ticketFacts(r.ticket_id));
  const texts: Record<string, string> = {};
  for (const c of crit) {
    const t = input.texts?.[c.id]?.trim();
    if (t && (c.type === "input" || c.type === "scale_text")) texts[c.id] = t.slice(0, 2000);
  }
  const res = scoreReview(card.sections, answers);
  if (input.submit) {
    const missing = crit.filter((c) => (c.type === "input" ? false : c.type === "auto" ? false : !(c.id in input.answers)));
    if (missing.length) throw new AppError(`Answer every criterion before submitting (${missing.length} left; choose N/A where it does not apply).`, 400);
    const needText = crit.filter((c) => c.type === "scale_text" && input.answers[c.id] != null && !texts[c.id]);
    if (needText.length) throw new AppError(`Add a comment to “${needText[0].label}”.`, 400);
  }
  if (input.supervisorId) {
    const [m] = await query("SELECT 1 FROM cx_members WHERE project_id=$1 AND user_id=$2 AND role IN ('admin','supervisor') UNION SELECT 1 FROM projects WHERE id=$1 AND owner_id=$2", [projectId, input.supervisorId]);
    if (!m) throw new AppError("The supervisor must be an admin or supervisor on this brand.", 400);
  }
  const status = input.submit ? (r.status === "disputed" ? "resolved" : "submitted") : r.status === "queued" ? "draft" : r.status;
  const tags = [...new Set((input.tags ?? r.tags ?? []).map((t) => t.trim().toLowerCase()).filter(Boolean))].slice(0, 20);
  const dueAt = input.submit && card.due_days ? new Date(Date.now() + card.due_days * 86400000) : null;
  await query(
    `UPDATE cx_qa_reviews SET answers=$3, score=$4, fatal=$5, comment=$6, coaching=$7, status=$8, reviewer_id=$9,
     submitted_at=CASE WHEN $10 THEN now() ELSE submitted_at END, text_answers=$11, tags=$12, supervisor_id=$13,
     due_at=CASE WHEN $10 THEN $14::timestamptz ELSE due_at END, accepted_at=CASE WHEN $10 THEN NULL ELSE accepted_at END, auto_accepted=CASE WHEN $10 THEN false ELSE auto_accepted END,
     updated_at=now() WHERE id=$1 AND project_id=$2`,
    [id, projectId, JSON.stringify(answers), res.score, res.fatal, input.comment.slice(0, 4000), input.coaching.slice(0, 4000), status, reviewerId, input.submit, JSON.stringify(texts), JSON.stringify(tags), input.supervisorId ?? r.supervisor_id ?? null, dueAt],
  );
  if (input.submit && r.agent_id && r.agent_id !== reviewerId) {
    await notify({
      ownerId: r.agent_id,
      projectId,
      tool: "cx-quality",
      severity: res.fatal || (res.score ?? 100) < card.pass_score ? "warning" : "info",
      title: `New ${card.form_type === "coaching" ? "coaching" : "evaluation"} on ticket #${r.ticket_number}: ${res.score == null ? "n/a" : `${res.score.toFixed(0)}%`}`,
      body: `${card.name}${dueAt ? ` · accept or dispute by ${dueAt.toISOString().slice(0, 10)}` : ""}`,
      link: `/cx/quality/review/${id}?brand=${projectId}`,
    }).catch(() => {});
  }
  return { ...res, status };
}

/** Agent accepts a submitted review (feedback loop). */
export async function acceptReview(projectId: string, id: string) {
  const r = await getReview(projectId, id);
  if (r.status !== "submitted" && r.status !== "resolved") throw new AppError("Only submitted reviews can be accepted.", 400);
  await query("UPDATE cx_qa_reviews SET accepted_at=now(), auto_accepted=false, updated_at=now() WHERE id=$1 AND project_id=$2", [id, projectId]);
}

/** Auto-accepts submitted reviews whose due date passed on forms with auto-accept on (hourly job). */
export async function autoAcceptDue(projectId: string) {
  const rows = await query<{ id: string }>(
    `UPDATE cx_qa_reviews r SET accepted_at=now(), auto_accepted=true, updated_at=now() FROM cx_qa_scorecards c
     WHERE r.scorecard_id=c.id AND r.project_id=$1 AND c.auto_accept AND r.status IN ('submitted','resolved') AND r.accepted_at IS NULL AND r.due_at IS NOT NULL AND r.due_at < now() RETURNING r.id`,
    [projectId],
  );
  return { accepted: rows.length };
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
  const card = await getScorecard(projectId, scorecardId);
  const pool = await query<{ id: string; assignee_id: string | null }>(
    `SELECT t.id,t.assignee_id FROM cx_tickets t WHERE t.project_id=$1 AND t.status IN ('solved','closed')
     AND COALESCE(t.resolved_at,t.updated_at) > now() - ($3 * interval '1 day')
     AND ($4::text IS NULL OR t.assignee_id=$4) AND ($5::text IS NULL OR t.channel_kind=$5)
     AND ($6::text IS NULL OR t.assignee_id IN (SELECT user_id FROM cx_members WHERE project_id=$1 AND team_id=$6))
     AND NOT EXISTS (SELECT 1 FROM cx_qa_reviews r WHERE r.ticket_id=t.id AND r.scorecard_id=$2)
     AND EXISTS (SELECT 1 FROM cx_messages m WHERE m.ticket_id=t.id AND m.direction='out')
     LIMIT 5000`,
    [projectId, scorecardId, opts.days, opts.agentId || null, opts.channel || null, card.team_id || null],
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
  const criteria = card.sections.flatMap((s) => s.criteria.filter((c) => c.type !== "input" && c.type !== "auto").map((c) => `- ${c.id} [${s.name}${c.fatal ? ", FATAL" : ""}]: ${c.label}${c.description ? ` — ${c.description}` : ""}`)).join("\n");
  const out = await complete(
    "You are a strict customer-support quality reviewer. Evaluate only the agent messages against each criterion. Answer 1 (meets), 0.5 (partially), 0 (does not meet) or null (not applicable). For FATAL criteria answer 0 only when the agent clearly violated it; also flag tone or policy problems (compliance) in the notes. Respond with JSON only: {\"answers\":{\"<id>\":1},\"notes\":{\"<id>\":\"short reason\"},\"summary\":\"one sentence summarizing the conversation, then two sentences of coaching\"}.",
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
  const trendAll = weeks.map((w) => {
    const row: Record<string, string | number | null> = { week: w };
    for (const a of agents.values()) row[a.id ?? "none"] = rows.find((r) => r.week === w && (r.agent_id ?? "none") === (a.id ?? "none"))?.avg ?? null;
    return row;
  });
  return {
    trendAll,
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

// ------------------------------------------------------------- coaching (R4, R11, R12, R15)

export type Coaching = { id: string; agent_id: string; agent: string | null; scorecard_id: string | null; form: string | null; supervisor: string | null; assigned_by_name: string | null; notes: string; outcome: string; status: "assigned" | "completed"; due_at: string | null; completed_at: string | null; created_at: string };

export async function listCoaching(projectId: string) {
  return query<Coaching>(
    `SELECT k.*, COALESCE(NULLIF(a.name,''),a.email) AS agent, c.name AS form, COALESCE(NULLIF(s.name,''),s.email) AS supervisor, COALESCE(NULLIF(b.name,''),b.email) AS assigned_by_name
     FROM cx_qa_coaching k LEFT JOIN users a ON a.id=k.agent_id LEFT JOIN cx_qa_scorecards c ON c.id=k.scorecard_id
     LEFT JOIN users s ON s.id=k.supervisor_id LEFT JOIN users b ON b.id=k.assigned_by
     WHERE k.project_id=$1 ORDER BY (k.status='assigned') DESC, k.created_at DESC LIMIT 500`,
    [projectId],
  );
}

export async function assignCoaching(projectId: string, by: string, input: { agentId: string; scorecardId?: string | null; supervisorId?: string | null; notes: string; dueDays?: number | null }) {
  const [a] = await query("SELECT 1 FROM cx_members WHERE project_id=$1 AND user_id=$2 UNION SELECT 1 FROM projects WHERE id=$1 AND owner_id=$2", [projectId, input.agentId]);
  if (!a) throw new AppError("That agent is not on this brand.", 400);
  if (input.scorecardId) await getScorecard(projectId, input.scorecardId);
  const id = randomUUID();
  const due = input.dueDays ? new Date(Date.now() + input.dueDays * 86400000) : null;
  await query("INSERT INTO cx_qa_coaching(id,project_id,agent_id,scorecard_id,supervisor_id,assigned_by,notes,due_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8)", [
    id, projectId, input.agentId, input.scorecardId || null, input.supervisorId || null, by, input.notes.slice(0, 4000), due,
  ]);
  if (input.agentId !== by)
    await notify({ ownerId: input.agentId, projectId, tool: "cx-quality", severity: "info", title: "A coaching session was assigned to you", body: input.notes.slice(0, 200), link: `/cx/quality?brand=${projectId}&tab=coaching` }).catch(() => {});
  return id;
}

export async function completeCoaching(projectId: string, id: string, outcome: string) {
  await query("UPDATE cx_qa_coaching SET status='completed', outcome=$3, completed_at=now() WHERE id=$1 AND project_id=$2", [id, projectId, outcome.slice(0, 4000)]);
}
export async function deleteCoaching(projectId: string, id: string) {
  await query("DELETE FROM cx_qa_coaching WHERE id=$1 AND project_id=$2", [id, projectId]);
}

/**
 * Agent-wise coaching view: reviewed tickets, average score, weekly trend with early-warning flags,
 * open coaching sessions and a recommended coaching form (team form first, then any coaching form).
 */
export async function coachingView(projectId: string, days = 90) {
  const [stats, cards, members, sessions] = await Promise.all([
    agentQaStats(projectId, days),
    listScorecards(projectId),
    query<{ user_id: string; team_id: string | null }>("SELECT user_id,team_id FROM cx_members WHERE project_id=$1", [projectId]),
    query<{ agent_id: string; open: number; done: number }>("SELECT agent_id, count(*) FILTER (WHERE status='assigned')::int AS open, count(*) FILTER (WHERE status='completed')::int AS done FROM cx_qa_coaching WHERE project_id=$1 GROUP BY 1", [projectId]),
  ]);
  const coachingForms = cards.filter((c) => c.form_type === "coaching" && c.active);
  const pass = cards.find((c) => c.form_type === "evaluation" && c.active)?.pass_score ?? 80;
  return stats.agents.map((a) => {
    const weekly = stats.trendAll.map((w) => w[a.id ?? "none"] as number | null);
    const warn = earlyWarnings(weekly, pass);
    const team = members.find((m) => m.user_id === a.id)?.team_id ?? null;
    const rec = coachingForms.find((c) => c.team_id && c.team_id === team) ?? coachingForms.find((c) => !c.team_id) ?? null;
    const s = sessions.find((x) => x.agent_id === a.id);
    return { ...a, weekly, warnings: warn.flags, change: warn.change, recommended: rec ? { id: rec.id, name: rec.name } : null, openSessions: s?.open ?? 0, completedSessions: s?.done ?? 0 };
  });
}

/**
 * Bulk AI auto-score (R9): AI pre-scores up to `limit` queued/draft reviews without a suggestion, applies
 * the suggested answers as a draft (reviewers still submit) and returns a summary. Null when AI is off.
 */
export async function bulkAiScore(projectId: string, reviewerId: string, limit = 20) {
  if (!aiConfigured()) return null;
  const rows = await query<{ id: string }>("SELECT id FROM cx_qa_reviews WHERE project_id=$1 AND status IN ('queued','draft') AND ai_suggestion IS NULL ORDER BY created_at LIMIT $2", [projectId, Math.min(50, limit)]);
  let scored = 0, failed = 0;
  const scores: number[] = [];
  const summaries: { id: string; summary: string; score: number | null }[] = [];
  for (const r of rows) {
    try {
      const s = await aiPrescore(projectId, r.id);
      if (!s) {
        failed++;
        continue;
      }
      const res = await saveReview(projectId, reviewerId, r.id, { answers: s.answers, comment: "", coaching: s.summary, submit: false });
      scored++;
      if (res.score != null) scores.push(res.score);
      summaries.push({ id: r.id, summary: s.summary, score: res.score });
    } catch {
      failed++;
    }
  }
  return { considered: rows.length, scored, failed, avg: scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : null, below: scores.filter((x) => x < 80).length, summaries };
}
