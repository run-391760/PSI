import { createHash, randomBytes, randomUUID } from "node:crypto";
import { query } from "@/lib/db";
import { AppError } from "@/lib/domain";
import { DEFAULT_CHAT, DEFAULT_FORM, publicChannel, type ChatConfig, type FormConfig } from "./channels";
import { chatFileLinks } from "./files";
import { addInbound, canThreadInto, createTicket, iso } from "./store";

/** Public live chat (visitor sessions, polled) and web form submissions. No user auth: token-scoped. */
const sha = (s: string) => createHash("sha256").update(s).digest("hex");

export async function chatChannel(id: string) {
  const ch = await publicChannel(id, "livechat");
  if (!ch || ch.status === "paused") return null;
  const cfg = { ...DEFAULT_CHAT, ...(ch.config as Partial<ChatConfig>) };
  const [online] = await query<{ n: number }>("SELECT count(*)::int AS n FROM cx_inbox_presence pr JOIN cx_tickets t ON t.id=pr.ticket_id WHERE t.project_id=$1 AND pr.seen_at > now()-interval '5 minutes'", [ch.project_id]);
  return { id: ch.id, projectId: ch.project_id, brand: ch.brand, config: cfg, agentsOnline: (online?.n ?? 0) > 0 };
}

async function session(channelId: string, token: string) {
  const [s] = await query<{ id: string; project_id: string; ticket_id: string | null; name: string; email: string | null; contact_id: string | null }>(
    "SELECT id,project_id,ticket_id,name,email,contact_id FROM cx_inbox_chat_sessions WHERE channel_id=$1 AND token_hash=$2",
    [channelId, sha(token)],
  );
  if (!s) throw new AppError("Chat session expired. Reload the page to start a new chat.", 401);
  return s;
}

const clean = (s: unknown, max: number) => String(s ?? "").replace(/\s+$/g, "").slice(0, max).trim();

export async function startChat(channelId: string, input: { name?: string; email?: string; pageUrl?: string; userAgent?: string }) {
  const ch = await chatChannel(channelId);
  if (!ch) throw new AppError("This chat is not available.", 404);
  const email = clean(input.email, 200).toLowerCase() || null;
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new AppError("Enter a valid email address.");
  const token = randomBytes(24).toString("base64url");
  const id = randomUUID();
  await query(
    "INSERT INTO cx_inbox_chat_sessions(id,channel_id,project_id,token_hash,name,email,page_url,user_agent) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
    [id, channelId, ch.projectId, sha(token), clean(input.name, 80), email, clean(input.pageUrl, 500) || null, clean(input.userAgent, 300) || null],
  );
  return { token, sessionId: id };
}

export async function sendChat(channelId: string, token: string, text: string) {
  const body = clean(text, 5000);
  if (!body) throw new AppError("Type a message.");
  const s = await session(channelId, token);
  let ticketId = s.ticket_id;
  if (ticketId && !(await canThreadInto(s.project_id, ticketId))) ticketId = null;
  const name = s.name || (s.email ? s.email.split("@")[0] : "Visitor");
  if (ticketId) await addInbound(s.project_id, ticketId, { body, authorName: name });
  else {
    const r = await createTicket({
      projectId: s.project_id, channelKind: "livechat", channelId, contact: { name: s.name || null, email: s.email, handle: { kind: "livechat", id: s.id } },
      subject: body.split("\n")[0].slice(0, 90), body, authorName: name,
    });
    ticketId = r.id;
    await query("UPDATE cx_inbox_chat_sessions SET ticket_id=$2, contact_id=$3 WHERE id=$1", [s.id, r.id, r.contactId]);
  }
  await query("UPDATE cx_inbox_chat_sessions SET visitor_seen_at=now(), visitor_typing_at=NULL WHERE id=$1", [s.id]);
  return { ticketId };
}

export async function pollChat(channelId: string, token: string, typing = false) {
  const s = await session(channelId, token);
  await query(`UPDATE cx_inbox_chat_sessions SET visitor_seen_at=now(), visitor_typing_at=CASE WHEN $2 THEN now() ELSE NULL END WHERE id=$1`, [s.id, typing]);
  if (!s.ticket_id) return { messages: [], agentTyping: false, status: "new" };
  const rows = await query<{ id: string; direction: string; author_name: string; body: string; created_at: string; attachments: { id?: string; name?: string }[] }>(
    "SELECT id,direction,author_name,body,created_at,attachments FROM cx_messages WHERE ticket_id=$1 AND direction IN ('in','out') ORDER BY created_at, id",
    [s.ticket_id],
  );
  const links = await chatFileLinks(rows.filter((m) => m.direction === "out").flatMap((m) => (m.attachments ?? []).map((a) => a.id).filter((x): x is string => !!x)));
  const messages = rows.map((m) => ({
    id: m.id, from: m.direction === "in" ? "visitor" : "agent", name: m.direction === "out" ? m.author_name.split(" ")[0] : "", body: m.body, at: iso(m.created_at)!,
    files: m.direction === "out" ? (m.attachments ?? []).filter((a) => a.id && links.has(a.id)).map((a) => ({ name: a.name ?? "file", path: links.get(a.id!)! })) : [],
  }));
  const [t] = await query<{ status: string; typing: boolean }>(
    "SELECT t.status, EXISTS (SELECT 1 FROM cx_inbox_presence p WHERE p.ticket_id=t.id AND p.typing AND p.seen_at > now()-interval '8 seconds') AS typing FROM cx_tickets t WHERE t.id=$1",
    [s.ticket_id],
  );
  return { messages, agentTyping: !!t?.typing, status: t?.status ?? "open" };
}

// ---------------------------------------------------------------- web form

export async function formChannel(id: string) {
  const ch = await publicChannel(id, "webform");
  if (!ch || ch.status === "paused") return null;
  return { id: ch.id, projectId: ch.project_id, brand: ch.brand, config: { ...DEFAULT_FORM, ...(ch.config as Partial<FormConfig>) } };
}

export async function submitForm(channelId: string, input: { name?: string; email?: string; phone?: string; subject?: string; message?: string; website?: string; pageUrl?: string }) {
  const ch = await formChannel(channelId);
  if (!ch) throw new AppError("This form is not available.", 404);
  if (input.website) return { ok: true, number: null }; // honeypot: silently accept bots
  const name = clean(input.name, 80), email = clean(input.email, 200).toLowerCase(), message = clean(input.message, 10_000);
  if (!name) throw new AppError("Please enter your name.");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new AppError("Please enter a valid email address.");
  if (message.length < 2) throw new AppError("Please write a message.");
  const subject = clean(input.subject, 200) || message.split("\n")[0].slice(0, 90);
  const r = await createTicket({
    projectId: ch.projectId, channelKind: "webform", channelId, contact: { name, email, phone: clean(input.phone, 40) || null, attributes: input.pageUrl ? { "Form page": clean(input.pageUrl, 300) } : undefined },
    subject, body: message, authorName: name,
  });
  return { ok: true, number: r.number };
}
