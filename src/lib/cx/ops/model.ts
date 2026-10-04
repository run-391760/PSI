/**
 * CX operational modules (WP-B), pure and client-safe; fixture-tested in tests/cx-ops.test.ts.
 * Media types, post keys ("view all comments on this post"), profile groups, tasks, A/B winner rule,
 * Mentions Tracker matching, Compose capabilities, quick-search scoping, notification preferences.
 */

// ---------------------------------------------------------------- media types

export type MediaType = { id: string; label: string };
/** Media types in display order (Konnect-style channel sub-types). */
export const MEDIA_TYPES: MediaType[] = [
  { id: "email", label: "Email" },
  { id: "livechat", label: "Live Chat" },
  { id: "webform", label: "Web Form" },
  { id: "phone", label: "Phone" },
  { id: "whatsapp", label: "WhatsApp Messages" },
  { id: "facebook_messages", label: "Facebook Messages" },
  { id: "facebook_comments", label: "Facebook Comments" },
  { id: "facebook_posts", label: "Facebook Public Posts" },
  { id: "instagram_messages", label: "Instagram Messages" },
  { id: "instagram_comments", label: "Instagram Comments" },
  { id: "instagram_mentions", label: "Instagram Mentions" },
  { id: "instagram_tags", label: "Instagram Tags" },
  { id: "x", label: "Twitter Mentions" },
  { id: "linkedin", label: "LinkedIn" },
  { id: "youtube", label: "YouTube Comments" },
  { id: "news", label: "News" },
  { id: "forums", label: "Forums" },
  { id: "reddit", label: "Reddit Posts" },
  { id: "mastodon", label: "Mastodon Posts" },
  { id: "bluesky", label: "Bluesky Posts" },
  { id: "app_reviews", label: "App Reviews" },
  { id: "google_reviews", label: "Google Reviews" },
  { id: "telegram", label: "Telegram Messages" },
  { id: "discord", label: "Discord Messages" },
  { id: "discourse", label: "Consumer Forums" },
  { id: "other", label: "Other" },
];
export const mediaLabel = (id: string | null | undefined) => MEDIA_TYPES.find((m) => m.id === id)?.label ?? (id ? id.replace(/_/g, " ") : "Other");

/** Media type of a ticket from its channel kind and public-thread key (mirrors MEDIA_SQL in ops/media.ts). */
export function mediaTypeOf(t: { channel_kind: string; external_thread_id?: string | null }): string {
  const k = t.channel_kind;
  const thread = (t.external_thread_id ?? "").split(":")[0];
  switch (k) {
    case "email": case "livechat": case "webform": case "phone": case "whatsapp": case "x": case "linkedin": case "youtube": case "news": case "reddit": case "mastodon": case "bluesky": case "telegram": case "discord": case "discourse":
      return k;
    case "facebook": return thread === "fbc" ? "facebook_comments" : thread === "fbp" ? "facebook_posts" : "facebook_messages";
    case "instagram": return thread === "igc" ? "instagram_comments" : thread === "igm" ? "instagram_mentions" : thread === "igt" ? "instagram_tags" : "instagram_messages";
    case "hackernews": return "forums";
    case "appstore": case "playstore": return "app_reviews";
    case "google-reviews": return "google_reviews";
    default: return "other";
  }
}

/** "INSTAGRAM MESSAGES ( PU IG )" style channel-profile badge text. */
export function profileBadge(mediaType: string, profileName: string | null | undefined) {
  const m = mediaLabel(mediaType).toUpperCase();
  return profileName ? `${m} ( ${profileName} )` : m;
}

/** Parse a comma-separated multi-select URL value into known media type ids. */
export function parseMediaParam(v: string | null | undefined): string[] {
  const ids = new Set(MEDIA_TYPES.map((m) => m.id));
  return [...new Set(String(v ?? "").split(",").map((x) => x.trim()).filter((x) => ids.has(x)))];
}

// ---------------------------------------------------------------- post keys ("view all comments on this post")

