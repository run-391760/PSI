/**
 * Pure (client-safe) publishing logic: channel limits, text rendering, UTM builder, short codes,
 * scheduler due logic and bulk CSV parsing. Unit-tested in tests/cx-publishing.test.ts.
 */

export type PubChannel = "facebook" | "instagram" | "linkedin" | "x" | "youtube" | "threads" | "gbp";
export type PostStatus = "draft" | "pending" | "approved" | "scheduled" | "published" | "failed";
export type ChannelResult = {
  status: "published" | "failed" | "not_connected" | "manual" | "deleted";
  externalId?: string;
  url?: string;
  error?: string;
  at: string;
};

export const PUB_CHANNELS: { kind: PubChannel; name: string; limit: number; firstComment: boolean; needsMedia: boolean; publishApi: boolean; note?: string }[] = [
  { kind: "facebook", name: "Facebook Page", limit: 63206, firstComment: true, needsMedia: false, publishApi: true },
  { kind: "instagram", name: "Instagram", limit: 2200, firstComment: true, needsMedia: true, publishApi: true, note: "Needs an image or video; max 30 hashtags." },
  { kind: "linkedin", name: "LinkedIn", limit: 3000, firstComment: true, needsMedia: false, publishApi: true },
  { kind: "x", name: "X", limit: 280, firstComment: true, needsMedia: false, publishApi: true, note: "Links count as 23 characters. First comment is posted as a reply." },
  { kind: "youtube", name: "YouTube", limit: 1500, firstComment: false, needsMedia: false, publishApi: false, note: "Community posts have no public API: publish manually, then mark it published. Videos upload automatically when an upload token is linked." },
  { kind: "threads", name: "Threads", limit: 500, firstComment: false, needsMedia: false, publishApi: true },
  { kind: "gbp", name: "Google Business Profile", limit: 1500, firstComment: false, needsMedia: false, publishApi: true, note: "Local posts: updates, offers and events on your Business Profile." },
];
export const pubChannel = (k: string) => PUB_CHANNELS.find((c) => c.kind === k);
export const isPubChannel = (k: string): k is PubChannel => PUB_CHANNELS.some((c) => c.kind === k);

export const STATUS_LABEL: Record<PostStatus, string> = {
  draft: "Draft",
  pending: "Pending approval",
  approved: "Approved",
  scheduled: "Scheduled",
  published: "Published",
  failed: "Failed",
};
export const STATUS_TONE: Record<PostStatus, "neutral" | "info" | "brand" | "good" | "warning" | "critical"> = {
  draft: "neutral",
  pending: "warning",
  approved: "info",
  scheduled: "brand",
  published: "good",
  failed: "critical",
};

// ------------------------------------------------------------------ text

const URL_RE = /https?:\/\/[^\s]+/g;

/** Channel text: the channel variant (if any) or the base text, with {link} replaced by the channel's short URL. */
export function renderText(body: string, variants: Partial<Record<string, string>>, kind: string, linkFor?: (kind: string) => string | null) {
  const raw = variants[kind]?.trim() ? variants[kind]! : body;
  const link = linkFor?.(kind) ?? null;
  return link ? raw.replaceAll("{link}", link) : raw.replaceAll("{link}", "").replace(/[ \t]+\n/g, "\n").trim();
}

/** Characters as counted by the network (X counts every URL as 23; everything counts code points). */
export function countChars(text: string, kind: string) {
  if (kind === "x") {
    const urls = text.match(URL_RE) ?? [];
    const rest = text.replace(URL_RE, "");
    return [...rest].length + urls.length * 23;
  }
  return [...text].length;
}

