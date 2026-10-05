/**
 * Twitter / Instagram reports (WP-K4): pure, client-safe helpers. Fixture-tested in tests/cx-k4-listening.test.ts.
 * A network report counts the stored conversations (listening mentions + tickets) whose media type belongs to
 * that network in the media-type catalogue; owned-profile stats come from the network's API only when connected.
 */
import { MEDIA_TYPES } from "@/lib/cx/ops/model";
import { pctChange, sentimentCounts, SENTIMENTS, type RRow, type Sentiment } from "./model";

export type NetworkId = "twitter" | "instagram";
export const NETWORKS: Record<NetworkId, { kind: "x" | "instagram"; label: string; page: string; path: string }> = {
  twitter: { kind: "x", label: "Twitter", page: "twitter", path: "/cx/reports/twitter" },
  instagram: { kind: "instagram", label: "Instagram", page: "instagram", path: "/cx/reports/instagram" },
};

/** Media type ids of a network (catalogue order), e.g. x_public + x for Twitter. */
export const networkMedia = (n: NetworkId) => MEDIA_TYPES.filter((m) => m.network === NETWORKS[n].kind).map((m) => m.id);

/**
 * Media types the report (and its drill-downs) use: the user's media filter narrowed to the network, or every
 * media type of the network when the filter selects none of them (a filter carried over from another report).
 */
export function effectiveMedia(selected: string[], n: NetworkId) {
  const own = networkMedia(n);
  const pick = selected.filter((m) => own.includes(m));
  return pick.length ? pick : own;
}

/** Rows of the given media types. */
export const ofMedia = <T extends Pick<RRow, "mediaType">>(rows: T[], media: string[]) => {
  const set = new Set(media);
  return rows.filter((r) => set.has(r.mediaType));
};

/** TOTAL / POSITIVE / NEGATIVE / NEUTRAL tiles with % change against the previous equal period. */
export function sentimentKpis(rows: Pick<RRow, "sentiment">[], prevRows: Pick<RRow, "sentiment">[]) {
  const cur = sentimentCounts(rows), before = sentimentCounts(prevRows);
  return {
    total: { value: cur.total, change: pctChange(cur.total, before.total) },
    ...Object.fromEntries(SENTIMENTS.map((s) => [s, { value: cur[s], change: pctChange(cur[s], before[s]) }])),
  } as Record<"total" | Sentiment, { value: number; change: number | null }>;
}

/** Top posts: most engaged first (where the source reports engagement), then strongest sentiment, then newest. */
export function rankPosts<T extends Pick<RRow, "engagement" | "score" | "at">>(rows: T[], limit = 25) {
  return [...rows].sort((a, b) => (b.engagement ?? -1) - (a.engagement ?? -1) || Math.abs(b.score ?? 0) - Math.abs(a.score ?? 0) || b.at.localeCompare(a.at)).slice(0, limit);
}

/** Ticket conversations per owned inbox profile (channel id), largest first; profiles without tickets keep 0. */
export function profileCounts(rows: Pick<RRow, "kind" | "profile">[], channels: { id: string; name: string }[]) {
  const c = new Map<string, number>();
  for (const r of rows) if (r.kind === "ticket" && r.profile) c.set(r.profile, (c.get(r.profile) ?? 0) + 1);
  return channels.map((ch) => ({ ...ch, count: c.get(ch.id) ?? 0 })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

/** State of the owned-profile widget: live stats, an API error, or a connect card (never invented numbers). */
export type ProfileState = "live" | "error" | "connect";
export function profileState(conn: { connected: boolean } | null | undefined, insight: { stats: unknown; error: string | null } | null | undefined): ProfileState {
  if (!conn?.connected || !insight) return "connect";
  if (insight.stats) return "live";
  return "error";
}

/** Engagement rate of recent posts: (likes + comments + shares) / views, as %, over posts that report views. */
export function recentEngagement(recent: { views: number | null; likes: number | null; comments: number | null; shares: number | null }[]) {
  const withViews = recent.filter((r) => r.views != null && r.views > 0);
  if (!withViews.length) return null;
  const views = withViews.reduce((s, r) => s + (r.views ?? 0), 0);
  const eng = withViews.reduce((s, r) => s + (r.likes ?? 0) + (r.comments ?? 0) + (r.shares ?? 0), 0);
  return views ? (eng / views) * 100 : null;
}
