import { randomUUID } from "node:crypto";
import { z } from "zod";
import { query } from "@/lib/db";
import { AppError } from "@/lib/domain";
import { dailyTrend, days, shareOfVoice, summary, type MentionRow } from "./analytics";
import { listEvents } from "./crisis";
import { listTopics } from "./data";
import { LISTEN_SOURCES } from "./sources";
import { publicLink } from "@/lib/cx/inbox/links";
import { trendingFor } from "./monitor";

/**
 * Command Centre (wall KPIs) and Streams boards: columns of live listening mentions and tickets from connected
 * channels (Facebook, Instagram, LinkedIn, X, WhatsApp, email, chat, web forms), filtered per stream.
 */

export const WALL_THEMES = ["midnight", "daylight", "contrast", "ocean"] as const;
export type WallTheme = (typeof WALL_THEMES)[number];

export async function wallData(projectId: string) {
  const now = new Date();
  const [topics, raw, events, trending, tickets] = await Promise.all([
    listTopics(projectId),
    query<MentionRow>(
      `SELECT id, topic_id, source, author, author_handle, author_followers, title, body, language, published_at, sentiment, intent FROM cx_mentions
       WHERE project_id=$1 AND published_at > now() - interval '14 days' AND published_at <= now() AND status<>'ignored' LIMIT 20000`,
      [projectId],
    ),
    listEvents(projectId),
    trendingFor(projectId),
    query<{ open: number; urgent: number; today: number }>(
      "SELECT count(*) FILTER (WHERE status IN ('new','open','pending'))::int open, count(*) FILTER (WHERE status IN ('new','open') AND priority IN ('high','urgent'))::int urgent, count(*) FILTER (WHERE created_at > now() - interval '24 hours')::int today FROM cx_tickets WHERE project_id=$1",
      [projectId],
    ),
  ]);
  const rows = raw.map((r) => ({ ...r, published_at: r.published_at ? new Date(r.published_at).toISOString() : null }));
  const t24 = now.getTime() - 86400000;
  const cur = rows.filter((r) => r.published_at && new Date(r.published_at).getTime() > t24);
  const prev = rows.filter((r) => r.published_at && new Date(r.published_at).getTime() <= t24 && new Date(r.published_at).getTime() > t24 - 86400000);
  const tRefs = topics.map((t) => ({ id: t.id, name: t.name, kind: t.kind, keywords: t.keywords }));
  // Hourly buzz for the last 48 hours (current 24h vs the 24h before, aligned by hour).
  const hours = Array.from({ length: 24 }, (_, i) => {
    const s = t24 + i * 3600000;
    return { label: new Date(s + 3600000).toISOString().slice(11, 13) + ":00", mentions: 0, prev_mentions: 0, negative: 0, s };
  });
  for (const r of rows) {
    const ts = r.published_at ? new Date(r.published_at).getTime() : NaN;
    const i = Math.floor((ts - t24) / 3600000);
    if (i >= 0 && i < 24) {
      hours[i].mentions++;
      if (r.sentiment === "negative") hours[i].negative++;
    } else {
      const j = Math.floor((ts - (t24 - 86400000)) / 3600000);
      if (j >= 0 && j < 24) hours[j].prev_mentions++;
    }
  }
  return {
    now: now.toISOString(),
    topics: topics.length,
    cur: summary(cur),
    prev: summary(prev),
    hourly: hours.map(({ s: _s, ...h }) => h),
    daily: dailyTrend(rows, days(now.toISOString(), 14)),
    sov: shareOfVoice(cur.length ? cur : rows, tRefs),
    events: events.filter((e) => e.status !== "resolved").slice(0, 5),
    trending: trending.issues.slice(0, 6),
    tickets: tickets[0],
  };
}

// ------------------------------------------------------------------ streams

export type StreamDef = { id: string; name: string; topic?: string; source?: string; sentiment?: string; q?: string };
export type Board = { id: string; name: string; streams: StreamDef[]; created_at: string };

/** Inbox channels a stream can show (tickets created by webhooks, mailboxes and widgets). */
export const STREAM_CHANNELS = ["facebook", "instagram", "linkedin", "x", "whatsapp", "email", "livechat", "webform"] as const;
const STREAM_SOURCES = [...LISTEN_SOURCES, ...STREAM_CHANNELS] as const;

