import { randomUUID } from "node:crypto";
import { query, transaction } from "@/lib/db";
import { AppError } from "@/lib/domain";
import { complete } from "@/lib/cx/ai";
import { getFieldDefs, getTicketFields } from "@/lib/cx/admin/fields";
import type { EmailConfig } from "./channels";
import { sendEmail } from "./email";
import { asAttachment, claimFiles, getFiles, readFileBytes } from "./files";
import {
  blockedRecipients, composeSubject, crmLabel, findMentions, hms, lockState, parseAddresses, reminderError, toEmailHtml, toPlainText, transcriptText,
} from "./model";
import { getInboxSettings } from "./settings";
import { CRM_SQL, insertMessage, iso, listAgents, listTickets, logEvent, projectOwner, ticketDue, updateTickets, type TicketFilters } from "./store";
import { slaStatus } from "./sla";

/**
 * Agent workspace (server only): reminders, parent–child tickets, collision lock, @mentions,
 * escalate / forward / compose mail, signatures, assignment with attachments, AI helpers, exports.
 */

const notifyUser = async (n: { ownerId: string; projectId: string; title: string; body?: string; link?: string; severity?: "info" | "warning" }) => {
  const { notify } = await import("@/lib/jobs/queue");
  await notify({ ...n, tool: "CX Inbox" }).catch(() => {});
};
const ticketLink = (projectId: string, id: string) => `/cx/inbox?brand=${projectId}&view=all&t=${id}`;
async function head(projectId: string, ticketId: string) {
  const [t] = await query<{ id: string; number: number; subject: string; status: string; channel_kind: string; channel_id: string | null; contact_id: string | null; contact_name: string | null; contact_email: string | null; priority: string; team: string | null; assignee_id: string | null; resolved_at: string | null }>(
    `SELECT t.id,t.number,t.subject,t.status,t.channel_kind,t.channel_id,t.contact_id,t.priority,t.team,t.assignee_id,t.resolved_at,c.name AS contact_name,c.email AS contact_email
       FROM cx_tickets t LEFT JOIN cx_contacts c ON c.id=t.contact_id WHERE t.id=$1 AND t.project_id=$2`,
    [ticketId, projectId],
  );
  if (!t) throw new AppError("Ticket not found.", 404);
  return t;
}

// ---------------------------------------------------------------- @mentions

export async function notifyMentions(projectId: string, t: { id: string; number: number; subject: string }, messageId: string, body: string, author: { id: string; name: string }) {
  const agents = await listAgents(projectId);
  const ids = findMentions(body, agents).filter((id) => id !== author.id);
  if (!ids.length) return [];
  await query("INSERT INTO cx_inbox_message_meta(message_id,mentions) VALUES($1,$2::jsonb) ON CONFLICT(message_id) DO UPDATE SET mentions=$2::jsonb", [messageId, JSON.stringify(ids)]);
  const names = agents.filter((a) => ids.includes(a.id)).map((a) => a.name);
  await transaction((q) => logEvent(q, t.id, author.name, "mention", `mentioned ${names.join(", ")} in a note`));
  for (const id of ids)
    await notifyUser({ ownerId: id, projectId, title: `${author.name} mentioned you on #${t.number}`, body: body.slice(0, 300), link: ticketLink(projectId, t.id) });
  return names;
}

// ---------------------------------------------------------------- reminders

