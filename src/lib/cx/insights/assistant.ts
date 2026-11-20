import { randomUUID } from "node:crypto";
import { z } from "zod";
import { query } from "@/lib/db";
import { AppError } from "@/lib/domain";
import { aiConfigured } from "@/lib/cx/ai";
import { topTerms, type MentionRow } from "@/lib/cx/listening/analytics";
import { listTopics } from "@/lib/cx/listening/data";
import { platformDashboard, platformHub, readPeriod } from "@/lib/cx/listening/platforms";
import { LISTEN_SOURCES, sourceLabel } from "@/lib/cx/listening/sources";
import { completeOrThrow, structured } from "@/lib/providers/llm";
import { metricsSnapshot } from "./intelligence";
import { searchKnowledge, type VaultHit } from "./vault";
import { articleTexts } from "./kb";

/**
 * CX AI assistant (Ask tab). Two model calls per answer, on any configured provider:
 *   1. plan  — the model picks up to 5 data lookups (tools) for the question and conversation;
 *   2. answer — the server runs them on stored data and the model answers from that data only.
 * Trust layer: listening mentions are public posts and may be quoted; ticket data stays aggregated
 * (metricsSnapshot), never message text or customer details. Sessions are private to their user.
 */

export const ASSISTANT_TOOLS = {
  platform_overview: "Mentions, sentiment split, unique authors and latest mention per platform (all platforms) for a period.",
  platform_detail: "One platform in depth: totals, engagement, views, reach, daily trend and top mentioners. Needs source.",
  mentions: "Recent public mentions (text, author, date, sentiment, link), optionally filtered by source, sentiment and a text query. Use to quote examples or find complaints.",
  top_terms: "Most frequent words in mentions (trending topics), optionally by source and sentiment.",
  cx_metrics: "Aggregated support metrics: tickets, response and resolution times, SLA, CSAT, NPS, intents, tags, agents. No message text.",
  search_knowledge: "Search the brand's own documents (knowledge vault) and published help articles. Needs query.",
} as const;
type Tool = keyof typeof ASSISTANT_TOOLS;
const TOOL_NAMES = Object.keys(ASSISTANT_TOOLS) as [Tool, ...Tool[]];

const planSchema = z.object({
  calls: z
    .array(
      z.object({
        tool: z.enum(TOOL_NAMES),
        source: z.enum(LISTEN_SOURCES).nullable(),
        days: z.number().int().nullable(),
        sentiment: z.enum(["positive", "neutral", "negative"]).nullable(),
        query: z.string().nullable(),
      }),
    )
    .max(5),
});
export type ToolCall = z.infer<typeof planSchema>["calls"][number];

export type Source = { kind: "data" | "vault" | "kb"; label: string; url?: string | null };

const days3 = (d: number | null | undefined) => ([7, 30, 90].includes(Number(d)) ? Number(d) : 30);
const cap = (v: unknown, max = 12_000) => {
  const s = JSON.stringify(v);
  return s.length > max ? `${s.slice(0, max)}…(truncated)` : s;
};

async function mentionRows(projectId: string, c: Pick<ToolCall, "source" | "sentiment" | "query">, days: number, limit: number) {
  const params: unknown[] = [projectId, days];
  const conds = ["project_id=$1", "status<>'ignored'", "published_at > now() - make_interval(days => $2)"];
  if (c.source) conds.push(`source=$${params.push(c.source)}`);
  if (c.sentiment) conds.push(`sentiment=$${params.push(c.sentiment)}`);
  if (c.query?.trim()) conds.push(`(title ILIKE $${params.push(`%${c.query.trim().slice(0, 100).replace(/[%_\\]/g, (x) => `\\${x}`)}%`)} OR body ILIKE $${params.length} OR translation ILIKE $${params.length})`);
  return query<MentionRow & { url: string | null; translation: string | null; engagement: Record<string, number> }>(
    `SELECT id, topic_id, source, author, author_handle, author_followers, title, body, translation, language, published_at, sentiment, intent, url, engagement
     FROM cx_mentions WHERE ${conds.join(" AND ")} ORDER BY published_at DESC NULLS LAST LIMIT ${limit}`,
    params,
  );
}

