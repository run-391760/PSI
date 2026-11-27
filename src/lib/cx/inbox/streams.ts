import { query } from "@/lib/db";
import { MEDIA_SQL, MENTION_MEDIA_SQL } from "@/lib/cx/ops/media";
import { listBookmarks } from "@/lib/cx/ops/bookmarks";
import { listTickets, type TicketListRow } from "./store";
import { decodeScope, isEmptyScope, ticketScopeSql, type ResolvedScope } from "@/lib/cx/ops/scope-model";
import { resolveScope } from "@/lib/cx/ops/scope";
import { cardFacets, filterCards, messageCard, mentionCard, sortCards, ticketCard, type CardItem, type MentionCardRow, type MessageCardRow, type StreamFilters } from "./stream";

/**
 * Server queries behind the Konnect-style streams (server only; callers verified brand access).
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