export function hashtagCount(text: string) {
  return (text.match(/(^|\s)#[\p{L}\p{N}_]+/gu) ?? []).length;
}

/** Validation problems of a post for one channel (empty = OK). */
export function channelProblems(text: string, kind: string, mediaCount: number): string[] {
  const c = pubChannel(kind);
  if (!c) return ["Unknown channel."];
  const out: string[] = [];
  const n = countChars(text, kind);
  if (!text.trim() && !mediaCount) out.push("Text is empty.");
  if (n > c.limit) out.push(`${n - c.limit} characters over the ${c.limit.toLocaleString("en-US")} limit.`);
  if (c.needsMedia && mediaCount === 0) out.push("Instagram needs an image or video.");
  if (kind === "instagram" && hashtagCount(text) > 30) out.push("Instagram allows at most 30 hashtags.");
  return out;
}

// ------------------------------------------------------------------ UTM + short links

export type Utm = { source?: string; medium?: string; campaign?: string; term?: string; content?: string };

/** Adds utm_* parameters (existing params are kept, blank values skipped, existing utm_* overwritten). */
export function buildUtmUrl(url: string, utm: Utm): string {
  let u: URL;
  try {
    u = new URL(url.trim());
  } catch {
    throw new Error("Enter a full URL starting with http:// or https://");
  }
  if (!/^https?:$/.test(u.protocol)) throw new Error("Only http(s) links can be shortened.");
  for (const k of ["source", "medium", "campaign", "term", "content"] as const) {
    const v = utm[k]?.trim();
    if (v) u.searchParams.set(`utm_${k}`, v);
  }
  return u.toString();
}

export const slugify = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);

const ALPHABET = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
/** Short code from random bytes (7 chars ≈ 41 bits); pass bytes for determinism in tests. */
export function shortCode(bytes: Uint8Array = globalThis.crypto.getRandomValues(new Uint8Array(7))) {
  return [...bytes].map((b) => ALPHABET[b % ALPHABET.length]).join("");
}
export const isShortCode = (s: string) => /^[A-Za-z0-9]{4,16}$/.test(s);

/** Device class from a user agent (clicks store only this, never the UA). */
export function deviceOf(ua: string | null | undefined): "bot" | "mobile" | "tablet" | "desktop" | "unknown" {
  const s = (ua ?? "").toLowerCase();
  if (!s) return "unknown";
  if (/bot|crawl|spider|slurp|facebookexternalhit|preview|fetch|curl|wget|python|headless|monitor/.test(s)) return "bot";
  if (/ipad|tablet/.test(s)) return "tablet";
  if (/mobi|iphone|android/.test(s)) return "mobile";
  return "desktop";
}
export function referrerHost(ref: string | null | undefined) {
  if (!ref) return null;
  try {
    return new URL(ref).hostname.replace(/^www\./, "") || null;
  } catch {
    return null;
  }
}

// ------------------------------------------------------------------ scheduling

/** A post is due when it is scheduled and its time has come (with no channel already published). */
export function isDue(post: { status: string; scheduled_at: string | Date | null }, now: Date = new Date()) {
  if (post.status !== "scheduled" || !post.scheduled_at) return false;
  return new Date(post.scheduled_at).getTime() <= now.getTime();
}

/** Final post status from per-channel results. */
export function outcomeStatus(results: Record<string, ChannelResult>): PostStatus {
  const v = Object.values(results);
  if (v.length && v.every((r) => r.status === "published" || r.status === "manual")) return "published";
  if (v.some((r) => r.status === "published") && !v.some((r) => r.status === "failed")) return "published";
  return "failed";
}

/** Which status a post goes to when the author schedules it. */
export function scheduleTarget(status: PostStatus, requireApproval: boolean): PostStatus | { error: string } {
  if (status === "published") return { error: "The post is already published." };
  if (requireApproval && !["approved", "scheduled", "failed"].includes(status))
    return { error: "This brand requires approval: submit the post for approval first." };
  return "scheduled";
}

// ------------------------------------------------------------------ CSV bulk scheduling

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(cell);
      cell = "";
    }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      if (row.some((c) => c.trim())) rows.push(row);
      row = [];
      cell = "";
    } else cell += ch;
  }
  row.push(cell);
  if (row.some((c) => c.trim())) rows.push(row);
  return rows;
}

export type BulkRow = { line: number; at: string; channels: PubChannel[]; text: string; link: string | null; campaign: string | null; firstComment: string; media: string[]; postType: string; tags: string[]; pollOptions: string[] };

/** Excel stores dates/times as serial numbers (days since 1899-12-30); converts "46300.5" → "2026-10-05 12:00". */
export function excelSerial(v: string): { date: string; time: string } | null {
  if (!/^\d+(\.\d+)?$/.test(v.trim())) return null;
  const n = Number(v);
  const ms = Math.round(n * 86_400_000) + Date.UTC(1899, 11, 30);
  const d = new Date(ms);
  const p = (x: number) => String(x).padStart(2, "0");
  return { date: n >= 1 ? `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}` : "", time: `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}` };
}

/**
 * CSV columns (header row, any order): date, time (or datetime), channels ("x|facebook" or "x;facebook"),
 * text, link, campaign, first_comment, media (asset file names, "|"-separated).
 * Times are local to `tzOffsetMinutes` (Date#getTimezoneOffset of the uploader's browser).
 */
