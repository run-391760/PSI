import { query, transaction } from "@/lib/db";
import { AppError } from "@/lib/domain";
import { channelInfo, metaGraphUrl } from "@/lib/cx/channels";
import { pickWhatsAppSender } from "@/lib/cx/providers";
import { channelSecret, type EmailConfig } from "./channels";
import { sendEmail } from "./email";
import { asAttachment, claimFiles, getFiles, readFileBytes, type FileRow } from "./files";
import { crmLabel, isCrmStatus, isTicketLocked, quoteMessage, toEmailHtml, toPlainText, toStored, type CrmStatus } from "./model";
import { getInboxSettings } from "./settings";
import { insertMessage, iso, logEvent, setOverlay, type Status } from "./store";
import { replySubject } from "./threading";
import { notifyMentions, signatureParts } from "./workspace";
import { parseMetaThread } from "./webhooks";

/**
 * Agent replies and internal notes. Replies are delivered through the ticket's channel where this
 * server can send (email via SMTP, live chat via the widget, web form via the brand's email channel,
 * WhatsApp/Meta when their tokens are configured); otherwise the reply is stored and marked as such.
 * Replies can carry attachments, a per-user signature (email), hyperlinks and target a specific
 * email in the thread (reply-on-reply). Notes notify @mentioned agents.
 */
export type Delivery = { delivery: "sent" | "stored" | "failed"; note: string | null };
export type ReplyInput = { body: string; note?: boolean; status?: Status | CrmStatus | null; attachmentIds?: string[]; replyToId?: string | null; signature?: boolean; /** Facebook/Instagram comment threads: DM the commenter instead of replying in public. */ privateReply?: boolean };

