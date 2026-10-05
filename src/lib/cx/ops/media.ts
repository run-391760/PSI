import { query } from "@/lib/db";
import { postKeyOf } from "./model";

const MENTION_CASE = (col: string) => `(CASE ${col}
  WHEN 'news' THEN 'news' WHEN 'blogs' THEN 'blogs' WHEN 'blog' THEN 'blogs' WHEN 'rss' THEN 'blogs'
  WHEN 'x' THEN 'x_public' WHEN 'twitter' THEN 'x_public' WHEN 'facebook' THEN 'facebook_posts' WHEN 'instagram' THEN 'instagram'
  WHEN 'linkedin' THEN 'linkedin_mentions' WHEN 'youtube' THEN 'youtube' WHEN 'reddit' THEN 'reddit' WHEN 'mastodon' THEN 'mastodon'
  WHEN 'bluesky' THEN 'bluesky' WHEN 'hackernews' THEN 'forums' WHEN 'appstore' THEN 'app_reviews' WHEN 'playstore' THEN 'app_reviews'
  WHEN 'google-reviews' THEN 'google_reviews' ELSE 'web' END)`;

/** Media type of a listening mention in SQL (alias mn). Mirrors model.mentionMediaType. */
export const MENTION_MEDIA_SQL = MENTION_CASE("mn.source");

/**
 * Media type of a ticket in SQL (alias t). Mirrors model.mediaTypeOf — keep both in sync. Tickets created from
 * listening mentions (no channel id, a listening source as channel kind, no thread key) follow the mention source.
 */
export const MEDIA_SQL = `(CASE
  WHEN t.channel_id IS NULL AND t.channel_kind IN ('news','blogs','web','hackernews','mastodon','appstore','playstore','reddit','youtube','bluesky','x','facebook','instagram','linkedin','google-reviews')
       AND COALESCE(t.external_thread_id,'') !~ '^(fbc|fbp|fbr|igc|igm|igt):|^(lic|lip)[|]' THEN ${MENTION_CASE("t.channel_kind")}
  WHEN t.channel_kind IN ('email','livechat','webform','phone','whatsapp','x','youtube','news','reddit','mastodon','bluesky','telegram','discord','discourse','blogs','web') THEN t.channel_kind
  WHEN t.channel_kind='facebook' THEN (CASE split_part(COALESCE(t.external_thread_id,''),':',1) WHEN 'fbc' THEN 'facebook_comments' WHEN 'fbr' THEN 'facebook_reviews'
       WHEN 'fbp' THEN (CASE WHEN t.subject LIKE 'Mentioned your Page in a post%' THEN 'facebook_tags' ELSE 'facebook_posts' END) ELSE 'facebook_messages' END)
  WHEN t.channel_kind='instagram' THEN (CASE split_part(COALESCE(t.external_thread_id,''),':',1) WHEN 'igc' THEN 'instagram_comments' WHEN 'igm' THEN 'instagram_mentions' WHEN 'igt' THEN 'instagram_tags' ELSE 'instagram_messages' END)
  WHEN t.channel_kind='linkedin' THEN (CASE WHEN COALESCE(t.external_thread_id,'') LIKE 'lic|%' THEN 'linkedin_comments' ELSE 'linkedin_mentions' END)
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
