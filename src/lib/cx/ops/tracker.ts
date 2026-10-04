import { randomUUID } from "node:crypto";
import { query } from "@/lib/db";
import { AppError } from "@/lib/domain";
import { sourceLabel } from "@/lib/cx/listening/sources";
import { mediaLabel, mediaTypeOf, normalizePostUrl, postKeyOf, responseState, trackerMatches, type Tracked } from "./model";
import { cleanTracked, publishedTracked, responseMs, ticketState, type PubPostRow, type TrackedInput, type TrackerItem } from "./tracker-model";

/** Mentions Tracker (server-only): tracked handles/posts and the replies/mentions that refer to them. */

const MAX_TRACKED = 200;
const SCAN_DAYS = 90;
const SCAN_MENTIONS = 3000;
const SCAN_TICKETS = 2000;
const iso = (v: unknown) => (v == null ? null : new Date(v as string).toISOString());

export type StoredTracked = Tracked & { createdAt: string };
export type PubTracked = Tracked & { postId: string; publishedAt: string | null };

export async function listTracked(projectId: string): Promise<StoredTracked[]> {
  const rows = await query<{ id: string; kind: "handle" | "post"; platform: string; value: string; label: string; created_at: string }>(
    "SELECT id,kind,platform,value,label,created_at FROM cx_ops_tracked WHERE project_id=$1 ORDER BY kind, created_at",
    [projectId],
  );
  return rows.map((r) => ({ id: r.id, kind: r.kind === "post" ? "post" : "handle", platform: r.platform, value: r.value, label: r.label, createdAt: iso(r.created_at)! }));
}

export async function addTracked(projectId: string, input: TrackedInput) {
  const c = cleanTracked(input);
  if (!c.ok) throw new AppError(c.error);
  const [{ n }] = await query<{ n: number }>("SELECT count(*)::int n FROM cx_ops_tracked WHERE project_id=$1", [projectId]);
  if (n >= MAX_TRACKED) throw new AppError(`You can track up to ${MAX_TRACKED} handles and posts per brand.`);
  if (c.value.kind === "post") {
    const key = normalizePostUrl(c.value.value);
    const posts = await query<{ value: string }>("SELECT value FROM cx_ops_tracked WHERE project_id=$1 AND kind='post'", [projectId]);
    if (posts.some((p) => normalizePostUrl(p.value) === key)) throw new AppError("That post is already tracked.");
  }
  const id = randomUUID();
  const rows = await query<{ id: string }>(
    "INSERT INTO cx_ops_tracked(id,project_id,kind,platform,value,label) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING RETURNING id",
    [id, projectId, c.value.kind, c.value.platform, c.value.value, c.value.label],
  );
  if (!rows.length) throw new AppError(c.value.kind === "handle" ? `@${c.value.value} is already tracked.` : "That post is already tracked.");
  return id;
}

export async function removeTracked(projectId: string, id: string) {
  await query("DELETE FROM cx_ops_tracked WHERE project_id=$1 AND id=$2", [projectId, id]);
}

/** Published Publishing posts (results with a URL) as tracked posts — derived, never stored. */
export async function publishingTracked(projectId: string, stored: Tracked[]): Promise<PubTracked[]> {
  const rows = await query<PubPostRow>(
    `SELECT id,title,body,published_at,results FROM cx_pub_posts
      WHERE project_id=$1 AND results <> '{}'::jsonb AND COALESCE(published_at, updated_at) > now() - interval '365 days'
      ORDER BY COALESCE(published_at, updated_at) DESC LIMIT 500`,
    [projectId],
  );
  return publishedTracked(rows.map((r) => ({ ...r, published_at: iso(r.published_at) })), stored);
}

type MentionRow = {
  id: string; source: string; url: string | null; author: string; author_handle: string | null; title: string; body: string;
  published_at: string | null; fetched_at: string; status: string; sentiment: string | null; ticket_id: string | null;
  ticket_number: number | null; ticket_status: string | null; ticket_first_response_at: string | null;
};
type TicketRow = {
  id: string; number: number; subject: string; status: string; channel_kind: string; external_thread_id: string; created_at: string;
  first_response_at: string | null; sentiment: string | null; contact_name: string | null; channel_name: string | null; first_body: string | null;
};

export type TrackerContext = { topics: number; mentions: number; metaChannels: number; scanned: number; scanDays: number };

