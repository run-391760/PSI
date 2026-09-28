/**
 * Pure (client-safe) WP4 publishing logic: post types, per-network options (adapter capabilities),
 * multi-approver state, content-tag permissions. Unit-tested in tests/cx-wp4.test.ts.
 */
import { PUB_CHANNELS, pubChannel, type PubChannel } from "./core";

// ================================================================= post types

export type PostType = "text" | "story" | "reel" | "poll" | "document" | "event";
export const POST_TYPES: { type: PostType; label: string; hint: string }[] = [
  { type: "text", label: "Text / image", hint: "A regular feed post with optional images or a video." },
  { type: "story", label: "Story", hint: "One image or video, shown for 24 hours." },
  { type: "reel", label: "Reel / short video", hint: "One vertical video (Reels, YouTube video upload)." },
  { type: "poll", label: "Poll", hint: "The text is the question; add 2–4 options." },
  { type: "document", label: "Document", hint: "A PDF carousel (LinkedIn)." },
  { type: "event", label: "Event / offer", hint: "A dated event or offer (Business Profile)." },
];
export const isPostType = (t: unknown): t is PostType => POST_TYPES.some((p) => p.type === t);
export const postTypeLabel = (t: string) => POST_TYPES.find((p) => p.type === t)?.label ?? t;

/** How a network handles a post type: sent through its API, supported only manually, or not at all. */
const TYPE_SUPPORT: Record<PostType, Partial<Record<PubChannel, "api" | "manual">>> = {
  text: { facebook: "api", instagram: "api", linkedin: "api", x: "api", youtube: "manual", threads: "api", gbp: "api" },
  story: { facebook: "api", instagram: "api" },
  reel: { facebook: "api", instagram: "api", youtube: "api", linkedin: "manual", threads: "api" },
  poll: { x: "api", threads: "api", linkedin: "api", youtube: "manual" },
  document: { linkedin: "api" },
  event: { gbp: "api", linkedin: "manual", facebook: "manual" },
};
export function typeSupport(type: string, kind: string): "api" | "manual" | "none" {
  return (isPostType(type) && TYPE_SUPPORT[type][kind as PubChannel]) || "none";
}
export const channelsForType = (type: string) => PUB_CHANNELS.filter((c) => typeSupport(type, c.kind) !== "none").map((c) => c.kind);

// ================================================================= per-network options

export type OptionKind = "text" | "select" | "bool" | "list" | "date" | "asset";
export type OptionField = {
  key: string;
  label: string;
  kind: OptionKind;
  /** true = the adapter sends it through the network API; false = kept with the post as a manual checklist item. */
  api: boolean;
  types?: PostType[];
  choices?: { value: string; label: string }[];
  hint?: string;
  placeholder?: string;
  max?: number;
};
const ch = (...v: [string, string][]) => v.map(([value, label]) => ({ value, label }));

/** Shared options (poll) apply to every channel that supports the post type. */
export const COMMON_OPTIONS: OptionField[] = [
  { key: "poll_options", label: "Poll options", kind: "list", api: true, types: ["poll"], max: 4, hint: "2–4 options, one per line (X: 25 characters, LinkedIn: 30).", placeholder: "Yes\nNo" },
  { key: "poll_hours", label: "Poll duration", kind: "select", api: true, types: ["poll"], choices: ch(["24", "1 day"], ["72", "3 days"], ["168", "7 days"], ["336", "14 days"]) },
];

