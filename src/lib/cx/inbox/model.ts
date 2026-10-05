/**
 * Agent-workspace model (pure, client-safe, fixture-tested in tests/cx-wp1.test.ts):
 * CRM statuses (WIP / Follow-up / Ignored / Reopened on top of the core ticket status), field-aware
 * search syntax, template placeholders, reply links, phone keys for contact auto-merge, email address
 * rules, reminders, ticket locking, collision locks, @mentions, user journey windows and transcripts.
 */

// ---------------------------------------------------------------- CRM statuses

export type BaseStatus = "new" | "open" | "pending" | "on_hold" | "solved" | "closed";
export type Overlay = "wip" | "follow_up" | "ignored" | "reopened";
export type CrmStatus = BaseStatus | Overlay | "assigned" | "responded";

export const CRM_STATUSES: { id: CrmStatus; label: string; base: BaseStatus; derived?: boolean; hint: string }[] = [
  { id: "new", label: "New", base: "new", hint: "Not yet opened by an agent" },
  { id: "open", label: "Open", base: "open", hint: "Waiting for the team" },
  { id: "assigned", label: "Assigned", base: "open", derived: true, hint: "Open with an assignee and no reply yet" },
  { id: "wip", label: "WIP", base: "open", hint: "Work in progress" },
  { id: "responded", label: "Responded", base: "open", derived: true, hint: "Last message is from the team" },
  { id: "reopened", label: "Reopened", base: "open", hint: "The customer wrote again after it was parked or resolved" },
  { id: "follow_up", label: "Follow-up", base: "pending", hint: "Parked until a planned follow-up" },
  { id: "pending", label: "Pending", base: "pending", hint: "Waiting for the customer" },
  { id: "on_hold", label: "On hold", base: "on_hold", hint: "Waiting on a third party" },
  { id: "solved", label: "Resolved", base: "solved", hint: "Resolved; reopens when the customer replies" },
  { id: "closed", label: "Closed", base: "closed", hint: "Closed for good" },
  { id: "ignored", label: "Ignored", base: "closed", hint: "No action needed (spam, noise)" },
];
export const SETTABLE_STATUSES = CRM_STATUSES.filter((s) => !s.derived);
const OVERLAYS = new Set<string>(["wip", "follow_up", "ignored", "reopened"]);
export const isCrmStatus = (s: unknown): s is CrmStatus => CRM_STATUSES.some((x) => x.id === s);
export const crmLabel = (s: string | null | undefined) => CRM_STATUSES.find((x) => x.id === s)?.label ?? (s ? s[0].toUpperCase() + s.slice(1).replace("_", " ") : "n/a");
export const DONE_STATUSES = new Set(["solved", "closed", "ignored"]);

/** Stored representation of a settable CRM status: core status + overlay (null clears the overlay). */
export function toStored(s: CrmStatus): { status: BaseStatus; overlay: Overlay | null } {
  const def = CRM_STATUSES.find((x) => x.id === s);
  if (!def || def.derived) return { status: "open", overlay: null };
  return { status: def.base, overlay: OVERLAYS.has(s) ? (s as Overlay) : null };
}

/** Effective CRM status (mirrors CRM_SQL in store.ts). An overlay only counts while its core status still matches. */
export function effectiveStatus(t: { status: string; overlay?: string | null; assignee_id?: string | null; last_direction?: string | null }): CrmStatus {
  const o = t.overlay;
  if ((o === "wip" || o === "reopened") && (t.status === "new" || t.status === "open")) return o;
  if (o === "follow_up" && t.status === "pending") return "follow_up";
  if (o === "ignored" && t.status === "closed") return "ignored";
  if ((t.status === "new" || t.status === "open") && t.last_direction === "out") return "responded";
  if ((t.status === "new" || t.status === "open") && t.assignee_id) return "assigned";
  return t.status as CrmStatus;
}

/**
 * Customer wrote again: which stored status the ticket moves to (null = unchanged). Resolved, pending,
 * on-hold and follow-up tickets reopen; WIP reopens only when the "Reopen WIP on customer reply" setting is on.
 * Closed/ignored tickets are not reopened here (a new ticket is created instead).
 */