export async function saveReminder(projectId: string, user: { id: string; name: string }, input: { id?: string; ticketId: string; remindAt: string; note: string; userIds: string[] }) {
  const err = reminderError(input.remindAt);
  if (err) throw new AppError(err);
  const t = await head(projectId, input.ticketId);
  const agents = await listAgents(projectId);
  const users = [...new Set(input.userIds.length ? input.userIds : [user.id])].filter((id) => agents.some((a) => a.id === id));
  if (!users.length) throw new AppError("Pick at least one person to remind.");
  const names = agents.filter((a) => users.includes(a.id)).map((a) => a.name).join(", ");
  const at = new Date(input.remindAt).toISOString();
  await transaction(async (q) => {
    if (input.id) {
      const r = await q("UPDATE cx_inbox_reminders SET remind_at=$3, note=$4, user_ids=$5::jsonb, fired_at=NULL, dismissed='[]', updated_at=now() WHERE id=$1 AND project_id=$2 RETURNING id", [input.id, projectId, at, input.note.slice(0, 500), JSON.stringify(users)]);
      if (!r.length) throw new AppError("Reminder not found.", 404);
      await logEvent(q, t.id, user.name, "reminder", `edited a reminder for ${at} (${names})`);
    } else {
      await q("INSERT INTO cx_inbox_reminders(id,project_id,ticket_id,created_by,created_by_name,remind_at,note,user_ids) VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb)", [randomUUID(), projectId, t.id, user.id, user.name, at, input.note.slice(0, 500), JSON.stringify(users)]);
      await logEvent(q, t.id, user.name, "reminder", `set a reminder for ${at} (${names})`);
    }
  });
}
export async function deleteReminder(projectId: string, user: { name: string }, id: string) {
  await transaction(async (q) => {
    const [r] = await q<{ ticket_id: string; remind_at: string }>("DELETE FROM cx_inbox_reminders WHERE id=$1 AND project_id=$2 RETURNING ticket_id,remind_at", [id, projectId]);
    if (r) await logEvent(q, r.ticket_id, user.name, "reminder", `deleted the reminder for ${iso(r.remind_at)}`);
  });
}
/** Fire due reminders (all brands when projectId is omitted): in-app notification to each person + activity log. */
export async function fireDueReminders(projectId?: string) {
  const rows = await query<{ id: string; project_id: string; ticket_id: string; note: string; user_ids: string[]; number: number; subject: string }>(
    `UPDATE cx_inbox_reminders r SET fired_at=now() FROM cx_tickets t WHERE t.id=r.ticket_id AND r.fired_at IS NULL AND r.remind_at <= now() AND ($1::text IS NULL OR r.project_id=$1)
     RETURNING r.id,r.project_id,r.ticket_id,r.note,r.user_ids,t.number,t.subject`,
    [projectId ?? null],
  );
  for (const r of rows) {
    await transaction((q) => logEvent(q, r.ticket_id, "Reminder", "reminder", `fired${r.note ? `: ${r.note}` : ""}`));
    for (const u of r.user_ids) await notifyUser({ ownerId: u, projectId: r.project_id, severity: "warning", title: `Reminder: #${r.number} ${r.subject}`.slice(0, 200), body: r.note, link: ticketLink(r.project_id, r.ticket_id) });
  }
  return rows.length;
}
export async function dueReminders(projectId: string, userId: string) {
  await fireDueReminders(projectId);
  return (await query<{ id: string; ticket_id: string; number: number; subject: string; note: string; remind_at: string; created_by_name: string }>(
    `SELECT r.id,r.ticket_id,t.number,t.subject,r.note,r.remind_at,r.created_by_name FROM cx_inbox_reminders r JOIN cx_tickets t ON t.id=r.ticket_id
      WHERE r.project_id=$1 AND r.fired_at IS NOT NULL AND r.fired_at > now()-interval '7 days' AND r.user_ids ? $2 AND NOT r.dismissed ? $2 ORDER BY r.remind_at LIMIT 10`,
    [projectId, userId],
  )).map((r) => ({ ...r, remind_at: iso(r.remind_at)! }));
}
export async function dismissReminder(projectId: string, userId: string, id: string) {
  await query("UPDATE cx_inbox_reminders SET dismissed = dismissed || to_jsonb($3::text) WHERE id=$1 AND project_id=$2 AND NOT dismissed ? $3", [id, projectId, userId]);
}

// ---------------------------------------------------------------- parent–child tickets