/** Canonical form of a post URL: lowercase host without www, no query (except identifying ones) or hash, no trailing slash. */
export function normalizePostUrl(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let u: URL;
  try { u = new URL(raw.trim()); } catch { return null; }
  if (!/^https?:$/.test(u.protocol)) return null;
  const host = u.hostname.toLowerCase().replace(/^(www|m|mobile|old)\./, "");
  const path = u.pathname.replace(/\/+$/, "");
  // Reddit: /r/<sub>/comments/<id>/<slug>/<commentId> → the post is /comments/<id>
  const rd = /^\/r\/[^/]+\/comments\/([a-z0-9]+)/i.exec(path);
  if (host.endsWith("reddit.com") && rd) return `reddit.com/comments/${rd[1].toLowerCase()}`;
  // Hacker News items and YouTube videos are identified by query parameters.
  if (host === "news.ycombinator.com" && u.searchParams.get("id")) return `news.ycombinator.com/item?id=${u.searchParams.get("id")}`;
  if ((host === "youtube.com") && u.searchParams.get("v")) return `youtube.com/watch?v=${u.searchParams.get("v")}`;
  if (host === "youtu.be" && path) return `youtube.com/watch?v=${path.slice(1)}`;
  // Instagram permalinks: /p/<code>/ or /reel/<code>/
  const ig = /^\/(p|reel|tv)\/([^/]+)/.exec(path);
  if (host === "instagram.com" && ig) return `instagram.com/p/${ig[2]}`;
  if (host === "facebook.com" && u.searchParams.get("story_fbid")) return `facebook.com/${u.searchParams.get("story_fbid")}`;
  return `${host}${path}`;
}

const URL_IN_TEXT = /https?:\/\/[^\s<>"')\]]+/g;
/**
 * Post key of a ticket: the public post its conversation belongs to, or null (email, chat, DMs…).
 * Sources, strongest first: listening mention URL → Meta thread keys that name the post (fbp, igm, igt) →
 * the post link appended to the first message of a social thread → Facebook comment ids "<post>_<comment>".
 */
export function postKeyOf(t: { externalThreadId?: string | null; mentionUrl?: string | null; firstBody?: string | null; channelKind?: string | null }): { key: string; url: string | null } | null {
  const mention = normalizePostUrl(t.mentionUrl);
  if (mention) return { key: `url:${mention}`, url: t.mentionUrl ?? null };
  const th = /^(fbc|fbp|igc|igm|igt):([^:]+)(?::(.*))?$/.exec(t.externalThreadId ?? "");
  const linkInBody = (t.firstBody ?? "").match(URL_IN_TEXT)?.map((x) => x.replace(/[.,;:!?]+$/, "")).find((x) => /facebook\.com|instagram\.com/.test(x)) ?? null;
  if (th) {
    const [, kind, id] = th;
    if (kind === "fbp") return { key: `fb:${id}`, url: `https://www.facebook.com/${id}` };
    if (kind === "igm" || kind === "igt") return { key: `ig:${id}`, url: linkInBody };
    if (linkInBody) {
      const fb = /facebook\.com\/(\d+_\d+|\d+)/.exec(linkInBody);
      if (fb) return { key: `fb:${fb[1]}`, url: linkInBody };
      const n = normalizePostUrl(linkInBody);
      if (n) return { key: `url:${n}`, url: linkInBody };
    }
    if (kind === "fbc" && /^\d+_\d+$/.test(id)) return { key: `fbc-post:${id.split("_")[0]}`, url: null };
    return null;
  }
  return null;
}

// ---------------------------------------------------------------- profile groups

export type ProfileGroupInput = { name: string; description?: string; channelIds: string[]; sources: string[]; isDefault?: boolean };
/** Validate and clean a profile group; known = channel ids of the brand, sources = listening sources allowed. */
export function cleanGroup(input: ProfileGroupInput, known: { channelIds: string[]; sources: readonly string[] }): { ok: true; value: Required<ProfileGroupInput> } | { ok: false; error: string } {
  const name = String(input.name ?? "").trim().replace(/\s+/g, " ").slice(0, 60);
  if (!name) return { ok: false, error: "Name the profile group." };
  const channelIds = [...new Set(input.channelIds ?? [])].filter((id) => known.channelIds.includes(id));
  const sources = [...new Set(input.sources ?? [])].filter((s) => known.sources.includes(s));
  if (!channelIds.length && !sources.length) return { ok: false, error: "Pick at least one profile or listening source." };
  return { ok: true, value: { name, description: String(input.description ?? "").trim().slice(0, 300), channelIds, sources, isDefault: !!input.isDefault } };
}

// ---------------------------------------------------------------- tasks

export const TASK_STATUSES = [
  { id: "open", label: "Open" },
  { id: "in_progress", label: "In progress" },
  { id: "waiting", label: "Waiting" },
  { id: "done", label: "Done" },
  { id: "cancelled", label: "Cancelled" },
] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number]["id"];
export const TASK_PRIORITIES = ["low", "normal", "high", "urgent"] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];
export const isTaskStatus = (s: unknown): s is TaskStatus => TASK_STATUSES.some((x) => x.id === s);
export const isTaskPriority = (s: unknown): s is TaskPriority => (TASK_PRIORITIES as readonly unknown[]).includes(s);
export const taskStatusLabel = (s: string) => TASK_STATUSES.find((x) => x.id === s)?.label ?? s;
export const TASK_DONE = new Set(["done", "cancelled"]);
export const REMIND_OPTIONS: [number, string][] = [[0, "At due time"], [15, "15 minutes before"], [60, "1 hour before"], [240, "4 hours before"], [1440, "1 day before"]];