export async function postReply(projectId: string, ticketId: string, user: { id: string; name: string }, input: ReplyInput): Promise<Delivery> {
  const body = input.body.trim();
  const files = await getFiles(projectId, input.attachmentIds ?? []);
  if (!body && !files.length) throw new AppError("Write a message first.");
  if (body.length > 20_000) throw new AppError("Message is too long.");
  const settings = await getInboxSettings(projectId);
  const [t] = await query<{ id: string; number: number; subject: string; status: string; overlay: string | null; resolved_at: string | null; channel_kind: string; channel_id: string | null; external_thread_id: string | null; contact_email: string | null; contact_phone: string | null; handles: Record<string, string> | null; first_response_at: string | null; open_children: number }>(
    `SELECT t.id,t.number,t.subject,t.status,t.resolved_at,tm.crm_status AS overlay,t.channel_kind,t.channel_id,t.external_thread_id,t.first_response_at,c.email AS contact_email,c.phone AS contact_phone,c.handles,
            (SELECT count(*)::int FROM cx_inbox_ticket_meta k JOIN cx_tickets ct ON ct.id=k.ticket_id WHERE k.parent_id=t.id AND ct.status NOT IN ('solved','closed')) AS open_children
       FROM cx_tickets t LEFT JOIN cx_inbox_ticket_meta tm ON tm.ticket_id=t.id LEFT JOIN cx_contacts c ON c.id=t.contact_id WHERE t.id=$1 AND t.project_id=$2`,
    [ticketId, projectId],
  );
  if (!t) throw new AppError("Ticket not found.", 404);
  const locked = isTicketLocked({ status: t.status, resolved_at: iso(t.resolved_at) }, settings.lockDays);
  const attachments = files.map(asAttachment);
  if (input.note) {
    const mid = await transaction(async (q) => {
      const id = await insertMessage(q, ticketId, { direction: "note", authorName: user.name, authorUserId: user.id, body, attachments });
      await q("UPDATE cx_tickets SET updated_at=now() WHERE id=$1", [ticketId]);
      return id;
    });
    await claimFiles(projectId, ticketId, files.map((f) => f.id));
    await notifyMentions(projectId, t, mid, body, user).catch(() => []);
    return { delivery: "stored", note: null };
  }
  if (locked) throw new AppError(`This ticket is locked (resolved more than ${settings.lockDays} days ago). Create a new ticket to reply.`, 409);
  if (input.status && !isCrmStatus(input.status)) throw new AppError("Invalid status.");
  if (settings.requireStatusOnReply && !input.status) throw new AppError("Choose the ticket status to send with this reply (required by your ticket settings).");
  const stored = input.status ? toStored(input.status as CrmStatus) : null;
  if (stored && ["solved", "closed"].includes(stored.status) && t.open_children > 0) throw new AppError(`#${t.number} stays open until its ${t.open_children} child ticket${t.open_children > 1 ? "s are" : " is"} closed.`, 409);

  let replyTo: { id: string; external_id: string | null; author_name: string; created_at: string; body: string } | null = null;
  if (input.replyToId) {
    [replyTo] = await query<{ id: string; external_id: string | null; author_name: string; created_at: string; body: string }>("SELECT id,external_id,author_name,created_at,body FROM cx_messages WHERE id=$1 AND ticket_id=$2", [input.replyToId, ticketId]);
    if (replyTo) replyTo.created_at = iso(replyTo.created_at)!;
  }
  let result: Delivery = { delivery: "stored", note: null };
  let externalId: string | null = null;
  try {
    const r = await deliver(projectId, t, body, { files, replyTo, signatureUser: input.signature === false ? null : user.id, privateReply: !!input.privateReply });
    result = r.result;
    externalId = r.externalId;
  } catch (e) {
    result = { delivery: "failed", note: e instanceof Error ? e.message.slice(0, 300) : "Delivery failed" };
  }
  const nextStatus = stored?.status ?? (t.status === "new" ? "open" : t.status === "solved" || t.status === "closed" ? "open" : t.status);
  await transaction(async (q) => {
    const mid = await insertMessage(q, ticketId, { direction: "out", authorName: user.name, authorUserId: user.id, body, attachments, externalId, delivery: result.delivery, deliveryError: result.note });
    if (replyTo) await q("INSERT INTO cx_inbox_message_meta(message_id,reply_to) VALUES($1,$2)", [mid, replyTo.id]);
    const counts = result.delivery !== "failed";
    await q(
      `UPDATE cx_tickets SET updated_at=now(), status=$2, first_response_at=CASE WHEN $3 THEN COALESCE(first_response_at, now()) ELSE first_response_at END,
              resolved_at=CASE WHEN $2 IN ('solved','closed') THEN COALESCE(resolved_at, now()) ELSE NULL END,
              assignee_id=COALESCE(assignee_id,$4) WHERE id=$1`,
      [ticketId, nextStatus, counts, user.id],
    );
    // Overlay: explicit status wins; otherwise a reply clears "Reopened" (ticket becomes Responded) and keeps WIP / Follow-up.
    if (stored) await setOverlay(q, ticketId, stored.overlay, ["solved", "closed"].includes(t.status) && !["solved", "closed"].includes(stored.status));
    else if (t.overlay === "reopened" || (t.overlay && ["solved", "closed"].includes(t.status))) await setOverlay(q, ticketId, null);
    if (input.status) await logEvent(q, ticketId, user.name, "update", `replied with status → ${crmLabel(input.status)}`);
    else if (nextStatus !== t.status) await logEvent(q, ticketId, user.name, "update", `status → ${nextStatus.replace("_", " ")}`);
  });
  await claimFiles(projectId, ticketId, files.map((f) => f.id));
  return result;
}

type T = { id: string; number: number; subject: string; channel_kind: string; channel_id: string | null; external_thread_id?: string | null; contact_email: string | null; contact_phone: string | null; handles: Record<string, string> | null };
type Extra = { files?: FileRow[]; replyTo?: { external_id: string | null; author_name: string; created_at: string; body: string } | null; signatureUser?: string | null; privateReply?: boolean };