/** Run one lookup on stored data. Returns the JSON the model sees and the source chips to show. */
export async function runTool(projectId: string, c: ToolCall): Promise<{ data: unknown; sources: Source[]; hits?: VaultHit[] }> {
  const days = days3(c.days);
  const period = readPeriod({ days: String(days) });
  const when = `last ${days} days`;
  switch (c.tool) {
    case "platform_overview": {
      const cards = await platformHub(projectId, period);
      return {
        data: { period: when, platforms: cards.map((x) => ({ platform: sourceLabel(x.source), mentions: x.mentions, positive: x.positive, neutral: x.neutral, negative: x.negative, uniqueAuthors: x.authors, latest: x.latestAt, storedAllTime: x.allTime })) },
        sources: [{ kind: "data", label: `All platforms · ${when}` }],
      };
    }
    case "platform_detail": {
      if (!c.source) return { data: { error: "source is required" }, sources: [] };
      const d = await platformDashboard(projectId, c.source, period, { sort: "newest", page: 1 }, 1);
      return {
        data: {
          platform: sourceLabel(c.source), period: when, mentions: d.summary.mentions, positive: d.summary.positive, neutral: d.neutral, negative: d.summary.negative,
          uniqueAuthors: d.summary.authors, potentialReach: d.summary.reach, interactions: d.interactions, views: d.views,
          daily: d.trend.map((t) => ({ date: t.date, mentions: t.mentions, positive: t.positive, negative: t.negative })),
          topMentioners: d.authorsByMentions.map((a) => ({ author: a.author, mentions: a.mentions, negative: a.negative })),
          keywords: d.listening.flatMap((t) => t.keywords),
        },
        sources: [{ kind: "data", label: `${sourceLabel(c.source)} · ${when}` }],
      };
    }
    case "mentions": {
      const rows = await mentionRows(projectId, c, days, 15);
      return {
        data: {
          period: when, filters: { source: c.source, sentiment: c.sentiment, query: c.query }, shown: rows.length,
          mentions: rows.map((m) => ({ date: m.published_at ? new Date(m.published_at).toISOString().slice(0, 10) : null, platform: sourceLabel(m.source), author: m.author, sentiment: m.sentiment, text: `${m.title} ${m.translation ?? m.body}`.replace(/\s+/g, " ").trim().slice(0, 320), url: m.url })),
        },
        sources: [{ kind: "data", label: `Mentions${c.source ? ` · ${sourceLabel(c.source)}` : ""}${c.sentiment ? ` · ${c.sentiment}` : ""} · ${when}` }],
      };
    }
    case "top_terms": {
      const [rows, topics] = await Promise.all([mentionRows(projectId, c, days, 5000), listTopics(projectId)]);
      const terms = topTerms(rows.map((r) => ({ ...r, published_at: r.published_at ? new Date(r.published_at).toISOString() : null })), topics.map((t) => ({ id: t.id, name: t.name, kind: t.kind, keywords: t.keywords })), 30);
      return { data: { period: when, mentionsAnalysed: rows.length, terms }, sources: [{ kind: "data", label: `Trending terms${c.source ? ` · ${sourceLabel(c.source)}` : ""} · ${when}` }] };
    }
    case "cx_metrics":
      return { data: await metricsSnapshot(projectId, days), sources: [{ kind: "data", label: `Support metrics · ${when}` }] };
    case "search_knowledge": {
      const hits = c.query?.trim() ? await searchKnowledge(projectId, c.query, 6) : [];
      const kbFull = new Map((await articleTexts(projectId, hits.filter((h) => h.kind === "kb").map((h) => h.id), 2500)).map((a) => [a.id, a.body]));
      return {
        data: { query: c.query, passages: hits.map((h) => ({ source: h.kind === "vault" ? "vault document" : "help article", title: h.title, text: h.kind === "kb" ? (kbFull.get(h.id) ?? h.text) : h.text })) },
        sources: hits.map((h) => ({ kind: h.kind, label: h.title, url: h.url })),
        hits,
      };
    }
  }
}

