import { query } from "@/lib/db";
import { AppError } from "@/lib/domain";
import { decryptSecret, encryptSecret } from "@/lib/secrets";
import { mapDiscordMessages, mapDiscoursePosts, mapTelegramUpdates, type Inbound } from "./pure/connectors";

/**
 * Free channel connectors (B13–B15): Discord bot, Discourse forum, Telegram bot. Channels live in
 * cx_channels (kind discord | discourse | telegram); the tick job polls them into tickets.
 * WP1 dispatch: for these kinds call `await sendConnectorReply(projectId, ticketId, body)` to deliver replies.
 */
export const CONNECTORS = [
  { kind: "discord", name: "Discord", api: "Discord bot (REST API)", costNote: "Free", setup: "Create an application at discord.com/developers → Bot → copy the token, enable Message Content intent, invite the bot to your server with Read/Send Messages, then paste the support channel id.", delay: "Polled every 5 minutes" },
  { kind: "discourse", name: "Discourse", api: "Discourse API", costNote: "Free", setup: "In your forum admin → API → New API key (user: a staff account, scope: read + write posts). Paste the forum URL, key and username.", delay: "Polled every 30 minutes" },
  { kind: "telegram", name: "Telegram", api: "Telegram Bot API", costNote: "Free", setup: "Message @BotFather → /newbot and paste the token. Customers message the bot; group messages arrive when the bot is added to the group with privacy mode off.", delay: "Polled every 5 minutes" },
] as const;
export type ConnectorKind = (typeof CONNECTORS)[number]["kind"];
export const isConnector = (k: string): k is ConnectorKind => CONNECTORS.some((c) => c.kind === k);

/** Channels that need a platform partnership / paid plan: shown as connect cards (B8–B12, B16, B21). */
export const CONNECT_CARDS = [
  { kind: "threads", name: "Threads", api: "Threads API (Meta)", cost: "free-approval", costNote: "Free; Meta app review. Connect with a token in Publishing → Settings", env: [] },
  { kind: "tiktok", name: "TikTok", api: "TikTok Business / Content Posting API", cost: "free-approval", costNote: "Free; TikTok developer approval", env: ["TIKTOK_CLIENT_KEY", "TIKTOK_CLIENT_SECRET"] },
  { kind: "pinterest", name: "Pinterest", api: "Pinterest API v5", cost: "free-approval", costNote: "Free; app review for write access", env: ["PINTEREST_APP_ID", "PINTEREST_APP_SECRET"] },
  { kind: "line", name: "LINE Messenger", api: "LINE Messaging API", cost: "paid", costNote: "Free tier, then paid messages", env: ["LINE_CHANNEL_SECRET", "LINE_CHANNEL_ACCESS_TOKEN"] },
  { kind: "viber", name: "Viber", api: "Viber Business Messages", cost: "paid", costNote: "Paid; via a Viber partner", env: ["VIBER_AUTH_TOKEN"] },
  { kind: "gbp", name: "Google Business Profile", api: "Business Profile API (reviews, locations)", cost: "free-approval", costNote: "Free; Google access approval. Connect with a token in Publishing → Settings", env: [] },
  { kind: "telephony", name: "Calls (Twilio, Exotel…)", api: "Telephony provider webhooks + recordings", cost: "paid", costNote: "Paid per minute", env: ["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN"] },
] as const;
export const cardConfigured = (env: readonly string[]) => env.every((e) => !!process.env[e]);

type Cfg = { channelId?: string; guildId?: string; channelName?: string; botUserId?: string; base?: string; username?: string; offset?: number; lastPostId?: number; bot?: string; lastMessageId?: string };

async function api(url: string, init: RequestInit = {}) {
  const r = await fetch(url, { ...init, signal: AbortSignal.timeout(20_000) });
  const d = await r.json().catch(() => null);
  if (!r.ok) throw new AppError(`${new URL(url).hostname}: ${(d as { message?: string; description?: string; errors?: string[] })?.message ?? (d as { description?: string })?.description ?? (d as { errors?: string[] })?.errors?.[0] ?? `HTTP ${r.status}`}`, 400);
  return d;
}