/** Which Meta messaging mode a DM reply may use, given hours since the customer's last message (pure). */
export function messagingTag(ageHours: number | null, humanAgent: boolean): "response" | "human_agent" | "closed" {
  if (ageHours === null || ageHours < 24) return "response";
  if (humanAgent && ageHours < 7 * 24) return "human_agent";
  return "closed";
}
async function lastInboundAgeHours(ticketId: string) {
  const [r] = await query<{ at: string | null }>("SELECT max(created_at) AS at FROM cx_messages WHERE ticket_id=$1 AND direction='in'", [ticketId]);
  return r?.at ? (Date.now() - new Date(r.at).getTime()) / 3_600_000 : null;
}
async function lastInboundExternalId(ticketId: string) {
  const [r] = await query<{ external_id: string | null }>("SELECT external_id FROM cx_messages WHERE ticket_id=$1 AND direction='in' AND external_id IS NOT NULL ORDER BY created_at DESC LIMIT 1", [ticketId]);
  return r?.external_id ?? null;
}

async function deliver(projectId: string, t: T, body: string, extra: Extra = {}): Promise<{ result: Delivery; externalId: string | null }> {
  const kind = t.channel_kind;
  if (kind === "livechat") return { result: { delivery: "sent", note: null }, externalId: null };
  if (kind === "email" || kind === "webform") {
    if (!t.contact_email) return { result: { delivery: "stored", note: "The customer has no email address, so the reply was stored only." }, externalId: null };
    type Ch = { id: string; config: EmailConfig; secret_enc: string | null };
    let [ch] = kind === "email" && t.channel_id ? await query<Ch>("SELECT id,config,secret_enc FROM cx_channels WHERE id=$1 AND project_id=$2 AND kind='email'", [t.channel_id, projectId]) : [];
    if (!ch) [ch] = await query<Ch>("SELECT id,config,secret_enc FROM cx_channels WHERE project_id=$1 AND kind='email' AND status<>'paused' ORDER BY created_at LIMIT 1", [projectId]);
    if (!ch) return { result: { delivery: "stored", note: "Connect an email channel (Settings → Channels) to send web form replies by email. The reply was stored." }, externalId: null };
    const ids = await query<{ external_id: string; direction: string }>("SELECT lower(external_id) AS external_id,direction FROM cx_messages WHERE ticket_id=$1 AND external_id IS NOT NULL AND external_id LIKE '%@%' ORDER BY created_at", [t.id]);
    const target = extra.replyTo?.external_id?.includes("@") ? extra.replyTo.external_id.toLowerCase() : null;
    const lastIn = target ?? [...ids].reverse().find((m) => m.direction === "in")?.external_id ?? ids.at(-1)?.external_id ?? null;
    const sig = extra.signatureUser ? await signatureParts(projectId, extra.signatureUser) : null;
    const quoted = extra.replyTo ? quoteMessage(extra.replyTo) : "";
    const files = await Promise.all((extra.files ?? []).map(async (f) => ({ filename: f.filename, content: await readFileBytes(f), contentType: f.mime })));
    const externalId = await sendEmail(ch, {
      to: t.contact_email, subject: replySubject(t.subject, t.number),
      text: toPlainText(body, sig?.text) + quoted,
      html: toEmailHtml(body, sig ? { text: sig.text, imageCid: sig.image?.cid } : null) + (quoted ? `<blockquote style="margin:12px 0 0;padding-left:10px;border-left:3px solid #ccc;color:#666;white-space:pre-wrap">${quoted.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</blockquote>` : ""),
      inReplyTo: lastIn, references: ids.map((m) => m.external_id).slice(-20),
      attachments: [...files, ...(sig?.image ? [sig.image] : [])],
    });
    return { result: { delivery: "sent", note: null }, externalId };
  }
  const plain = toPlainText(body) + ((extra.files ?? []).length ? `\n\n(${(extra.files ?? []).length} attachment(s) could not be sent on this channel)` : "");
  if (kind === "whatsapp") {
    // Send from the number the conversation came in on (channel config.accountId = phone number id).
    const [ch] = t.channel_id ? await query<{ secret_enc: string | null; config: { accountId?: string } | null }>("SELECT secret_enc,config FROM cx_channels WHERE id=$1 AND project_id=$2", [t.channel_id, projectId]) : [];
    const sender = pickWhatsAppSender(ch ? { phoneId: ch.config?.accountId ?? null, token: channelSecret(ch) } : null, process.env);
    const to = t.handles?.whatsapp ?? t.contact_phone?.replace(/^\+/, "");
    if (!sender || !to) return { result: { delivery: "stored", note: "WhatsApp sending needs WHATSAPP_TOKEN on the server and the phone number id (the channel's account id or WHATSAPP_PHONE_NUMBER_ID). The reply was stored only." }, externalId: null };
    const { token, phoneId } = sender;
    const r = await fetch(`${metaGraphUrl()}/${phoneId}/messages`, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ messaging_product: "whatsapp", to, type: "text", text: { body: plain } }), signal: AbortSignal.timeout(20_000) });
    const d = (await r.json().catch(() => ({}))) as { messages?: { id: string }[]; error?: { message?: string } };
    if (!r.ok) throw new Error(d.error?.message ?? `WhatsApp API ${r.status}`);
    return { result: { delivery: "sent", note: null }, externalId: d.messages?.[0]?.id ?? null };
  }
  if ((kind === "facebook" || kind === "instagram") && t.channel_id) {
    const [ch] = await query<{ project_id: string; secret_enc: string | null; config: { accountId?: string; humanAgent?: boolean } }>("SELECT project_id,secret_enc,config FROM cx_channels WHERE id=$1", [t.channel_id]);
    const { graph, metaToken } = await import("./social");
    // The channel's Page token, else the brand's Publishing token for the same account, else META_PAGE_ACCESS_TOKEN.
    const token = ch ? await metaToken(ch, kind) : null;
    const thread = parseMetaThread(t.external_thread_id);
    const net = kind === "facebook" ? "Facebook" : "Instagram";
    if (thread) {
      // Public thread (comment, mention, tag, review): answer in public on the post, or privately by DM to the commenter.
      if (!token) return { result: { delivery: "stored", note: `Replying to ${net} comments needs a Page access token on the channel (or the Page connected in Publishing). The reply was stored only.` }, externalId: null };
      const target = extra.replyTo?.external_id && !extra.replyTo.external_id.startsWith("tag:") ? extra.replyTo.external_id : null;
      if (extra.privateReply) {
        const commentId = target ?? (thread.kind === "igm" ? thread.commentId : thread.kind === "fbc" || thread.kind === "igc" ? (await lastInboundExternalId(t.id)) : null);
        if (!commentId) return { result: { delivery: "stored", note: `A private reply needs a ${net} comment to answer. The reply was stored only.` }, externalId: null };
        // Meta allows one private reply per comment, within 7 days of the comment (same endpoint for FB and IG with a Page token).
        const d = await graph("me/messages", token, { recipient: JSON.stringify({ comment_id: commentId }), message: JSON.stringify({ text: plain }) });
        return { result: { delivery: "sent", note: "Sent as a private message to the commenter." }, externalId: d.message_id ? String(d.message_id) : null };
      }
      if (thread.kind === "igt") return { result: { delivery: "stored", note: "Instagram's API can't comment on posts you're only photo-tagged in. The reply was stored; answer on Instagram using the post link in the ticket." }, externalId: null };
      const d =
        thread.kind === "fbc" ? await graph(`${target ?? thread.id}/comments`, token, { message: plain })
        : thread.kind === "fbp" || thread.kind === "fbr" ? await graph(`${thread.id}/comments`, token, { message: plain })
        // Instagram only accepts replies on top-level comments, so replies always go under the thread's root comment.
        : thread.kind === "igc" ? await graph(`${thread.id}/replies`, token, { message: plain })
        : await graph(`${ch.config?.accountId}/mentions`, token, { media_id: thread.id, ...(thread.commentId ? { comment_id: thread.commentId } : {}), message: plain });
      return { result: { delivery: "sent", note: null }, externalId: d.id ? String(d.id) : null };
    }
    const psid = t.handles?.[kind];
    if (!token || !psid) return { result: { delivery: "stored", note: `Sending ${kind === "facebook" ? "Messenger" : "Instagram"} replies needs a Page access token on the channel (or the Page connected in Publishing). The reply was stored only.` }, externalId: null };
    // Messaging window: 24 h after the customer's last message; up to 7 days with the Human Agent tag (Meta approval).
    const age = await lastInboundAgeHours(t.id);
    const tag = messagingTag(age, !!ch?.config?.humanAgent);
    if (tag === "closed")
      return { result: { delivery: "stored", note: ch?.config?.humanAgent ? `The customer's last message is over 7 days old, so ${net} doesn't allow a reply. The reply was stored only.` : `The customer's last message is over 24 hours old. ${net} only allows replies within 24 hours (7 days with the Human Agent permission, enable it on the channel once Meta approves it). The reply was stored only.` }, externalId: null };
    const d = await graph("me/messages", token, {
      recipient: JSON.stringify({ id: psid }),
      message: JSON.stringify({ text: plain }),
      ...(tag === "human_agent" ? { messaging_type: "MESSAGE_TAG", tag: "HUMAN_AGENT" } : { messaging_type: "RESPONSE" }),
    });
    return { result: { delivery: "sent", note: tag === "human_agent" ? "Sent with the Human Agent tag (outside the 24-hour window)." : null }, externalId: d.message_id ? String(d.message_id) : null };
  }
  if (kind === "linkedin") {
    const { sendLinkedInReply } = await import("./linkedin");
    const externalId = await sendLinkedInReply(projectId, t.channel_id, t.external_thread_id ?? null, plain);
    if (externalId === null) return { result: { delivery: "stored", note: "Replying on LinkedIn needs an access token on the channel (or LinkedIn connected in Publishing). The reply was stored only." }, externalId: null };
    return { result: { delivery: "sent", note: null }, externalId };
  }
  if (kind === "discord" || kind === "discourse" || kind === "telegram") {
    const { sendConnectorReply } = await import("@/lib/cx/admin/connectors");
    const externalId = await sendConnectorReply(projectId, t.id, plain);
    return { result: { delivery: "sent", note: null }, externalId };
  }
  const name = channelInfo(kind)?.name ?? kind;
  return { result: { delivery: "stored", note: `Replies to ${name} can't be sent from here yet — the reply was stored; post it on ${name} directly.` }, externalId: null };
}