export async function createChildTicket(projectId: string, parentId: string, user: { id: string; name: string }, input: { subject: string; body: string; assigneeId?: string | null }) {
  const p = await head(projectId, parentId);
  const [pm] = await query<{ parent_id: string | null }>("SELECT parent_id FROM cx_inbox_ticket_meta WHERE ticket_id=$1", [parentId]);
  if (pm?.parent_id) throw new AppError("A child ticket can't have children of its own. Create it under the parent instead.");
  if (!input.subject.trim()) throw new AppError("Give the child ticket a subject.");
  const due = await ticketDue(projectId, p.priority, new Date());
  const assignee = input.assigneeId && (await listAgents(projectId)).some((a) => a.id === input.assigneeId) ? input.assigneeId : null;
  const r = await transaction(async (q) => {
    const [{ n }] = await q<{ n: number }>("SELECT COALESCE(MAX(number),0)+1 AS n FROM cx_tickets WHERE project_id=$1", [projectId]);
    const id = randomUUID();
    await q(
      `INSERT INTO cx_tickets(id,project_id,number,subject,status,priority,channel_kind,channel_id,contact_id,assignee_id,team,first_response_due,resolution_due)
       VALUES($1,$2,$3,$4,'open',$5,$6,$7,$8,$9,$10,$11,$12)`,
      [id, projectId, n, input.subject.trim().slice(0, 300), p.priority, p.channel_kind, p.channel_id, p.contact_id, assignee, p.team, due.firstResponseDue, due.resolutionDue],
    );
    await q("INSERT INTO cx_inbox_ticket_meta(ticket_id,parent_id) VALUES($1,$2)", [id, parentId]);
    if (input.body.trim()) await insertMessage(q, id, { direction: "note", authorName: user.name, authorUserId: user.id, body: input.body.trim().slice(0, 20_000) });
    await logEvent(q, id, user.name, "parent", `created as a child of #${p.number}`);
    await logEvent(q, parentId, user.name, "parent", `created child ticket #${n}`);
    await q("UPDATE cx_tickets SET updated_at=now() WHERE id=$1", [parentId]);
    return { id, number: n };
  });
  if (assignee && assignee !== user.id) await notifyUser({ ownerId: assignee, projectId, title: `${user.name} assigned you child ticket #${r.number}`, body: input.subject, link: ticketLink(projectId, r.id) });
  return r;
}
export async function linkParent(projectId: string, childId: string, parentNumber: number, actor: string) {
  const c = await head(projectId, childId);
  const [p] = await query<{ id: string; number: number; parent_id: string | null }>("SELECT t.id,t.number,tm.parent_id FROM cx_tickets t LEFT JOIN cx_inbox_ticket_meta tm ON tm.ticket_id=t.id WHERE t.project_id=$1 AND t.number=$2", [projectId, parentNumber]);
  if (!p) throw new AppError(`Ticket #${parentNumber} not found.`, 404);
  if (p.id === childId) throw new AppError("A ticket can't be its own parent.");
  if (p.parent_id) throw new AppError(`#${p.number} is itself a child ticket; link to its parent instead.`);
  const [kids] = await query<{ n: number }>("SELECT count(*)::int AS n FROM cx_inbox_ticket_meta WHERE parent_id=$1", [childId]);
  if (kids.n) throw new AppError("This ticket has child tickets, so it can't become a child.");
  await transaction(async (q) => {
    await q("INSERT INTO cx_inbox_ticket_meta(ticket_id,parent_id) VALUES($1,$2) ON CONFLICT(ticket_id) DO UPDATE SET parent_id=$2, updated_at=now()", [childId, p.id]);
    await logEvent(q, childId, actor, "parent", `linked as a child of #${p.number}`);
    await logEvent(q, p.id, actor, "parent", `linked #${c.number} as a child ticket`);
  });
}
export async function unlinkParent(projectId: string, childId: string, actor: string) {
  const c = await head(projectId, childId);
  await transaction(async (q) => {
    const [m] = await q<{ number: number; id: string }>("SELECT t.number,t.id FROM cx_inbox_ticket_meta tm JOIN cx_tickets t ON t.id=tm.parent_id WHERE tm.ticket_id=$1", [childId]);
    await q("UPDATE cx_inbox_ticket_meta SET parent_id=NULL, updated_at=now() WHERE ticket_id=$1", [childId]);
    if (m) {
      await logEvent(q, childId, actor, "parent", `unlinked from parent #${m.number}`);
      await logEvent(q, m.id, actor, "parent", `unlinked child #${c.number}`);
    }
  });
}

