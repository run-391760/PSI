import { ImapFlow } from "imapflow";
import { simpleParser, type AddressObject, type ParsedMail } from "mailparser";
import nodemailer from "nodemailer";
import { query } from "@/lib/db";
import { AppError } from "@/lib/domain";
import { channelSecret, setChannelResult, type EmailConfig } from "./channels";
import { addInbound, createTicket } from "./store";
import { normalizeMessageId, parseMessageIds, resolveThread, stripQuoted, ticketNumberFromSubject, type ThreadCandidate } from "./threading";

/** Email channel: IMAP import (threaded into tickets) and SMTP replies. */
type EmailChannel = { id: string; project_id: string; config: EmailConfig; secret_enc: string | null };

function imapClient(c: EmailConfig, pass: string) {
  return new ImapFlow({ host: c.imapHost, port: c.imapPort, secure: c.imapSecure, auth: { user: c.user, pass }, logger: false, connectionTimeout: 20_000, greetingTimeout: 15_000, socketTimeout: 60_000 });
}
function smtpTransport(c: EmailConfig, pass: string) {
  return nodemailer.createTransport({ host: c.smtpHost, port: c.smtpPort, secure: c.smtpSecure, auth: { user: c.user, pass }, connectionTimeout: 20_000, greetingTimeout: 15_000, socketTimeout: 60_000 });
}
const errText = (e: unknown) => {
  const x = e as { responseText?: string; response?: string; message?: string; code?: string };
  return (x?.responseText || x?.response || x?.message || x?.code || "Connection failed").toString().slice(0, 300);
};

/** Try IMAP login + mailbox open and SMTP handshake. */
export async function testEmail(c: EmailConfig, pass: string) {
  const result = { imap: null as string | null, smtp: null as string | null, messages: null as number | null };
  const client = imapClient(c, pass);
  client.on("error", () => {});
  try {
    await client.connect();
    const st = await client.status(c.mailbox || "INBOX", { messages: true });
    result.messages = st ? (st.messages ?? null) : null;
    await client.logout();
  } catch (e) {
    result.imap = errText(e);
    client.close();
  }
  try {
    await smtpTransport(c, pass).verify();
  } catch (e) {
    result.smtp = errText(e);
  }
  return result;
}

const firstAddr = (a: AddressObject | AddressObject[] | undefined) => (Array.isArray(a) ? a[0] : a)?.value?.[0];
const syncing = ((globalThis as { cxEmailSyncing?: Set<string> }).cxEmailSyncing ??= new Set());

/** Import new messages of one email channel. First sync imports the last 3 days (max 50 messages). */
export async function syncEmailChannel(ch: EmailChannel, max = 200) {
  if (syncing.has(ch.id)) return { skipped: true, imported: 0 };
  syncing.add(ch.id);
  const c = ch.config;
  const pass = channelSecret(ch);
  if (!pass) {
    syncing.delete(ch.id);
    throw new AppError("Mailbox password missing.");
  }
  const client = imapClient(c, pass);
  client.on("error", () => {});
  let imported = 0, threaded = 0, lastUid = c.lastUid ?? 0;
  let uidValidity = c.uidValidity;
  try {
    await client.connect();
    const lock = await client.getMailboxLock(c.mailbox || "INBOX");
    try {
      const mb = client.mailbox;
      if (!mb) throw new Error("Mailbox not available");
      const validity = String(mb.uidValidity);
      if (uidValidity && uidValidity !== validity) lastUid = 0;
      uidValidity = validity;
      let uids: number[];
      if (!lastUid) {
        const found = await client.search({ since: new Date(Date.now() - 3 * 86_400_000) }, { uid: true });
        uids = (found || []).sort((a, b) => a - b).slice(-50);
        if (!uids.length) lastUid = Math.max(0, mb.uidNext - 1);
      } else {
        const found = await client.search({ uid: `${lastUid + 1}:*` }, { uid: true });
        uids = (found || []).filter((u) => u > lastUid).sort((a, b) => a - b).slice(0, max);
      }
      if (uids.length) {
        for await (const msg of client.fetch(uids.join(","), { uid: true, source: true }, { uid: true })) {
          if (!msg.source) continue;
          lastUid = Math.max(lastUid, msg.uid);
          const parsed = await simpleParser(msg.source);
          const r = await importParsed(ch, parsed);
          if (r === "new") imported++;
          if (r === "threaded") threaded++;
        }
      }
    } finally {
      lock.release();
    }
    await client.logout();
    await setChannelResult(ch.id, null, { lastUid, uidValidity, imported: (c.imported ?? 0) + imported + threaded, lastCheck: new Date().toISOString() });
    return { imported, threaded };
  } catch (e) {
    client.close();
    await setChannelResult(ch.id, errText(e), { lastUid, uidValidity });
    throw new AppError(`Email sync failed: ${errText(e)}`);
  } finally {
    syncing.delete(ch.id);
  }
}

