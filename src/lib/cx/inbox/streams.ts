import { query } from "@/lib/db";
import { groupScope, groupTicketSql } from "@/lib/cx/ops/groups";
import { MEDIA_SQL, MENTION_MEDIA_SQL } from "@/lib/cx/ops/media";
import { listBookmarks } from "@/lib/cx/ops/bookmarks";
import { listTickets, type TicketListRow } from "./store";
import { decodeScope, isEmptyScope, mentionScopeSql, ticketScopeSql, type ResolvedScope } from "@/lib/cx/ops/scope-model";
import { resolveScope } from "@/lib/cx/ops/scope";
import { cardFacets, filterCards, messageCard, mentionCard, selectedProfileKey, sortCards, ticketCard, type CardItem, type Facets, type MentionCardRow, type MessageCardRow, type StreamFilters } from "./stream";

/**
 * Server queries behind the Konnect-style streams (server only; callers verified brand access).
 * - All Messages: ticket messages and listening mentions in one time-ordered stream with MEDIA TYPE / PROFILE counters.
 * - Bookmarks: the user's bookmarked tickets and messages as cards.
 * - Ticket cards by id (queue, bookmarks).
 */
const iso = (v: unknown) => (v == null ? null : new Date(v as string).toISOString());

type ScopeF = StreamFilters & { channel?: string; scope?: string };

async function scopeOf(projectId: string, f: ScopeF): Promise<ResolvedScope | null> {
  if (!f.scope) return null;
  const v = decodeScope(f.scope);
  return isEmptyScope(v) ? null : resolveScope(projectId, v);
}
/** Keep only cards whose ticket is inside the Topic / Profile scope (mentions: topic/source). */
async function inScope(projectId: string, cards: CardItem[], f: ScopeF) {
  const r = await scopeOf(projectId, f);
  if (!r) return cards;
  const params: unknown[] = [projectId, [...new Set(cards.map((c) => c.ticketId).filter(Boolean))]];
  const p = (v: unknown) => { params.push(v); return `$${params.length}`; };
  const ok = new Set((await query<{ id: string }>(`SELECT t.id FROM cx_tickets t WHERE t.project_id=$1 AND t.id = ANY($2) AND ${ticketScopeSql(r, p, "t")}`, params)).map((x) => x.id));
  return cards.filter((c) => c.ticketId && ok.has(c.ticketId));
}