// ---------------------------------------------------------------- collision lock

/** Heartbeat for the one-agent-at-a-time lock. `takeover` = the "Continue" override. */
export async function lockHeartbeat(projectId: string, ticketId: string, user: { id: string; name: string }, opts: { takeover?: boolean; canHold?: boolean } = {}) {
  const [lock] = await query<{ user_id: string; user_name: string; seen_at: string }>(
    "SELECT l.user_id,l.user_name,l.seen_at FROM cx_inbox_locks l JOIN cx_tickets t ON t.id=l.ticket_id WHERE l.ticket_id=$1 AND t.project_id=$2",
    [ticketId, projectId],
  );
  const state = lockState(lock, user.id);
  if (state === "other" && !opts.takeover) return { holder: { id: lock.user_id, name: lock.user_name } };
  if (opts.canHold === false) return { holder: null };
  await query(
    `INSERT INTO cx_inbox_locks(ticket_id,user_id,user_name,acquired_at,seen_at) SELECT $1,$2,$3,now(),now() WHERE EXISTS (SELECT 1 FROM cx_tickets WHERE id=$1 AND project_id=$4)
     ON CONFLICT(ticket_id) DO UPDATE SET user_id=$2, user_name=$3, seen_at=now(), acquired_at=CASE WHEN cx_inbox_locks.user_id=$2 THEN cx_inbox_locks.acquired_at ELSE now() END`,
    [ticketId, user.id, user.name, projectId],
  );
  if (state === "other" && opts.takeover) await transaction((q) => logEvent(q, ticketId, user.name, "lock", `continued working on the ticket (took over from ${lock.user_name})`));
  return { holder: null };
}

// ---------------------------------------------------------------- signatures

export type Signature = { body: string; imageFileId: string | null; imageUrl: string | null; enabled: boolean };
export async function getSignature(projectId: string, userId: string): Promise<Signature> {
  const [s] = await query<{ body: string; image_file_id: string | null; enabled: boolean }>("SELECT body,image_file_id,enabled FROM cx_inbox_signatures WHERE project_id=$1 AND user_id=$2", [projectId, userId]);
  return { body: s?.body ?? "", imageFileId: s?.image_file_id ?? null, imageUrl: s?.image_file_id ? `/api/cx/inbox/files/${s.image_file_id}` : null, enabled: s?.enabled ?? true };
}
export async function saveSignature(projectId: string, userId: string, input: { body: string; imageFileId: string | null; enabled: boolean }) {
  if (input.imageFileId) {
    const [f] = await getFiles(projectId, [input.imageFileId]);
    if (!f || !f.mime.startsWith("image/")) throw new AppError("The signature image must be an image file.");
  }
  await query(
    `INSERT INTO cx_inbox_signatures(project_id,user_id,body,image_file_id,enabled,updated_at) VALUES($1,$2,$3,$4,$5,now())
     ON CONFLICT(project_id,user_id) DO UPDATE SET body=$3, image_file_id=$4, enabled=$5, updated_at=now()`,
    [projectId, userId, input.body.slice(0, 2000), input.imageFileId, input.enabled],
  );
}
/** Signature parts for an outgoing email (text, html cid image attachment). */
export async function signatureParts(projectId: string, userId: string) {
  const s = await getSignature(projectId, userId);
  if (!s.enabled || (!s.body.trim() && !s.imageFileId)) return null;
  let image: { filename: string; content: Buffer; contentType: string; cid: string } | null = null;
  if (s.imageFileId) {
    const [f] = await getFiles(projectId, [s.imageFileId]);
    if (f) image = { filename: f.filename, content: await readFileBytes(f), contentType: f.mime, cid: "signature@synapse" };
  }
  return { text: s.body, image };
}

