import { query } from "@/lib/db";
import { effectiveStatus } from "@/lib/cx/inbox/model";
import { hoursCfg } from "@/lib/cx/insights/reports";
import { tzOffset } from "@/lib/cx/insights/metrics";
import { MEDIA_TYPES, mediaLabel, mediaTypeOf } from "@/lib/cx/ops/model";
import { asSentiment, engagementOf, mentionMediaType, type Basis, type Entity, type Range, type RRow } from "./model";
import { localToday, readFilters, type ReportFilters } from "./filters";
import { resolveReportScope, type Scope } from "./scope";

/**
 * Report data loading (server-only). Conversations = listening mentions + tickets; a ticket created from a
 * mention is counted once (through the mention) in conversation reports. Rows carry local-time `at`.
 *
 *   const ctx = await reportContext(brand, sp);
 *   const rows = await loadConversations(ctx, { span: { from, to } });
 */
export type ReportCtx = {
  brandId: string;
  brandName: string;
  timezone: string;
  offsetMin: number;
  today: string;
  filters: ReportFilters;
  scope: Scope;
};
type SP = Record<string, string | string[] | undefined>;

export async function reportContext(brand: { id: string; name: string }, sp: SP, opts: { defDays?: number } = {}): Promise<ReportCtx> {
  const cfg = await hoursCfg(brand.id);
  const offsetMin = tzOffset(cfg.timezone || "UTC", new Date());
  const today = localToday(offsetMin);
  const filters = readFilters(sp, today, opts);
  const kw = await query<{ keywords: string[] }>("SELECT keywords FROM cx_topics WHERE project_id=$1", [brand.id]);
  const scope = await resolveReportScope(brand.id, brand.name, sp, kw.flatMap((k) => k.keywords ?? []));
  return { brandId: brand.id, brandName: brand.name, timezone: cfg.timezone || "UTC", offsetMin, today, filters, scope };
}

const LIMIT = 40000;
const bounds = (r: Range, off: number) => ({ start: new Date(Date.parse(`${r.from}T00:00:00Z`) - off * 60000), end: new Date(Date.parse(`${r.to}T23:59:59.999Z`) - off * 60000) });
const local = (v: unknown, off: number) => new Date(new Date(v as string).getTime() + off * 60000).toISOString();

type MentionDb = {
  id: string; topic_id: string | null; source: string; url: string | null; author: string; author_handle: string | null; title: string; body: string;
  at: string; sentiment: string | null; sentiment_score: number | null; engagement: Record<string, unknown> | null; ticket_id: string | null; ticket_number: number | null;
};
type TicketDb = {
  id: string; number: number; subject: string; status: string; overlay: string | null; last_direction: string | null; channel_kind: string; channel_id: string | null;
  external_thread_id: string | null; sentiment: string | null; at: string; assignee_id: string | null; in_queue: boolean | null; contact: string | null; avatar_url: string | null;
  handle: string | null; first_body: string | null; mention_id: string | null; mention_topic: string | null; mention_url: string | null;
};

/** Listening mentions in the span (publish basis = published time, created basis = fetched time). */
export async function loadMentionRows(ctx: ReportCtx, span: Range, basis: Basis = ctx.filters.basis): Promise<RRow[]> {
  const { start, end } = bounds(span, ctx.offsetMin);
  const col = basis === "created" ? "m.fetched_at" : "COALESCE(m.published_at, m.fetched_at)";
  const rows = await query<MentionDb>(
    `SELECT m.id,m.topic_id,m.source,m.url,m.author,m.author_handle,m.title,left(m.body,1200) AS body,${col} AS at,m.sentiment,m.sentiment_score,m.engagement,m.ticket_id,t.number AS ticket_number
       FROM cx_mentions m LEFT JOIN cx_tickets t ON t.id=m.ticket_id
      WHERE m.project_id=$1 AND m.status<>'ignored' AND ${col} >= $2 AND ${col} <= $3 ORDER BY ${col} DESC LIMIT ${LIMIT}`,
    [ctx.brandId, start, end],
  );
  return rows.map((m) => ({
    id: `m:${m.id}`,
    kind: "mention" as const,
    at: local(m.at, ctx.offsetMin),
    sentiment: asSentiment(m.sentiment),
    entities: ctx.scope.mentionEntities({ topic_id: m.topic_id, source: m.source }),
    mediaType: mentionMediaType(m.source),
    network: m.source,
    author: m.author || m.author_handle || "Unknown",
    handle: m.author_handle,
    avatar: null,
    title: m.title,
    text: m.body,
    url: m.url,
    ticketId: m.ticket_id,
    ticketNumber: m.ticket_number,
    mentionId: m.id,
    engagement: engagementOf(m.engagement),
    score: m.sentiment_score,
  }));
}

