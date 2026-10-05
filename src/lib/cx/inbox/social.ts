import { query } from "@/lib/db";
import { addInbound, createTicket, logEvent } from "./store";
import { channelSecret, setChannelResult } from "./channels";
import type { InboundSocial, PendingMention } from "./webhooks";

const GRAPH = "https://graph.facebook.com/v21.0";
type Obj = Record<string, any>;

/** GET/POST the Graph API with a Page access token (sent in the body or header, never logged). */
export async function graph(path: string, token: string, post?: Record<string, string> | "DELETE"): Promise<Obj> {
  const del = post === "DELETE";
  if (del) post = undefined;
  const r = await fetch(`${GRAPH}/${path}`, {
    method: del ? "DELETE" : post ? "POST" : "GET",
    headers: { authorization: `Bearer ${token}`, ...(post ? { "content-type": "application/x-www-form-urlencoded" } : {}) },
    body: post && typeof post === "object" ? new URLSearchParams(post).toString() : undefined,
    signal: AbortSignal.timeout(20_000),
  });
  const d = (await r.json().catch(() => ({}))) as Obj;
  if (!r.ok || d.error) throw new Error(d.error?.message ?? `Graph API ${r.status}`);
  return d;
}

/**
 * Store inbound WhatsApp / Messenger / Instagram messages: the channel is the cx_channels row whose
 * config.accountId equals the phone number id / page id / IG account id. One open ticket per sender.
 */
export async function storeSocial(items: InboundSocial[]) {
  let stored = 0;
  for (const m of items) {
    const [ch] = await query<{ id: string; project_id: string }>("SELECT id,project_id FROM cx_channels WHERE kind=$1 AND config->>'accountId'=$2 AND status<>'paused' LIMIT 1", [m.platform, m.accountId]);
    if (!ch) continue;
    if (m.messageId) {
      const [dupe] = await query("SELECT 1 FROM cx_messages mm JOIN cx_tickets t ON t.id=mm.ticket_id WHERE t.project_id=$1 AND mm.external_id=$2", [ch.project_id, m.messageId]);
      if (dupe) continue;
    }
    if (m.thread) {
      await storeThreaded(ch, { ...m, thread: m.thread });
      stored++;
      continue;
    }
    const [open] = await query<{ id: string }>(
      `SELECT t.id FROM cx_tickets t JOIN cx_contacts c ON c.id=t.contact_id WHERE t.project_id=$1 AND t.channel_kind=$2 AND c.handles->>$2=$3 AND t.status<>'closed' ORDER BY t.updated_at DESC LIMIT 1`,
      [ch.project_id, m.platform, m.senderId],
    );
    const attachments = m.attachments.map((a) => ({ name: a.type, type: a.type, url: a.url }));
    if (open) await addInbound(ch.project_id, open.id, { body: m.text, authorName: m.senderName || m.senderId, attachments, externalId: m.messageId, createdAt: m.timestamp });
    else
      await createTicket({
        projectId: ch.project_id, channelKind: m.platform, channelId: ch.id,
        contact: { name: m.senderName || null, phone: m.platform === "whatsapp" ? `+${m.senderId}` : null, handle: { kind: m.platform, id: m.senderId } },
        subject: m.text.split("\n")[0].slice(0, 90), body: m.text, attachments, externalId: m.messageId, authorName: m.senderName || m.senderId, createdAt: m.timestamp,
      });
    stored++;
  }
  return stored;
}