// ---------------------------------------------------------------- email channel

export async function emailChannel(projectId: string, preferId?: string | null) {
  type Ch = { id: string; config: EmailConfig; secret_enc: string | null };
  let [ch] = preferId ? await query<Ch>("SELECT id,config,secret_enc FROM cx_channels WHERE id=$1 AND project_id=$2 AND kind='email' AND status<>'paused'", [preferId, projectId]) : [];
  if (!ch) [ch] = await query<Ch>("SELECT id,config,secret_enc FROM cx_channels WHERE project_id=$1 AND kind='email' AND status<>'paused' ORDER BY created_at LIMIT 1", [projectId]);
  return ch ?? null;
}
export async function emailSuggestions(projectId: string) {
  const agents = await listAgents(projectId);
  const used = await query<{ a: string }>(
    "SELECT DISTINCT jsonb_array_elements_text(to_addrs || cc_addrs || bcc_addrs) AS a FROM cx_inbox_emails WHERE project_id=$1 LIMIT 100",
    [projectId],
  );
  return [...new Set([...agents.map((a) => a.email.toLowerCase()), ...used.map((u) => u.a)])].filter(Boolean).slice(0, 150);
}

export type EmailInput = {
  kind: "escalate" | "forward" | "compose";
  to: string; cc: string; bcc: string; subject: string; body: string;
  attachmentIds: string[]; originalAttachmentIds: string[]; includeHistory: boolean; includeSignature: boolean;
};
/** Escalate via email, forward, or compose mail from a ticket (ticket ID in the subject so replies thread back). */
export async function sendTicketEmail(projectId: string, ticketId: string, user: { id: string; name: string }, input: EmailInput) {
  const t = await head(projectId, ticketId);
  const settings = await getInboxSettings(projectId);
  const to = parseAddresses(input.to), cc = parseAddresses(input.cc), bcc = parseAddresses(input.bcc);
  const invalid = [...to.invalid, ...cc.invalid, ...bcc.invalid];
  if (invalid.length) throw new AppError(`Not a valid email address: ${invalid.join(", ")}`);
  if (!to.valid.length) throw new AppError("Add at least one recipient.");
  const all = [...to.valid, ...cc.valid, ...bcc.valid];
  const blocked = blockedRecipients(all, settings.allowedEmailDomains);
  if (blocked.length) throw new AppError(`Email to ${blocked.join(", ")} isn't allowed. Allowed domains: ${settings.allowedEmailDomains.join(", ")}.`);
  if (!input.body.trim() && input.kind !== "forward") throw new AppError("Write a message first.");
  const ch = await emailChannel(projectId, t.channel_kind === "email" ? t.channel_id : null);
  if (!ch) throw new AppError("Connect an email channel (Settings → Channels) to send email from tickets.");
  const subject = composeSubject(input.subject.trim() || t.subject, t.number, input.kind);
  const files = await getFiles(projectId, [...new Set([...input.attachmentIds, ...input.originalAttachmentIds])]);
  let text = input.body.trim();
  if (input.kind === "escalate") text = `${text}\n\n---\nTicket #${t.number}: ${t.subject}\nCustomer: ${t.contact_name ?? ""} ${t.contact_email ? `<${t.contact_email}>` : ""}\nChannel: ${t.channel_kind} · Status: ${crmLabel(t.status)} · Priority: ${t.priority}`;
  if (input.kind === "forward" && input.includeHistory) {
    const msgs = await query<{ direction: string; author_name: string; body: string; created_at: string }>("SELECT direction,author_name,body,created_at FROM cx_messages WHERE ticket_id=$1 AND direction<>'note' ORDER BY created_at", [ticketId]);
    text += `\n\n---------- Forwarded conversation (ticket #${t.number}) ----------\n${msgs.map((m) => `\n${iso(m.created_at)} · ${m.author_name || (m.direction === "in" ? "Customer" : "Agent")}:\n${toPlainText(m.body)}`).join("\n")}`;
  }
  const sig = input.includeSignature ? await signatureParts(projectId, user.id) : null;
  const attachments = await Promise.all(files.map(async (f) => ({ filename: f.filename, content: await readFileBytes(f), contentType: f.mime })));
  let status: "sent" | "failed" = "sent", error: string | null = null, messageId: string | null = null;
  try {
    messageId = await sendEmail(ch, {
      to: to.valid, cc: cc.valid, bcc: bcc.valid, subject,
      text: toPlainText(text, sig?.text), html: toEmailHtml(text, sig ? { text: sig.text, imageCid: sig.image?.cid } : null),
      attachments: [...attachments, ...(sig?.image ? [sig.image] : [])],
    });
  } catch (e) {
    status = "failed";
    error = (e instanceof Error ? e.message : String(e)).slice(0, 300);
  }
  const meta = files.map(asAttachment);
  const label = { escalate: "Escalated via email", forward: "Forwarded", compose: "Email sent" }[input.kind];
  await transaction(async (q) => {
    const id = randomUUID();
    await q(
      `INSERT INTO cx_inbox_emails(id,project_id,ticket_id,kind,to_addrs,cc_addrs,bcc_addrs,subject,body,attachments,status,error,message_id,sent_by,sent_by_name)
       VALUES($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7::jsonb,$8,$9,$10::jsonb,$11,$12,$13,$14,$15)`,
      [id, projectId, ticketId, input.kind, JSON.stringify(to.valid), JSON.stringify(cc.valid), JSON.stringify(bcc.valid), subject, input.body.slice(0, 50_000), JSON.stringify(meta), status, error, messageId, user.id, user.name],
    );
    const note = `${status === "failed" ? `${label} FAILED (${error})` : label} to ${to.valid.join(", ")}${cc.valid.length ? ` · cc ${cc.valid.join(", ")}` : ""}${bcc.valid.length ? ` · bcc ${bcc.valid.length}` : ""}\nSubject: ${subject}\n\n${input.body.trim()}`;
    const mid = await insertMessage(q, ticketId, { direction: "note", authorName: user.name, authorUserId: user.id, body: note.slice(0, 20_000), attachments: meta, externalId: messageId, delivery: status === "sent" ? "sent" : "failed", deliveryError: error });
    await q("INSERT INTO cx_inbox_message_meta(message_id,email_id) VALUES($1,$2)", [mid, id]);
    if (input.kind === "escalate" && status === "sent")
      await q("INSERT INTO cx_inbox_ticket_meta(ticket_id,escalated_at,escalated_to) VALUES($1,now(),$2) ON CONFLICT(ticket_id) DO UPDATE SET escalated_at=now(), escalated_to=$2, updated_at=now()", [ticketId, to.valid.join(", ")]);
    await logEvent(q, ticketId, user.name, input.kind, `${status === "sent" ? label.toLowerCase() : `${label.toLowerCase()} failed`} to ${to.valid.join(", ")}`);
    await q("UPDATE cx_tickets SET updated_at=now() WHERE id=$1", [ticketId]);
  });
  await claimFiles(projectId, ticketId, input.attachmentIds);
  return { status, error, subject };
}

