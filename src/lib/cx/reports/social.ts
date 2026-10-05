import { query } from "@/lib/db";
import { channelInfo } from "@/lib/cx/channels";
import { connections } from "@/lib/cx/publishing/data";
import { channelInsights, statHistory } from "@/lib/cx/publishing/dispatch";
import { applyFilters, loadConversationsRaw, mediaOptions, type ReportCtx } from "./data";
import { filterQuery } from "./filters";
import type { PostVM } from "./listening";
import { inRange, ownWords, previousRange, sentimentCounts, timeSeries, wordCloud, SENTIMENTS, type DrillSpec, type RRow } from "./model";
import { effectiveMedia, networkMedia, NETWORKS, ofMedia, profileCounts, profileState, rankPosts, recentEngagement, sentimentKpis, type NetworkId } from "./social-model";

/**
 * View model of the Twitter and Instagram reports (server-only, serializable output). Mention metrics are counts
 * of stored conversations of the network's media types; owned-profile stats come from the network's official API
 * (publishing connection) and are only shown when it is connected — otherwise the page shows a connect card.
 */
const post = (r: RRow): PostVM => ({ id: r.id, author: r.author, handle: r.handle, avatar: r.avatar, network: r.network, mediaType: r.mediaType, sentiment: r.sentiment, text: r.text.slice(0, 400), title: r.title.slice(0, 200), at: r.at, url: r.url });

/** Drill base of a network report: the media filter is narrowed to the network's media types. */
export function networkDrillBase(ctx: ReportCtx, n: NetworkId, source: DrillSpec["source"] = "conversations"): Omit<DrillSpec, "title"> {
  const media = effectiveMedia(ctx.filters.media, n);
  return { source, range: ctx.filters.range, basis: ctx.filters.basis, filters: filterQuery({ scope: ctx.filters.scope, media }), interval: ctx.filters.interval };
}

async function ownedProfile(ctx: ReportCtx, n: NetworkId) {
  const kind = NETWORKS[n].kind;
  const info = channelInfo(kind);
  const [conns, inbox] = await Promise.all([
    connections(ctx.brandId),
    query<{ id: string; name: string; status: string; last_synced_at: string | null; last_error: string | null }>("SELECT id,name,status,last_synced_at,last_error FROM cx_channels WHERE project_id=$1 AND kind=$2 ORDER BY name", [ctx.brandId, kind]),
  ]);
  const conn = conns.find((c) => c.kind === kind) ?? null;
  // Only call the API when this network is connected (channelInsights fetches every connected channel, 6 h cache).
  const insight = conn?.connected ? ((await channelInsights(ctx.brandId)).find((i) => i.kind === kind) ?? null) : null;
  const history = insight?.stats ? (await statHistory(ctx.brandId)).filter((h) => h.kind === kind && h.followers != null).map((h) => ({ key: h.day, followers: h.followers as number })) : [];
  const state = profileState(conn, insight);
  return {
    state,
    catalogue: { name: info?.name ?? NETWORKS[n].label, api: info?.api ?? conn?.api ?? "", costNote: info?.costNote ?? conn?.costNote ?? "", env: info?.env ?? conn?.env ?? [], setup: info?.setup ?? conn?.setup ?? "" },
    envReady: conn?.envReady ?? false,
    account: conn?.account ?? null,
    reason: conn?.reason ?? null,
    error: insight?.error ?? null,
    fetchedAt: insight?.fetchedAt ?? null,
    stats: insight?.stats
      ? {
          name: insight.stats.name,
          handle: insight.stats.handle,
          url: insight.stats.url,
          followers: insight.stats.followers,
          views: insight.stats.views,
          posts: insight.stats.posts,
          engagementRate: recentEngagement(insight.stats.recent),
          recent: insight.stats.recent.slice(0, 8).map((r) => ({ id: r.id, title: r.title, url: r.url, at: r.at, views: r.views, likes: r.likes, comments: r.comments, shares: r.shares })),
        }
      : null,
    history,
    inbox: inbox.map((c) => ({ id: c.id, name: c.name, status: c.status, lastSynced: c.last_synced_at ? new Date(c.last_synced_at).toISOString() : null, lastError: c.last_error })),
  };
}

export async function networkView(ctx: ReportCtx, n: NetworkId) {
  const { range, interval } = ctx.filters;
  const prev = previousRange(range);
  const media = effectiveMedia(ctx.filters.media, n);
  const [raw, profile] = await Promise.all([loadConversationsRaw(ctx, { from: prev.from, to: range.to }), ownedProfile(ctx, n)]);
  // The page's own media filter narrows within the network; a selection from another network is ignored.
  const scoped = applyFilters({ ...ctx, filters: { ...ctx.filters, media: [] } }, raw);
  const all = ofMedia(scoped, media);
  const rows = all.filter((r) => inRange(r.at, range));
  const prevRows = all.filter((r) => inRange(r.at, prev));
  const own = networkMedia(n);
  const exclude = ownWords(ctx.scope.topicKeywords);
  const byMedia = media.map((m) => ({ mediaType: m, ...sentimentCounts(rows.filter((r) => r.mediaType === m)) })).filter((m) => m.total > 0);
  return {
    empty: rows.length === 0,
    mediaOptions: mediaOptions(ofMedia(raw, own), range),
    media,
    kpis: sentimentKpis(rows, prevRows),
    trend: timeSeries(rows, range, interval, (r) => [r.sentiment], SENTIMENTS),
    sentiment: sentimentCounts(rows),
    byMedia,
    cloud: wordCloud(rows, exclude, 70),
    posts: rankPosts(rows, 25).map(post),
    profiles: profileCounts(rows, profile.inbox),
    profile,
  };
}
export type NetworkView = Awaited<ReturnType<typeof networkView>>;
