/**
 * A/B testing (CX ops), pure and client-safe; fixture-tested in tests/cx-ops-ab.test.ts.
 * Input validation for a new test, variant text/UTM conventions, effective status, daily click series
 * and engagement matching against network insights. The winner rule itself is abWinner() in ./model.
 */
import { channelProblems, isPubChannel, pubChannel, slugify, type ChannelResult, type PubChannel } from "@/lib/cx/publishing/core";

export type Variant = "a" | "b";
export type AbStatus = "draft" | "running" | "completed";
export type AbWinner = "a" | "b" | "none" | null;
export type AbMode = "publish" | "schedule" | "draft";

export const AB_CONFIDENCES: { value: number; label: string }[] = [
  { value: 0.9, label: "90%" },
  { value: 0.95, label: "95%" },
  { value: 0.99, label: "99%" },
];
export const AB_DEFAULT_MIN_CLICKS = 30;

/** Channels a text-only A/B test can run on (Instagram needs media, so it is excluded). */
export const AB_EXCLUDED: Partial<Record<PubChannel, string>> = { instagram: "Instagram posts need an image or video; A/B tests here are text + link." };
export const abChannelAllowed = (k: string) => isPubChannel(k) && !AB_EXCLUDED[k];

export type AbInput = {
  name: string;
  hypothesis: string;
  channels: string[];
  linkUrl: string;
  textA: string;
  textB: string;
  minClicks: number;
  confidence: number;
  endsAt: string | null;
  mode: AbMode;
  scheduleAt: string | null;
};
export type AbClean = Omit<AbInput, "channels"> & { channels: PubChannel[] };

/** Post text with the tracked-link placeholder: appended when the author did not place {link} themselves. */
export function variantBody(text: string) {
  const t = String(text ?? "").trim();
  return t.includes("{link}") ? t : `${t}\n\n{link}`;
}

/** UTM for a variant's tracked links (utm_source is set per channel by the publishing module). */
export function variantUtm(name: string, v: Variant) {
  return { medium: "social", campaign: `ab-${slugify(name) || "test"}`.slice(0, 64), content: `variant-${v}` };
}

const LINK_STAND_IN = (originLen: number) => `https://${"x".repeat(Math.max(4, originLen - 8))}/l/abcdefg`;

/** Per-channel problems of one variant's text (the {link} replaced by a short URL of realistic length). */
export function variantProblems(text: string, channels: string[], originLen = 22): string[] {
  const rendered = variantBody(text).replaceAll("{link}", LINK_STAND_IN(originLen));
  const out: string[] = [];
  for (const k of channels) {
    const p = channelProblems(rendered, k, 0);
    if (p.length) out.push(`${pubChannel(k)?.name ?? k}: ${p[0]}`);
  }
  return out;
}

/** Validate and clean a new-test form; `now` for the past-date checks. */
export function cleanAbInput(i: AbInput, now = Date.now(), originLen = 22): { ok: true; value: AbClean } | { ok: false; error: string } {
  const name = String(i.name ?? "").trim().replace(/\s+/g, " ").slice(0, 120);
  if (!name) return { ok: false, error: "Name the test." };
  const channels = [...new Set(i.channels ?? [])].filter(isPubChannel);
  if (!channels.length) return { ok: false, error: "Pick at least one channel." };
  const excluded = channels.find((k) => AB_EXCLUDED[k]);
  if (excluded) return { ok: false, error: AB_EXCLUDED[excluded]! };
  const linkUrl = String(i.linkUrl ?? "").trim();
  if (!linkUrl) return { ok: false, error: "Enter the destination link: clicks on it decide the winner." };
  try {
    const u = new URL(linkUrl);
    if (!/^https?:$/.test(u.protocol)) throw new Error();
  } catch {
    return { ok: false, error: "Enter a full destination URL starting with http:// or https://" };
  }
  const textA = String(i.textA ?? "").trim();
  const textB = String(i.textB ?? "").trim();
  if (!textA || !textB) return { ok: false, error: "Write the text of both variants." };
  if (textA === textB) return { ok: false, error: "The two variants are identical; change one of them." };
  for (const [v, t] of [["A", textA], ["B", textB]] as const) {
    const p = variantProblems(t, channels, originLen);
    if (p.length) return { ok: false, error: `Variant ${v} · ${p[0]}` };
  }
  const minClicks = Math.round(Number(i.minClicks));
  if (!Number.isFinite(minClicks) || minClicks < 5 || minClicks > 100_000) return { ok: false, error: "Minimum clicks per variant must be between 5 and 100,000." };
  const confidence = Number(i.confidence);
  if (!AB_CONFIDENCES.some((c) => Math.abs(c.value - confidence) < 1e-6)) return { ok: false, error: "Pick a confidence level of 90, 95 or 99%." };
  const mode: AbMode = i.mode === "schedule" || i.mode === "draft" ? i.mode : "publish";
  let scheduleAt: string | null = null;
  if (mode === "schedule") {
    const t = Date.parse(i.scheduleAt ?? "");
    if (!Number.isFinite(t)) return { ok: false, error: "Pick the date and time to publish both variants." };
    if (t < now - 60_000) return { ok: false, error: "The schedule time is in the past." };
    scheduleAt = new Date(t).toISOString();
  }
  let endsAt: string | null = null;
  if (i.endsAt) {
    const t = Date.parse(i.endsAt);
    if (!Number.isFinite(t)) return { ok: false, error: "Pick a valid end date." };
    const start = scheduleAt ? Date.parse(scheduleAt) : now;
    if (t <= start) return { ok: false, error: "The end date must be after the variants go live." };
    endsAt = new Date(t).toISOString();
  }
  return { ok: true, value: { name, hypothesis: String(i.hypothesis ?? "").trim().slice(0, 1000), channels, linkUrl, textA, textB, minClicks, confidence, endsAt, mode, scheduleAt } };
}

