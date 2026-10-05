/**
 * Konnect-style monitor streams (Tickets, Queued Tickets, All Messages, Bookmarks): pure, client-safe helpers
 * shared by the pages and the card / filter-panel components. Fixture-tested in tests/cx-k2.test.ts.
 *
 * - URL filter parsing (all stream filter state lives in the query string)
 * - dd/mm/yyyy date display and parsing for the date-range control
 * - text segments for card bodies (links, #hashtags, @handles) and the READ MORE clamp rule
 * - mapping of ticket / message / mention / bookmark rows to one card shape (`CardItem`)
 */
import { linkSegments, toPlainText } from "./model";
import { isPublicMedia, mediaNetwork, parseMediaParam } from "@/lib/cx/ops/model";

// ---------------------------------------------------------------- URL filters

export type SearchParams = Record<string, string | string[] | undefined>;
export const SORT_OPTIONS: [string, string][] = [["latest", "Date - Latest First"], ["oldest", "Date - Oldest First"]];
export const TICKET_SORT_OPTIONS: [string, string][] = [...SORT_OPTIONS, ["priority", "Priority, then latest"], ["sla", "SLA due - soonest first"], ["updated", "Last updated"]];

/** Filters shared by every stream page. Dates are ISO yyyy-mm-dd (the URL also accepts dd/mm/yyyy). */
export type StreamFilters = {
  q?: string; from?: string; to?: string; media: string[]; sort: "latest" | "oldest" | string;
  sentiment?: string; status?: string; assignee?: string; priority?: string; tag?: string; lang?: string; attach?: boolean; cls?: string;
  profile?: string; topic?: string; group?: string; direction?: string; kind?: string; page: number;
};
const SENTIMENTS = new Set(["positive", "neutral", "negative", "mixed"]);
const PRIORITIES = new Set(["urgent", "high", "normal", "low"]);
const DIRECTIONS = new Set(["in", "out", "note", "all"]);
const KINDS = new Set(["ticket", "message", "mention"]);

const str = (sp: SearchParams, k: string) => {
  const v = sp[k];
  const s = (Array.isArray(v) ? v[0] : v)?.trim();
  return s ? s.slice(0, 300) : undefined;
};

/** Parse a date written as yyyy-mm-dd or dd/mm/yyyy (also dd-mm-yyyy, dd.mm.yyyy) to yyyy-mm-dd, or undefined. */
export function parseDate(v: string | null | undefined): string | undefined {
  const s = (v ?? "").trim();
  let y: number, m: number, d: number;
  let r = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (r) [y, m, d] = [Number(r[1]), Number(r[2]), Number(r[3])];
  else if ((r = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(s))) [d, m, y] = [Number(r[1]), Number(r[2]), Number(r[3])];
  else return undefined;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return undefined;
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}
/** yyyy-mm-dd → dd/mm/yyyy (Konnect's date-range display). */
export function dmy(iso: string | null | undefined): string {
  const r = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? "");
  return r ? `${r[3]}/${r[2]}/${r[1]}` : "";
}
/** "29/09/2026 - 05/10/2026", "From 29/09/2026", "Until …" or "" when no range. */
export function rangeLabel(from?: string, to?: string) {
  if (from && to) return `${dmy(from)} - ${dmy(to)}`;
  if (from) return `From ${dmy(from)}`;
  if (to) return `Until ${dmy(to)}`;
  return "";
}

/** Date-range presets (local calendar days, inclusive). */
export const DATE_PRESETS: [string, string][] = [["today", "Today"], ["yesterday", "Yesterday"], ["7", "Last 7 days"], ["30", "Last 30 days"], ["90", "Last 90 days"], ["month", "This month"], ["lastmonth", "Last month"]];
const isoDay = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
export function presetRange(id: string, now = new Date()): { from: string; to: string } | null {
  const back = (n: number) => { const d = new Date(now); d.setDate(d.getDate() - n); return isoDay(d); };
  switch (id) {
    case "today": return { from: isoDay(now), to: isoDay(now) };
    case "yesterday": return { from: back(1), to: back(1) };
    case "7": return { from: back(6), to: isoDay(now) };
    case "30": return { from: back(29), to: isoDay(now) };
    case "90": return { from: back(89), to: isoDay(now) };
    case "month": return { from: isoDay(new Date(now.getFullYear(), now.getMonth(), 1)), to: isoDay(now) };
    case "lastmonth": return { from: isoDay(new Date(now.getFullYear(), now.getMonth() - 1, 1)), to: isoDay(new Date(now.getFullYear(), now.getMonth(), 0)) };
    default: return null;
  }
}
/** Which preset (if any) a from/to pair equals. */
export function matchPreset(from?: string, to?: string, now = new Date()) {
  if (!from && !to) return "";
  return DATE_PRESETS.find(([id]) => { const p = presetRange(id, now); return p?.from === from && p?.to === to; })?.[0] ?? "custom";
}