/** Validate credentials and return the channel config to store. */
export async function verifyConnector(kind: ConnectorKind, input: { token: string; channelId?: string; base?: string; username?: string }): Promise<Cfg> {
  const token = input.token.trim();
  if (!token) throw new AppError("Enter the token / API key.");
  if (kind === "discord") {
    const h = { authorization: `Bot ${token}` };
    const me = (await api("https://discord.com/api/v10/users/@me", { headers: h })) as { id: string };
    if (!input.channelId?.trim()) throw new AppError("Enter the Discord channel id.");
    const ch = (await api(`https://discord.com/api/v10/channels/${input.channelId.trim()}`, { headers: h })) as { id: string; name?: string; guild_id?: string };
    return { channelId: ch.id, guildId: ch.guild_id, channelName: ch.name, botUserId: me.id };
  }
  if (kind === "discourse") {
    const base = (input.base ?? "").trim().replace(/\/$/, "");
    if (!/^https:\/\/[a-z0-9.-]+\.[a-z]{2,}/i.test(base)) throw new AppError("Enter the forum URL (https://forum.example.com).");
    if (!input.username?.trim()) throw new AppError("Enter the API username.");
    await api(`${base}/posts.json`, { headers: { "Api-Key": token, "Api-Username": input.username.trim() } });
    return { base, username: input.username.trim() };
  }
  const me = (await api(`https://api.telegram.org/bot${token}/getMe`)) as { result: { username: string } };
  return { bot: me.result.username };
}

async function importItems(projectId: string, channelId: string, kind: ConnectorKind, items: Inbound[]) {
  const { createTicket, addInbound } = await import("@/lib/cx/inbox/store");
  let created = 0, threaded = 0;
  for (const it of items) {
    const [dupe] = await query("SELECT 1 FROM cx_messages m JOIN cx_tickets t ON t.id=m.ticket_id WHERE t.project_id=$1 AND m.external_id=$2", [projectId, `${kind}:${it.externalId}`]);
    if (dupe) continue;
    const [open] = await query<{ id: string }>("SELECT id FROM cx_tickets WHERE project_id=$1 AND external_thread_id=$2 AND status<>'closed' ORDER BY updated_at DESC LIMIT 1", [projectId, it.threadId]);
    if (open) {
      await addInbound(projectId, open.id, { body: it.body, authorName: it.authorName, externalId: `${kind}:${it.externalId}`, createdAt: it.createdAt });
      threaded++;
    } else {
      await createTicket({ projectId, channelKind: kind, channelId, contact: { name: it.authorName, handle: { kind, id: it.authorId } }, subject: it.subject, body: it.url ? `${it.body}\n\n${it.url}` : it.body, externalId: `${kind}:${it.externalId}`, externalThreadId: it.threadId, authorName: it.authorName, createdAt: it.createdAt });
      created++;
    }
  }
  return { created, threaded };
}

/** Poll one connector channel. */
export async function syncConnector(ch: { id: string; project_id: string; kind: string; config: Cfg; secret_enc: string | null }) {
  if (!isConnector(ch.kind) || !ch.secret_enc) return { created: 0, threaded: 0 };
  const token = decryptSecret(ch.secret_enc);
  const c = ch.config;
  let items: Inbound[] = [];
  const next: Cfg = { ...c };
  try {
    if (ch.kind === "discord") {
      const msgs = (await api(`https://discord.com/api/v10/channels/${c.channelId}/messages?limit=100${c.lastMessageId ? `&after=${c.lastMessageId}` : ""}`, { headers: { authorization: `Bot ${token}` } })) as { id: string }[];
      items = mapDiscordMessages(msgs, { guildId: c.guildId, channelId: c.channelId!, channelName: c.channelName }, c.botUserId);
      if (msgs.length) next.lastMessageId = msgs.map((m) => m.id).sort((a, b) => (BigInt(a) > BigInt(b) ? 1 : -1)).at(-1);
    } else if (ch.kind === "discourse") {
      const d = await api(`${c.base}/posts.json`, { headers: { "Api-Key": token, "Api-Username": c.username! } });
      items = mapDiscoursePosts(d as Record<string, unknown>, c.base!, c.username).filter((p) => Number(p.externalId) > (c.lastPostId ?? 0));
      if (items.length) next.lastPostId = Math.max(...items.map((p) => Number(p.externalId)));
    } else {
      const d = await api(`https://api.telegram.org/bot${token}/getUpdates?timeout=0${c.offset ? `&offset=${c.offset}` : ""}`);
      const r = mapTelegramUpdates(d as Record<string, unknown>);
      items = r.items;
      if (r.nextOffset) next.offset = r.nextOffset;
    }
    const res = await importItems(ch.project_id, ch.id, ch.kind, items);
    await query("UPDATE cx_channels SET config=$2::jsonb, last_synced_at=now(), last_error=NULL, status=CASE WHEN status='error' THEN 'active' ELSE status END WHERE id=$1", [ch.id, JSON.stringify(next)]);
    return res;
  } catch (e) {
    await query("UPDATE cx_channels SET last_error=$2, status='error' WHERE id=$1", [ch.id, e instanceof Error ? e.message.slice(0, 300) : "Sync failed"]);
    throw e;
  }
}

