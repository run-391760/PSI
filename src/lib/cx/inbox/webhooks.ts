import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Mapping of WhatsApp Cloud API and Meta (Messenger / Instagram) webhook payloads to inbound
 * messages (pure, fixture-tested) and X-Hub-Signature-256 verification.
 */
export type InboundSocial = {
  platform: "whatsapp" | "facebook" | "instagram" | "linkedin"; accountId: string; senderId: string; senderName: string; messageId: string; text: string; timestamp: string;
  attachments: { type: string; url?: string; id?: string }[];
  /** Public conversations (comments, mentions, tags): one ticket per thread instead of one per sender. */
  thread?: { key: string; label: string; link?: string | null };
};

/**
 * Public-conversation thread keys (stored in cx_tickets.external_thread_id) and how a reply is sent:
 * fbc:<commentId> reply to a Page comment · fbp:<postId> comment on a visitor post / mention post ·
 * fbr:<openGraphStoryId> comment on a Page review/recommendation · igc:<commentId> reply to an IG comment ·
 * igm:<mediaId>:<commentId?> reply to an @mention · igt:<mediaId> tagged post.
 */
export type MetaThread = { kind: "fbc" | "fbp" | "fbr" | "igc" | "igm" | "igt"; id: string; commentId: string | null };
export function parseMetaThread(key: string | null | undefined): MetaThread | null {
  const m = /^(fbc|fbp|fbr|igc|igm|igt):([^:]+)(?::(.*))?$/.exec(key ?? "");
  return m ? { kind: m[1] as MetaThread["kind"], id: m[2], commentId: m[3] || null } : null;
}

/** IG @mentions arrive without text; they are resolved with the Graph API before storing. */
export type PendingMention = { accountId: string; mediaId: string; commentId: string | null };

type Obj = Record<string, any>;
const iso = (sec: unknown) =>
  Number(sec) ? new Date(Number(sec) * (Number(sec) > 1e12 ? 1 : 1000)).toISOString() : typeof sec === "string" && !Number.isNaN(Date.parse(sec)) ? new Date(sec).toISOString() : new Date().toISOString();

export function mapWhatsApp(body: Obj): InboundSocial[] {
  const out: InboundSocial[] = [];
  if (body?.object !== "whatsapp_business_account") return out;
  for (const entry of body.entry ?? [])
    for (const change of entry.changes ?? []) {
      const v = change.value ?? {};
      const names = Object.fromEntries((v.contacts ?? []).map((c: Obj) => [c.wa_id, c.profile?.name ?? ""]));
      for (const m of v.messages ?? []) {
        const media = ["image", "audio", "video", "document", "sticker"].find((k) => m[k]);
        const text = m.text?.body ?? m.button?.text ?? m.interactive?.button_reply?.title ?? m.interactive?.list_reply?.title ?? (media ? m[media]?.caption ?? `[${media}]` : m.location ? `[location ${m.location.latitude},${m.location.longitude}]` : `[${m.type ?? "message"}]`);
        out.push({ platform: "whatsapp", accountId: v.metadata?.phone_number_id ?? "", senderId: m.from ?? "", senderName: names[m.from] || m.from || "", messageId: m.id ?? "", text, timestamp: iso(m.timestamp), attachments: media ? [{ type: media, id: m[media]?.id }] : [] });
      }
    }
  return out;
}

export function mapMeta(body: Obj): InboundSocial[] {
  const out: InboundSocial[] = [];
  const platform = body?.object === "instagram" ? "instagram" : body?.object === "page" ? "facebook" : null;
  if (!platform) return out;
  for (const entry of body.entry ?? [])
    for (const ev of entry.messaging ?? []) {
      const m = ev.message;
      if (!m || m.is_echo) continue;
      const atts: Obj[] = m.attachments ?? [];
      const storyMention = atts.some((a) => a.type === "story_mention");
      const story = m.reply_to?.story;
      const base = m.text ?? (storyMention ? "" : atts.length ? `[${atts.map((a) => a.type).join(", ")}]` : "[message]");
      // Story mentions / story replies (Instagram): keep the story media link; it expires after 24 hours on Meta's side.
      const text = storyMention ? `Mentioned you in their story${base ? `: ${base}` : ""}` : story ? `Replied to your story: ${base}` : base;
      out.push({
        platform, accountId: String(entry.id ?? ev.recipient?.id ?? ""), senderId: String(ev.sender?.id ?? ""), senderName: "", messageId: m.mid ?? "",
        text, timestamp: iso(ev.timestamp),
        attachments: [
          ...atts.map((a) => ({ type: a.type === "story_mention" ? "story" : a.type ?? "file", url: a.payload?.url })),
          ...(story?.url ? [{ type: "story", url: String(story.url) }] : []),
        ],
      });
    }
  return out;
}