/**
 * After tickets are solved: send the brand's auto-send CSAT/NPS survey link (Surveys module) as an outbound
 * message on email, live chat and web form tickets. Sent at most once per ticket and survey.
 */
export async function sendSurveysOnSolve(projectId: string, ticketIds: string[], actor: string) {
  const { surveyLinkForTicket } = await import("@/lib/cx/insights/surveys");
  let sent = 0;
  for (const id of ticketIds.slice(0, 100)) {
    try {
      const [t] = await query<T & { status: string }>(
        `SELECT t.id,t.number,t.subject,t.status,t.channel_kind,t.channel_id,c.email AS contact_email,c.phone AS contact_phone,c.handles
           FROM cx_tickets t LEFT JOIN cx_contacts c ON c.id=t.contact_id WHERE t.id=$1 AND t.project_id=$2`,
        [id, projectId],
      );
      if (!t || t.status !== "solved" || !SURVEY_CHANNELS.has(t.channel_kind)) continue;
      const link = await surveyLinkForTicket(projectId, id);
      if (!link) return sent; // brand has no active auto-send survey
      const [dupe] = await query("SELECT 1 FROM cx_messages WHERE ticket_id=$1 AND direction='out' AND position($2 in body) > 0", [id, link.url]);
      if (dupe) continue;
      let result: Delivery = { delivery: "stored", note: null };
      let externalId: string | null = null;
      try {
        const r = await deliver(projectId, t, link.text);
        result = r.result;
        externalId = r.externalId;
      } catch (e) {
        result = { delivery: "failed", note: e instanceof Error ? e.message.slice(0, 300) : "Delivery failed" };
      }
      await transaction(async (q) => {
        await insertMessage(q, id, { direction: "out", authorName: `${actor} (survey)`, body: link.text, externalId, delivery: result.delivery, deliveryError: result.note });
        await logEvent(q, id, actor, "survey", `Satisfaction survey ${result.delivery === "sent" ? "sent" : result.delivery === "failed" ? "failed to send" : "stored"}`);
      });
      if (result.delivery === "sent") sent++;
    } catch (e) {
      console.error("[cx inbox] survey on solve", e);
    }
  }
  return sent;
}
const SURVEY_CHANNELS = new Set(["email", "livechat", "webform"]);