const streamSchema = z.object({
  id: z.string().max(40).optional(),
  name: z.string().trim().min(1).max(40),
  topic: z.string().max(64).optional(),
  source: z.enum(STREAM_SOURCES).optional(),
  sentiment: z.enum(["positive", "neutral", "negative"]).optional(),
  q: z.string().trim().max(80).optional(),
});
export const boardInput = z.object({ name: z.string().trim().min(1, "Name the board.").max(60), streams: z.array(streamSchema).min(1, "Add a stream.").max(8) });

/**
 * A brand's first visit to Streams gets a starter board instead of an empty page: all activity, negative,
 * one column per connected social channel and per topic (up to 8 columns). Edit or delete it like any board.
 */
export async function ensureDefaultBoard(projectId: string) {
  const [{ n }] = await query<{ n: number }>("SELECT count(*)::int n FROM cx_command_boards WHERE project_id=$1", [projectId]);
  if (n > 0) return;
  const [kinds, topics] = await Promise.all([
    query<{ kind: string }>("SELECT DISTINCT kind FROM cx_channels WHERE project_id=$1 AND kind = ANY($2)", [projectId, ["facebook", "instagram", "linkedin", "x", "whatsapp"]]),
    listTopics(projectId),
  ]);
  const label: Record<string, string> = { facebook: "Facebook", instagram: "Instagram", linkedin: "LinkedIn", x: "X", whatsapp: "WhatsApp" };
  const streams: z.input<typeof streamSchema>[] = [
    { name: "All activity" },
    { name: "Negative", sentiment: "negative" as const },
    ...kinds.map((k) => ({ name: label[k.kind] ?? k.kind, source: k.kind as (typeof STREAM_CHANNELS)[number] })),
    ...topics.filter((t) => t.active).map((t) => ({ name: t.name.slice(0, 40), topic: t.id })),
  ].slice(0, 8);
  await saveBoard(projectId, { name: "War room", streams });
}

export async function listBoards(projectId: string) {
  return query<Board>("SELECT id, name, streams, created_at FROM cx_command_boards WHERE project_id=$1 ORDER BY created_at", [projectId]);
}

export async function saveBoard(projectId: string, input: z.input<typeof boardInput>, id?: string) {
  const b = boardInput.parse(input);
  const streams = JSON.stringify(b.streams.map((s) => ({ ...s, id: s.id || randomUUID().slice(0, 8), q: s.q || undefined })));
  if (id) {
    const r = await query("UPDATE cx_command_boards SET name=$3, streams=$4::jsonb WHERE id=$1 AND project_id=$2 RETURNING id", [id, projectId, b.name, streams]);
    if (!r.length) throw new AppError("Board not found.", 404);
    return id;
  }
  const [{ n }] = await query<{ n: number }>("SELECT count(*)::int n FROM cx_command_boards WHERE project_id=$1", [projectId]);
  if (n >= 20) throw new AppError("A brand can have up to 20 boards.");
  const newId = randomUUID();
  await query("INSERT INTO cx_command_boards(id,project_id,name,streams) VALUES($1,$2,$3,$4::jsonb)", [newId, projectId, b.name, streams]);
  return newId;
}

export async function deleteBoard(projectId: string, id: string) {
  await query("DELETE FROM cx_command_boards WHERE id=$1 AND project_id=$2", [id, projectId]);
}

export type StreamItem = { id: string; source: string; url: string | null; author: string; author_handle: string | null; title: string; body: string; published_at: string | null; sentiment: string | null; topic_name: string | null; media: { preview: string | null; url: string; type: string }[] | null; ticket_id: string | null };

/**
 * A stream's items, newest first: listening mentions and/or tickets. No source = both; a listening source =
 * mentions; an inbox channel = that channel's tickets. Topics only exist on mentions. Tickets made from a
 * mention are shown once, as the mention.
 */
