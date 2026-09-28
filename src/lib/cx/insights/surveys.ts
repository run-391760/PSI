import { randomBytes, randomUUID } from "node:crypto";
import { z } from "zod";
import { query, transaction } from "@/lib/db";
import { AppError } from "@/lib/domain";
import { sentimentOf } from "@/lib/cx/ai";
import { getTicketFields } from "@/lib/cx/admin/fields";
import { csat, dayKeys, nps } from "./metrics";
import { DEFAULT_SETTINGS, fillSurveyTemplate, inlineRatingLinks, matchesConditions, settingsInput, type SurveySettings } from "./survey-defs";
import { brandMailer } from "./mailer";

export type SurveyKind = "csat" | "nps" | "custom";
export type Question = { id: string; label: string; type: "rating5" | "nps" | "text" | "choice"; options?: string[]; required?: boolean };
export type Survey = { id: string; project_id: string; name: string; kind: SurveyKind; question: string; questions: Question[]; thank_you: string; status: "active" | "paused"; auto_send: boolean; created_at: string; settings: SurveySettings };
export type { SurveySettings, SurveyConditions } from "./survey-defs";
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
  return { ...s, settings: { ...DEFAULT_SETTINGS, ...(s.settings ?? {}) } };
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
/** Delivery settings (email subject/template, trigger, conditions, inline rating, redirect, background). */
export async function saveSurveySettings(projectId: string, id: string, raw: unknown) {
  await getSurvey(projectId, id);
  const st = settingsInput.parse(raw);
  await query("UPDATE cx_surveys SET settings=$3 WHERE id=$1 AND project_id=$2", [id, projectId, JSON.stringify(st)]);
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

type TicketCtx = { id: string; status: string; channel_kind: string; priority: string; tags: string[]; assignee_id: string | null; number: number; subject: string; contact_name: string | null; contact_email: string | null };
async function ticketCtx(projectId: string, ticketId: string) {
  const [t] = await query<TicketCtx>(
    `SELECT t.id,t.status,t.channel_kind,t.priority,t.tags,t.assignee_id,t.number,t.subject,NULLIF(c.name,'') AS contact_name,c.email AS contact_email
     FROM cx_tickets t LEFT JOIN cx_contacts c ON c.id=t.contact_id WHERE t.id=$1 AND t.project_id=$2`,
    [ticketId, projectId],
  );
  return t ?? null;
}
async function eligible(s: Survey, t: TicketCtx) {
  const st = { ...DEFAULT_SETTINGS, ...(s.settings ?? {}) };
  const c = st.conditions;
  const needFields = !!(c.classificationIds?.length || c.fields?.length);
  const f = needFields ? await getTicketFields(t.id).catch(() => ({ classificationIds: [], values: {} })) : { classificationIds: [], values: {} };
  return matchesConditions(c, { channel: t.channel_kind, priority: t.priority, tags: t.tags ?? [], classificationIds: f.classificationIds, values: f.values });
}
function surveyText(s: Survey, url: string, t: TicketCtx | null, brand = "") {
  const st = { ...DEFAULT_SETTINGS, ...(s.settings ?? {}) };
  const rating = st.inline && s.kind !== "custom" ? inlineRatingLinks(s.kind, url) : "";
  return fillSurveyTemplate(st.emailTemplate, { name: t?.contact_name ?? "", ticket: t?.number, brand, question: s.question || "We'd love your feedback.", link: url, ratingLinks: rating });
}

/**
 * Helper for the inbox module: the survey link to send after a ticket is solved (null when the brand has
 * no active auto-send survey whose conditions match the ticket). Path is relative unless APP_ORIGIN is set.
 * `text` contains inline rating links when the survey has inline rating on.
 */
export async function surveyLinkForTicket(projectId: string, ticketId: string) {
  const surveys = await query<Survey & { brand: string }>(
    "SELECT s.*, p.name AS brand FROM cx_surveys s JOIN projects p ON p.id=s.project_id WHERE s.project_id=$1 AND s.status='active' AND s.auto_send ORDER BY (s.kind='csat') DESC, s.created_at",
    [projectId],
  );
  const t = await ticketCtx(projectId, ticketId);
  if (!t) return null;
  for (const s of surveys) {
    const st = { ...DEFAULT_SETTINGS, ...(s.settings ?? {}) };
    if (st.trigger === "closed" && t.status !== "closed") continue;
    if (!(await eligible(s, t))) continue;
    const token = await inviteForTicket(projectId, s.id, ticketId, "auto");
    const url = `${appOrigin()}/s/${s.id}?t=${token}`;
    return { surveyId: s.id, url, text: surveyText(s, url, t, s.brand), subject: fillSurveyTemplate(st.emailSubject, { brand: s.brand, ticket: t.number, name: t.contact_name ?? "" }) };
  }
  return null;
}

/**
 * Hourly (job cx.insights.survey-dispatch): creates invites for resolved tickets matching each auto-send
 * survey's trigger and conditions, and emails them itself where the inbox does not: tickets on social or
 * other channels with a known contact email (when "email social tickets" is on) and, for the "closed"
 * trigger, email tickets once closed.
 */
export async function dispatchSurveys(projectId: string) {
  const surveys = await query<Survey & { brand: string }>("SELECT s.*, p.name AS brand FROM cx_surveys s JOIN projects p ON p.id=s.project_id WHERE s.project_id=$1 AND s.status='active' AND s.auto_send", [projectId]);
  let created = 0, emailed = 0;
  let mailer: Awaited<ReturnType<typeof brandMailer>> | undefined;
  for (const s of surveys) {
    const st = { ...DEFAULT_SETTINGS, ...(s.settings ?? {}) };
    const statuses = st.trigger === "closed" ? ["closed"] : ["solved", "closed"];
    const tickets = await query<{ id: string }>(
      `SELECT t.id FROM cx_tickets t LEFT JOIN cx_survey_invites i ON i.survey_id=$2 AND i.ticket_id=t.id
       WHERE t.project_id=$1 AND t.status = ANY($3) AND t.resolved_at > now() - interval '14 days'
       AND (i.token IS NULL OR (i.sent_at IS NULL AND i.responded_at IS NULL AND t.channel_kind NOT IN ('livechat','webform') AND NOT (t.channel_kind='email' AND $4<>'closed')))
       LIMIT 500`,
      [projectId, s.id, statuses, st.trigger],
    );
    for (const { id } of tickets) {
      const t = await ticketCtx(projectId, id);
      if (!t || !(await eligible(s, t))) continue;
      const token = await inviteForTicket(projectId, s.id, id, "auto");
      await query("UPDATE cx_survey_invites SET agent_id=COALESCE(agent_id,$2) WHERE token=$1", [token, t.assignee_id]);
      created++;
      const inboxSends = ["email", "livechat", "webform"].includes(t.channel_kind) && !(st.trigger === "closed" && t.channel_kind === "email");
      const wantEmail = t.contact_email && (st.trigger === "closed" && t.channel_kind === "email" ? true : !["email", "livechat", "webform"].includes(t.channel_kind) && st.socialEmail);
      if (inboxSends || !wantEmail) continue;
      mailer ??= await brandMailer(projectId);
      if (!mailer) continue;
      const url = `${appOrigin()}/s/${s.id}?t=${token}`;
      try {
        await mailer.send({ to: t.contact_email!, subject: fillSurveyTemplate(st.emailSubject, { brand: s.brand, ticket: t.number, name: t.contact_name ?? "" }), text: surveyText(s, url, t, s.brand) });
        await query("UPDATE cx_survey_invites SET sent_at=now(), sent_via='email' WHERE token=$1", [token]);
        emailed++;
      } catch (e) {
        console.error("[cx insights] survey email", e);
      }
    }
  }
  return { surveys: surveys.length, invites: created, emailed };
}

/** Agent-wise CSAT sent report (L27): invites, delivered, responses and average score per ticket assignee. */
export async function agentSurveyReport(projectId: string, surveyId?: string, days = 90) {
  const [inv, resp] = await Promise.all([
    query<{ agent_id: string | null; agent: string | null; invites: number; delivered: number; responses: number }>(
      `SELECT u.id AS agent_id, COALESCE(NULLIF(u.name,''),u.email) AS agent, count(*)::int AS invites,
              count(*) FILTER (WHERE i.sent_at IS NOT NULL OR EXISTS (SELECT 1 FROM cx_messages m WHERE m.ticket_id=i.ticket_id AND m.direction='out' AND m.delivery='sent' AND position(i.token in m.body) > 0))::int AS delivered,
              count(*) FILTER (WHERE i.responded_at IS NOT NULL)::int AS responses
       FROM cx_survey_invites i LEFT JOIN cx_tickets t ON t.id=i.ticket_id LEFT JOIN users u ON u.id=COALESCE(i.agent_id,t.assignee_id)
       WHERE i.project_id=$1 AND ($2::text IS NULL OR i.survey_id=$2) AND i.created_at > now() - ($3 * interval '1 day') GROUP BY 1,2`,
      [projectId, surveyId ?? null, days],
    ),
    query<{ agent_id: string | null; n: number; avg: number | null; satisfied: number }>(
      `SELECT t.assignee_id AS agent_id, count(*)::int AS n, avg(r.score)::float AS avg,
              count(*) FILTER (WHERE (s.kind='csat' AND r.score>=4) OR (s.kind='nps' AND r.score>=9))::int AS satisfied
       FROM cx_survey_responses r JOIN cx_surveys s ON s.id=r.survey_id LEFT JOIN cx_tickets t ON t.id=r.ticket_id
       WHERE r.project_id=$1 AND ($2::text IS NULL OR r.survey_id=$2) AND r.ticket_id IS NOT NULL AND r.created_at > now() - ($3 * interval '1 day') GROUP BY 1`,
      [projectId, surveyId ?? null, days],
    ),
  ]);
  return inv
    .map((i) => {
      const r = resp.find((x) => (x.agent_id ?? "") === (i.agent_id ?? ""));
      return { agent: i.agent ?? "Unassigned", invites: i.invites, delivered: i.delivered, responses: i.responses, responseRate: i.invites ? (i.responses / i.invites) * 100 : null, avg: r?.avg ?? null, satisfiedPct: r?.n ? (r.satisfied / r.n) * 100 : null };
    })
    .sort((a, b) => b.invites - a.invites);
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
  return s ? { ...s, settings: { ...DEFAULT_SETTINGS, ...(s.settings ?? {}) } as SurveySettings } : null;
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
    return { thankYou: s.thank_you, redirect: s.settings.redirectUrl || null };
  });
}