// ---------------------------------------------------------------- assignment with note + media

export async function assignWithNote(projectId: string, ticketId: string, user: { id: string; name: string }, input: { assigneeId: string | null; note: string; attachmentIds: string[] }) {
  const t = await head(projectId, ticketId);
  await updateTickets(projectId, [ticketId], { assignee_id: input.assigneeId }, user.name);
  const agents = await listAgents(projectId);
  const who = agents.find((a) => a.id === input.assigneeId)?.name ?? "nobody";
  const files = await getFiles(projectId, input.attachmentIds);
  if (input.note.trim() || files.length)
    await transaction((q) => insertMessage(q, ticketId, { direction: "note", authorName: user.name, authorUserId: user.id, body: `Assigned to ${who}${input.note.trim() ? `: ${input.note.trim()}` : ""}`, attachments: files.map(asAttachment) }));
  await claimFiles(projectId, ticketId, input.attachmentIds);
  if (input.assigneeId && input.assigneeId !== user.id)
    await notifyUser({ ownerId: input.assigneeId, projectId, title: `${user.name} assigned you #${t.number}`, body: `${t.subject}${input.note.trim() ? `\n${input.note.trim()}` : ""}`.slice(0, 300), link: ticketLink(projectId, ticketId) });
}

// ---------------------------------------------------------------- AI helpers (null when no key)

