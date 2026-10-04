import { query } from "@/lib/db";
import { groupScope, groupTicketSql } from "./groups";
import { MEDIA_SQL } from "./media";
import { parseMediaParam } from "./model";

/** "All messages" stream: every message across the brand's tickets, newest first (server only). */
export type StreamMessage = {
  id: string; ticket_id: string; number: number; subject: string; direction: "in" | "out" | "note"; author_name: string; author_user_id: string | null;
  body: string; attachments: number; delivery: string; created_at: string; channel_kind: string; channel_name: string | null; media_type: string;
  contact_name: string | null; status: string; sentiment: string | null; bookmarked: boolean;
};
export type MessageFilters = { q?: string; direction?: string; channel?: string; group?: string; media?: string; from?: string; to?: string; agent?: string; sentiment?: string };
const isDate = (s?: string) => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);

export async function listMessages(projectId: string, userId: string, f: MessageFilters, page = 1, pageSize = 50) {
  const params: unknown[] = [projectId, userId];
  const p = (v: unknown) => { params.push(v); return `$${params.length}`; };
  const where = ["t.project_id=$1", "$2::text IS NOT NULL"];
  if (f.direction && ["in", "out", "note"].includes(f.direction)) where.push(`m.direction=${p(f.direction)}`);
  if (f.channel) where.push(`t.channel_kind=${p(f.channel)}`);
  if (f.sentiment) where.push(`t.sentiment=${p(f.sentiment)}`);
  if (f.agent) where.push(`m.author_user_id=${p(f.agent)}`);
  if (isDate(f.from)) where.push(`m.created_at >= ${p(f.from)}::date`);
  if (isDate(f.to)) where.push(`m.created_at < (${p(f.to)}::date + 1)`);
  if (f.group) {
    const scope = await groupScope(projectId, f.group);
    where.push(scope ? groupTicketSql(scope, p) : "false");
  }
  const media = parseMediaParam(f.media);
  if (media.length) where.push(`${MEDIA_SQL} = ANY(${p(media)}::text[])`);
  if (f.q?.trim()) {
    const x = p(`%${f.q.trim()}%`);
    where.push(`(m.body ILIKE ${x} OR m.author_name ILIKE ${x} OR t.subject ILIKE ${x} OR c.name ILIKE ${x})`);
  }
  const w = where.join(" AND ");
  const base = `FROM cx_messages m JOIN cx_tickets t ON t.id=m.ticket_id LEFT JOIN cx_contacts c ON c.id=t.contact_id LEFT JOIN cx_channels ch ON ch.id=t.channel_id WHERE ${w}`;
  const [{ n }] = await query<{ n: number }>(`SELECT count(*)::int AS n ${base}`, params);
  const lim = p(pageSize), off = p((Math.max(1, page) - 1) * pageSize);
  const rows = await query<StreamMessage>(
    `SELECT m.id,m.ticket_id,t.number,t.subject,m.direction,m.author_name,m.author_user_id,m.body,jsonb_array_length(m.attachments)::int AS attachments,m.delivery,m.created_at,
            t.channel_kind,ch.name AS channel_name,${MEDIA_SQL} AS media_type,c.name AS contact_name,t.status,t.sentiment,
            EXISTS (SELECT 1 FROM cx_ops_bookmarks b WHERE b.message_id=m.id AND b.user_id=$2) AS bookmarked
       ${base} ORDER BY m.created_at DESC, m.id DESC LIMIT ${lim} OFFSET ${off}`,
    params,
  );
  return { total: n, rows: rows.map((r) => ({ ...r, created_at: new Date(r.created_at).toISOString() })) };
}

/** Counts for the stream header: today / 7 days by direction. */
export async function messageStats(projectId: string) {
  const [r] = await query<{ today: number; week_in: number; week_out: number; week_note: number }>(
    `SELECT count(*) FILTER (WHERE m.created_at >= date_trunc('day', now()))::int AS today,
            count(*) FILTER (WHERE m.created_at > now()-interval '7 days' AND m.direction='in')::int AS week_in,
            count(*) FILTER (WHERE m.created_at > now()-interval '7 days' AND m.direction='out')::int AS week_out,
            count(*) FILTER (WHERE m.created_at > now()-interval '7 days' AND m.direction='note')::int AS week_note
       FROM cx_messages m JOIN cx_tickets t ON t.id=m.ticket_id WHERE t.project_id=$1`,
    [projectId],
  );
  return r;
}