export function parseBulkCsv(text: string, tzOffsetMinutes: number, now: Date = new Date()): { rows: BulkRow[]; errors: { line: number; error: string }[] } {
  return parseBulkTable(parseCsv(text.replace(/^\uFEFF/, "")), tzOffsetMinutes, now);
}

const POST_TYPE_NAMES = ["text", "story", "reel", "poll", "document", "event"];

/** Bulk rows from a parsed table (CSV or the first sheet of an .xlsx). Excel date/time serials are accepted. */
export function parseBulkTable(table: string[][], tzOffsetMinutes: number, now: Date = new Date()): { rows: BulkRow[]; errors: { line: number; error: string }[] } {
  const errors: { line: number; error: string }[] = [];
  const rows: BulkRow[] = [];
  if (table.length < 2) return { rows, errors: [{ line: 1, error: "Add a header row and at least one post." }] };
  const header = table[0].map((h) => h.trim().toLowerCase().replace(/[\s-]+/g, "_"));
  const col = (r: string[], ...names: string[]) => {
    for (const n of names) {
      const i = header.indexOf(n);
      if (i >= 0) return (r[i] ?? "").trim();
    }
    return "";
  };
  table.slice(1).forEach((r, idx) => {
    const line = idx + 2;
    const serialDt = excelSerial(col(r, "datetime", "date_time", "scheduled_at"));
    const date = excelSerial(col(r, "date"))?.date || col(r, "date");
    const time = excelSerial(col(r, "time"))?.time || col(r, "time") || "09:00";
    const dt = serialDt ? `${serialDt.date} ${serialDt.time}` : col(r, "datetime", "date_time", "scheduled_at") || `${date} ${time}`;
    const m = dt.trim().match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{1,2}):(\d{2})/);
    if (!m) return errors.push({ line, error: `Date "${dt.trim()}" is not YYYY-MM-DD HH:MM.` });
    const utc = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]) + tzOffsetMinutes * 60_000;
    if (Number.isNaN(utc)) return errors.push({ line, error: "Invalid date." });
    if (utc < now.getTime() - 60_000) return errors.push({ line, error: "Date is in the past." });
    const channelsRaw = col(r, "channels", "channel", "networks")
      .toLowerCase()
      .split(/[|;/\s]+/)
      .map((c) => (c === "twitter" ? "x" : c))
      .filter(Boolean);
    const bad = channelsRaw.filter((c) => !isPubChannel(c));
    if (!channelsRaw.length) return errors.push({ line, error: "No channels." });
    if (bad.length) return errors.push({ line, error: `Unknown channel ${bad.join(", ")}.` });
    const text = col(r, "text", "message", "caption");
    if (!text) return errors.push({ line, error: "Text is empty." });
    const postType = (col(r, "post_type", "type") || "text").toLowerCase();
    if (!POST_TYPE_NAMES.includes(postType)) return errors.push({ line, error: `Unknown post type "${postType}" (use ${POST_TYPE_NAMES.join(", ")}).` });
    const link = col(r, "link", "url") || null;
    if (link && !/^https?:\/\//i.test(link)) return errors.push({ line, error: "Link must start with http(s)://" });
    rows.push({
      line,
      at: new Date(utc).toISOString(),
      channels: [...new Set(channelsRaw)] as PubChannel[],
      text,
      link,
      campaign: col(r, "campaign") || null,
      firstComment: col(r, "first_comment", "comment"),
      media: col(r, "media", "assets").split("|").map((s) => s.trim()).filter(Boolean),
      postType,
      tags: col(r, "tags", "content_tags").split(/[|,]/).map((s) => s.trim().toLowerCase()).filter(Boolean),
      pollOptions: col(r, "poll_options", "options").split("|").map((s) => s.trim()).filter(Boolean),
    });
  });
  return { rows, errors };
}

export const BULK_COLUMNS = ["date", "time", "channels", "text", "link", "campaign", "first_comment", "media", "post_type", "tags", "poll_options"];
export const BULK_TEMPLATE = `date,time,channels,text,link,campaign,first_comment,media,post_type,tags,poll_options
2026-10-05,09:30,x|linkedin,"Our autumn guide is live: {link}",https://example.com/guide,Autumn launch,,,text,launch,
2026-10-06,18:00,facebook,"Behind the scenes of the launch 📸",,Autumn launch,"Tell us what you think!",,text,,
2026-10-07,12:00,x|linkedin,"Which feature should we ship next?",,Autumn launch,,,poll,,Dark mode|Exports
`;