/**
 * Public Page / Instagram events from `entry[].changes[]`: Page feed comments and visitor posts (field
 * "feed"), Page mentions ("mention"), IG comments ("comments") and IG @mentions ("mentions", resolved later).
 * The account's own comments and replies are skipped.
 */
export function mapMetaChanges(body: Obj): { items: InboundSocial[]; mentions: PendingMention[] } {
  const items: InboundSocial[] = [];
  const mentions: PendingMention[] = [];
  const object = body?.object;
  if (object !== "page" && object !== "instagram") return { items, mentions };
  for (const entry of body.entry ?? []) {
    const accountId = String(entry.id ?? "");
    for (const ch of entry.changes ?? []) {
      const v: Obj = ch.value ?? {};
      if (object === "page" && (ch.field === "feed" || ch.field === "mention")) {
        if (v.verb !== "add" || String(v.from?.id ?? v.sender_id ?? "") === accountId) continue;
        const senderId = String(v.from?.id ?? v.sender_id ?? "");
        const senderName = String(v.from?.name ?? v.sender_name ?? "");
        const postId = String(v.post_id ?? "");
        const link = postId ? `https://www.facebook.com/${postId}` : null;
        const photo = v.photo ?? v.link;
        if (v.item === "comment" && v.comment_id) {
          const root = v.parent_id && v.parent_id !== postId ? String(v.parent_id) : String(v.comment_id);
          items.push({
            platform: "facebook", accountId, senderId, senderName, messageId: String(v.comment_id), text: String(v.message ?? (photo ? "[photo]" : "[comment]")), timestamp: iso(v.created_time),
            attachments: photo ? [{ type: "image", url: String(photo) }] : [],
            thread: { key: `fbc:${root}`, label: ch.field === "mention" ? "Mentioned your Page in a comment" : "Comment on your Page post", link },
          });
        } else if (postId && ["post", "status", "photo", "video", "share"].includes(String(v.item))) {
          items.push({
            platform: "facebook", accountId, senderId, senderName, messageId: postId, text: String(v.message ?? `[${v.item}]`), timestamp: iso(v.created_time),
            attachments: photo ? [{ type: "image", url: String(photo) }] : [],
            thread: { key: `fbp:${postId}`, label: ch.field === "mention" ? "Mentioned your Page in a post" : "Post on your Page", link },
          });
        }
      }
      if (object === "page" && ch.field === "ratings" && v.open_graph_story_id && (v.verb === "add" || v.verb === "edit")) {
        const positive = v.recommendation_type ? v.recommendation_type === "positive" : Number(v.rating) >= 4;
        items.push({
          platform: "facebook", accountId, senderId: String(v.reviewer_id ?? ""), senderName: String(v.reviewer_name ?? ""), messageId: `review:${v.open_graph_story_id}:${v.verb === "edit" ? iso(v.created_time) : "add"}`,
          text: String(v.review_text || (v.rating ? `[${v.rating}★ rating]` : "[recommendation]")), timestamp: iso(v.created_time), attachments: [],
          thread: { key: `fbr:${v.open_graph_story_id}`, label: positive ? "Recommends your Page" : "Doesn't recommend your Page", link: `https://www.facebook.com/${v.open_graph_story_id}` },
        });
      }
      if (object === "instagram" && ch.field === "comments" && v.id) {
        if (String(v.from?.id ?? "") === accountId) continue;
        const root = String(v.parent_id ?? v.id);
        items.push({
          platform: "instagram", accountId, senderId: String(v.from?.id ?? v.from?.username ?? ""), senderName: v.from?.username ? `@${v.from.username}` : "", messageId: String(v.id),
          text: String(v.text ?? "[comment]"), timestamp: iso(v.timestamp ?? entry.time), attachments: [],
          thread: { key: `igc:${root}`, label: v.media?.media_product_type === "REELS" ? "Comment on your reel" : "Comment on your post", link: null },
        });
      }
      if (object === "instagram" && ch.field === "mentions" && v.media_id) mentions.push({ accountId, mediaId: String(v.media_id), commentId: v.comment_id ? String(v.comment_id) : null });
    }
  }
  return { items, mentions };
}

/** Verify Meta's X-Hub-Signature-256 header (sha256=<hex HMAC of the raw body with the app secret>). */
export function verifyMetaSignature(appSecret: string, rawBody: string, header: string | null) {
  if (!header?.startsWith("sha256=")) return false;
  const expected = createHmac("sha256", appSecret).update(rawBody, "utf8").digest();
  const got = Buffer.from(header.slice(7), "hex");
  return got.length === expected.length && timingSafeEqual(got, expected);
}