type PostLite = { status: string; scheduled_at: string | null; published_at: string | null } | null;

/**
 * Status shown for a test: a stored draft whose two posts are both scheduled or published is running
 * (the posts went through approval / were published from Publishing); `expired` = the end date passed
 * while running (clicks after it are not counted; decide the winner).
 */
export function effectiveStatus(t: { status: string; started_at: string | null; ends_at: string | null }, a: PostLite, b: PostLite, now = Date.now()) {
  const live = (p: PostLite) => !!p && ["scheduled", "published"].includes(p.status);
  let status: AbStatus = t.status === "completed" ? "completed" : t.status === "running" ? "running" : "draft";
  let startedAt = t.started_at;
  if (status === "draft" && live(a) && live(b)) {
    status = "running";
    const times = [a, b].map((p) => Date.parse(p!.published_at ?? p!.scheduled_at ?? "")).filter(Number.isFinite);
    startedAt = startedAt ?? (times.length ? new Date(Math.max(...times)).toISOString() : null);
  }
  const expired = status === "running" && !!t.ends_at && Date.parse(t.ends_at) <= now;
  const notStarted = status === "running" && !!startedAt && Date.parse(startedAt) > now;
  return { status, startedAt, expired, notStarted };
}

export function statusLabel(s: { status: AbStatus; expired: boolean; notStarted: boolean }, winner: AbWinner) {
  if (s.status === "completed") return winner ? "Completed" : "Ended";
  if (s.status === "running") return s.expired ? "Time's up" : s.notStarted ? "Scheduled" : "Running";
  return "Draft";
}

export function abStatusTone(r: { status: string; expired: boolean; notStarted: boolean }): "neutral" | "warning" | "brand" | "good" {
  if (r.status === "running") return r.expired ? "warning" : r.notStarted ? "brand" : "good";
  return "neutral";
}

/** Daily clicks per variant from `from` to `to` (inclusive, UTC days); missing days are 0 (the tracker was live). */
export function dailyVariantSeries(rows: { day: string; variant: Variant; clicks: number }[], from: string, to: string, maxDays = 120) {
  const start = Date.parse(`${from.slice(0, 10)}T00:00:00Z`);
  let end = Date.parse(`${to.slice(0, 10)}T00:00:00Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return [];
  if ((end - start) / 86_400_000 > maxDays - 1) end = start + (maxDays - 1) * 86_400_000;
  const out: { day: string; a: number; b: number }[] = [];
  for (let t = start; t <= end; t += 86_400_000) {
    const day = new Date(t).toISOString().slice(0, 10);
    out.push({
      day,
      a: rows.filter((r) => r.day === day && r.variant === "a").reduce((s, r) => s + r.clicks, 0),
      b: rows.filter((r) => r.day === day && r.variant === "b").reduce((s, r) => s + r.clicks, 0),
    });
  }
  return out;
}

export type RecentLite = { id: string; likes: number | null; comments: number | null; shares: number | null; views: number | null };
export type Engagement = { likes: number | null; comments: number | null; shares: number | null; views: number | null; matched: number };

/**
 * Engagement of one post from network insights: per channel, the published result's externalId is
 * matched against the network's recent items. Values stay null (n/a) when nothing matched or the network
 * does not report that metric; a matched 0 is a real 0.
 */
export function engagementFor(results: Record<string, ChannelResult | undefined>, recentByKind: Record<string, RecentLite[] | undefined>): Engagement {
  const out: Engagement = { likes: null, comments: null, shares: null, views: null, matched: 0 };
  const add = (k: "likes" | "comments" | "shares" | "views", v: number | null) => {
    if (v == null) return;
    out[k] = (out[k] ?? 0) + v;
  };
  for (const [kind, r] of Object.entries(results)) {
    if (!r || r.status !== "published" || !r.externalId) continue;
    const item = (recentByKind[kind] ?? []).find((x) => x.id === r.externalId || x.id.endsWith(`_${r.externalId}`) || r.externalId!.endsWith(`_${x.id}`));
    if (!item) continue;
    out.matched++;
    add("likes", item.likes);
    add("comments", item.comments);
    add("shares", item.shares);
    add("views", item.views);
  }
  return out;
}

/** Short label of a channel publish result for badges. */
export function resultLabel(r: ChannelResult | undefined, postStatus: string): { label: string; tone: "good" | "critical" | "warning" | "neutral" | "brand" | "info" } {
  if (!r) {
    if (postStatus === "scheduled") return { label: "Scheduled", tone: "brand" };
    if (postStatus === "pending") return { label: "Pending approval", tone: "warning" };
    if (postStatus === "approved") return { label: "Approved", tone: "info" };
    return { label: "Not published", tone: "neutral" };
  }
  switch (r.status) {
    case "published": return { label: "Published", tone: "good" };
    case "manual": return { label: "Published manually", tone: "good" };
    case "failed": return { label: "Failed", tone: "critical" };
    case "not_connected": return { label: "Not connected", tone: "warning" };
    case "deleted": return { label: "Deleted", tone: "neutral" };
  }
}