/** Comments, mentions and tags: one ticket per public thread; later comments in the thread join it. */
async function storeThreaded(ch: { id: string; project_id: string }, m: InboundSocial & { thread: NonNullable<InboundSocial["thread"]> }) {
  const [open] = await query<{ id: string }>("SELECT id FROM cx_tickets WHERE project_id=$1 AND external_thread_id=$2 AND status<>'closed' ORDER BY updated_at DESC LIMIT 1", [ch.project_id, m.thread.key]);
  const attachments = m.attachments.map((a) => ({ name: a.type, type: a.type, url: a.url }));
  const author = m.senderName || m.senderId || "Unknown";
  if (open) return addInbound(ch.project_id, open.id, { body: m.text, authorName: author, attachments, externalId: m.messageId, createdAt: m.timestamp });
  const body = m.thread.link ? `${m.text}\n\n${m.thread.label}: ${m.thread.link}` : m.text;
  await createTicket({
    projectId: ch.project_id, channelKind: m.platform, channelId: ch.id,
    contact: { name: m.senderName || null, handle: m.senderId ? { kind: m.platform, id: m.senderId } : undefined },
    subject: `${m.thread.label}: ${m.text.split("\n")[0]}`.slice(0, 90), body, attachments, externalId: m.messageId, externalThreadId: m.thread.key,
    authorName: author, createdAt: m.timestamp,
  });
}

async function metaChannel(kind: "facebook" | "instagram", accountId: string) {
  const [ch] = await query<{ id: string; project_id: string; config: Obj; secret_enc: string | null }>(
    "SELECT id,project_id,config,secret_enc FROM cx_channels WHERE kind=$1 AND config->>'accountId'=$2 AND status<>'paused' LIMIT 1", [kind, accountId]);
  return ch ?? null;
}

/** Fetch the text of IG @mentions (captions or comments) and store them; needs the channel's access token. */
export async function storeMentions(pending: PendingMention[]) {
  let stored = 0;
  for (const p of pending) {
    const ch = await metaChannel("instagram", p.accountId);
    const token = ch ? channelSecret(ch) : null;
    if (!ch || !token) continue;
    try {
      const item = p.commentId
        ? (await graph(`${p.accountId}?fields=${encodeURIComponent(`mentioned_comment.comment_id(${p.commentId}){id,text,username,timestamp,media{id,permalink}}`)}`, token)).mentioned_comment
        : (await graph(`${p.accountId}?fields=${encodeURIComponent(`mentioned_media.media_id(${p.mediaId}){id,caption,username,timestamp,permalink,media_type,media_url}`)}`, token)).mentioned_media;
      if (!item) continue;
      const link = item.permalink ?? item.media?.permalink ?? null;
      await storeSocial([{
        platform: "instagram", accountId: p.accountId, senderId: item.username ? `@${item.username}` : "", senderName: item.username ? `@${item.username}` : "",
        messageId: String(item.id), text: String((p.commentId ? item.text : item.caption) ?? "[mention]"), timestamp: item.timestamp ?? new Date().toISOString(),
        attachments: item.media_url ? [{ type: String(item.media_type ?? "image").toLowerCase(), url: item.media_url }] : [],
        thread: { key: `igm:${p.mediaId}:${p.commentId ?? ""}`, label: p.commentId ? "Mentioned you in a comment" : "Mentioned you in a post", link },
      }]);
      stored++;
    } catch (e) {
      await setChannelResult(ch.id, `Instagram mention: ${e instanceof Error ? e.message : String(e)}`.slice(0, 300));
    }
  }
  return stored;
}

/**
 * Posts the IG account is tagged in (no webhook exists): polled at most every 15 minutes. The first check
 * only imports the last 3 days so connecting an account doesn't flood the inbox.
 */