export function reopenOnInbound(t: { status: string; overlay?: string | null }, opts: { reopenWip: boolean }): { status: BaseStatus; overlay: Overlay | null } | null {
  const eff = effectiveStatus(t);
  if (eff === "closed" || eff === "ignored") return null;
  if (["solved", "pending", "on_hold", "follow_up"].includes(eff)) return { status: "open", overlay: "reopened" };
  if (eff === "wip" && opts.reopenWip) return { status: "open", overlay: "reopened" };
  return null;
}

/** Ticket locking: resolved/closed tickets become read-only `lockDays` after they were resolved (0 = off). */
export function isTicketLocked(t: { status: string; resolved_at: string | null }, lockDays: number, now = Date.now()) {
  if (!lockDays || lockDays <= 0 || !["solved", "closed"].includes(t.status) || !t.resolved_at) return false;
  return now - new Date(t.resolved_at).getTime() > lockDays * 86_400_000;
}

// ---------------------------------------------------------------- settings & preferences

export type InboxSettings = {
  /** Every customer reply must carry a status change (no "reply only"). */
  requireStatusOnReply: boolean;
  /** A customer reply on a WIP ticket moves it to Reopened. */
  reopenWip: boolean;
  /** Lock resolved/closed tickets N days after resolution (0 = never). */
  lockDays: number;
  /** Escalate / forward / compose may only go to these domains (empty = any). */
  allowedEmailDomains: string[];
  /** Merge contacts automatically when they share a phone number. */
  autoMergePhone: boolean;
  /** Split One Ticket View into Public / Private message tabs. */
  publicPrivateTabs: boolean;
};
export const DEFAULT_SETTINGS: InboxSettings = { requireStatusOnReply: false, reopenWip: true, lockDays: 0, allowedEmailDomains: [], autoMergePhone: true, publicPrivateTabs: true };

export type InboxPrefs = {
  layout: "ticket" | "chat";
  align: "split" | "left";
  absoluteDates: boolean;
  soundNewTicket: boolean;
  soundNewMessage: boolean;
  enterToSend: boolean;
  emailCollapsed: boolean;
  translateTo: string;
  /** "Change view": split list + conversation, or Konnect-style ticket cards. */
  mode: "split" | "cards";
  /** Right-hand filter/counter panel open. */
  panel: boolean;
};
export const DEFAULT_PREFS: InboxPrefs = { layout: "ticket", align: "split", absoluteDates: false, soundNewTicket: false, soundNewMessage: false, enterToSend: false, emailCollapsed: true, translateTo: "English", mode: "cards", panel: true };