export async function aiRewrite(kind: "grammar" | "translate", text: string, lang = "English") {
  const t = text.trim().slice(0, 8000);
  if (!t) throw new AppError("Write something first.");
  const keep = "Keep placeholders like {{name}}, markdown links [text](url), line breaks and the meaning. Return only the resulting text, nothing else.";
  return kind === "grammar"
    ? complete(`You fix spelling, grammar and punctuation in customer-support replies without changing their tone or language. ${keep}`, t, 1500)
    : complete(`You translate customer-support replies into ${lang}, natural and polite. ${keep}`, t, 1800);
}
export async function translateMessage(projectId: string, messageId: string, lang: string) {
  const [m] = await query<{ body: string }>("SELECT m.body FROM cx_messages m JOIN cx_tickets t ON t.id=m.ticket_id WHERE m.id=$1 AND t.project_id=$2", [messageId, projectId]);
  if (!m) throw new AppError("Message not found.", 404);
  const key = lang.slice(0, 40);
  const [c] = await query<{ text: string }>("SELECT text FROM cx_inbox_translations WHERE message_id=$1 AND lang=$2", [messageId, key]);
  if (c) return c.text;
  const out = await complete(`Translate the customer's message into ${key}. Return only the translation. If it already is in ${key}, return it unchanged.`, m.body.slice(0, 8000), 1800);
  if (out) await query("INSERT INTO cx_inbox_translations(message_id,lang,text) VALUES($1,$2,$3) ON CONFLICT DO NOTHING", [messageId, key, out]);
  return out;
}
export async function summarizeTicket(projectId: string, ticketId: string) {
  const t = await head(projectId, ticketId);
  const msgs = await query<{ direction: string; author_name: string; body: string }>("SELECT direction,author_name,body FROM cx_messages WHERE ticket_id=$1 ORDER BY created_at LIMIT 80", [ticketId]);
  const convo = msgs.map((m) => `${m.direction === "in" ? "Customer" : m.direction === "note" ? "Internal note" : "Agent"}: ${m.body.slice(0, 1500)}`).join("\n\n");
  return complete(
    "Summarise this support ticket for an agent taking over. Use 3-5 short bullet points: the customer's issue, what has been done, open questions, the next best action, and the customer's mood. No preamble.",
    `Ticket #${t.number}: ${t.subject}\nChannel: ${t.channel_kind}\n\n${convo}`.slice(0, 30_000),
    600,
  );
}

// ---------------------------------------------------------------- exports