export function parseStreamFilters(sp: SearchParams): StreamFilters {
  let from = parseDate(str(sp, "from")), to = parseDate(str(sp, "to"));
  if (from && to && from > to) [from, to] = [to, from];
  const sort = str(sp, "sort") ?? "latest";
  const sentiment = str(sp, "sentiment")?.toLowerCase();
  const priority = str(sp, "priority")?.toLowerCase();
  const direction = str(sp, "direction")?.toLowerCase();
  const kind = str(sp, "kind")?.toLowerCase();
  return {
    q: str(sp, "q"), from, to, media: parseMediaParam(str(sp, "media")),
    sort: /^[a-z]{3,10}$/.test(sort) ? sort : "latest",
    sentiment: sentiment && SENTIMENTS.has(sentiment) ? sentiment : undefined,
    status: str(sp, "status")?.toLowerCase(),
    assignee: str(sp, "assignee"),
    priority: priority && PRIORITIES.has(priority) ? priority : undefined,
    tag: str(sp, "tag"),
    lang: /^[a-z]{2,3}$/i.test(str(sp, "lang") ?? "") ? str(sp, "lang")!.toLowerCase() : undefined,
    attach: str(sp, "attach") === "1",
    cls: str(sp, "cls"),
    profile: str(sp, "profile"), topic: str(sp, "topic"), group: str(sp, "group"),
    direction: direction && DIRECTIONS.has(direction) ? direction : undefined,
    kind: kind && KINDS.has(kind) ? kind : undefined,
    page: Math.min(10_000, Math.max(1, Math.floor(Number(str(sp, "page")) || 1))),
  };
}

/** Number of "More Filters" values in use (for the "More Filters (n)" label). */
export function moreFilterCount(f: Partial<StreamFilters>) {
  return [f.sentiment, f.status, f.assignee, f.priority, f.tag, f.lang, f.attach || undefined, f.cls, f.direction, f.kind].filter(Boolean).length;
}

/** Apply a patch to a query string: null/"" deletes, "page" resets unless patched. Returns "?a=b" (or "?" when empty). */
export function patchQuery(current: string, patch: Record<string, string | null | undefined>) {
  const p = new URLSearchParams(current);
  for (const [k, v] of Object.entries(patch)) if (v) p.set(k, v); else p.delete(k);
  if (!("page" in patch)) p.delete("page");
  return `?${p.toString()}`;
}

/** Toggle one id in a comma-separated multi-select value; returns the new value or null when empty. */
export function toggleListValue(current: string[], id: string) {
  const next = current.includes(id) ? current.filter((x) => x !== id) : [...current, id];
  return next.length ? next.join(",") : null;
}

// ---------------------------------------------------------------- card text