export type DueState = "none" | "done" | "overdue" | "today" | "soon" | "later";
/** Due-date state for badges and the overdue filter (soon = within 24 h). */
export function taskDueState(t: { status: string; due_at: string | null }, now = Date.now()): DueState {
  if (TASK_DONE.has(t.status)) return "done";
  if (!t.due_at) return "none";
  const due = Date.parse(t.due_at);
  if (due < now) return "overdue";
  const end = new Date(now); end.setHours(23, 59, 59, 999);
  if (due <= end.getTime()) return "today";
  return due - now <= 86_400_000 ? "soon" : "later";
}
/** True when a task's reminder should fire now (not done, has a due date, not reminded yet, inside the window). */
export function taskReminderDue(t: { status: string; due_at: string | null; remind_minutes: number; reminded_at: string | null }, now = Date.now()) {
  if (TASK_DONE.has(t.status) || !t.due_at || t.reminded_at) return false;
  return now >= Date.parse(t.due_at) - Math.max(0, t.remind_minutes) * 60_000;
}
/** Validate task input; returns an error message or null. */
export function taskInputError(i: { title: string; status?: string; priority?: string; dueAt?: string | null; remindMinutes?: number }) {
  if (!String(i.title ?? "").trim()) return "Give the task a title.";
  if (i.status && !isTaskStatus(i.status)) return "Invalid status.";
  if (i.priority && !isTaskPriority(i.priority)) return "Invalid priority.";
  if (i.dueAt && !Number.isFinite(Date.parse(i.dueAt))) return "Pick a valid due date.";
  if (i.remindMinutes != null && (!Number.isFinite(i.remindMinutes) || i.remindMinutes < 0 || i.remindMinutes > 7 * 1440)) return "Invalid reminder.";
  return null;
}

// ---------------------------------------------------------------- A/B testing winner rule

/**
 * Winner rule for two variants published to the same channels at the same time (equal exposure):
 * both variants need `minClicks` tracked clicks, then a two-sided binomial z-test of the click split
 * against 50/50 must reach `confidence` (z ≥ 1.96 at 95%). Returns the leader even when not significant.
 */