export async function exportTicketRows(projectId: string, userId: string, f: TicketFilters, ids?: string[]) {
  const defs = (await getFieldDefs(projectId).catch(() => [])).filter((d) => d.scope === "ticket" && !d.hidden && !d.encrypted);
  const rows = await listTickets(projectId, userId, f, 5000, { ids, fieldKeys: defs.map((d) => d.key) });
  const header = ["Ticket #", "Subject", "Status", "Priority", "Severity", "Channel", "Profile", "Customer", "Email", "Assignee", "Team", "Tags", "Sentiment", "Intent", "Language",
    "Created", "First response", "FRT (HH:MM:SS)", "Resolved", "Resolution time (HH:MM:SS)", "SLA", "CSAT", "Messages", "Attachments", "Parent", "Child tickets", "Escalated", "Emails sent", ...defs.map((d) => d.label)];
  const out: (string | number | null)[][] = [header];
  const parents = new Map((await query<{ id: string; number: number }>("SELECT id,number FROM cx_tickets WHERE project_id=$1 AND id = ANY($2)", [projectId, rows.map((r) => r.parent_id).filter(Boolean)])).map((r) => [r.id, r.number]));
  for (const r of rows) {
    const sla = slaStatus(r);
    const values = defs.length ? (await getTicketFields(r.id).catch(() => ({ values: {} as Record<string, unknown> }))).values : {};
    out.push([
      r.number, r.subject, crmLabel(r.crm_status), r.priority, r.severity ?? "", r.channel_kind, r.channel_name ?? "", r.contact_name ?? "", r.contact_email ?? "", r.assignee_name ?? "", r.team ?? "", r.tags.join(", "),
      r.sentiment ?? "", r.intent ?? "", r.language ?? "", r.created_at, r.first_response_at ?? "", hms(r.first_response_at ? new Date(r.first_response_at).getTime() - new Date(r.created_at).getTime() : null),
      r.resolved_at ?? "", hms(r.resolved_at ? new Date(r.resolved_at).getTime() - new Date(r.created_at).getTime() : null),
      sla.breached.length ? `Breached (${sla.breached.join(", ").replace(/_/g, " ")})` : "OK", r.csat ?? "", r.messages, r.has_attachment ? "Yes" : "No",
      r.parent_id ? `#${parents.get(r.parent_id) ?? ""}` : "", r.children || "", r.escalated_at ?? "", r.emails_sent || "",
      ...defs.map((d) => { const v = values[d.key]; return v == null ? "" : Array.isArray(v) ? v.join(", ") : String(v); }),
    ]);
  }
  return out;
}
export async function ticketTranscript(projectId: string, ticketId: string) {
  const [t] = await query<{ id: string; number: number; subject: string; channel_kind: string; contact: string | null; crm: string }>(
    `SELECT t.id,t.number,t.subject,t.channel_kind,COALESCE(c.name,c.email) AS contact,${CRM_SQL} AS crm FROM cx_tickets t LEFT JOIN cx_inbox_ticket_meta tm ON tm.ticket_id=t.id LEFT JOIN cx_contacts c ON c.id=t.contact_id WHERE t.id=$1 AND t.project_id=$2`,
    [ticketId, projectId],
  );
  if (!t) throw new AppError("Ticket not found.", 404);
  const messages = (await query<{ direction: string; author_name: string; body: string; created_at: string; attachments: { name?: string }[] }>("SELECT direction,author_name,body,created_at,attachments FROM cx_messages WHERE ticket_id=$1 ORDER BY created_at,id", [ticketId])).map((m) => ({ ...m, created_at: iso(m.created_at)! }));
  const events = (await query<{ actor: string; detail: string; created_at: string }>("SELECT actor,detail,created_at FROM cx_inbox_events WHERE ticket_id=$1 ORDER BY created_at", [ticketId])).map((e) => ({ ...e, created_at: iso(e.created_at)! }));
  const text = transcriptText({ number: t.number, subject: t.subject, channel: t.channel_kind, contact: t.contact ?? "Unknown", status: crmLabel(t.crm) }, messages, events);
  const rows: (string | number)[][] = [["Time", "Type", "Author", "Message", "Attachments"], ...messages.map((m) => [m.created_at, m.direction === "in" ? "Customer" : m.direction === "note" ? "Private note" : "Agent reply", m.author_name, toPlainText(m.body), (m.attachments ?? []).map((a) => a.name).join(", ")])];
  const activity: (string | number)[][] = [["Time", "Who", "Activity"], ...events.map((e) => [e.created_at, e.actor, e.detail])];
  return { number: t.number, text, rows, activity };
}
export { projectOwner };