export type TextSegment = { kind: "text" | "link" | "hashtag" | "handle"; text: string; href?: string; tag?: string };
const TAG_RE = /(^|[^\p{L}\p{M}\p{N}_&/.])([#@])([\p{L}\p{M}\p{N}_]{1,80})/gu;

/** Split a card body into text, links, #hashtags and @handles (hashtags/handles are not matched inside links). */
export function richSegments(text: string): TextSegment[] {
  const out: TextSegment[] = [];
  for (const s of linkSegments(text ?? "")) {
    if (s.href) { out.push({ kind: "link", text: s.text, href: s.href }); continue; }
    let last = 0;
    for (const m of s.text.matchAll(TAG_RE)) {
      const start = (m.index ?? 0) + m[1].length;
      if (m[2] === "#" && /^\d+$/.test(m[3])) continue; // "#123" is a number (ticket ref), not a hashtag
      if (start > last) out.push({ kind: "text", text: s.text.slice(last, start) });
      out.push({ kind: m[2] === "#" ? "hashtag" : "handle", text: `${m[2]}${m[3]}`, tag: m[3] });
      last = start + 1 + m[3].length;
    }
    if (last < s.text.length) out.push({ kind: "text", text: s.text.slice(last) });
  }
  // merge adjacent text segments
  return out.reduce<TextSegment[]>((acc, s) => {
    const prev = acc[acc.length - 1];
    if (prev && prev.kind === "text" && s.kind === "text") prev.text += s.text;
    else acc.push({ ...s });
    return acc;
  }, []);
}

/** Whether a card body is long enough to clamp behind READ MORE (more than `lines` lines or ~`chars` characters). */
export function needsClamp(text: string, opts: { lines?: number; chars?: number; media?: number } = {}) {
  const lines = opts.lines ?? 3, chars = opts.chars ?? 280;
  const t = (text ?? "").trim();
  if (!t) return false;
  return t.split(/\n/).length > lines || t.length > chars;
}

// ---------------------------------------------------------------- cards

export type CardMedia = { url: string; type: string; name?: string };
export type CardItem = {
  key: string;
  kind: "ticket" | "message" | "mention";
  ticketId: string | null; number: number | null; messageId: string | null; mentionId: string | null; bookmarkId: string | null;
  author: string; handle: string | null; network: string; at: string | null;
  body: string; media: CardMedia[];
  first: { body: string; at: string | null; media: CardMedia[] } | null;
  mediaType: string; profile: string | null; profileKey: string; isPublic: boolean; direction: "in" | "out" | "note" | null;
  status: string | null; priority: string | null; sentiment: string | null; messages: number;
  assigneeId: string | null; assigneeName: string | null; bookmarked: boolean; note: string | null;
  url: string | null; postKey: string | null; related: number; realtime: boolean; parentId: string | null; tasksOpen: number;
  sla: { status: string; first_response_due: string | null; resolution_due: string | null; first_response_at: string | null; resolved_at: string | null } | null;
  queued: { assigned: boolean; position: number | null } | null;
  mentionStatus: string | null;
};

type Att = { url?: string | null; type?: string | null; name?: string | null };
/** Image/video thumbnails from message attachments (only items with a URL). */
export function cardMedia(list: Att[] | null | undefined): CardMedia[] {
  return (Array.isArray(list) ? list : []).filter((a) => a && typeof a.url === "string" && a.url).slice(0, 6)
    .map((a) => ({ url: a.url as string, type: String(a.type ?? "file").toLowerCase(), name: a.name ?? undefined }));
}
export const isImage = (m: CardMedia) => /^image|^photo|^carousel/.test(m.type) || /\.(png|jpe?g|gif|webp|avif)(\?|$)/i.test(m.url);
export const isVideo = (m: CardMedia) => /^video|^reel/.test(m.type) || /\.(mp4|mov|webm)(\?|$)/i.test(m.url);

/** Arrives by webhook / live widget rather than by a polling fetch. */
const REALTIME = new Set(["livechat", "webform", "whatsapp", "facebook_messages", "facebook_comments", "facebook_posts", "facebook_tags", "facebook_reviews", "instagram_messages", "instagram_comments", "instagram_mentions", "telegram", "discord"]);
export const isRealtime = (mediaType: string) => REALTIME.has(mediaType);

const handleOf = (h: string | null | undefined, email?: string | null) => {
  const s = (h ?? "").trim();
  if (s) return s.startsWith("@") || /^www\./i.test(s) ? s : s.length < 32 && !/\s/.test(s) && !/^\d{6,}$/.test(s) ? `@${s}` : null;
  return email ?? null;
};
const plain = (b: string | null | undefined) => (b ? toPlainText(b).trim() : "");
/** The post link a public thread's first message ends with ("Comment on your Page post: https://…"), if any. */
export function threadLink(body: string | null | undefined): string | null {
  const m = /:\s(https?:\/\/\S+)\s*$/.exec((body ?? "").trim());
  return m ? m[1] : null;
}
/** Remove the "<thread label>: <link>" footer that social threads append to the first message. */
const stripThreadFooter = (b: string) => b.replace(/\n\n[^\n]{3,80}:\s+https?:\/\/\S+\s*$/, "").trim();

export type TicketCardRow = {
  id: string; number: number; subject: string; status: string; priority: string; channel_kind: string; channel_id: string | null; channel_name: string | null;
  contact_name: string | null; contact_email: string | null; contact_handle: string | null; assignee_id: string | null; assignee_name: string | null;
  sentiment: string | null; last_body: string | null; last_direction: string | null; last_at: string | null; updated_at: string; messages: number;
  crm_status: string; media_type: string; first_body: string | null; first_at: string | null; post_key: string | null; post_url: string | null; post_tickets: number;
  bookmarked: boolean; tasks_open: number; parent_id: string | null; children: number;
  first_response_due: string | null; resolution_due: string | null; first_response_at: string | null; resolved_at: string | null;
  last_attachments?: Att[] | null; first_attachments?: Att[] | null; mention_url?: string | null;
};

export function ticketCard(t: TicketCardRow, extra: { queued?: CardItem["queued"]; bookmarkId?: string | null; note?: string | null } = {}): CardItem {
  const latest = stripThreadFooter(plain(t.last_body));
  const firstText = stripThreadFooter(plain(t.first_body));
  const lastMedia = cardMedia(t.last_attachments), firstMedia = cardMedia(t.first_attachments);
  const sameAsFirst = t.messages <= 1 || (t.first_at != null && t.first_at === t.last_at) || (!firstText && !firstMedia.length);
  return {
    key: `t:${t.id}`, kind: "ticket", ticketId: t.id, number: t.number, messageId: null, mentionId: null, bookmarkId: extra.bookmarkId ?? null,
    author: t.contact_name || t.contact_email || "Unknown", handle: handleOf(t.contact_handle, t.contact_name ? t.contact_email : null), network: mediaNetwork(t.media_type) === "other" ? t.channel_kind : mediaNetwork(t.media_type),
    at: t.last_at ?? t.updated_at, body: latest || (lastMedia.length ? "" : t.subject), media: lastMedia,
    first: sameAsFirst ? null : { body: firstText, at: t.first_at, media: firstMedia },
    mediaType: t.media_type, profile: t.channel_name, profileKey: profileKeyOf(t.channel_id, null, t.channel_kind), isPublic: isPublicMedia(t.media_type), direction: (t.last_direction as CardItem["direction"]) ?? null,
    status: t.crm_status, priority: t.priority, sentiment: t.sentiment, messages: t.messages,
    assigneeId: t.assignee_id, assigneeName: t.assignee_name, bookmarked: t.bookmarked, note: extra.note ?? null,
    url: t.mention_url ?? t.post_url ?? threadLink(t.first_body), postKey: t.post_key, related: Math.max(0, (t.post_tickets ?? 0) - 1) + (t.children ?? 0),
    realtime: isRealtime(t.media_type), parentId: t.parent_id, tasksOpen: t.tasks_open,
    sla: { status: t.status, first_response_due: t.first_response_due, resolution_due: t.resolution_due, first_response_at: t.first_response_at, resolved_at: t.resolved_at },
    queued: extra.queued ?? null, mentionStatus: null,
  };
}

export type MessageCardRow = {
  id: string; ticket_id: string; number: number; subject: string; direction: "in" | "out" | "note"; author_name: string; body: string; attachments: Att[] | null; created_at: string;
  channel_kind: string; channel_id: string | null; channel_name: string | null; topic_id?: string | null; topic_name?: string | null; media_type: string; contact_handle: string | null; crm_status: string; sentiment: string | null; bookmarked: boolean;
  first_body: string | null; first_at: string | null; first_id: string | null; first_attachments?: Att[] | null; messages: number; url?: string | null; assignee_id?: string | null; assignee_name?: string | null; priority?: string | null;
};
export function messageCard(m: MessageCardRow, extra: { bookmarkId?: string | null; note?: string | null } = {}): CardItem {
  const body = stripThreadFooter(plain(m.body));
  const isFirst = !m.first_id || m.first_id === m.id;
  return {
    key: `m:${m.id}`, kind: "message", ticketId: m.ticket_id, number: m.number, messageId: m.id, mentionId: null, bookmarkId: extra.bookmarkId ?? null,
    author: m.author_name || "Unknown", handle: m.direction === "in" ? handleOf(m.contact_handle) : null, network: mediaNetwork(m.media_type) === "other" ? m.channel_kind : mediaNetwork(m.media_type),
    at: m.created_at, body, media: cardMedia(m.attachments),
    first: isFirst ? null : { body: stripThreadFooter(plain(m.first_body)), at: m.first_at, media: cardMedia(m.first_attachments) },
    mediaType: m.media_type, profile: m.channel_name ?? m.topic_name ?? null, profileKey: profileKeyOf(m.channel_id, m.topic_id ?? null, m.channel_kind), isPublic: isPublicMedia(m.media_type), direction: m.direction,
    status: m.crm_status, priority: m.priority ?? null, sentiment: m.sentiment, messages: m.messages,
    assigneeId: m.assignee_id ?? null, assigneeName: m.assignee_name ?? null, bookmarked: m.bookmarked, note: extra.note ?? null,
    url: m.url ?? threadLink(m.first_body), postKey: null, related: 0, realtime: isRealtime(m.media_type), parentId: null, tasksOpen: 0, sla: null, queued: null, mentionStatus: null,
  };
}

/** Sources whose "handle" is a site / domain rather than an @account. */
const WEB_SOURCES = new Set(["news", "blogs", "blog", "rss", "web", "hackernews", "appstore", "playstore"]);
export type MentionCardRow = {
  id: string; source: string; url: string | null; author: string; author_handle: string | null; title: string; body: string; published_at: string | null; fetched_at: string;
  sentiment: string | null; status: string; topic_id: string | null; topic_name: string | null; ticket_id: string | null; media_type: string;
  media?: Att[] | null;
};
export function mentionCard(m: MentionCardRow): CardItem {
  const title = (m.title ?? "").trim(), text = (m.body ?? "").trim();
  const body = !title ? text : !text || title.startsWith(text) ? title : text.startsWith(title) ? text : `${title}\n\n${text}`;
  return {
    key: `n:${m.id}`, kind: "mention", ticketId: m.ticket_id, number: null, messageId: null, mentionId: m.id, bookmarkId: null,
    author: m.author || "Unknown", handle: WEB_SOURCES.has(m.source) ? m.author_handle || null : handleOf(m.author_handle), network: mediaNetwork(m.media_type) === "other" ? m.source : mediaNetwork(m.media_type),
    at: m.published_at ?? m.fetched_at, body, media: cardMedia(m.media), first: null,
    mediaType: m.media_type, profile: m.topic_name, profileKey: profileKeyOf(null, m.topic_id, m.source), isPublic: true, direction: "in",
    status: null, priority: null, sentiment: m.sentiment, messages: 1, assigneeId: null, assigneeName: null, bookmarked: false, note: null,
    url: m.url, postKey: null, related: 0, realtime: false, parentId: null, tasksOpen: 0, sla: null, queued: null, mentionStatus: m.status,
  };
}

// ---------------------------------------------------------------- PROFILE counter keys

/** PROFILE counter key: a connected profile ("ch:<id>"), a listening topic ("topic:<id>") or a bare channel kind / source ("kind:<kind>"). */
export function profileKeyOf(channelId: string | null | undefined, topicId: string | null | undefined, kind: string) {
  return channelId ? `ch:${channelId}` : topicId ? `topic:${topicId}` : `kind:${kind}`;
}
/** URL patch selecting one PROFILE row (profile= channel id, topic= topic id, channel= kind); null values clear the others. */
export function profilePatch(key: string): Record<string, string | null> {
  const [k, ...rest] = key.split(":");
  const v = rest.join(":");
  return { profile: k === "ch" ? v : null, topic: k === "topic" ? v : null, channel: k === "kind" ? v : null };
}
/** The PROFILE key currently selected by the URL (profile → topic → channel). */
export function selectedProfileKey(f: { profile?: string; topic?: string; channel?: string }) {
  return f.profile ? `ch:${f.profile}` : f.topic ? `topic:${f.topic}` : f.channel ? `kind:${f.channel}` : null;
}

export type Facets = { media: { id: string; n: number }[]; profiles: { key: string; name: string; network: string; n: number }[]; total: number };
/** MEDIA TYPE and PROFILE counters of a card list (used where the list is already in memory: bookmarks, queue). */
export function cardFacets(cards: CardItem[]): Facets {
  const media = new Map<string, number>();
  const profiles = new Map<string, { key: string; name: string; network: string; n: number }>();
  for (const c of cards) {
    media.set(c.mediaType, (media.get(c.mediaType) ?? 0) + 1);
    const p = profiles.get(c.profileKey) ?? { key: c.profileKey, name: c.profile ?? c.profileKey.replace(/^kind:/, ""), network: c.profileKey.startsWith("topic:") ? "topic" : c.network, n: 0 };
    p.n++;
    profiles.set(c.profileKey, p);
  }
  const byN = <T extends { n: number }>(a: T, b: T) => b.n - a.n;
  return { media: [...media].map(([id, n]) => ({ id, n })).sort(byN), profiles: [...profiles.values()].sort((a, b) => byN(a, b) || a.name.localeCompare(b.name)), total: cards.length };
}

/** Filter an in-memory card list by the stream filters (media, profile, dates, text, sentiment, assignee). */
export function filterCards(cards: CardItem[], f: Partial<StreamFilters> & { channel?: string }, opts: { skip?: ("media" | "profile")[] } = {}) {
  const skip = new Set(opts.skip ?? []);
  const key = selectedProfileKey(f);
  const q = f.q?.trim().toLowerCase();
  return cards.filter((c) => {
    if (!skip.has("media") && f.media?.length && !f.media.includes(c.mediaType)) return false;
    if (!skip.has("profile") && key && c.profileKey !== key) return false;
    const day = (c.at ?? "").slice(0, 10);
    if (f.from && day < f.from) return false;
    if (f.to && day > f.to) return false;
    if (f.sentiment && c.sentiment !== f.sentiment) return false;
    if (f.assignee && (f.assignee === "none" ? c.assigneeId : c.assigneeId !== f.assignee)) return false;
    if (f.kind && c.kind !== f.kind) return false;
    if (q && ![c.body, c.author, c.handle ?? "", c.first?.body ?? "", c.note ?? "", c.number != null ? `#${c.number}` : ""].some((x) => x.toLowerCase().includes(q))) return false;
    return true;
  });
}
/** Sort cards by time ("latest" default, "oldest"). */
export function sortCards(cards: CardItem[], sort?: string) {
  const dir = sort === "oldest" ? 1 : -1;
  return [...cards].sort((a, b) => dir * (a.at ?? "").localeCompare(b.at ?? ""));
}

/** One Ticket View URL (stable: WP-K4's drill-down drawer links here). */
export const ticketHref = (brand: string, ticketId: string, extra?: Record<string, string>) =>
  `/cx/ticket/${encodeURIComponent(ticketId)}?brand=${encodeURIComponent(brand)}${extra ? Object.entries(extra).map(([k, v]) => `&${k}=${encodeURIComponent(v)}`).join("") : ""}`;

// ---------------------------------------------------------------- TICKET STATUS buckets

/** Konnect's TICKET STATUS rows as buckets of our CRM statuses (each row filters `?status=<list>&view=all`). */
export const STATUS_BUCKETS: { id: string; label: string; statuses: string[]; always?: boolean }[] = [
  { id: "opened", label: "Opened", statuses: ["new", "open", "reopened"], always: true },
  { id: "assigned", label: "Assigned", statuses: ["assigned", "wip"], always: true },
  { id: "responded", label: "Responded", statuses: ["responded"], always: true },
  { id: "pending", label: "Pending", statuses: ["pending", "on_hold", "follow_up"] },
  { id: "resolved", label: "Resolved", statuses: ["solved"] },
  { id: "closed", label: "Closed", statuses: ["closed", "ignored"], always: true },
];
/** Bucket rows with counts from a per-status map; optional buckets only appear when they have tickets. */
export function statusBuckets(crm: Record<string, number>) {
  return STATUS_BUCKETS.map((b) => ({ ...b, value: b.statuses.join(","), n: b.statuses.reduce((a, s) => a + (crm[s] ?? 0), 0) })).filter((b) => b.always || b.n > 0);
}
/** Whether a `?status=` value equals a bucket (order-insensitive). */
export const sameStatusList = (a: string | undefined, b: string) => !!a && a.split(",").sort().join(",") === b.split(",").sort().join(",");