export function abWinner(a: number, b: number, opts: { minClicks: number; confidence: number }) {
  const total = a + b;
  const leader: "a" | "b" | null = a === b ? null : a > b ? "a" : "b";
  const lift = Math.min(a, b) > 0 ? (Math.max(a, b) / Math.min(a, b) - 1) * 100 : null;
  const z = total > 0 ? Math.abs(a - b) / Math.sqrt(total) : 0;
  const zNeeded = zFor(opts.confidence);
  const enough = a >= opts.minClicks && b >= opts.minClicks;
  const significant = enough && z >= zNeeded && leader != null;
  const reason = total === 0 ? "No tracked clicks yet."
    : !enough ? `Waiting for at least ${opts.minClicks} clicks per variant (A ${a}, B ${b}).`
    : !leader ? "Both variants have the same number of clicks."
    : significant ? `Variant ${leader.toUpperCase()} wins with ${Math.round(opts.confidence * 100)}% confidence (z = ${z.toFixed(2)}).`
    : `Variant ${leader.toUpperCase()} leads, but the difference is not significant yet (z = ${z.toFixed(2)} < ${zNeeded.toFixed(2)}).`;
  return { winner: significant ? leader : null, leader, z, zNeeded, lift, enough, significant, reason, share: total ? a / total : null };
}
/** Two-sided z threshold for a confidence level (common levels exact, others approximated). */
export function zFor(confidence: number) {
  const table: [number, number][] = [[0.8, 1.2816], [0.9, 1.6449], [0.95, 1.96], [0.98, 2.3263], [0.99, 2.5758]];
  const hit = table.find(([c]) => Math.abs(c - confidence) < 1e-6);
  if (hit) return hit[1];
  // Acklam-style rational approximation of the normal quantile for p = 1 - (1-c)/2
  const p = 1 - (1 - Math.min(0.999, Math.max(0.5, confidence))) / 2;
  const t = Math.sqrt(-2 * Math.log(1 - p));
  return t - (2.515517 + 0.802853 * t + 0.010328 * t * t) / (1 + 1.432788 * t + 0.189269 * t * t + 0.001308 * t * t * t);
}

// ---------------------------------------------------------------- Mentions Tracker