/** Ticket messages + mentions with media type and profile key (no media/profile filter: counters are computed on this). */
async function itemsCte(projectId: string, userId: string, f: ScopeF) {
  const params: unknown[] = [projectId, userId];
  const p = (v: unknown) => { params.push(v); return `$${params.length}`; };
  const mw = ["t.project_id=$1", "$2::text IS NOT NULL"];
  const nw = ["mn.project_id=$1", "mn.ticket_id IS NULL", "mn.status<>'ignored'"];
  const dir = f.direction ?? "in";
  if (dir !== "all") mw.push(`m.direction=${p(dir)}`);
  // ticket-only filters exclude mentions
  const ticketOnly = dir !== "in" || !!f.status || !!f.assignee || !!f.attach || !!f.priority || !!f.tag || !!f.cls || f.kind === "message";
  if (f.kind === "mention") mw.push("false");
  if (f.from) { mw.push(`m.created_at >= ${p(f.from)}::date`); nw.push(`COALESCE(mn.published_at, mn.fetched_at) >= $${params.length}::date`); }
  if (f.to) { mw.push(`m.created_at < (${p(f.to)}::date + 1)`); nw.push(`COALESCE(mn.published_at, mn.fetched_at) < ($${params.length}::date + 1)`); }
  if (f.sentiment) { mw.push(`t.sentiment=${p(f.sentiment)}`); nw.push(`mn.sentiment=$${params.length}`); }
  if (f.lang) { mw.push(`t.language=${p(f.lang)}`); nw.push(`mn.language=$${params.length}`); }
  if (f.priority) mw.push(`t.priority=${p(f.priority)}`);
  if (f.assignee) mw.push(f.assignee === "none" ? "t.assignee_id IS NULL" : `t.assignee_id=${p(f.assignee)}`);
  if (f.attach) mw.push("m.attachments <> '[]'::jsonb");
  if (f.tag) mw.push(`t.tags ? ${p(f.tag)}`);
  if (f.cls) mw.push(`EXISTS (SELECT 1 FROM cx_admin_ticket_fields tf WHERE tf.ticket_id=t.id AND tf.classification_ids ? ${p(f.cls)})`);
  if (f.status) mw.push(`t.status=${p(f.status === "resolved" ? "solved" : f.status)}`);
  if (f.group && f.group !== "all") {
    const scope = await groupScope(projectId, f.group);
    mw.push(scope ? groupTicketSql(scope, p) : "false");
    nw.push(scope?.sources.length ? `mn.source = ANY(${p(scope.sources)}::text[])` : "false");
  }
  const scope = await scopeOf(projectId, f);
  if (scope) { mw.push(ticketScopeSql(scope, p, "t")); nw.push(mentionScopeSql(scope, p, "mn")); }
  if (f.q?.trim()) {
    const x = p(`%${f.q.trim().replace(/^#(?=\D)/, "")}%`);
    mw.push(`(m.body ILIKE ${x} OR m.author_name ILIKE ${x} OR t.subject ILIKE ${x})`);
    nw.push(`(mn.body ILIKE ${x} OR mn.title ILIKE ${x} OR mn.author ILIKE ${x})`);
  }
  if (ticketOnly) nw.push("false");
  const cte = `WITH items AS (
      SELECT 'message'::text AS kind, m.id, m.created_at AS at, ${MEDIA_SQL} AS media_type,
             CASE WHEN t.channel_id IS NOT NULL THEN 'ch:' || t.channel_id WHEN tpc.topic_id IS NOT NULL THEN 'topic:' || tpc.topic_id ELSE 'kind:' || t.channel_kind END AS pkey,
             COALESCE(ch.name, tpc.topic_name, t.channel_kind) AS pname, COALESCE(ch.kind, CASE WHEN tpc.topic_id IS NOT NULL THEN 'topic' ELSE t.channel_kind END) AS pnet
        FROM cx_messages m JOIN cx_tickets t ON t.id=m.ticket_id LEFT JOIN cx_channels ch ON ch.id=t.channel_id
        LEFT JOIN LATERAL (SELECT mn2.topic_id, tp.name AS topic_name FROM cx_mentions mn2 JOIN cx_topics tp ON tp.id=mn2.topic_id WHERE mn2.ticket_id=t.id LIMIT 1) tpc ON t.channel_id IS NULL
       WHERE ${mw.join(" AND ")}
      UNION ALL
      SELECT 'mention'::text, mn.id, COALESCE(mn.published_at, mn.fetched_at), ${MENTION_MEDIA_SQL},
             CASE WHEN mn.topic_id IS NOT NULL THEN 'topic:' || mn.topic_id ELSE 'kind:' || mn.source END,
             COALESCE(tp.name, mn.source), CASE WHEN mn.topic_id IS NOT NULL THEN 'topic' ELSE mn.source END
        FROM cx_mentions mn LEFT JOIN cx_topics tp ON tp.id=mn.topic_id
       WHERE ${nw.join(" AND ")}
    )`;
  return { cte, params, p };
}

export type MessagesStream = { cards: CardItem[]; total: number; facets: Facets; page: number; pageSize: number };