/** Tickets in the span (created basis = ticket created; publish basis = first customer message time). */
export async function loadTicketRows(ctx: ReportCtx, span: Range, opts: { basis?: Basis; dedupe?: boolean } = {}): Promise<RRow[]> {
  const basis = opts.basis ?? ctx.filters.basis;
  const { start, end } = bounds(span, ctx.offsetMin);
  const col = basis === "publish" ? "COALESCE(fm.created_at, t.created_at)" : "t.created_at";
  const rows = await query<TicketDb>(
    `SELECT t.id,t.number,t.subject,t.status,tm.crm_status AS overlay,t.channel_kind,t.channel_id,t.external_thread_id,t.sentiment,${col} AS at,t.assignee_id,st.in_queue,
            c.name AS contact,c.avatar_url,(SELECT value FROM jsonb_each_text(COALESCE(c.handles,'{}'::jsonb)) LIMIT 1) AS handle,left(fm.body,1200) AS first_body,
            (SELECT x.direction FROM cx_messages x WHERE x.ticket_id=t.id AND x.direction<>'note' ORDER BY x.created_at DESC, x.id DESC LIMIT 1) AS last_direction,
            mn.id AS mention_id, mn.topic_id AS mention_topic, mn.url AS mention_url
       FROM cx_tickets t
       LEFT JOIN cx_inbox_ticket_meta tm ON tm.ticket_id=t.id
       LEFT JOIN cx_admin_ticket_state st ON st.ticket_id=t.id
       LEFT JOIN cx_contacts c ON c.id=t.contact_id
       LEFT JOIN LATERAL (SELECT m.body,m.created_at FROM cx_messages m WHERE m.ticket_id=t.id AND m.direction='in' ORDER BY m.created_at, m.id LIMIT 1) fm ON true
       LEFT JOIN LATERAL (SELECT x.id,x.topic_id,x.url FROM cx_mentions x WHERE x.ticket_id=t.id ORDER BY x.published_at NULLS LAST LIMIT 1) mn ON true
      WHERE t.project_id=$1 AND ${col} >= $2 AND ${col} <= $3 ORDER BY ${col} DESC LIMIT ${LIMIT}`,
    [ctx.brandId, start, end],
  );
  return rows.map((t) => {
    const status = effectiveStatus({ status: t.status, overlay: t.overlay, assignee_id: t.assignee_id, last_direction: t.last_direction });
    return {
      id: `t:${t.id}`,
      kind: "ticket" as const,
      at: local(t.at, ctx.offsetMin),
      sentiment: asSentiment(t.sentiment),
      entities: ctx.scope.ticketEntities({ channel_id: t.channel_id, channel_kind: t.channel_kind, mention_topic: t.mention_topic, from_mention: !!t.mention_id }, !!opts.dedupe),
      mediaType: mediaTypeOf(t),
      network: t.channel_kind,
      author: t.contact || t.handle || "Unknown",
      handle: t.handle,
      avatar: t.avatar_url,
      title: t.subject,
      text: t.first_body ?? t.subject,
      url: t.mention_url,
      ticketId: t.id,
      ticketNumber: t.number,
      mentionId: t.mention_id,
      engagement: null,
      score: null,
      status,
      profile: t.channel_id ?? `kind:${t.channel_kind}`,
      agent: t.assignee_id,
      inQueue: !!t.in_queue,
    };
  });
}

/** Conversations (mentions + tickets not created from a mention), before the media/scope filters. */
export async function loadConversationsRaw(ctx: ReportCtx, span: Range = ctx.filters.range) {
  const [m, t] = await Promise.all([loadMentionRows(ctx, span), loadTicketRows(ctx, span, { dedupe: true })]);
  return [...m, ...t.filter((r) => !r.mentionId)];
}
/** Conversations filtered by media type and scope. */
export async function loadConversations(ctx: ReportCtx, span: Range = ctx.filters.range) {
  return applyFilters(ctx, await loadConversationsRaw(ctx, span));
}

/** Media-type filter options: types present in the period (any scope), with counts, in catalogue order. */
export function mediaOptions(rows: Pick<RRow, "mediaType" | "at">[], range: Range) {
  const c = new Map<string, number>();
  for (const r of rows) if (r.at.slice(0, 10) >= range.from && r.at.slice(0, 10) <= range.to) c.set(r.mediaType, (c.get(r.mediaType) ?? 0) + 1);
  const order = MEDIA_TYPES.map((m) => m.id);
  return [...c.entries()].sort((a, b) => order.indexOf(a[0]) - order.indexOf(b[0])).map(([id, count]) => ({ id, label: mediaLabel(id), count }));
}

/** Media-type filter and scope membership (rows outside every entity are dropped). */
export function applyFilters(ctx: ReportCtx, rows: RRow[]) {
  const media = new Set(ctx.filters.media);
  return rows.filter((r) => (!media.size || media.has(r.mediaType)) && r.entities.length > 0);
}

/** Entities to show: in the default scope, "Owned profiles" / "Other mentions" only when they have rows. */
export function visibleEntities(ctx: ReportCtx, rows: RRow[]): Entity[] {
  if (!ctx.scope.isDefault) return ctx.scope.entities;
  const used = new Set(rows.flatMap((r) => r.entities));
  return ctx.scope.entities.filter((e) => (e.kind === "owned" || e.kind === "other" ? used.has(e.id) : true));
}

/** Channel (profile) names of the brand, plus listening sources used as pseudo-profiles ("kind:news"). */
export async function profileNames(projectId: string) {
  const rows = await query<{ id: string; name: string; kind: string }>("SELECT id,name,kind FROM cx_channels WHERE project_id=$1", [projectId]);
  return new Map(rows.map((r) => [r.id, r.name]));
}