export async function streamItems(projectId: string, s: StreamDef, limit = 30) {
  const channel = (STREAM_CHANNELS as readonly string[]).includes(s.source ?? "");
  const [mentions, tickets] = await Promise.all([
    channel ? Promise.resolve([]) : mentionItems(projectId, s, limit),
    s.topic || (s.source && !channel) ? Promise.resolve([]) : ticketItems(projectId, s, limit),
  ]);
  return [...mentions, ...tickets].sort((a, b) => (b.published_at ?? "").localeCompare(a.published_at ?? "")).slice(0, limit);
}

const like = (q: string) => `%${q.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;

async function ticketItems(projectId: string, s: StreamDef, limit: number): Promise<StreamItem[]> {
  const params: unknown[] = [projectId];
  const conds = ["t.project_id=$1", "NOT EXISTS (SELECT 1 FROM cx_mentions x WHERE x.ticket_id=t.id)"];
  const add = (sql: string, v: unknown) => { params.push(v); conds.push(sql.replaceAll("?", () => `$${params.length}`)); };
  if (s.source) add("t.channel_kind=?", s.source);
  if (s.sentiment) add("t.sentiment=?", s.sentiment);
  if (s.q) add("(t.subject ILIKE ? OR fm.body ILIKE ?)", like(s.q));
  const rows = await query<{ id: string; source: string; thread: string | null; author: string | null; handle: string | null; body: string | null; subject: string; at: string; sentiment: string | null }>(
    `SELECT t.id, t.channel_kind source, t.external_thread_id thread, COALESCE(NULLIF(c.name,''), c.email, fm.author_name) author,
            (SELECT value FROM jsonb_each_text(COALESCE(c.handles,'{}'::jsonb)) LIMIT 1) handle, fm.body, t.subject, t.created_at at, t.sentiment
       FROM cx_tickets t LEFT JOIN cx_contacts c ON c.id=t.contact_id
       LEFT JOIN LATERAL (SELECT m.body, m.author_name FROM cx_messages m WHERE m.ticket_id=t.id AND m.direction='in' ORDER BY m.created_at, m.id LIMIT 1) fm ON true
      WHERE ${conds.join(" AND ")} ORDER BY t.created_at DESC LIMIT ${limit}`,
    params,
  );
  return rows.map((r) => ({
    id: `t:${r.id}`, source: r.source, url: publicLink({ threadKey: r.thread, firstBody: r.body }), author: r.author || "Unknown", author_handle: r.handle,
    // The first message without the "Comment on your post: <link>" footer.
    title: "", body: (r.body ?? r.subject).replace(/\n\n[^\n]{3,80}:\s+https?:\/\/\S+\s*$/, "").slice(0, 600),
    published_at: new Date(r.at).toISOString(), sentiment: r.sentiment, topic_name: null, media: null, ticket_id: r.id,
  }));
}

async function mentionItems(projectId: string, s: StreamDef, limit: number): Promise<StreamItem[]> {
  const params: unknown[] = [projectId];
  const conds = ["m.project_id=$1", "m.status<>'ignored'"];
  const add = (sql: string, v: unknown) => {
    params.push(v);
    conds.push(sql.replace("?", `$${params.length}`));
  };
  if (s.topic) add("m.topic_id=?", s.topic);
  if (s.source) add("m.source=?", s.source);
  if (s.sentiment) add("m.sentiment=?", s.sentiment);
  if (s.q) add("(m.title ILIKE ? OR m.body ILIKE $X)".replace("$X", `$${params.length + 1}`), `%${s.q.replace(/[%_\\]/g, (c) => `\\${c}`)}%`);
  const rows = await query<StreamItem>(
    `SELECT m.id, m.source, m.url, m.author, m.author_handle, m.title, left(m.body, 600) body, m.published_at, m.sentiment, t.name topic_name, x.media, m.ticket_id
     FROM cx_mentions m LEFT JOIN cx_topics t ON t.id=m.topic_id LEFT JOIN cx_listening_media x ON x.mention_id=m.id WHERE ${conds.join(" AND ")} ORDER BY m.published_at DESC NULLS LAST LIMIT ${limit}`,
    params,
  );
  return rows.map((r) => ({ ...r, published_at: r.published_at ? new Date(r.published_at).toISOString() : null }));
}
