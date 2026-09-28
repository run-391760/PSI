import { randomBytes, randomUUID } from "node:crypto";
import { z } from "zod";
import { query, transaction } from "@/lib/db";
import { AppError } from "@/lib/domain";
import { sentimentOf } from "@/lib/cx/ai";
import { csat, dayKeys, nps } from "./metrics";

export type SurveyKind = "csat" | "nps" | "custom";
export type Question = { id: string; label: string; type: "rating5" | "nps" | "text" | "choice"; options?: string[]; required?: boolean };
export type Survey = { id: string; project_id: string; name: string; kind: SurveyKind; question: string; questions: Question[]; thank_you: string; status: "active" | "paused"; auto_send: boolean; created_at: string };
export type SurveyWithStats = Survey & { responses: number; last_response: string | null; scores: number[] };
export type ResponseRow = { id: string; score: number | null; answers: Record<string, unknown>; comment: string; sentiment: string | null; created_at: string; ticket_id: string | null; ticket_number: number | null; contact: string | null; agent: string | null };

export const KIND_META: Record<SurveyKind, { label: string; defaultQuestion: string; scale: string }> = {
  csat: { label: "CSAT", defaultQuestion: "How satisfied were you with the support you received?", scale: "1–5" },
  nps: { label: "NPS", defaultQuestion: "How likely are you to recommend us to a friend or colleague?", scale: "0–10" },
  custom: { label: "Custom", defaultQuestion: "", scale: "custom" },
};

const questionInput = z.object({
  id: z.string().min(1).max(40),
  label: z.string().trim().min(1, "Every question needs text").max(300),
  type: z.enum(["rating5", "nps", "text", "choice"]),
  options: z.array(z.string().trim().min(1).max(100)).max(12).optional(),
  required: z.boolean().optional(),
});
export const surveyInput = z.object({
  name: z.string().trim().min(1, "Name is required").max(100),
  kind: z.enum(["csat", "nps", "custom"]),
  question: z.string().trim().max(300).default(""),
  questions: z.array(questionInput).max(20).default([]),
  thank_you: z.string().trim().max(300).default("Thank you for your feedback!"),
  status: z.enum(["active", "paused"]).default("active"),
  auto_send: z.boolean().default(false),
});

export async function listSurveys(projectId: string) {
  return query<SurveyWithStats>(
    `SELECT s.*, (SELECT count(*)::int FROM cx_survey_responses r WHERE r.survey_id=s.id) AS responses,
            (SELECT max(created_at) FROM cx_survey_responses r WHERE r.survey_id=s.id) AS last_response,
            COALESCE((SELECT json_agg(r.score) FROM cx_survey_responses r WHERE r.survey_id=s.id AND r.score IS NOT NULL AND r.created_at > now() - interval '90 days'),'[]'::json) AS scores
     FROM cx_surveys s WHERE s.project_id=$1 ORDER BY s.created_at DESC`,
    [projectId],
  );
}
export async function getSurvey(projectId: string, id: string) {
  const [s] = await query<Survey>("SELECT * FROM cx_surveys WHERE id=$1 AND project_id=$2", [id, projectId]);
  if (!s) throw new AppError("Survey not found.", 404);
  return s;
}
export async function saveSurvey(projectId: string, raw: z.input<typeof surveyInput>, id?: string) {
  const s = surveyInput.parse(raw);
  if (s.kind !== "custom" && !s.question) s.question = KIND_META[s.kind].defaultQuestion;
  if (s.kind === "custom" && !s.questions.length) throw new AppError("Add at least one question.", 400);
  for (const q of s.questions) if (q.type === "choice" && !(q.options?.length ?? 0)) throw new AppError(`Add options to “${q.label}”.`, 400);
  if (id) {
    await getSurvey(projectId, id);
    await query("UPDATE cx_surveys SET name=$3,question=$4,questions=$5,thank_you=$6,status=$7,auto_send=$8 WHERE id=$1 AND project_id=$2", [
      id, projectId, s.name, s.question, JSON.stringify(s.questions), s.thank_you, s.status, s.auto_send,
    ]);
    return id;
  }
  const nid = randomUUID();
  await query("INSERT INTO cx_surveys(id,project_id,name,kind,question,questions,thank_you,status,auto_send) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)", [
    nid, projectId, s.name, s.kind, s.question, JSON.stringify(s.questions), s.thank_you, s.status, s.auto_send,
  ]);
  return nid;
}
export async function deleteSurvey(projectId: string, id: string) {
  await query("DELETE FROM cx_surveys WHERE id=$1 AND project_id=$2", [id, projectId]);
}