/** All Messages: newest (or oldest) first, `pageSize` per page, with counters that ignore the media/profile selection. */
export async function allMessagesStream(projectId: string, userId: string, f: ScopeF, pageSize = 30): Promise<MessagesStream> {
  const { cte, params, p } = await itemsCte(projectId, userId, f);
  const facetMedia = await query<{ id: string; n: number }>(`${cte} SELECT media_type AS id, count(*)::int AS n FROM items GROUP BY 1 ORDER BY 2 DESC`, params);
  const facetProfiles = await query<{ key: string; name: string; network: string; n: number }>(`${cte} SELECT pkey AS key, pname AS name, pnet AS network, count(*)::int AS n FROM items GROUP BY 1,2,3 ORDER BY 4 DESC, 2 LIMIT 60`, params);
  const outer: string[] = [];
  if (f.media.length) outer.push(`media_type = ANY(${p(f.media)}::text[])`);
  const key = selectedProfileKey(f);
  if (key) outer.push(`pkey=${p(key)}`);
  const w = outer.length ? `WHERE ${outer.join(" AND ")}` : "";
  const [{ n }] = await query<{ n: number }>(`${cte} SELECT count(*)::int AS n FROM items ${w}`, params);
  const page = Math.max(1, f.page || 1);
  const ids = await query<{ kind: string; id: string }>(`${cte} SELECT kind, id FROM items ${w} ORDER BY at ${f.sort === "oldest" ? "ASC" : "DESC"}, id LIMIT ${p(pageSize)} OFFSET ${p((page - 1) * pageSize)}`, params);
  const [msgs, mentions] = await Promise.all([
    messageCardsByIds(userId, ids.filter((r) => r.kind === "message").map((r) => r.id)),
    mentionCardsByIds(projectId, ids.filter((r) => r.kind === "mention").map((r) => r.id)),
  ]);
  const byKey = new Map<string, CardItem>([...msgs.map((c) => [c.messageId!, c] as const), ...mentions.map((c) => [c.mentionId!, c] as const)]);
  const cards = ids.map((r) => byKey.get(r.id)).filter((c): c is CardItem => !!c);
  return { cards, total: n, page, pageSize, facets: { media: facetMedia, profiles: facetProfiles, total: facetMedia.reduce((a, x) => a + x.n, 0) } };
}

/** Message cards (with the ticket's first message for FIRST CONVERSATION). */
export async function messageCardsByIds(userId: string, ids: string[], projectId?: string): Promise<CardItem[]> {
  if (!ids.length) return [];
  const rows = await query<MessageCardRow>(
    `SELECT m.id,m.ticket_id,t.number,t.subject,m.direction,m.author_name,m.body,m.attachments,m.created_at,t.channel_kind,t.channel_id,ch.name AS channel_name,
            ${MEDIA_SQL} AS media_type,
            (SELECT value FROM jsonb_each_text(COALESCE(c.handles,'{}'::jsonb)) LIMIT 1) AS contact_handle,
            t.status AS crm_status, t.sentiment, t.priority, t.assignee_id, COALESCE(NULLIF(u.name,''),u.email) AS assignee_name,
            EXISTS (SELECT 1 FROM cx_ops_bookmarks b WHERE b.message_id=m.id AND b.user_id=$2) AS bookmarked,
            fm.id AS first_id, fm.body AS first_body, fm.created_at AS first_at, fm.attachments AS first_attachments,
            (SELECT count(*)::int FROM cx_messages x WHERE x.ticket_id=t.id AND x.direction<>'note') AS messages,
            (SELECT mn.url FROM cx_mentions mn WHERE mn.ticket_id=t.id AND mn.url IS NOT NULL LIMIT 1) AS url,
            tpc.topic_id, tpc.topic_name
       FROM cx_messages m JOIN cx_tickets t ON t.id=m.ticket_id LEFT JOIN cx_contacts c ON c.id=t.contact_id LEFT JOIN cx_channels ch ON ch.id=t.channel_id LEFT JOIN users u ON u.id=t.assignee_id
       LEFT JOIN LATERAL (SELECT x.id,x.body,x.created_at,x.attachments FROM cx_messages x WHERE x.ticket_id=t.id AND x.direction<>'note' ORDER BY x.created_at, x.id LIMIT 1) fm ON true
       LEFT JOIN LATERAL (SELECT mn2.topic_id, tp.name AS topic_name FROM cx_mentions mn2 JOIN cx_topics tp ON tp.id=mn2.topic_id WHERE mn2.ticket_id=t.id LIMIT 1) tpc ON t.channel_id IS NULL
      WHERE m.id = ANY($1) ${projectId ? "AND t.project_id=$3" : ""}`,
    projectId ? [ids, userId, projectId] : [ids, userId],
  );
  // CRM status for messages: the ticket's effective status is computed by the inbox; the stream shows the stored status.
  return rows.map((r) => messageCard({ ...r, created_at: iso(r.created_at)!, first_at: iso(r.first_at) }));
}