export async function pollInstagramTags(projectId: string) {
  const chans = await query<{ id: string; project_id: string; config: Obj; secret_enc: string | null }>(
    "SELECT id,project_id,config,secret_enc FROM cx_channels WHERE project_id=$1 AND kind='instagram' AND status<>'paused' AND secret_enc IS NOT NULL", [projectId]);
  let stored = 0;
  for (const ch of chans) {
    const last = ch.config.tagsCheckedAt ? Date.parse(ch.config.tagsCheckedAt) : 0;
    if (Date.now() - last < 15 * 60_000) continue;
    const token = channelSecret(ch);
    const accountId = String(ch.config.accountId ?? "");
    if (!token || !accountId) continue;
    try {
      const d = await graph(`${accountId}/tags?fields=id,caption,username,timestamp,permalink,media_type,media_url&limit=25`, token);
      const since = last || Date.now() - 3 * 86_400_000;
      const fresh = ((d.data ?? []) as Obj[]).filter((x) => Date.parse(x.timestamp) > since - 60 * 60_000).reverse();
      stored += await storeSocial(fresh.map((x) => ({
        platform: "instagram" as const, accountId, senderId: x.username ? `@${x.username}` : "", senderName: x.username ? `@${x.username}` : "", messageId: `tag:${x.id}`,
        text: String(x.caption ?? "[tagged post]"), timestamp: x.timestamp, attachments: x.media_url ? [{ type: String(x.media_type ?? "image").toLowerCase(), url: x.media_url }] : [],
        thread: { key: `igt:${x.id}`, label: "Tagged you in a post", link: x.permalink ?? null },
      })));
      await setChannelResult(ch.id, null, { tagsCheckedAt: new Date().toISOString() });
    } catch (e) {
      await setChannelResult(ch.id, `Instagram tags: ${e instanceof Error ? e.message : String(e)}`.slice(0, 300), { tagsCheckedAt: new Date().toISOString() });
    }
  }
  return stored;
}

/** Subscribe the app to a Page's webhook fields (messages, comments/posts, mentions). */
export async function subscribePage(pageId: string, token: string) {
  await graph(`${pageId}/subscribed_apps`, token, { subscribed_fields: "messages,feed,mention,ratings" });
}

export type Moderation = "hide" | "unhide" | "delete";

/**
 * Hide, unhide or delete a Facebook / Instagram comment that arrived in a ticket. Only comments on the
 * brand's own posts can be moderated (Meta rule); the result is stored on the message and logged.
 */
export async function moderateComment(projectId: string, ticketId: string, messageId: string, action: Moderation, actor: string) {
  const { AppError } = await import("@/lib/domain");
  const { parseMetaThread } = await import("./webhooks");
  const [m] = await query<{ external_id: string | null; direction: string; channel_kind: string; channel_id: string | null; external_thread_id: string | null }>(
    `SELECT m.external_id,m.direction,t.channel_kind,t.channel_id,t.external_thread_id FROM cx_messages m JOIN cx_tickets t ON t.id=m.ticket_id
      WHERE m.id=$1 AND m.ticket_id=$2 AND t.project_id=$3`, [messageId, ticketId, projectId]);
  if (!m) throw new AppError("Message not found.", 404);
  const thread = parseMetaThread(m.external_thread_id);
  // Only comments on the brand's own posts: Page comments (fbc) and IG comments (igc), not @mentions elsewhere.
  if (!thread || (thread.kind !== "fbc" && thread.kind !== "igc") || m.direction !== "in" || !m.external_id) throw new AppError("Only comments on your own Facebook and Instagram posts can be hidden or deleted.");
  const [ch] = m.channel_id ? await query<{ secret_enc: string | null }>("SELECT secret_enc FROM cx_channels WHERE id=$1 AND project_id=$2", [m.channel_id, projectId]) : [];
  const token = ch ? channelSecret(ch) : null;
  if (!token) throw new AppError("Add a Page access token to the channel to moderate comments.");
  if (action === "delete") await graph(m.external_id, token, "DELETE");
  else if (m.channel_kind === "instagram") await graph(m.external_id, token, { hide: action === "hide" ? "true" : "false" });
  else await graph(m.external_id, token, { is_hidden: action === "hide" ? "true" : "false" });
  const state = action === "unhide" ? null : action === "hide" ? "hidden" : "deleted";
  await query("INSERT INTO cx_inbox_message_meta(message_id,moderation) VALUES($1,$2) ON CONFLICT(message_id) DO UPDATE SET moderation=$2", [messageId, state]);
  await logEvent(query, ticketId, actor, "update", `${action === "delete" ? "deleted" : action === "hide" ? "hid" : "unhid"} a ${m.channel_kind === "instagram" ? "Instagram" : "Facebook"} comment`);
  return state;
}
