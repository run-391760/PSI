/** Free channel connectors (Discord, Discourse, Telegram): API payload → inbound item mapping (pure, fixture-tested). */
export type Inbound = { externalId: string; threadId: string; authorId: string; authorName: string; subject: string; body: string; createdAt: string; url: string | null };
type Obj = Record<string, any>;

/** Discord REST: GET /channels/{id}/messages. Bot and system messages are skipped; threads map to one ticket. */
export function mapDiscordMessages(msgs: Obj[], ch: { guildId?: string; channelId: string; channelName?: string }, botUserId?: string): Inbound[] {
  return (Array.isArray(msgs) ? msgs : [])
    .filter((m) => m && !m.author?.bot && m.author?.id !== botUserId && (m.type === 0 || m.type === 19) && (m.content || m.attachments?.length))
    .map((m) => ({
      externalId: String(m.id),
      threadId: `discord:${m.message_reference?.channel_id && m.message_reference.channel_id !== ch.channelId ? m.message_reference.channel_id : ch.channelId}:${m.author.id}`,
      authorId: String(m.author.id), authorName: m.member?.nick || m.author.global_name || m.author.username || "Discord user",
      subject: `Discord #${ch.channelName ?? ch.channelId}`,
      body: m.content || (m.attachments ?? []).map((a: Obj) => `[${a.filename}] ${a.url}`).join("\n"),
      createdAt: new Date(m.timestamp ?? Date.now()).toISOString(),
      url: ch.guildId ? `https://discord.com/channels/${ch.guildId}/${ch.channelId}/${m.id}` : null,
    }))
    .reverse();
}

/** Discourse: GET /posts.json (latest posts). Topic = ticket thread; staff/own posts are skipped. */
export function mapDiscoursePosts(body: Obj, base: string, ownUsername?: string): Inbound[] {
  const posts: Obj[] = body?.latest_posts ?? [];
  return posts
    .filter((p) => p && !p.hidden && p.post_type === 1 && p.username !== ownUsername && !p.staff)
    .map((p) => ({
      externalId: String(p.id), threadId: `discourse:${p.topic_id}`, authorId: String(p.username), authorName: p.name || p.username,
      subject: p.topic_title || `Topic ${p.topic_id}`, body: String(p.raw ?? stripHtml(p.cooked ?? "")).slice(0, 20000),
      createdAt: new Date(p.created_at ?? Date.now()).toISOString(), url: `${base.replace(/\/$/, "")}/t/${p.topic_slug ?? p.topic_id}/${p.topic_id}/${p.post_number ?? 1}`,
    }))
    .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
}
const stripHtml = (h: string) => h.replace(/<br\s*\/?>/gi, "\n").replace(/<\/p>/gi, "\n").replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim();

/** Telegram Bot API getUpdates: private and group messages to the bot. Returns items and the next offset. */
export function mapTelegramUpdates(body: Obj): { items: Inbound[]; nextOffset: number | null } {
  const updates: Obj[] = body?.ok ? body.result ?? [] : [];
  let max: number | null = null;
  const items: Inbound[] = [];
  for (const u of updates) {
    max = Math.max(max ?? 0, Number(u.update_id));
    const m = u.message ?? u.edited_message;
    if (!m || m.from?.is_bot) continue;
    const text = m.text ?? m.caption ?? (m.photo ? "[photo]" : m.document ? `[file ${m.document.file_name ?? ""}]` : m.voice ? "[voice message]" : m.sticker ? "[sticker]" : null);
    if (!text) continue;
    const name = [m.from?.first_name, m.from?.last_name].filter(Boolean).join(" ") || m.from?.username || "Telegram user";
    items.push({
      externalId: `${m.chat.id}:${m.message_id}`, threadId: `telegram:${m.chat.id}`, authorId: String(m.from?.id ?? m.chat.id), authorName: name,
      subject: m.chat.type === "private" ? `Telegram: ${name}` : `Telegram: ${m.chat.title ?? m.chat.id}`, body: text, createdAt: new Date((m.date ?? Date.now() / 1000) * 1000).toISOString(), url: null,
    });
  }
  return { items, nextOffset: max == null ? null : max + 1 };
}