export const NETWORK_OPTIONS: Record<PubChannel, OptionField[]> = {
  facebook: [
    { key: "target_countries", label: "Feed targeting: countries", kind: "list", api: true, types: ["text"], hint: "ISO codes, e.g. US, IN (one per line).", max: 25 },
    { key: "target_age_min", label: "Feed targeting: minimum age", kind: "select", api: true, types: ["text"], choices: ch(["", "Any"], ["13", "13+"], ["18", "18+"], ["21", "21+"], ["25", "25+"], ["35", "35+"], ["45", "45+"], ["65", "65+"]) },
    { key: "video_title", label: "Video title", kind: "text", api: true, types: ["text", "reel"] },
    { key: "collaborators", label: "Reel collaborators", kind: "list", api: false, types: ["reel"], hint: "Invite them in Meta Business Suite after publishing (not in the API)." },
  ],
  instagram: [
    { key: "collaborators", label: "Collaborators", kind: "list", api: true, types: ["text", "reel"], max: 3, hint: "Up to 3 Instagram usernames; they get an invite." },
    { key: "cover", label: "Reel cover image", kind: "asset", api: true, types: ["reel"] },
    { key: "share_to_feed", label: "Also show the reel in the feed", kind: "bool", api: true, types: ["reel"] },
    { key: "disable_comments", label: "Turn off comments", kind: "bool", api: true, types: ["text", "reel"] },
    { key: "copyright_checked", label: "Audio rights checked in the app", kind: "bool", api: false, types: ["reel"], hint: "Instagram's copyright pre-check runs in the app only." },
  ],
  linkedin: [
    { key: "target_geo", label: "Targeting: locations (geo URNs)", kind: "list", api: true, types: ["text", "document", "poll"], placeholder: "urn:li:geo:103644278" },
    { key: "target_seniorities", label: "Targeting: seniorities (URNs)", kind: "list", api: true, types: ["text", "document", "poll"], placeholder: "urn:li:seniority:5" },
    { key: "target_industries", label: "Targeting: industries (URNs)", kind: "list", api: true, types: ["text", "document", "poll"], placeholder: "urn:li:industry:4" },
    { key: "target_company_sizes", label: "Targeting: company sizes", kind: "list", api: true, types: ["text", "document", "poll"], placeholder: "SIZE_51_TO_200" },
    { key: "document_title", label: "Document title", kind: "text", api: true, types: ["document"] },
    { key: "disable_reshare", label: "Disable resharing", kind: "bool", api: true },
    { key: "disable_comments", label: "Turn off comments", kind: "bool", api: false, hint: "Turn comments off in the post menu after publishing." },
    { key: "mentions", label: "@mentions", kind: "list", api: false, hint: "Mention people or pages while reviewing in LinkedIn." },
    { key: "event_url", label: "LinkedIn event link", kind: "text", api: false, types: ["event"] },
  ],
  x: [
    { key: "reply_settings", label: "Who can reply", kind: "select", api: true, choices: ch(["", "Everyone"], ["following", "Accounts you follow"], ["mentionedUsers", "Only accounts you mention"], ["subscribers", "Subscribers"], ["verified", "Verified accounts"]) },
    { key: "super_followers", label: "Super Followers only", kind: "bool", api: false, hint: "Not available in the public API; set it in the X app." },
    { key: "tag_users", label: "Tag people in images", kind: "list", api: false },
  ],
  youtube: [
    { key: "title", label: "Video title", kind: "text", api: true, types: ["reel"], max: 100 },
    { key: "privacy", label: "Privacy", kind: "select", api: true, types: ["reel"], choices: ch(["public", "Public"], ["unlisted", "Unlisted"], ["private", "Private"]) },
    { key: "category", label: "Category", kind: "select", api: true, types: ["reel"], choices: ch(["22", "People & Blogs"], ["27", "Education"], ["28", "Science & Technology"], ["24", "Entertainment"], ["26", "Howto & Style"], ["25", "News & Politics"], ["17", "Sports"], ["10", "Music"]) },
    { key: "made_for_kids", label: "Made for kids", kind: "bool", api: true, types: ["reel"] },
  ],
  threads: [
    { key: "reply_control", label: "Who can reply", kind: "select", api: true, choices: ch(["", "Everyone"], ["accounts_you_follow", "Accounts you follow"], ["mentioned_only", "Mentioned only"]) },
    { key: "topic_tag", label: "Topic tag", kind: "text", api: true, max: 50 },
    { key: "ghost_post", label: "Ghost post (disappears after 24 h)", kind: "bool", api: true, types: ["text"] },
  ],
  gbp: [
    { key: "cta", label: "Button", kind: "select", api: true, choices: ch(["", "None"], ["LEARN_MORE", "Learn more"], ["BOOK", "Book"], ["ORDER", "Order online"], ["SHOP", "Buy"], ["SIGN_UP", "Sign up"], ["CALL", "Call now"]) },
    { key: "event_title", label: "Event / offer title", kind: "text", api: true, types: ["event"], max: 58 },
    { key: "start_date", label: "Start date", kind: "date", api: true, types: ["event"] },
    { key: "end_date", label: "End date", kind: "date", api: true, types: ["event"] },
    { key: "offer", label: "This is an offer", kind: "bool", api: true, types: ["event"] },
    { key: "coupon_code", label: "Voucher code", kind: "text", api: true, types: ["event"] },
    { key: "redeem_url", label: "Redeem online link", kind: "text", api: true, types: ["event"] },
    { key: "terms", label: "Terms and conditions", kind: "text", api: true, types: ["event"] },
  ],
};