export async function saveConnectorChannel(projectId: string, kind: ConnectorKind, name: string, input: { token: string; channelId?: string; base?: string; username?: string }, id?: string) {
  const { randomUUID } = await import("node:crypto");
  let token = input.token.trim();
  if (!token && id) {
    const [r] = await query<{ secret_enc: string | null }>("SELECT secret_enc FROM cx_channels WHERE id=$1 AND project_id=$2", [id, projectId]);
    token = r?.secret_enc ? decryptSecret(r.secret_enc) : "";
  }
  const cfg = await verifyConnector(kind, { ...input, token });
  if (id) await query("UPDATE cx_channels SET name=$3, config=$4::jsonb, secret_enc=$5, status='active', last_error=NULL WHERE id=$1 AND project_id=$2", [id, projectId, name, JSON.stringify(cfg), encryptSecret(token)]);
  else {
    id = randomUUID();
    await query("INSERT INTO cx_channels(id,project_id,kind,name,config,secret_enc) VALUES($1,$2,$3,$4,$5::jsonb,$6)", [id, projectId, kind, name || kind, JSON.stringify(cfg), encryptSecret(token)]);
  }
  return id;
}

export async function listConnectorChannels(projectId: string) {
  const rows = await query<{ id: string; kind: string; name: string; config: Cfg; status: string; last_error: string | null; last_synced_at: string | null; tickets: number }>(
    "SELECT c.id,c.kind,c.name,c.config,c.status,c.last_error,c.last_synced_at,(SELECT count(*)::int FROM cx_tickets t WHERE t.channel_id=c.id) AS tickets FROM cx_channels c WHERE c.project_id=$1 AND c.kind IN ('discord','discourse','telegram') ORDER BY c.created_at", [projectId]);
  return rows.map((r) => ({ ...r, last_synced_at: r.last_synced_at ? new Date(r.last_synced_at).toISOString() : null }));
}

/** Deliver an agent reply to Discord / Discourse / Telegram. Returns the external message id. */
export async function sendConnectorReply(projectId: string, ticketId: string, body: string): Promise<string | null> {
  const [t] = await query<{ channel_kind: string; external_thread_id: string | null; config: Cfg; secret_enc: string | null }>(
    "SELECT t.channel_kind,t.external_thread_id,c.config,c.secret_enc FROM cx_tickets t JOIN cx_channels c ON c.id=t.channel_id WHERE t.id=$1 AND t.project_id=$2", [ticketId, projectId]);
  if (!t?.secret_enc || !t.external_thread_id || !isConnector(t.channel_kind)) throw new AppError("This ticket's channel can't send replies.");
  const token = decryptSecret(t.secret_enc);
  const [, a] = t.external_thread_id.split(":");
  if (t.channel_kind === "discord") {
    const d = (await api(`https://discord.com/api/v10/channels/${a}/messages`, { method: "POST", headers: { authorization: `Bot ${token}`, "content-type": "application/json" }, body: JSON.stringify({ content: body.slice(0, 2000) }) })) as { id: string };
    return `discord:${d.id}`;
  }
  if (t.channel_kind === "discourse") {
    const d = (await api(`${t.config.base}/posts.json`, { method: "POST", headers: { "Api-Key": token, "Api-Username": t.config.username!, "content-type": "application/json" }, body: JSON.stringify({ topic_id: Number(a), raw: body }) })) as { id: number };
    return `discourse:${d.id}`;
  }
  const d = (await api(`https://api.telegram.org/bot${token}/sendMessage`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ chat_id: a, text: body.slice(0, 4096) }) })) as { result: { message_id: number } };
  return `telegram:${a}:${d.result.message_id}`;
}