// ------------------------------------------------------------------ prompts

const PLAN_SYSTEM = `You plan data lookups for a brand-reputation and customer-experience assistant.
Pick 1-5 tool calls that together answer the user's latest message (use the conversation for context, e.g. "and on YouTube?").
Tools:
${Object.entries(ASSISTANT_TOOLS).map(([k, v]) => `- ${k}: ${v}`).join("\n")}
Arguments: source is one of ${LISTEN_SOURCES.join(", ")} or null; days is 7, 30 or 90 (default 30; "this week" = 7, "this month" = 30, "recently" = 30, "quarter" = 90); sentiment or null; query is search text or null.
Questions about the institution itself (fees, courses, policies, facts) need search_knowledge. Complaints/issues need mentions with sentiment negative and usually top_terms. Comparisons need one platform_detail per platform or platform_overview.
Use only the tools listed; never invent tools. Return JSON only.`;

const ANSWER_SYSTEM = `You are the brand's AI data analyst. Answer using ONLY the DATA and KNOWLEDGE provided below and the conversation.
Rules:
- Quote the exact numbers you use, with their period. null or missing means unknown: say "not available", never guess.
- If a platform has fewer than 30 mentions in the data, add "⚠️ Limited sample — interpret with caution."
- When you use a knowledge passage, cite its title in square brackets, e.g. [Fee policy 2026].
- Quote mention text briefly and only when it helps; never invent quotes, authors or links.
- If the data cannot answer, say what is missing (e.g. a platform not connected, no mentions yet, an empty vault).
- Format: short markdown — a one-line answer first, then bullets or a small table. At most 250 words unless asked for more.`;

// ------------------------------------------------------------------ sessions

export type Session = { id: string; title: string; updated_at: string; messages: number };
export type Message = { id: string; role: "user" | "assistant"; content: string; sources: Source[]; created_at: string };

export async function listSessions(projectId: string, userId: string, limit = 40) {
  return query<Session>(
    "SELECT s.id, s.title, s.updated_at, (SELECT count(*)::int FROM cx_assistant_messages m WHERE m.session_id=s.id) messages FROM cx_assistant_sessions s WHERE s.project_id=$1 AND s.user_id=$2 ORDER BY s.updated_at DESC LIMIT $3",
    [projectId, userId, limit],
  );
}

export async function getMessages(projectId: string, userId: string, sessionId: string) {
  const [s] = await query<{ id: string; title: string }>("SELECT id, title FROM cx_assistant_sessions WHERE id=$1 AND project_id=$2 AND user_id=$3", [sessionId, projectId, userId]);
  if (!s) return null;
  const messages = await query<Message>("SELECT id, role, content, sources, created_at FROM cx_assistant_messages WHERE session_id=$1 ORDER BY created_at, role DESC", [sessionId]);
  return { ...s, messages };
}

export async function renameSession(projectId: string, userId: string, id: string, title: string) {
  const t = title.trim().slice(0, 120);
  if (!t) throw new AppError("Enter a name.");
  await query("UPDATE cx_assistant_sessions SET title=$4 WHERE id=$1 AND project_id=$2 AND user_id=$3", [id, projectId, userId, t]);
}

export async function deleteSession(projectId: string, userId: string, id: string) {
  await query("DELETE FROM cx_assistant_sessions WHERE id=$1 AND project_id=$2 AND user_id=$3", [id, projectId, userId]);
}

/** Fallback plan when the planner call fails: an overview plus a knowledge search. */
export const defaultPlan = (q: string): ToolCall[] => [
  { tool: "platform_overview", source: null, days: 30, sentiment: null, query: null },
  { tool: "search_knowledge", source: null, days: null, sentiment: null, query: q },
];