export type PostOptions = { common?: Record<string, OptionValue> } & Partial<Record<PubChannel, Record<string, OptionValue>>>;
export type OptionValue = string | boolean | string[];

export const fieldsFor = (kind: PubChannel, type: string) => (NETWORK_OPTIONS[kind] ?? []).filter((f) => !f.types || f.types.includes(type as PostType));
export const commonFieldsFor = (type: string) => COMMON_OPTIONS.filter((f) => !f.types || f.types.includes(type as PostType));

const asList = (v: OptionValue | undefined) => (Array.isArray(v) ? v : typeof v === "string" ? v.split(/\n|,/) : []).map((s) => s.trim()).filter(Boolean);

/** Keeps only known fields of the chosen channels/type, normalized (lists trimmed and capped, bools strict, text capped). */
export function cleanOptions(raw: unknown, channels: string[], type: string): PostOptions {
  const src = (raw && typeof raw === "object" ? raw : {}) as Record<string, Record<string, unknown>>;
  const norm = (f: OptionField, v: unknown): OptionValue | undefined => {
    if (v == null || v === "") return undefined;
    if (f.kind === "bool") return v === true || v === "true" ? true : undefined;
    if (f.kind === "list") {
      const l = asList(v as OptionValue).map((s) => s.slice(0, 200));
      return l.length ? l.slice(0, f.max ?? 20) : undefined;
    }
    const s = String(v).trim().slice(0, f.max ?? 500);
    if (f.kind === "select" && !f.choices?.some((c) => c.value === s)) return undefined;
    if (f.kind === "date" && !/^\d{4}-\d{2}-\d{2}$/.test(s)) return undefined;
    return s || undefined;
  };
  const pick = (fields: OptionField[], obj: Record<string, unknown> | undefined) => {
    const out: Record<string, OptionValue> = {};
    for (const f of fields) {
      const v = norm(f, obj?.[f.key]);
      if (v !== undefined) out[f.key] = v;
    }
    return out;
  };
  const out: PostOptions = {};
  const common = pick(commonFieldsFor(type), src.common);
  if (Object.keys(common).length) out.common = common;
  for (const k of channels) {
    if (!(k in NETWORK_OPTIONS)) continue;
    const o = pick(fieldsFor(k as PubChannel, type), src[k]);
    if (Object.keys(o).length) out[k as PubChannel] = o;
  }
  return out;
}

