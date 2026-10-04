import { query } from "@/lib/db";
import { postKeyOf } from "./model";

/** Media type of a ticket in SQL (alias t). Mirrors model.mediaTypeOf — keep both in sync. */
export const MEDIA_SQL = `(CASE
  WHEN t.channel_kind IN ('email','livechat','webform','phone','whatsapp','x','linkedin','youtube','news','reddit','mastodon','bluesky','telegram','discord','discourse') THEN t.channel_kind
  WHEN t.channel_kind='facebook' THEN (CASE split_part(COALESCE(t.external_thread_id,''),':',1) WHEN 'fbc' THEN 'facebook_comments' WHEN 'fbp' THEN 'facebook_posts' ELSE 'facebook_messages' END)
  WHEN t.channel_kind='instagram' THEN (CASE split_part(COALESCE(t.external_thread_id,''),':',1) WHEN 'igc' THEN 'instagram_comments' WHEN 'igm' THEN 'instagram_mentions' WHEN 'igt' THEN 'instagram_tags' ELSE 'instagram_messages' END)
  WHEN t.channel_kind='hackernews' THEN 'forums'
  WHEN t.channel_kind IN ('appstore','playstore') THEN 'app_reviews'
  WHEN t.channel_kind='google-reviews' THEN 'google_reviews'
  ELSE 'other' END)`;

/**
 * Compute post keys for tickets that don't have one yet (cx_ops_ticket_posts). Cheap and idempotent: called
 * when the inbox loads; a ticket without a public post gets a row with post_key NULL so it isn't re-checked.
 */
export async function syncPostKeys(projectId: string, limit = 1000) {
  const rows = await query<{ id: string; external_thread_id: string | null; channel_kind: string; mention_url: string | null; first_body: string | null }>(
    `SELECT t.id,t.external_thread_id,t.channel_kind,
            (SELECT mn.url FROM cx_mentions mn WHERE mn.ticket_id=t.id AND mn.url IS NOT NULL ORDER BY mn.published_at NULLS LAST LIMIT 1) AS mention_url,
            (SELECT m.body FROM cx_messages m WHERE m.ticket_id=t.id AND m.direction='in' ORDER BY m.created_at, m.id LIMIT 1) AS first_body
       FROM cx_tickets t LEFT JOIN cx_ops_ticket_posts tp ON tp.ticket_id=t.id
      WHERE t.project_id=$1 AND tp.ticket_id IS NULL ORDER BY t.created_at DESC LIMIT $2`,
    [projectId, limit],
  );
  if (!rows.length) return 0;
  const ids: string[] = [], keys: (string | null)[] = [], urls: (string | null)[] = [];
  for (const r of rows) {
    const k = postKeyOf({ externalThreadId: r.external_thread_id, mentionUrl: r.mention_url, firstBody: r.first_body, channelKind: r.channel_kind });
    ids.push(r.id); keys.push(k?.key ?? null); urls.push(k?.url ?? null);
  }
  await query(
    `INSERT INTO cx_ops_ticket_posts(ticket_id,project_id,post_key,post_url)
     SELECT x.id,$1,x.k,x.u FROM unnest($2::text[],$3::text[],$4::text[]) AS x(id,k,u)
     ON CONFLICT(ticket_id) DO NOTHING`,
    [projectId, ids, keys, urls],
  );
  return rows.length;
}

/** Forget a ticket's post key (e.g. after a merge) so it is recomputed. */
export async function resetPostKey(ticketId: string) {
  await query("DELETE FROM cx_ops_ticket_posts WHERE ticket_id=$1", [ticketId]);
}