/** Ask in a session (a new one when sessionId is null). Stores both turns; returns the session id and answer. */
export async function sendMessage(projectId: string, userId: string, sessionId: string | null, text: string) {
  if (!aiConfigured()) throw new AppError("Connect an AI key (Anthropic, OpenAI, Gemini or Sarvam) on the server to use the assistant.", 400);
  const q = text.trim().slice(0, 2000);
  if (!q) throw new AppError("Type a question.");
  let sid = sessionId;
  if (sid) {
    const [s] = await query("SELECT 1 FROM cx_assistant_sessions WHERE id=$1 AND project_id=$2 AND user_id=$3", [sid, projectId, userId]);
    if (!s) throw new AppError("Chat not found.", 404);
  } else {
    sid = randomUUID();
    await query("INSERT INTO cx_assistant_sessions(id,project_id,user_id,title) VALUES($1,$2,$3,$4)", [sid, projectId, userId, q.replace(/\s+/g, " ").slice(0, 80)]);
  }
  const history = (await query<{ role: string; content: string }>("SELECT role, content FROM (SELECT role, content, created_at FROM cx_assistant_messages WHERE session_id=$1 ORDER BY created_at DESC LIMIT 10) x ORDER BY created_at", [sid]))
    .map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content.slice(0, 1500)}`)
    .join("\n\n");
  await query("INSERT INTO cx_assistant_messages(id,session_id,role,content) VALUES($1,$2,'user',$3)", [randomUUID(), sid, q]);

  const today = new Date().toISOString().slice(0, 10);
  let calls: ToolCall[];
  try {
    calls = (await structured(planSchema, PLAN_SYSTEM, `Today: ${today}\n\nConversation so far:\n${history || "(none)"}\n\nLatest message: ${q}`, { maxTokens: 800, effort: "low", timeoutMs: 45_000, name: "plan" })).data.calls;
  } catch {
    calls = [];
  }
  if (!calls.length) calls = defaultPlan(q);
  // Always check the brand's own material too (cheap, local) unless the plan already does.
  if (!calls.some((c) => c.tool === "search_knowledge")) calls.push({ tool: "search_knowledge", source: null, days: null, sentiment: null, query: q });

  const results = await Promise.all(calls.slice(0, 6).map((c) => runTool(projectId, c).then((r) => ({ c, ...r }), (e) => ({ c, data: { error: e instanceof Error ? e.message : "lookup failed" }, sources: [] as Source[] }))));
  const data = results.filter((r) => r.c.tool !== "search_knowledge").map((r) => `### ${r.c.tool}${r.c.source ? ` (${r.c.source})` : ""}\n${cap(r.data)}`).join("\n\n");
  const knowledge = results.filter((r) => r.c.tool === "search_knowledge").map((r) => cap(r.data, 9000)).join("\n");
  const prompt = `Today: ${today}\n\nConversation so far:\n${history || "(none)"}\n\nDATA:\n${data || "(no data lookups)"}\n\nKNOWLEDGE:\n${knowledge || "(no matching passages)"}\n\nUser: ${q}`;
  const answer = (await completeOrThrow(ANSWER_SYSTEM, prompt, { maxTokens: 1200, timeoutMs: 90_000 })).text.trim();

  const seen = new Set<string>();
  const sources = results.flatMap((r) => r.sources).filter((s) => (seen.has(s.label) ? false : (seen.add(s.label), true))).slice(0, 12);
  await query("INSERT INTO cx_assistant_messages(id,session_id,role,content,sources,created_at) VALUES($1,$2,'assistant',$3,$4::jsonb,now() + interval '1 millisecond')", [randomUUID(), sid, answer, JSON.stringify(sources)]);
  await query("UPDATE cx_assistant_sessions SET updated_at=now() WHERE id=$1", [sid]);
  return { sessionId: sid, answer, sources };
}