/** Problems of the chosen post type + options on one channel (empty = OK). */
export function typeProblems(type: string, kind: string, opts: PostOptions, media: { kind: "image" | "video" | "document" }[]): string[] {
  const name = pubChannel(kind)?.name ?? kind;
  const s = typeSupport(type, kind);
  if (s === "none") return [`${name} does not support ${postTypeLabel(type).toLowerCase()} posts.`];
  const out: string[] = [];
  const o = opts[kind as PubChannel] ?? {};
  const videos = media.filter((m) => m.kind === "video").length;
  if (type === "story" && media.length !== 1) out.push(`${name} stories need exactly one image or video.`);
  if (type === "reel" && (videos !== 1 || media.length !== 1)) out.push(`${name} reels need exactly one video.`);
  if (type === "poll") {
    const opt = asList(opts.common?.poll_options);
    if (opt.length < 2 || opt.length > 4) out.push("Polls need 2–4 options.");
    const max = kind === "x" ? 25 : kind === "linkedin" ? 30 : 25;
    if (opt.some((x) => [...x].length > max)) out.push(`${name} poll options are limited to ${max} characters.`);
    if (media.length && kind === "x") out.push("X polls cannot include media.");
  }
  if (type === "document" && kind === "linkedin") {
    if (media.filter((m) => m.kind === "document").length !== 1) out.push("Attach exactly one PDF document.");
    if (!o.document_title) out.push("Give the LinkedIn document a title.");
  }
  if (type !== "document" && media.some((m) => m.kind === "document")) out.push("Documents can only be attached to document posts.");
  if (type === "event" && kind === "gbp") {
    if (!o.event_title) out.push("Business Profile events and offers need a title.");
    if (!o.start_date || !o.end_date) out.push("Business Profile events and offers need start and end dates.");
    else if (String(o.end_date) < String(o.start_date)) out.push("The end date is before the start date.");
  }
  if (kind === "instagram" && asList(o.collaborators).length > 3) out.push("Instagram allows at most 3 collaborators.");
  if (kind === "gbp" && o.redeem_url && !/^https?:\/\//.test(String(o.redeem_url))) out.push("The redeem link must start with http(s)://");
  return out;
}

/** Manual checklist lines: options that are kept with the post but not sent by the API, plus manual-only types. */
export function manualSteps(type: string, channels: string[], opts: PostOptions): string[] {
  const out: string[] = [];
  for (const k of channels) {
    const name = pubChannel(k)?.name ?? k;
    if (typeSupport(type, k) === "manual") out.push(`${name}: publish this ${postTypeLabel(type).toLowerCase()} manually, then mark it published.`);
    for (const f of fieldsFor(k as PubChannel, type)) {
      const v = opts[k as PubChannel]?.[f.key];
      if (!f.api && v != null && v !== false && !(Array.isArray(v) && !v.length)) out.push(`${name}: ${f.label}${v === true ? "" : ` — ${Array.isArray(v) ? v.join(", ") : v}`}`);
    }
  }
  return out;
}

// ================================================================= multi-approver workflow

export type Decision = { user_id: string; decision: "approved" | "rejected"; comment?: string; at?: string };

/**
 * Approval state for a post. With designated approvers every one of them must approve; without, the first
 * approval by anyone allowed to approve is enough. Any rejection sends the post back.
 */
export function approvalState(designated: string[], decisions: Decision[]) {
  const latest = new Map<string, Decision>();
  for (const d of decisions) latest.set(d.user_id, d);
  const rejected = [...latest.values()].filter((d) => d.decision === "rejected").map((d) => d.user_id);
  const approved = [...latest.values()].filter((d) => d.decision === "approved").map((d) => d.user_id);
  if (!designated.length) return { mode: "any" as const, approved, waiting: approved.length ? [] : ["*"], rejected, complete: approved.length > 0 && !rejected.length };
  const waiting = designated.filter((u) => !approved.includes(u));
  return { mode: "all" as const, approved: approved.filter((u) => designated.includes(u)), waiting, rejected, complete: !waiting.length && !rejected.length };
}

/** Whether a user may decide on a pending post. */
export function canDecide(userId: string, designated: string[], canApprove: boolean) {
  return designated.length ? designated.includes(userId) : canApprove;
}

// ================================================================= content tags

export type TagPolicy = "authors" | "managers";
export const normTag = (t: string) => t.trim().toLowerCase().replace(/^#/, "").replace(/\s+/g, "-").slice(0, 40);

/**
 * Content-tag permission check. Tag managers (owner, approvers with the tag role) may create new tags and set any;
 * authors may set existing tags when the policy is "authors", and cannot change tags when it is "managers".
 */
export function tagCheck(next: string[], current: string[], defined: string[], policy: TagPolicy, isManager: boolean): { ok: true; tags: string[]; created: string[] } | { ok: false; error: string } {
  const tags = [...new Set(next.map(normTag).filter(Boolean))].slice(0, 15);
  const cur = [...new Set(current.map(normTag))];
  const changed = tags.length !== cur.length || tags.some((t) => !cur.includes(t));
  if (!changed) return { ok: true, tags, created: [] };
  if (!isManager && policy === "managers") return { ok: false, error: "Only content-tag managers can change tags on this brand." };
  const created = tags.filter((t) => !defined.includes(t));
  if (created.length && !isManager) return { ok: false, error: `Only content-tag managers can create new tags (${created.join(", ")}).` };
  return { ok: true, tags, created };
}