export async function listResponses(projectId: string, surveyId: string, limit = 2000) {
  return query<ResponseRow>(
    `SELECT r.id,r.score,r.answers,r.comment,r.sentiment,r.created_at,r.ticket_id,t.number AS ticket_number,
            COALESCE(NULLIF(c.name,''),c.email) AS contact, COALESCE(NULLIF(u.name,''),u.email) AS agent
     FROM cx_survey_responses r LEFT JOIN cx_tickets t ON t.id=r.ticket_id LEFT JOIN cx_contacts c ON c.id=r.contact_id
     LEFT JOIN users u ON u.id=t.assignee_id
     WHERE r.survey_id=$1 AND r.project_id=$2 ORDER BY r.created_at DESC LIMIT $3`,
    [surveyId, projectId, limit],
  );
}

/** Headline scores, daily trend, distribution and comment sentiment for one survey. */
export function surveyStats(s: Survey, rows: ResponseRow[], days = 90, now = new Date()) {
  const since = now.getTime() - days * 86400000;
  const inRange = rows.filter((r) => new Date(r.created_at).getTime() >= since);
  const scores = inRange.flatMap((r) => (r.score != null ? [r.score] : []));
  const n = nps(scores), c = csat(scores);
  // Weekly buckets (week starting Monday, UTC) — daily points are too sparse for survey volumes.
  const weekOf = (d: Date) => {
    const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
    x.setUTCDate(x.getUTCDate() - ((x.getUTCDay() + 6) % 7));
    return x.toISOString().slice(0, 10);
  };
  const keys = [...new Set(dayKeys(days, now).map((d) => weekOf(new Date(`${d}T00:00:00Z`))))];
  const byWeek = new Map<string, number[]>();
  for (const r of inRange) {
    if (r.score == null) continue;
    const k = weekOf(new Date(r.created_at));
    byWeek.set(k, [...(byWeek.get(k) ?? []), r.score]);
  }
  const trend = keys.map((day) => {
    const xs = byWeek.get(day) ?? [];
    return { day, responses: xs.length, score: xs.length ? (s.kind === "nps" ? nps(xs).score : s.kind === "csat" ? csat(xs).score : xs.reduce((a, b) => a + b, 0) / xs.length) : null };
  });
  const max = s.kind === "nps" ? 10 : 5, min = s.kind === "nps" ? 0 : 1;
  const distribution = Array.from({ length: max - min + 1 }, (_, i) => ({ score: String(min + i), count: scores.filter((x) => x === min + i).length }));
  const sentiment = { positive: 0, neutral: 0, negative: 0 };
  for (const r of inRange) if (r.comment && r.sentiment) sentiment[r.sentiment as keyof typeof sentiment] = (sentiment[r.sentiment as keyof typeof sentiment] ?? 0) + 1;
  return { n: inRange.length, nps: n, csat: c, trend, distribution, sentiment, avg: scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : null };
}

// ------------------------------------------------------------- links & invites

export function appOrigin() {
  return (process.env.APP_ORIGIN || "").replace(/\/$/, "");
}

/** Per-ticket invite (one per survey + ticket). Returns the token used in /s/<survey>?t=<token>. */
export async function inviteForTicket(projectId: string, surveyId: string, ticketId: string, source = "manual") {
  const [t] = await query<{ contact_id: string | null }>("SELECT contact_id FROM cx_tickets WHERE id=$1 AND project_id=$2", [ticketId, projectId]);
  if (!t) throw new AppError("Ticket not found.", 404);
  const [row] = await query<{ token: string }>(
    `INSERT INTO cx_survey_invites(token,survey_id,project_id,ticket_id,contact_id,source) VALUES($1,$2,$3,$4,$5,$6)
     ON CONFLICT (survey_id,ticket_id) WHERE ticket_id IS NOT NULL DO UPDATE SET contact_id=excluded.contact_id RETURNING token`,
    [randomBytes(12).toString("base64url"), surveyId, projectId, ticketId, t.contact_id, source],
  );
  return row.token;
}

/**
 * Helper for the inbox module: the survey link to send after a ticket is solved (null when the brand has
 * no active auto-send survey). Path is relative unless APP_ORIGIN is set.
 */
export async function surveyLinkForTicket(projectId: string, ticketId: string) {
  const [s] = await query<Survey>(
    "SELECT * FROM cx_surveys WHERE project_id=$1 AND status='active' AND auto_send ORDER BY (kind='csat') DESC, created_at LIMIT 1",
    [projectId],
  );
  if (!s) return null;
  const token = await inviteForTicket(projectId, s.id, ticketId, "auto");
  const url = `${appOrigin()}/s/${s.id}?t=${token}`;
  return { surveyId: s.id, url, text: `${s.question || "We'd love your feedback."}\n${url}` };
}

/** Creates invites for recently solved tickets of every auto-send survey (job cx.insights.survey-dispatch). */
export async function dispatchSurveys(projectId: string) {
  const surveys = await query<{ id: string }>("SELECT id FROM cx_surveys WHERE project_id=$1 AND status='active' AND auto_send", [projectId]);
  let created = 0;
  for (const s of surveys) {
    const tickets = await query<{ id: string }>(
      `SELECT t.id FROM cx_tickets t WHERE t.project_id=$1 AND t.status IN ('solved','closed') AND t.resolved_at > now() - interval '14 days'
       AND NOT EXISTS (SELECT 1 FROM cx_survey_invites i WHERE i.survey_id=$2 AND i.ticket_id=t.id) LIMIT 500`,
      [projectId, s.id],
    );
    for (const t of tickets) {
      await inviteForTicket(projectId, s.id, t.id, "auto");
      created++;
    }
  }
  return { surveys: surveys.length, invites: created };
}

