import { randomUUID } from "node:crypto";
import { query, transaction } from "@/lib/db";
import { AppError } from "@/lib/domain";
import { sendEmail } from "@/lib/cx/inbox/email";
import { asAttachment, claimFiles, getFiles, readFileBytes } from "@/lib/cx/inbox/files";
import { blockedRecipients, parseAddresses, toEmailHtml, toPlainText } from "@/lib/cx/inbox/model";
import { getInboxSettings } from "@/lib/cx/inbox/settings";
import { insertMessage, listAgents, logEvent, ticketDue, upsertContact } from "@/lib/cx/inbox/store";
import { ticketTag } from "@/lib/cx/inbox/threading";
import { emailChannel, signatureParts } from "@/lib/cx/inbox/workspace";
import { analyzeText } from "@/lib/cx/ai";

/**
 * Compose Message: start a new outbound conversation. Email is sent from the chosen mailbox with the
 * ticket tag in the subject so the customer's reply threads back; the ticket starts as Pending
 * (waiting for the customer) with the agent's message as its first message.
 */
export type ComposeInput = {
  channelId: string | null; to: string; cc: string; bcc: string; name: string; subject: string; body: string;
  priority: "low" | "normal" | "high" | "urgent"; assigneeId: string | null; includeSignature: boolean; attachmentIds: string[]; tags: string[];
};

export async function composeEmail(projectId: string, user: { id: string; name: string }, input: ComposeInput) {
  const to = parseAddresses(input.to), cc = parseAddresses(input.cc), bcc = parseAddresses(input.bcc);
  const invalid = [...to.invalid, ...cc.invalid, ...bcc.invalid];
  if (invalid.length) throw new AppError(`Not a valid email address: ${invalid.join(", ")}`);
  if (!to.valid.length) throw new AppError("Add the customer's email address.");
  if (!input.subject.trim()) throw new AppError("Add a subject.");
  if (!input.body.trim()) throw new AppError("Write the message.");
  if (!["low", "normal", "high", "urgent"].includes(input.priority)) throw new AppError("Invalid priority.");
  const settings = await getInboxSettings(projectId);
  const blocked = blockedRecipients([...to.valid, ...cc.valid, ...bcc.valid], settings.allowedEmailDomains);
  if (blocked.length) throw new AppError(`Email to ${blocked.join(", ")} isn't allowed. Allowed domains (Ticket settings): ${settings.allowedEmailDomains.join(", ")}.`);
  const ch = await emailChannel(projectId, input.channelId);
  if (!ch || (input.channelId && ch.id !== input.channelId)) throw new AppError("Connect an active email channel (Settings → Channels) to compose email.");
  const assignee = input.assigneeId ? ((await listAgents(projectId)).some((a) => a.id === input.assigneeId) ? input.assigneeId : null) : user.id;
  if (input.assigneeId && !assignee) throw new AppError("That agent is not on this brand.");
  const files = await getFiles(projectId, input.attachmentIds);
  const due = await ticketDue(projectId, input.priority, new Date());
  const a = analyzeText(`${input.subject}\n${input.body}`);
  const tags = [...new Set(["outbound", ...input.tags.map((t) => t.trim().toLowerCase()).filter(Boolean)])].slice(0, 10);
  const created = await transaction(async (q) => {
    const contactId = await upsertContact(q, projectId, { name: input.name.trim() || null, email: to.valid[0] });
    const [{ n }] = await q<{ n: number }>("SELECT COALESCE(MAX(number),0)+1 AS n FROM cx_tickets WHERE project_id=$1", [projectId]);
    const id = randomUUID();
    await q(
      `INSERT INTO cx_tickets(id,project_id,number,subject,status,priority,channel_kind,channel_id,contact_id,assignee_id,tags,language,first_response_due,resolution_due,first_response_at)
       VALUES($1,$2,$3,$4,'pending',$5,'email',$6,$7,$8,$9::jsonb,$10,$11,$12,now())`,
      [id, projectId, n, input.subject.trim().slice(0, 300), input.priority, ch.id, contactId, assignee, JSON.stringify(tags), a.language, due.firstResponseDue, due.resolutionDue],
    );
    const mid = await insertMessage(q, id, { direction: "out", authorName: user.name, authorUserId: user.id, body: input.body.trim().slice(0, 20_000), attachments: files.map(asAttachment), delivery: "queued" });
    await logEvent(q, id, user.name, "compose", `started an outbound email conversation to ${to.valid.join(", ")}`);
    return { id, number: n, mid };
  });
  const subject = `${input.subject.trim()} ${ticketTag(created.number)}`;
  const sig = input.includeSignature ? await signatureParts(projectId, user.id) : null;
  let delivery: "sent" | "failed" = "sent", error: string | null = null, messageId: string | null = null;
  try {
    const attachments = await Promise.all(files.map(async (f) => ({ filename: f.filename, content: await readFileBytes(f), contentType: f.mime })));
    messageId = await sendEmail(ch, {
      to: to.valid, cc: cc.valid, bcc: bcc.valid, subject,
      text: toPlainText(input.body.trim(), sig?.text), html: toEmailHtml(input.body.trim(), sig ? { text: sig.text, imageCid: sig.image?.cid } : null),
      attachments: [...attachments, ...(sig?.image ? [sig.image] : [])],
    });
  } catch (e) {
    delivery = "failed";
    error = (e instanceof Error ? e.message : String(e)).slice(0, 300);
  }
  await query("UPDATE cx_messages SET delivery=$2, delivery_error=$3, external_id=$4 WHERE id=$1", [created.mid, delivery, error, messageId]);
  if (delivery === "failed") await transaction((q) => logEvent(q, created.id, "Email", "delivery", `sending failed: ${error}`));
  await claimFiles(projectId, created.id, input.attachmentIds);
  return { ticketId: created.id, number: created.number, delivery, error, subject };
}

/** Connected channels with whether an outbound conversation can be started on them. */
export async function composeChannels(projectId: string) {
  return query<{ id: string; kind: string; name: string; status: string; from_address: string | null }>(
    "SELECT id,kind,name,status,COALESCE(config->>'fromAddress', config->>'user') AS from_address FROM cx_channels WHERE project_id=$1 ORDER BY kind, created_at",
    [projectId],
  );
}

/** Recent outbound conversations started from Compose (tag "outbound"). */
export async function recentComposed(projectId: string, limit = 15) {
  const rows = await query<{ id: string; number: number; subject: string; status: string; contact_email: string | null; created_at: string; delivery: string | null; replied: boolean }>(
    `SELECT t.id,t.number,t.subject,t.status,c.email AS contact_email,t.created_at,
            (SELECT m.delivery FROM cx_messages m WHERE m.ticket_id=t.id ORDER BY m.created_at, m.id LIMIT 1) AS delivery,
            EXISTS (SELECT 1 FROM cx_messages m WHERE m.ticket_id=t.id AND m.direction='in') AS replied
       FROM cx_tickets t LEFT JOIN cx_contacts c ON c.id=t.contact_id WHERE t.project_id=$1 AND t.tags ? 'outbound' ORDER BY t.created_at DESC LIMIT $2`,
    [projectId, limit],
  );
  return rows.map((r) => ({ ...r, created_at: new Date(r.created_at).toISOString() }));
}
