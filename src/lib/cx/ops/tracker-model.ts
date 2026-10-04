/**
 * Mentions Tracker: pure, client-safe helpers (validation of tracked handles/posts, publishing posts as
 * tracked posts, item filtering and the metrics strip). Fixture-tested in tests/cx-ops-tracker.test.ts.
 */
import { normalizePostUrl, normHandle, type ResponseState, type Tracked } from "./model";

export const TRACK_PLATFORMS: { id: string; label: string }[] = [
  { id: "x", label: "X (Twitter)" },
  { id: "instagram", label: "Instagram" },
  { id: "facebook", label: "Facebook" },
  { id: "linkedin", label: "LinkedIn" },
  { id: "youtube", label: "YouTube" },
  { id: "threads", label: "Threads" },
  { id: "mastodon", label: "Mastodon" },
  { id: "bluesky", label: "Bluesky" },
  { id: "reddit", label: "Reddit" },
  { id: "tiktok", label: "TikTok" },
  { id: "other", label: "Other" },
];
export const platformLabel = (id: string) => TRACK_PLATFORMS.find((p) => p.id === id)?.label ?? (id === "gbp" ? "Google Business Profile" : id || "Other");

export type TrackedInput = { kind: "handle" | "post"; platform: string; value: string; label?: string };
/** Validate and normalize a tracked handle / post. Handles are stored normalized ("acme"), posts as the trimmed URL. */
export function cleanTracked(input: TrackedInput): { ok: true; value: { kind: "handle" | "post"; platform: string; value: string; label: string } } | { ok: false; error: string } {
  const kind = input.kind === "post" ? "post" : input.kind === "handle" ? "handle" : null;
  if (!kind) return { ok: false, error: "Choose a handle or a post." };
  const platform = TRACK_PLATFORMS.some((p) => p.id === input.platform) ? input.platform : "other";
  const label = String(input.label ?? "").trim().replace(/\s+/g, " ").slice(0, 80);
  const raw = String(input.value ?? "").trim();
  if (!raw) return { ok: false, error: kind === "handle" ? "Enter a handle, e.g. @acme." : "Paste the post URL." };
  if (kind === "handle") {
    const h = normHandle(raw);
    if (!h || h.length > 60 || !/^[a-z0-9_.\-]+(@[a-z0-9.\-]+\.[a-z]{2,})?$/.test(h)) return { ok: false, error: "Use a handle like @acme (letters, numbers, _ . -; Mastodon handles may include @instance)." };
    return { ok: true, value: { kind, platform, value: h, label } };
  }
  if (raw.length > 2048) return { ok: false, error: "That URL is too long." };
  if (!normalizePostUrl(raw)) return { ok: false, error: "Paste a full post URL starting with https://." };
  return { ok: true, value: { kind, platform, value: raw, label } };
}

export type PubPostRow = { id: string; title: string; body: string; published_at: string | null; results: Record<string, { status?: string; url?: string } | null> | null };
/** The brand's published Publishing posts (per network result with a URL, status published/manual) as tracked posts. */
export function publishedTracked(posts: PubPostRow[], stored: Tracked[] = []): (Tracked & { postId: string; publishedAt: string | null })[] {
  const seen = new Set(stored.filter((t) => t.kind === "post").map((t) => normalizePostUrl(t.value)).filter(Boolean) as string[]);
  const out: (Tracked & { postId: string; publishedAt: string | null })[] = [];
  for (const p of posts) {
    for (const [network, r] of Object.entries(p.results ?? {})) {
      if (!r || !r.url || !["published", "manual"].includes(String(r.status))) continue;
      const key = normalizePostUrl(r.url);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      const text = (p.title || p.body || "").replace(/\s+/g, " ").trim();
      out.push({ id: `pub:${p.id}:${network}`, kind: "post", platform: network, value: r.url, label: text.slice(0, 60) || "Published post", postId: p.id, publishedAt: p.published_at });
    }
  }
  return out;
}

export type TrackerItem = {
  key: string;
  kind: "mention" | "ticket";
  id: string;
  source: string;
  sourceLabel: string;
  author: string;
  handle: string | null;
  text: string;
  matched: { id: string; label: string }[];
  publishedAt: string | null;
  state: ResponseState;
  responseMs: number | null;
  ticketId: string | null;
  ticketNumber: number | null;
  url: string | null;
  sentiment: string | null;
};

/** Response time in ms between the customer's post and the first reply (null when unknown or negative). */
export function responseMs(from: string | null | undefined, firstResponse: string | null | undefined) {
  if (!from || !firstResponse) return null;
  const d = Date.parse(firstResponse) - Date.parse(from);
  return Number.isFinite(d) && d >= 0 ? d : null;
}

/** Response state of a Meta comment/mention ticket: replied → responded, closed without reply → responded (closed), else pending. */
export function ticketState(t: { status: string; first_response_at: string | null }): ResponseState {
  if (t.first_response_at) return "responded";
  if (t.status === "solved" || t.status === "closed") return "responded";
  return "pending";
}

export function median(values: number[]) {
  const v = values.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
}

export type TrackerFilters = { status: string; match: string; source: string; range: string; from: string; to: string };
export const DEFAULT_FILTERS: TrackerFilters = { status: "", match: "", source: "", range: "90", from: "", to: "" };
export const RANGES: [string, string][] = [["7", "Last 7 days"], ["30", "Last 30 days"], ["90", "Last 90 days"], ["custom", "Custom range"]];

/** Window [start, end) in ms for the date filter (custom from/to are inclusive calendar days, UTC). */
export function rangeWindow(f: Pick<TrackerFilters, "range" | "from" | "to">, now = Date.now()): [number, number] {
  if (f.range === "custom") {
    const start = f.from && Number.isFinite(Date.parse(`${f.from}T00:00:00Z`)) ? Date.parse(`${f.from}T00:00:00Z`) : -Infinity;
    const end = f.to && Number.isFinite(Date.parse(`${f.to}T00:00:00Z`)) ? Date.parse(`${f.to}T00:00:00Z`) + 86_400_000 : Infinity;
    return [start, end];
  }
  const days = Number(f.range) || 90;
  return [now - days * 86_400_000, Infinity];
}

export function filterItems(items: TrackerItem[], f: TrackerFilters, now = Date.now()) {
  const [start, end] = rangeWindow(f, now);
  return items.filter((i) => {
    if (f.status && i.state !== f.status) return false;
    if (f.source && i.source !== f.source) return false;
    if (f.match && !i.matched.some((m) => m.id === f.match)) return false;
    const t = i.publishedAt ? Date.parse(i.publishedAt) : NaN;
    if (Number.isFinite(t)) return t >= start && t < end;
    return f.range !== "custom";
  });
}

export function trackerMetrics(items: TrackerItem[]) {
  const by = (s: ResponseState) => items.filter((i) => i.state === s).length;
  const responded = by("responded");
  const ignored = by("ignored");
  const actionable = items.length - ignored;
  return {
    total: items.length,
    responded,
    respondedPct: actionable > 0 ? (responded / actionable) * 100 : null,
    pending: by("pending"),
    inProgress: by("in_progress"),
    ignored,
    medianMs: median(items.map((i) => i.responseMs).filter((x): x is number => x != null)),
  };
}

export const STATE_LABEL: Record<ResponseState, string> = { responded: "Responded", pending: "Pending", in_progress: "In progress", ignored: "Ignored" };