export async function listInvites(projectId: string, surveyId: string) {
  return query<{ token: string; ticket_id: string | null; ticket_number: number | null; contact: string | null; email: string | null; source: string; created_at: string; responded_at: string | null }>(
    `SELECT i.token,i.ticket_id,t.number AS ticket_number,COALESCE(NULLIF(c.name,''),c.email) AS contact,c.email,i.source,i.created_at,i.responded_at
     FROM cx_survey_invites i LEFT JOIN cx_tickets t ON t.id=i.ticket_id LEFT JOIN cx_contacts c ON c.id=i.contact_id
     WHERE i.survey_id=$1 AND i.project_id=$2 ORDER BY i.created_at DESC LIMIT 300`,
    [surveyId, projectId],
  );
}

// ------------------------------------------------------------- public side

export async function publicSurvey(id: string) {
  const [s] = await query<Survey & { brand: string }>("SELECT s.*, p.name AS brand FROM cx_surveys s JOIN projects p ON p.id=s.project_id WHERE s.id=$1", [id]);
  return s ?? null;
}

export const responseInput = z.object({
  token: z.string().max(64).optional(),
  score: z.number().int().min(0).max(10).nullable().optional(),
  answers: z.record(z.string(), z.union([z.string().max(2000), z.number()])).default({}),
  comment: z.string().max(4000).default(""),
});

/** Validates and stores a public response; a per-ticket token links it to the ticket (and writes ticket CSAT). */
export async function submitResponse(surveyId: string, raw: z.input<typeof responseInput>) {
  const input = responseInput.parse(raw);
  const s = await publicSurvey(surveyId);
  if (!s || s.status !== "active") throw new AppError("This survey is no longer accepting responses.", 404);
  let score = input.score ?? null;
  if (s.kind === "csat" && (score == null || score < 1 || score > 5)) throw new AppError("Choose a rating from 1 to 5.", 400);
  if (s.kind === "nps" && (score == null || score < 0 || score > 10)) throw new AppError("Choose a score from 0 to 10.", 400);
  const answers: Record<string, string | number> = {};
  if (s.kind === "custom") {
    for (const q of s.questions) {
      const a = input.answers[q.id];
      const empty = a == null || a === "";
      if (empty) {
        if (q.required) throw new AppError(`Please answer “${q.label}”.`, 400);
        continue;
      }
      if (q.type === "rating5" && !(Number(a) >= 1 && Number(a) <= 5)) throw new AppError("Invalid rating.", 400);
      if (q.type === "nps" && !(Number(a) >= 0 && Number(a) <= 10)) throw new AppError("Invalid score.", 400);
      if (q.type === "choice" && !q.options?.includes(String(a))) throw new AppError("Invalid choice.", 400);
      answers[q.id] = q.type === "rating5" || q.type === "nps" ? Number(a) : String(a).slice(0, 2000);
    }
    const firstScore = s.questions.find((q) => (q.type === "rating5" || q.type === "nps") && answers[q.id] != null);
    score = firstScore ? Number(answers[firstScore.id]) : null;
  }
  const text = [input.comment, ...Object.entries(answers).filter(([k]) => s.questions.find((q) => q.id === k)?.type === "text").map(([, v]) => String(v))].join(" ").trim();
  const sent = text ? sentimentOf(text) : null;
  return transaction(async (q) => {
    let ticketId: string | null = null, contactId: string | null = null;
    if (input.token) {
      const [inv] = await q<{ ticket_id: string | null; contact_id: string | null }>("SELECT ticket_id,contact_id FROM cx_survey_invites WHERE token=$1 AND survey_id=$2", [input.token, surveyId]);
      if (!inv) throw new AppError("This survey link is invalid.", 404);
      ticketId = inv.ticket_id;
      contactId = inv.contact_id;
      await q("UPDATE cx_survey_invites SET responded_at=now() WHERE token=$1", [input.token]);
      if (ticketId) await q("DELETE FROM cx_survey_responses WHERE survey_id=$1 AND ticket_id=$2", [surveyId, ticketId]);
      if (ticketId && s.kind === "csat" && score != null) await q("UPDATE cx_tickets SET csat=$2, updated_at=now() WHERE id=$1", [ticketId, score]);
    }
    await q(
      "INSERT INTO cx_survey_responses(id,survey_id,project_id,ticket_id,contact_id,score,answers,comment,sentiment,sentiment_score) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
      [randomUUID(), surveyId, s.project_id, ticketId, contactId, score, JSON.stringify(answers), input.comment.trim(), sent?.label ?? null, sent?.score ?? null],
    );
    return { thankYou: s.thank_you };
  });
}