/** Tracked items: listening mentions that reference a tracked handle/post, plus comment/mention tickets on the brand's own Meta posts. */
export async function trackerData(projectId: string, tracked: Tracked[]): Promise<{ items: TrackerItem[]; context: TrackerContext }> {
  const [[ctx], mentions, tickets] = await Promise.all([
    query<{ topics: number; mentions: number; meta: number }>(
      `SELECT (SELECT count(*)::int FROM cx_topics WHERE project_id=$1) topics,
              (SELECT count(*)::int FROM cx_mentions WHERE project_id=$1) mentions,
              (SELECT count(*)::int FROM cx_channels WHERE project_id=$1 AND kind IN ('facebook','instagram')) meta`,
      [projectId],
    ),
    tracked.length
      ? query<MentionRow>(
          `SELECT m.id,m.source,m.url,m.author,m.author_handle,m.title,left(m.body,4000) body,m.published_at,m.fetched_at,m.status,m.sentiment,m.ticket_id,
                  t.number ticket_number,t.status ticket_status,t.first_response_at ticket_first_response_at
             FROM cx_mentions m LEFT JOIN cx_tickets t ON t.id=m.ticket_id
            WHERE m.project_id=$1 AND COALESCE(m.published_at, m.fetched_at) > now() - make_interval(days => $2)
            ORDER BY COALESCE(m.published_at, m.fetched_at) DESC LIMIT $3`,
          [projectId, SCAN_DAYS, SCAN_MENTIONS],
        )
      : Promise.resolve([] as MentionRow[]),
    query<TicketRow>(
      `SELECT t.id,t.number,t.subject,t.status,t.channel_kind,t.external_thread_id,t.created_at,t.first_response_at,t.sentiment,
              c.name contact_name, ch.name channel_name,
              (SELECT left(body,1000) FROM cx_messages WHERE ticket_id=t.id AND direction='in' ORDER BY created_at LIMIT 1) first_body
         FROM cx_tickets t LEFT JOIN cx_contacts c ON c.id=t.contact_id LEFT JOIN cx_channels ch ON ch.id=t.channel_id
        WHERE t.project_id=$1 AND t.external_thread_id ~ '^(fbc|fbp|igc|igm|igt):' AND t.created_at > now() - make_interval(days => $2)
        ORDER BY t.created_at DESC LIMIT $3`,
      [projectId, SCAN_DAYS, SCAN_TICKETS],
    ),
  ]);

  const items: TrackerItem[] = [];
  for (const m of mentions) {
    const hits = trackerMatches(m, tracked);
    if (!hits.length) continue;
    const st = responseState({ status: m.status, ticket_id: m.ticket_id, ticket_first_response_at: iso(m.ticket_first_response_at), ticket_status: m.ticket_status });
    const published = iso(m.published_at) ?? iso(m.fetched_at);
    items.push({
      key: `m:${m.id}`, kind: "mention", id: m.id, source: m.source, sourceLabel: sourceLabel(m.source),
      author: m.author || m.author_handle || "Unknown", handle: m.author_handle, text: snippetOf(m.title, m.body),
      matched: hits.map((h) => ({ id: h.id, label: trackedLabel(h) })), publishedAt: published, state: st,
      responseMs: st === "responded" ? responseMs(published, iso(m.ticket_first_response_at)) : null,
      ticketId: m.ticket_id, ticketNumber: m.ticket_number, url: m.url, sentiment: m.sentiment,
    });
  }
  const trackedPosts = tracked.filter((t) => t.kind === "post").map((t) => ({ t, key: normalizePostUrl(t.value) }));
  for (const t of tickets) {
    const media = mediaTypeOf(t);
    const post = postKeyOf({ externalThreadId: t.external_thread_id, firstBody: t.first_body, channelKind: t.channel_kind });
    const postNorm = normalizePostUrl(post?.url);
    const hit = postNorm ? trackedPosts.find((p) => p.key && (postNorm === p.key || postNorm.startsWith(`${p.key}/`))) : undefined;
    const created = iso(t.created_at);
    const first = iso(t.first_response_at);
    const st = ticketState({ status: t.status, first_response_at: first });
    items.push({
      key: `t:${t.id}`, kind: "ticket", id: t.id, source: media, sourceLabel: mediaLabel(media),
      author: t.contact_name || "Unknown", handle: null, text: snippetOf(t.subject, t.first_body),
      matched: hit ? [{ id: hit.t.id, label: trackedLabel(hit.t) }] : [{ id: `own:${t.channel_kind}`, label: `Own ${t.channel_kind === "facebook" ? "Facebook" : "Instagram"} posts${t.channel_name ? ` (${t.channel_name})` : ""}` }],
      publishedAt: created, state: st, responseMs: first ? responseMs(created, first) : null,
      ticketId: t.id, ticketNumber: t.number, url: post?.url ?? null, sentiment: t.sentiment,
    });
  }
  items.sort((a, b) => (b.publishedAt ?? "").localeCompare(a.publishedAt ?? ""));
  return { items, context: { topics: ctx?.topics ?? 0, mentions: ctx?.mentions ?? 0, metaChannels: ctx?.meta ?? 0, scanned: mentions.length, scanDays: SCAN_DAYS } };
}

function trackedLabel(t: Tracked) {
  if (t.label) return t.kind === "handle" ? `@${t.value} · ${t.label}` : t.label;
  return t.kind === "handle" ? `@${t.value}` : (normalizePostUrl(t.value) ?? t.value);
}
function snippetOf(title: string | null, body: string | null) {
  const s = [title, body].filter((x) => x && x.trim()).join(" — ").replace(/\s+/g, " ").trim();
  return s.length > 220 ? `${s.slice(0, 220)}…` : s;
}