export async function mentionCardsByIds(projectId: string, ids: string[]): Promise<CardItem[]> {
  if (!ids.length) return [];
  const rows = await query<MentionCardRow>(
    `SELECT mn.id,mn.source,mn.url,mn.author,mn.author_handle,mn.title,mn.body,mn.published_at,mn.fetched_at,mn.sentiment,mn.status,mn.topic_id,tp.name AS topic_name,mn.ticket_id,
            ${MENTION_MEDIA_SQL} AS media_type, to_jsonb(mn)->'media' AS media
       FROM cx_mentions mn LEFT JOIN cx_topics tp ON tp.id=mn.topic_id WHERE mn.project_id=$1 AND mn.id = ANY($2)`,
    [projectId, ids],
  );
  return rows.map((r) => mentionCard({ ...r, published_at: iso(r.published_at), fetched_at: iso(r.fetched_at)! }));
}

/** Ticket cards for a set of ticket ids (any status), keyed by ticket id. */
export async function ticketCardRows(projectId: string, userId: string, ids: string[]): Promise<Map<string, TicketListRow>> {
  if (!ids.length) return new Map();
  const rows = await listTickets(projectId, userId, { view: "all", sort: "latest" }, ids.length, { ids });
  return new Map(rows.map((r) => [r.id, r]));
}

/** Bookmarks as cards (tickets and single messages), filtered and counted in memory (a user has at most 1000). */
export async function bookmarkStream(projectId: string, userId: string, f: ScopeF) {
  const marks = await listBookmarks(projectId, userId);
  const ticketIds = [...new Set(marks.filter((b) => !b.message_id).map((b) => b.ticket_id))];
  const [tickets, msgs] = await Promise.all([
    ticketCardRows(projectId, userId, ticketIds),
    messageCardsByIds(userId, marks.filter((b) => b.message_id).map((b) => b.message_id!), projectId),
  ]);
  const msgById = new Map(msgs.map((c) => [c.messageId!, c]));
  const all: CardItem[] = [];
  for (const b of marks) {
    if (b.message_id) {
      const c = msgById.get(b.message_id);
      if (c) all.push({ ...c, key: `b:${b.id}`, bookmarkId: b.id, note: b.note || null, bookmarked: true });
    } else {
      const t = tickets.get(b.ticket_id);
      if (t) all.push(ticketCard(t, { bookmarkId: b.id, note: b.note || null }));
    }
  }
  const scoped = filterCards(await inScope(projectId, all, f), f, { skip: ["media", "profile"] });
  const facets = cardFacets(scoped);
  const cards = sortCards(filterCards(scoped, f), f.sort);
  return { cards, facets, total: all.length, tickets: all.filter((c) => c.kind === "ticket").length, messages: all.filter((c) => c.kind === "message").length };
}

/**
 * Queued Tickets as cards: the assignment queue (waiting first, in hand-out order, then assigned-not-started),
 * with ACTIVE USERS (queue agents with their in-queue load, online dot and break state), MEDIA TYPE and PROFILE counters.
 */
export async function queuedStream(projectId: string, userId: string, f: ScopeF) {
  const { queuedTickets } = await import("@/lib/cx/ops/queued");
  const q = await queuedTickets(projectId);
  const rows = await ticketCardRows(projectId, userId, q.rows.map((r) => r.id));
  const all: CardItem[] = [];
  for (const r of q.rows) {
    const t = rows.get(r.id);
    if (t) all.push(ticketCard(t, { queued: { assigned: !!r.assignee_id, position: r.position } }));
  }
  const scoped = filterCards(await inScope(projectId, all, f), { ...f, assignee: undefined }, { skip: ["media", "profile"] });
  const users = {
    unassigned: scoped.filter((c) => !c.assigneeId).length,
    agents: q.agents.map((a) => ({ id: a.id, name: a.name, status: a.status, statusName: a.statusName, paused: a.paused, n: scoped.filter((c) => c.assigneeId === a.id).length })),
  };
  const facetBase = filterCards(scoped, { assignee: f.assignee });
  const facets = cardFacets(facetBase);
  const cards = sortCards(filterCards(facetBase, f), f.sort === "latest" || f.sort === "oldest" ? f.sort : "oldest");
  return { cards, facets, users, settings: q.settings, agents: q.agents, rows: q.rows, total: all.length };
}
