import { applyFilters, loadConversationsRaw, mediaOptions, visibleEntities, type ReportCtx } from "./data";
import { filterQuery } from "./filters";
import {
  buzzStats, byMediaType, currentTrends, entityCounts, extremes, ownWords, previousRange, sentimentCounts, sentimentPeaks, shareOfVoice, timeSeries, topPosts, wordCloud,
  pctChange, SENTIMENTS, type DrillSpec, type Entity, type Range, type RRow, type Sentiment,
} from "./model";

/**
 * View models for the Share of Voice and Sentiment Analysis reports (server-only, serializable output).
 * Pages render them with the kit; every count here is a count of stored conversations.
 */
type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
export type PostVM = { id: string; author: string; handle: string | null; avatar: string | null; network: string; mediaType: string; sentiment: Sentiment; text: string; title: string; at: string; url: string | null };
const post = (r: RRow): PostVM => ({ id: r.id, author: r.author, handle: r.handle, avatar: r.avatar, network: r.network, mediaType: r.mediaType, sentiment: r.sentiment, text: r.text.slice(0, 400), title: r.title.slice(0, 200), at: r.at, url: r.url });

export function drillBase(ctx: ReportCtx, source: DrillSpec["source"] = "conversations"): Omit<DrillSpec, "title"> {
  return { source, range: ctx.filters.range, basis: ctx.filters.basis, filters: filterQuery(ctx.filters), interval: ctx.filters.interval };
}
/** Rows of one entity ("" = whole scope). */
const of = (rows: RRow[], id: string) => (id ? rows.filter((r) => r.entities.includes(id)) : rows);
const pickEntity = (v: string, entities: Entity[]) => (entities.some((e) => e.id === v) ? v : "");

async function base(ctx: ReportCtx, span: Range) {
  const raw = await loadConversationsRaw(ctx, span);
  const rows = applyFilters(ctx, raw);
  return { raw, rows };
}

export async function shareOfVoiceView(ctx: ReportCtx, sp: SP) {
  const { range, interval } = ctx.filters;
  const { raw, rows } = await base(ctx, range);
  const entities = visibleEntities(ctx, rows);
  const counts = entityCounts(rows, entities);
  const ids = entities.map((e) => e.id);
  const trend = timeSeries(rows, range, interval, (r) => r.entities, ids);
  const buzzEntity = pickEntity(one(sp.buzz), entities);
  const postsEntity = pickEntity(one(sp.posts), entities);
  const cloudEntity = pickEntity(one(sp.cloud), entities);
  const exclude = ownWords(ctx.scope.topicKeywords);
  const ranked = [...of(rows, postsEntity)].sort((a, b) => (b.engagement ?? -1) - (a.engagement ?? -1) || Math.abs(b.score ?? 0) - Math.abs(a.score ?? 0) || b.at.localeCompare(a.at));
  return {
    empty: rows.length === 0,
    mediaOptions: mediaOptions(raw, range),
    entities,
    trend,
    buzz: { entity: buzzEntity, name: buzzEntity ? entities.find((e) => e.id === buzzEntity)!.name : ctx.scope.label, ...buzzStats(of(rows, buzzEntity), range) },
    sentiment: counts.map((c) => ({ key: c.id, positive: c.positive, negative: c.negative, neutral: c.neutral })),
    sov: shareOfVoice(counts),
    posts: { entity: postsEntity, items: ranked.slice(0, 25).map(post) },
    cloud: { entity: cloudEntity, words: wordCloud(of(rows, cloudEntity), exclude, 70) },
  };
}

export async function sentimentView(ctx: ReportCtx, sp: SP) {
  const { range, interval } = ctx.filters;
  const prev = previousRange(range);
  const trendsSpan: Range = { from: new Date(Date.parse(`${range.to}T00:00:00Z`) - 27 * 86400000).toISOString().slice(0, 10), to: range.to };
  const span: Range = { from: [prev.from, trendsSpan.from].sort()[0], to: range.to };
  const { raw, rows: all } = await base(ctx, span);
  const inR = (r: RRow, x: Range) => r.at.slice(0, 10) >= x.from && r.at.slice(0, 10) <= x.to;
  const rows = all.filter((r) => inR(r, range));
  const prevRows = all.filter((r) => inR(r, prev));
  const entities = visibleEntities(ctx, rows);
  const counts = entityCounts(rows, entities);
  const cur = sentimentCounts(rows), before = sentimentCounts(prevRows);
  const sel = (k: string) => pickEntity(one(sp[k]), entities);
  const ot = sel("ot"), wc = sel("wc"), tp = sel("tp"), mt = sel("mt"), bp = sel("bp");
  const exclude = ownWords(ctx.scope.topicKeywords);
  const name = (id: string) => (id ? entities.find((e) => e.id === id)!.name : ctx.scope.label);
  return {
    empty: rows.length === 0,
    mediaOptions: mediaOptions(raw, range),
    entities,
    kpis: {
      total: { value: cur.total, change: pctChange(cur.total, before.total) },
      ...Object.fromEntries(SENTIMENTS.map((s) => [s, { value: cur[s], change: pctChange(cur[s], before[s]) }])),
    } as Record<"total" | Sentiment, { value: number; change: number | null }>,
    overTime: { entity: ot, name: name(ot), data: timeSeries(of(rows, ot), range, interval, (r) => [r.sentiment], SENTIMENTS), peaks: sentimentPeaks(of(rows, ot), range) },
    byEntity: counts.map((c) => ({ key: c.id, name: c.name, total: c.total, positive: c.positive, negative: c.negative, neutral: c.neutral })),
    extremes: { positive: extremes(counts, "positive"), negative: extremes(counts, "negative") },
    byMedia: { entity: mt, rows: byMediaType(of(rows, mt)) },
    clouds: { entity: wc, positive: wordCloud(of(rows, wc).filter((r) => r.sentiment === "positive"), exclude, 60), negative: wordCloud(of(rows, wc).filter((r) => r.sentiment === "negative"), exclude, 60) },
    trends: currentTrends(applyFilters(ctx, raw).filter((r) => inR(r, trendsSpan)), range.to),
    top: { entity: tp, positive: topPosts(of(rows, tp), "positive", 25).map(post), negative: topPosts(of(rows, tp), "negative", 25).map(post) },
    brandPie: { entity: bp, name: name(bp), counts: sentimentCounts(of(rows, bp)) },
  };
}