export function normSettings(v: Partial<InboxSettings> | null | undefined): InboxSettings {
  const s = { ...DEFAULT_SETTINGS, ...(v ?? {}) };
  return {
    requireStatusOnReply: !!s.requireStatusOnReply,
    reopenWip: !!s.reopenWip,
    lockDays: Math.max(0, Math.min(3650, Math.round(Number(s.lockDays) || 0))),
    allowedEmailDomains: normDomains(s.allowedEmailDomains),
    autoMergePhone: !!s.autoMergePhone,
    publicPrivateTabs: !!s.publicPrivateTabs,
  };
}
export function normPrefs(v: Partial<InboxPrefs> | null | undefined): InboxPrefs {
  const p = { ...DEFAULT_PREFS, ...(v ?? {}) };
  return {
    layout: p.layout === "chat" ? "chat" : "ticket",
    align: p.align === "left" ? "left" : "split",
    absoluteDates: !!p.absoluteDates,
    soundNewTicket: !!p.soundNewTicket,
    soundNewMessage: !!p.soundNewMessage,
    enterToSend: !!p.enterToSend,
    emailCollapsed: !!p.emailCollapsed,
    translateTo: String(p.translateTo || "English").slice(0, 40),
    mode: p.mode === "cards" ? "cards" : "split",
    panel: p.panel !== false,
  };
}
export function normDomains(v: unknown): string[] {
  const list = Array.isArray(v) ? v : String(v ?? "").split(/[\s,;]+/);
  return [...new Set(list.map((d) => String(d).trim().toLowerCase().replace(/^@/, "").replace(/^https?:\/\//, "").replace(/\/.*$/, "")).filter((d) => /^[a-z0-9.-]+\.[a-z]{2,}$/.test(d)))].slice(0, 100);
}

// ---------------------------------------------------------------- email addresses

const EMAIL_RE = /^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/;
/** Split "a@x.com, B <b@y.org>; c@z" into valid lowercase addresses and invalid tokens. */
export function parseAddresses(input: string | string[]): { valid: string[]; invalid: string[] } {
  const parts = (Array.isArray(input) ? input : [input]).flatMap((s) => String(s ?? "").split(/[,;\n]+/)).map((s) => s.trim()).filter(Boolean);
  const valid: string[] = [], invalid: string[] = [];
  for (const p of parts) {
    const m = /<([^<>]+)>/.exec(p);
    const addr = (m ? m[1] : p).trim().toLowerCase();
    if (EMAIL_RE.test(addr)) { if (!valid.includes(addr)) valid.push(addr); } else invalid.push(p);
  }
  return { valid, invalid };
}
export function domainAllowed(email: string, allowed: string[]) {
  if (!allowed.length) return true;
  const d = email.split("@")[1]?.toLowerCase() ?? "";
  return allowed.some((a) => d === a || d.endsWith(`.${a}`));
}
export function blockedRecipients(emails: string[], allowed: string[]) {
  return emails.filter((e) => !domainAllowed(e, allowed));
}

/** Subject for mail composed from a ticket: always carries the ticket ID tag so replies thread back. */
export function composeSubject(subject: string, n: number, kind: "compose" | "forward" | "escalate") {
  let s = (subject || "").replace(/\s*\[#\d+\]/g, "").trim();
  if (kind === "forward" && !/^fwd?:/i.test(s)) s = `Fwd: ${s}`;
  if (kind === "escalate" && !/^escalat/i.test(s)) s = `Escalation: ${s}`;
  return `${s || "Ticket"} [#${n}]`;
}

// ---------------------------------------------------------------- phone keys (auto-merge)

/** Comparable phone key: the last 10 digits (country code and formatting ignored); null when too short. */
export function phoneKey(phone: string | null | undefined) {
  const d = String(phone ?? "").replace(/\D/g, "");
  return d.length >= 7 ? d.slice(-10) : null;
}

// ---------------------------------------------------------------- reminders

export const REMINDER_MIN_MINUTES = 10;
export function reminderError(at: Date | string, now = Date.now()) {
  const t = new Date(at).getTime();
  if (!Number.isFinite(t)) return "Pick a valid date and time.";
  if (t - now < REMINDER_MIN_MINUTES * 60_000 - 30_000) return `Reminders must be at least ${REMINDER_MIN_MINUTES} minutes from now.`;
  if (t - now > 366 * 86_400_000) return "Reminders can be set up to a year ahead.";
  return null;
}

// ---------------------------------------------------------------- collision lock

export const LOCK_STALE_MS = 30_000;
/** Who holds a ticket: me, another agent (while their heartbeat is fresh) or nobody. */
export function lockState(lock: { user_id: string; seen_at: string | Date } | null | undefined, me: string, now = Date.now()): "mine" | "other" | "free" {
  if (!lock) return "free";
  if (now - new Date(lock.seen_at).getTime() > LOCK_STALE_MS) return "free";
  return lock.user_id === me ? "mine" : "other";
}

// ---------------------------------------------------------------- @mentions

/** Agents mentioned as @Full Name, @First or @email-user (longest names win; case-insensitive). */
export function findMentions(body: string, agents: { id: string; name: string; email: string }[]) {
  const text = ` ${body.toLowerCase()} `;
  const ids = new Set<string>();
  const handles = agents.flatMap((a) => {
    const n = (a.name || "").trim().toLowerCase();
    return [n, n.split(/\s+/)[0], (a.email || "").split("@")[0].toLowerCase()].filter((h) => h && h.length >= 2).map((h) => ({ id: a.id, h }));
  }).sort((a, b) => b.h.length - a.h.length);
  for (const { id, h } of handles) {
    const i = text.indexOf(`@${h}`);
    if (i < 0) continue;
    const after = text[i + 1 + h.length] ?? " ";
    if (!/[a-z0-9_]/.test(after)) ids.add(id);
  }
  return [...ids];
}

// ---------------------------------------------------------------- links in replies

export type Segment = { text: string; href?: string };
const LINK_RE = /\[([^\]\n]{1,200})\]\((https?:\/\/[^\s)]{1,2000})\)|(https?:\/\/[^\s<>"')\]]{2,2000})/g;
/** Split text into plain and link segments: [label](https://…) and bare http(s) URLs. */
export function linkSegments(text: string): Segment[] {
  const out: Segment[] = [];
  let last = 0;
  for (const m of text.matchAll(LINK_RE)) {
    const i = m.index ?? 0;
    if (i > last) out.push({ text: text.slice(last, i) });
    if (m[1]) out.push({ text: m[1], href: m[2] });
    else {
      const url = m[3].replace(/[.,;:!?]+$/, "");
      out.push({ text: url, href: url });
      if (url.length < m[3].length) out.push({ text: m[3].slice(url.length) });
    }
    last = i + m[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last) });
  return out;
}
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
/** HTML body for email: escaped text, hyperlinks, line breaks, optional signature block. */
export function toEmailHtml(text: string, signature?: { text: string; imageCid?: string | null } | null) {
  const body = linkSegments(text).map((s) => (s.href ? `<a href="${esc(s.href)}">${esc(s.text)}</a>` : esc(s.text))).join("").replace(/\r?\n/g, "<br>");
  const sig = signature && (signature.text.trim() || signature.imageCid)
    ? `<br><br><div style="color:#555">-- <br>${linkSegments(signature.text).map((s) => (s.href ? `<a href="${esc(s.href)}">${esc(s.text)}</a>` : esc(s.text))).join("").replace(/\r?\n/g, "<br>")}${signature.imageCid ? `<br><img src="cid:${signature.imageCid}" alt="" style="max-height:80px">` : ""}</div>`
    : "";
  return `<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;font-size:14px;line-height:1.5">${body}${sig}</div>`;
}
/** Plain-text version: [label](url) → "label (url)", signature appended after "-- ". */
export function toPlainText(text: string, signature?: string | null): string {
  const body = linkSegments(text).map((s) => (s.href && s.text !== s.href ? `${s.text} (${s.href})` : s.text)).join("");
  return signature?.trim() ? `${body}\n\n-- \n${toPlainText(signature)}` : body;
}
/** Quote a message for reply-on-reply emails. */
export function quoteMessage(m: { author_name: string; created_at: string; body: string }) {
  const when = new Date(m.created_at).toUTCString();
  return `\n\nOn ${when}, ${m.author_name || "the customer"} wrote:\n${m.body.split("\n").slice(0, 60).map((l) => `> ${l}`).join("\n")}`;
}

// ---------------------------------------------------------------- templates / placeholders

export const BUILTIN_PLACEHOLDERS = [
  { key: "name", label: "Customer name" },
  { key: "first_name", label: "Customer first name" },
  { key: "ticket", label: "Ticket number" },
  { key: "brand", label: "Brand name" },
  { key: "agent", label: "Your name" },
];
/**
 * Fill {{name}}, {{first_name}}, {{ticket}}, {{brand}}, {{agent}} plus custom fields as {{field.<key>}}
 * (or {{<key>}}) and contact attributes as {{contact.<attribute>}}. Unknown placeholders stay as typed.
 */
export function fillTemplate(body: string, v: { name?: string | null; ticket?: number; brand?: string; agent?: string; fields?: Record<string, unknown>; contact?: Record<string, unknown> }) {
  const first = (v.name ?? "").trim().split(/\s+/)[0] ?? "";
  const str = (x: unknown) => (x == null ? "" : Array.isArray(x) ? x.join(", ") : typeof x === "boolean" ? (x ? "Yes" : "No") : String(x));
  const fields = Object.fromEntries(Object.entries(v.fields ?? {}).map(([k, x]) => [k.toLowerCase(), x]));
  const contact = Object.fromEntries(Object.entries(v.contact ?? {}).map(([k, x]) => [k.toLowerCase(), x]));
  return body.replace(/\{\{\s*([\w.\- ]+?)\s*\}\}/g, (all, raw: string) => {
    const k = raw.toLowerCase();
    if (k === "first_name") return first || "there";
    if (k === "name") return v.name?.trim() || "there";
    if (k === "ticket") return v.ticket != null ? `#${v.ticket}` : "";
    if (k === "brand") return v.brand ?? "";
    if (k === "agent") return v.agent ?? "";
    if (k.startsWith("field.") && k.slice(6) in fields) return str(fields[k.slice(6)]);
    if (k.startsWith("contact.") && k.slice(8) in contact) return str(contact[k.slice(8)]);
    if (k in fields) return str(fields[k]);
    return all;
  });
}

// ---------------------------------------------------------------- field-aware search

export const SEARCH_FIELDS: { key: string; hint: string; values?: string[] }[] = [
  { key: "status", hint: "CRM status", values: CRM_STATUSES.map((s) => s.id) },
  { key: "priority", hint: "urgent, high, normal, low", values: ["urgent", "high", "normal", "low"] },
  { key: "severity", hint: "Severity label" },
  { key: "channel", hint: "Channel kind (email, livechat…)" },
  { key: "profile", hint: "Connected profile / channel name" },
  { key: "assignee", hint: "Agent name, me or none" },
  { key: "team", hint: "Team name" },
  { key: "tag", hint: "Ticket tag" },
  { key: "sentiment", hint: "positive, neutral, negative", values: ["positive", "neutral", "negative"] },
  { key: "intent", hint: "complaint, query, purchase…", values: ["complaint", "query", "feedback", "praise", "purchase", "cancellation", "spam", "other"] },
  { key: "lang", hint: "Language code (en, hi…)" },
  { key: "email", hint: "Customer email" },
  { key: "phone", hint: "Customer phone" },
  { key: "name", hint: "Customer name" },
  { key: "subject", hint: "Subject contains" },
  { key: "ticket", hint: "Ticket number" },
  { key: "post", hint: "Post ID or URL of a linked mention/message" },
  { key: "topic", hint: "Listening topic name" },
  { key: "is", hint: "escalated, unassigned, mine, parent, child, locked", values: ["escalated", "unassigned", "mine", "parent", "child", "locked"] },
  { key: "has", hint: "attachment, reminder, children, csat", values: ["attachment", "reminder", "children", "csat"] },
  { key: "after", hint: "Created after YYYY-MM-DD" },
  { key: "before", hint: "Created before YYYY-MM-DD" },
];
export type SearchTerm = { field: string; value: string; neg: boolean };
/**
 * Parse `field:value` terms (quotes for spaces, leading "-" negates), "#123" ticket numbers and pasted
 * post URLs. `extraFields` are custom field keys (from Settings → Fields). Unknown fields stay free text.
 */
export function parseSearch(q: string, extraFields: string[] = []): { text: string; terms: SearchTerm[] } {
  const known = new Set([...SEARCH_FIELDS.map((f) => f.key), ...extraFields.map((f) => f.toLowerCase())]);
  const terms: SearchTerm[] = [];
  const words: string[] = [];
  const re = /(-?)(https?:\/\/\S+)|(-?)([a-z][\w.-]*):(?:"([^"]*)"|(\S+))|"([^"]*)"|(\S+)/gi;
  for (const m of (q ?? "").matchAll(re)) {
    if (m[2]) { terms.push({ field: "post", value: m[2], neg: m[1] === "-" }); continue; }
    if (m[4]) {
      const field = m[4].toLowerCase(), value = (m[5] ?? m[6] ?? "").trim();
      if (known.has(field) && value) { terms.push({ field, value, neg: m[3] === "-" }); continue; }
      words.push(m[0]);
      continue;
    }
    const w = m[7] ?? m[8] ?? "";
    if (/^#\d{1,9}$/.test(w)) terms.push({ field: "ticket", value: w.slice(1), neg: false });
    else if (w) words.push(w);
  }
  return { text: words.join(" ").trim(), terms };
}
/** Autocomplete for the search box: field names while typing a word, values after "field:". */
export function searchSuggestions(input: string, extra: { key: string; label: string; options?: string[] }[] = []) {
  const last = input.split(/\s+/).pop() ?? "";
  const all = [...SEARCH_FIELDS.map((f) => ({ key: f.key, hint: f.hint, values: f.values ?? [] })), ...extra.map((f) => ({ key: f.key, hint: f.label, values: f.options ?? [] }))];
  const colon = last.indexOf(":");
  if (colon > 0) {
    const f = all.find((x) => x.key === last.slice(0, colon).replace(/^-/, "").toLowerCase());
    const v = last.slice(colon + 1).replace(/^"/, "").toLowerCase();
    return (f?.values ?? []).filter((x) => x.toLowerCase().startsWith(v)).slice(0, 12).map((x) => ({ insert: `${last.slice(0, colon + 1)}${/\s/.test(x) ? `"${x}"` : x} `, label: x, hint: f!.hint }));
  }
  const w = last.replace(/^-/, "").toLowerCase();
  if (!w) return [];
  return all.filter((f) => f.key.startsWith(w)).slice(0, 10).map((f) => ({ insert: `${last.startsWith("-") ? "-" : ""}${f.key}:`, label: `${f.key}:`, hint: f.hint }));
}
export function applySuggestion(input: string, insert: string) {
  const parts = input.split(/(\s+)/);
  parts[parts.length - 1] = insert;
  return parts.join("");
}

// ---------------------------------------------------------------- user journey

export type JourneyItem = { at: string; kind: "ticket" | "message" | "mention" | "note" | "csat"; title: string; body?: string; channel?: string; ticketId?: string; direction?: string };
/** Journey items inside the last `days` (0 = all time), sorted ascending or descending. */
export function journeyWindow(items: JourneyItem[], days: number, order: "asc" | "desc", now = Date.now()) {
  const from = days > 0 ? now - days * 86_400_000 : -Infinity;
  return items.filter((i) => new Date(i.at).getTime() >= from).sort((a, b) => (order === "asc" ? a.at.localeCompare(b.at) : b.at.localeCompare(a.at)));
}

// ---------------------------------------------------------------- export helpers

/** Duration as HH:MM:SS (hours may exceed 24); "" when unknown. */
export function hms(ms: number | null | undefined) {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return "";
  const s = Math.round(ms / 1000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(Math.floor(s / 3600))}:${p(Math.floor((s % 3600) / 60))}:${p(s % 60)}`;
}
/** Plain-text conversation history (public messages, private notes and activity). */
export function transcriptText(t: { number: number; subject: string; channel: string; contact: string; status: string }, messages: { direction: string; author_name: string; body: string; created_at: string; attachments?: { name?: string }[] }[], events: { actor: string; detail: string; created_at: string }[] = []) {
  const lines = [`Ticket #${t.number}: ${t.subject}`, `Channel: ${t.channel} · Customer: ${t.contact} · Status: ${t.status}`, `Exported: ${new Date().toISOString()}`, "".padEnd(60, "=")];
  for (const m of messages) {
    const who = m.direction === "in" ? `${m.author_name || "Customer"} (customer)` : m.direction === "note" ? `${m.author_name} (private note)` : `${m.author_name} (agent)`;
    lines.push("", `[${m.created_at}] ${who}`, toPlainText(m.body));
    const a = (m.attachments ?? []).map((x) => x.name).filter(Boolean);
    if (a.length) lines.push(`Attachments: ${a.join(", ")}`);
  }
  if (events.length) {
    lines.push("", "".padEnd(60, "="), "Activity");
    for (const e of events) lines.push(`[${e.created_at}] ${e.actor} ${e.detail}`);
  }
  return lines.join("\n");
}