export type Tracked = { id: string; kind: "handle" | "post"; platform: string; value: string; label: string };
/** Normalize a handle ("@Acme", "acme", "https://x.com/acme") to "acme". */
export function normHandle(v: string) {
  const s = String(v ?? "").trim();
  const fromUrl = /^https?:\/\/[^/]+\/@?([^/?#]+)/.exec(s);
  return (fromUrl ? fromUrl[1] : s).replace(/^@+/, "").toLowerCase();
}
/** Which tracked handles / posts a mention refers to (handle as "@handle" in the text, or links to a tracked post). */
export function trackerMatches(m: { title?: string | null; body?: string | null; url?: string | null }, tracked: Tracked[]) {
  const text = ` ${(m.title ?? "")} ${(m.body ?? "")} `.toLowerCase();
  const urls = [m.url ?? "", ...((`${m.title ?? ""} ${m.body ?? ""}`).match(URL_IN_TEXT) ?? [])].map(normalizePostUrl).filter(Boolean) as string[];
  return tracked.filter((t) => {
    if (t.kind === "handle") {
      const h = normHandle(t.value);
      if (!h) return false;
      const i = text.indexOf(`@${h}`);
      return i >= 0 && !/[a-z0-9_]/.test(text[i + 1 + h.length] ?? " ");
    }
    const p = normalizePostUrl(t.value);
    return !!p && urls.some((u) => u === p || u.startsWith(`${p}/`));
  });
}
export type ResponseState = "responded" | "pending" | "ignored" | "in_progress";
/** Response status of a tracked mention: ignored, responded (ticket replied / marked actioned without ticket), in progress (ticket open, no reply) or pending. */
export function responseState(m: { status: string; ticket_id?: string | null; ticket_first_response_at?: string | null; ticket_status?: string | null }): ResponseState {
  if (m.status === "ignored") return "ignored";
  if (m.ticket_id) return m.ticket_first_response_at ? "responded" : m.ticket_status && ["solved", "closed"].includes(m.ticket_status) ? "responded" : "in_progress";
  if (m.status === "actioned") return "responded";
  return "pending";
}

// ---------------------------------------------------------------- Compose capabilities

export type ComposeCap = { kind: string; canStart: boolean; how: string; needs?: string };
/** Whether an outbound (company-initiated) conversation can be started on a channel, per its public API rules. */
export const COMPOSE_CAPS: ComposeCap[] = [
  { kind: "email", canStart: true, how: "Sent from the connected mailbox over SMTP. Replies thread back into the ticket by its [#number] tag." },
  { kind: "whatsapp", canStart: false, how: "WhatsApp Business only lets a business start a conversation with a pre-approved message template; free text is allowed only within 24 h of the customer's last message.", needs: "An approved template in WhatsApp Manager (template sending is not set up here yet)." },
  { kind: "facebook", canStart: false, how: "Messenger only allows replies within 24 hours of the person's last message; a Page can't message people first.", needs: "The customer must message your Page first." },
  { kind: "instagram", canStart: false, how: "Instagram messaging only allows replies within 24 hours of the person's last message.", needs: "The customer must message your account first." },
  { kind: "x", canStart: false, how: "Direct messages need a paid X API tier and the recipient must accept DMs from you.", needs: "X API Basic tier or higher." },
  { kind: "livechat", canStart: false, how: "Live chat sessions are started by the visitor from the website widget." },
  { kind: "webform", canStart: false, how: "Web forms are inbound only; reply to form tickets by email." },
  { kind: "telegram", canStart: false, how: "Telegram bots can only message users who have started a chat with the bot." },
  { kind: "discord", canStart: false, how: "Bots reply in the channel or thread where the conversation started." },
  { kind: "discourse", canStart: false, how: "Post a new topic on the forum itself; replies to existing topics work from tickets." },
];
export const composeCap = (kind: string): ComposeCap => COMPOSE_CAPS.find((c) => c.kind === kind) ?? { kind, canStart: false, how: "This channel has no API for starting conversations from here." };

// ---------------------------------------------------------------- quick search

/** Free-text part and field terms of a quick-search query, split by entity relevance. */
export function searchScopes(terms: { field: string; value: string; neg: boolean }[]) {
  const contact = new Set(["name", "email", "phone"]);
  const mention = new Set(["sentiment", "topic", "lang"]);
  return {
    contacts: terms.filter((t) => contact.has(t.field)),
    mentions: terms.filter((t) => mention.has(t.field)),
    tasks: terms.filter((t) => ["status", "priority", "assignee", "ticket"].includes(t.field)),
  };
}

/** Short snippet of `text` around the first occurrence of `q` (case-insensitive). */
export function snippet(text: string, q: string, width = 140) {
  const s = (text ?? "").replace(/\s+/g, " ").trim();
  if (!q) return s.slice(0, width);
  const i = s.toLowerCase().indexOf(q.toLowerCase());
  if (i < 0) return s.slice(0, width);
  const start = Math.max(0, i - Math.floor((width - q.length) / 2));
  return `${start > 0 ? "…" : ""}${s.slice(start, start + width)}${start + width < s.length ? "…" : ""}`;
}

// ---------------------------------------------------------------- notification preferences (My Profile)

export type NotifyPrefs = { taskAssigned: boolean; taskDue: boolean; ticketAssigned: boolean; mentions: boolean; dailyDigest: boolean };
export const DEFAULT_NOTIFY: NotifyPrefs = { taskAssigned: true, taskDue: true, ticketAssigned: true, mentions: true, dailyDigest: false };
export function normNotify(v: Partial<NotifyPrefs> | null | undefined): NotifyPrefs {
  const p = { ...DEFAULT_NOTIFY, ...(v ?? {}) };
  return { taskAssigned: !!p.taskAssigned, taskDue: !!p.taskDue, ticketAssigned: !!p.ticketAssigned, mentions: !!p.mentions, dailyDigest: !!p.dailyDigest };
}

// ---------------------------------------------------------------- plan & usage

/** Last `n` calendar months as YYYY-MM (oldest first), filling counts from rows (missing months = 0). */
export function monthSeries(rows: { month: string; n: number }[], n = 6, now = new Date()) {
  const out: { month: string; n: number }[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    const key = d.toISOString().slice(0, 7);
    out.push({ month: key, n: rows.find((r) => r.month === key)?.n ?? 0 });
  }
  return out;
}
export function fmtBytes(n: number | null | undefined) {
  if (n == null || !Number.isFinite(n)) return "n/a";
  if (n < 1024) return `${n} B`;
  const u = ["KB", "MB", "GB", "TB"];
  let v = n / 1024, i = 0;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(v < 10 ? 1 : 0)} ${u[i]}`;
}

// ---------------------------------------------------------------- waiting time

/** "4m", "2h 05m", "3d 4h" from milliseconds. */
export function waitLabel(ms: number) {
  if (!Number.isFinite(ms) || ms < 0) return "n/a";
  const m = Math.floor(ms / 60_000);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${String(m % 60).padStart(2, "0")}m`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}
