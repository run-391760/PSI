import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Mapping of WhatsApp Cloud API and Meta (Messenger / Instagram) webhook payloads to inbound
 * messages (pure, fixture-tested) and X-Hub-Signature-256 verification.
 */
export type InboundSocial = { platform: "whatsapp" | "facebook" | "instagram"; accountId: string; senderId: string; senderName: string; messageId: string; text: string; timestamp: string; attachments: { type: string; url?: string; id?: string }[] };

type Obj = Record<string, any>;
const iso = (sec: unknown) => (Number(sec) ? new Date(Number(sec) * (Number(sec) > 1e12 ? 1 : 1000)).toISOString() : new Date().toISOString());

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
      out.push({
        platform, accountId: String(entry.id ?? ev.recipient?.id ?? ""), senderId: String(ev.sender?.id ?? ""), senderName: "", messageId: m.mid ?? "",
        text: m.text ?? (m.attachments?.length ? `[${m.attachments.map((a: Obj) => a.type).join(", ")}]` : "[message]"), timestamp: iso(ev.timestamp),
        attachments: (m.attachments ?? []).map((a: Obj) => ({ type: a.type ?? "file", url: a.payload?.url })),
      });
    }
  return out;
}

/** Verify Meta's X-Hub-Signature-256 header (sha256=<hex HMAC of the raw body with the app secret>). */
export function verifyMetaSignature(appSecret: string, rawBody: string, header: string | null) {
  if (!header?.startsWith("sha256=")) return false;
  const expected = createHmac("sha256", appSecret).update(rawBody, "utf8").digest();
  const got = Buffer.from(header.slice(7), "hex");
  return got.length === expected.length && timingSafeEqual(got, expected);
}