/** Store one parsed email: skip duplicates, own mail and auto-replies; thread or create a ticket. */
export async function importParsed(ch: { id: string; project_id: string; config: EmailConfig }, m: ParsedMail): Promise<"new" | "threaded" | "skipped"> {
  const from = firstAddr(m.from);
  const fromEmail = from?.address?.toLowerCase() ?? "";
  const own = [ch.config.user, ch.config.fromAddress].map((x) => (x || "").toLowerCase());
  if (!fromEmail || own.includes(fromEmail) || /mailer-daemon|postmaster/i.test(fromEmail)) return "skipped";
  const auto = String(m.headers.get("auto-submitted") ?? "no").toLowerCase();
  if (auto !== "no" && auto !== "") return "skipped";
  const messageId = normalizeMessageId(m.messageId) ?? `${ch.id}:${m.date?.getTime() ?? Date.now()}:${fromEmail}`;
  const [dupe] = await query("SELECT 1 FROM cx_messages mm JOIN cx_tickets t ON t.id=mm.ticket_id WHERE t.project_id=$1 AND lower(mm.external_id)=$2 LIMIT 1", [ch.project_id, messageId]);
  if (dupe) return "skipped";

  const refs = [...parseMessageIds(m.inReplyTo), ...parseMessageIds(m.references as string | string[] | undefined)];
  const known: Record<string, string> = {};
  if (refs.length)
    for (const r of await query<{ external_id: string; ticket_id: string }>("SELECT lower(mm.external_id) AS external_id, mm.ticket_id FROM cx_messages mm JOIN cx_tickets t ON t.id=mm.ticket_id WHERE t.project_id=$1 AND lower(mm.external_id) = ANY($2)", [ch.project_id, refs]))
      known[r.external_id] = r.ticket_id;
  const num = ticketNumberFromSubject(m.subject);
  const candidates = (
    await query<ThreadCandidate & { updated_at: string; contact_email: string | null }>(
      `SELECT t.id,t.number,t.subject,t.status,t.updated_at,c.email AS contact_email FROM cx_tickets t LEFT JOIN cx_contacts c ON c.id=t.contact_id
        WHERE t.project_id=$1 AND (t.number=$2 OR lower(c.email)=$3) ORDER BY t.updated_at DESC LIMIT 50`,
      [ch.project_id, num ?? -1, fromEmail],
    )
  ).map((t) => ({ id: t.id, number: t.number, subject: t.subject, status: t.status, contactEmail: t.contact_email, updatedAt: new Date(t.updated_at).toISOString() }));
  const thread = resolveThread({ messageId, inReplyTo: m.inReplyTo, references: m.references as string | string[] | undefined, subject: m.subject, fromEmail }, known, candidates);
  const text = (m.text ?? (m.html ? htmlToText(m.html) : "")).trim();
  const body = thread ? stripQuoted(text) : text;
  const attachments = (m.attachments ?? []).slice(0, 20).map((a) => ({ name: a.filename ?? "attachment", type: a.contentType, size: a.size }));
  const createdAt = m.date ? m.date.toISOString() : null;
  const target = thread ? candidates.find((c) => c.id === thread.ticketId) : null;
  if (thread && target?.status !== "closed") {
    await addInbound(ch.project_id, thread.ticketId, { body: body.slice(0, 50_000), html: typeof m.html === "string" ? m.html.slice(0, 200_000) : null, authorName: from?.name || fromEmail, attachments, externalId: messageId, createdAt });
    return "threaded";
  }
  await createTicket({
    projectId: ch.project_id, channelKind: "email", channelId: ch.id, contact: { name: from?.name || null, email: fromEmail },
    subject: (m.subject ?? "").trim() || "(no subject)", body: body.slice(0, 50_000), html: typeof m.html === "string" ? m.html.slice(0, 200_000) : null,
    attachments, externalId: messageId, externalThreadId: refs[0] ?? messageId, authorName: from?.name || fromEmail, createdAt,
  });
  return "new";
}

export function htmlToText(html: string) {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|tr|h\d)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Send an email through a channel's SMTP server; returns the normalized Message-ID. */
export async function sendEmail(ch: { config: EmailConfig; secret_enc: string | null }, mail: { to: string; subject: string; text: string; inReplyTo?: string | null; references?: string[] }) {
  const pass = channelSecret(ch);
  if (!pass) throw new AppError("Mailbox password missing.");
  const c = ch.config;
  const info = await smtpTransport(c, pass).sendMail({
    from: { name: c.fromName || c.fromAddress || c.user, address: c.fromAddress || c.user },
    to: mail.to,
    subject: mail.subject,
    text: mail.text,
    inReplyTo: mail.inReplyTo ? `<${mail.inReplyTo}>` : undefined,
    references: mail.references?.length ? mail.references.map((r) => `<${r}>`).join(" ") : undefined,
  });
  return normalizeMessageId(info.messageId);
}
