import { query } from "@/lib/db";
import { addInbound, createTicket } from "./store";
import type { InboundSocial } from "./webhooks";

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
