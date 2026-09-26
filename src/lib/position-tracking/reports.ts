import { query } from "@/lib/db";
import type { SerpFeature } from "@/lib/seo/types";
import { addDays, aggregateDay, keywordTraffic, keywordVisibility, type RankRow } from "./metrics";
import type { Campaign, DayAggregate, Device, ImpactRow, OverviewRow, RangeDays, Tag, TrackedKeyword } from "./types";
import { RANGES } from "./types";

export type ReportProject = { id: string; name: string; domain: string };

export type Ctx = {
  project: ReportProject;
  campaign: Campaign;
  keywords: TrackedKeyword[];
  tags: Tag[];
  device: Device;
  devices: Device[];
  range: RangeDays;
  domains: string[];
  /** Days with data in the selected range (ascending). */
  days: string[];
  startDay: string | null;
  endDay: string | null;
  tagIds: string[];
  /** Keywords matching the tag filter (all when no filter). */
  selected: TrackedKeyword[];
  filtered: boolean;
};

export function parseRange(v: string | null | undefined): RangeDays {
  const n = Number(v);
  return (RANGES as readonly number[]).includes(n) ? (n as RangeDays) : 30;
}

export async function loadContext(
  project: ReportProject,
  campaign: Campaign,
  keywords: TrackedKeyword[],
  tags: Tag[],
  opts: { device?: string | null; range?: string | null; tags?: string[] },
): Promise<Ctx> {
  const devices: Device[] = campaign.device === "both" ? ["desktop", "mobile"] : [campaign.device];
  const device = devices.includes(opts.device as Device) ? (opts.device as Device) : devices[0];
  const range = parseRange(opts.range);
  const domains = [project.domain, ...campaign.competitors];
  const tagIds = (opts.tags ?? []).filter((t) => tags.some((x) => x.id === t));
  const selected = tagIds.length ? keywords.filter((k) => k.tags.some((t) => tagIds.includes(t.id))) : keywords;
  let days: string[] = [];
  if (campaign.lastDay) {
    const rows = await query<{ day: string }>("SELECT day FROM pt_daily WHERE project_id=$1 AND device=$2 AND domain=$3 AND day>=$4 ORDER BY day", [
      project.id,
      device,
      project.domain,
      addDays(campaign.lastDay, -(range - 1)),
    ]);
    days = rows.map((r) => r.day);
  }
  return { project, campaign, keywords, tags, device, devices, range, domains, days, startDay: days[0] ?? null, endDay: days[days.length - 1] ?? null, tagIds, selected, filtered: tagIds.length > 0 };
}

const inDays = (days: string[]) => JSON.stringify(days);

/** Full snapshots for specific days (selected keywords only). */
export async function loadRows(ctx: Ctx, days: string[], device: Device = ctx.device): Promise<RankRow[]> {
  if (!days.length) return [];
  const ids = new Set(ctx.selected.map((k) => k.id));
  const rows = await query<RankRow>(
    `SELECT keyword_id, day, positions, urls, own_urls, features, owned, fs_owner FROM pt_rankings
     WHERE project_id=$1 AND device=$2 AND day IN (SELECT jsonb_array_elements_text($3::jsonb))`,
    [ctx.project.id, device, inDays([...new Set(days)])],
  );
  return rows.filter((r) => ids.has(r.keyword_id));
}

/** Own-domain position per keyword per day over the range (light query for sparklines/timelines). */
async function loadOwnSeries(ctx: Ctx, device: Device = ctx.device) {
  if (!ctx.startDay) return new Map<string, Map<string, number | null>>();
  const rows = await query<{ keyword_id: string; day: string; pos: number | null }>(
    `SELECT keyword_id, day, (positions->>$4)::int AS pos FROM pt_rankings WHERE project_id=$1 AND device=$2 AND day>=$3 ORDER BY day`,
    [ctx.project.id, device, ctx.startDay, ctx.project.domain],
  );
  const out = new Map<string, Map<string, number | null>>();
  for (const r of rows) {
    const m = out.get(r.keyword_id) ?? new Map<string, number | null>();
    m.set(r.day, r.pos);
    out.set(r.keyword_id, m);
  }
  return out;
}

type DailyRow = { day: string; domain: string; keywords: number; ranked: number; top3: number; top10: number; top20: number; top100: number; visibility: number; traffic: number; avg_position: number | null };

/** Per-domain daily aggregates over the range: precomputed unless a tag filter is active. */
export async function loadDaily(ctx: Ctx, device: Device = ctx.device): Promise<DayAggregate[]> {
  if (!ctx.startDay) return [];
  if (!ctx.filtered) {
    const rows = await query<DailyRow>("SELECT * FROM pt_daily WHERE project_id=$1 AND device=$2 AND day>=$3 ORDER BY day", [ctx.project.id, device, ctx.startDay]);
    return rows
      .filter((r) => ctx.domains.includes(r.domain))
      .map((r) => ({ day: r.day, domain: r.domain, keywords: r.keywords, ranked: r.ranked, top3: r.top3, top10: r.top10, top20: r.top20, top100: r.top100, visibility: Number(r.visibility), traffic: Number(r.traffic), avgPosition: r.avg_position == null ? null : Number(r.avg_position) }));
  }
  const ids = new Set(ctx.selected.map((k) => k.id));
  const rows = await query<RankRow>("SELECT keyword_id, day, positions, features FROM pt_rankings WHERE project_id=$1 AND device=$2 AND day>=$3", [ctx.project.id, device, ctx.startDay]);
  const byDay = new Map<string, RankRow[]>();
  for (const r of rows) {
    if (!ids.has(r.keyword_id)) continue;
    const l = byDay.get(r.day) ?? [];
    l.push(r);
    byDay.set(r.day, l);
  }
  const volumes = new Map(ctx.selected.map((k) => [k.id, k.volume]));
  return [...byDay.keys()].sort().flatMap((day) => aggregateDay(day, byDay.get(day)!, ctx.domains, volumes));
}

// ------------------------------------------------------------------------------------ Landscape

export async function landscape(ctx: Ctx) {
  const daily = await loadDaily(ctx);
  const [startRows, endRows] = await Promise.all([loadRows(ctx, ctx.startDay ? [ctx.startDay] : []), loadRows(ctx, ctx.endDay ? [ctx.endDay] : [])]);
  const own = ctx.project.domain;
  const at = (domain: string, day: string | null) => (day ? (daily.find((d) => d.domain === domain && d.day === day) ?? null) : null);
  const perDomain = ctx.domains.map((domain) => ({ domain, start: at(domain, ctx.startDay), end: at(domain, ctx.endDay) }));
  const kw = new Map(ctx.selected.map((k) => [k.id, k]));
  const start = new Map(startRows.map((r) => [r.keyword_id, r]));
  const n = endRows.length || 1;

  const impacts: ImpactRow[] = endRows.map((r) => {
    const a = start.get(r.keyword_id)?.positions[own] ?? null;
    const b = r.positions[own] ?? null;
    return { id: r.keyword_id, keyword: kw.get(r.keyword_id)?.keyword ?? "", start: a, end: b, impact: (keywordVisibility(b) - keywordVisibility(a)) / n, volume: kw.get(r.keyword_id)?.volume ?? null };
  });
  const positive = impacts.filter((i) => i.impact > 0.0001).sort((x, y) => y.impact - x.impact).slice(0, 8);
  const negative = impacts.filter((i) => i.impact < -0.0001).sort((x, y) => x.impact - y.impact).slice(0, 8);

  const topKeywords = endRows
    .filter((r) => r.positions[own] != null)
    .map((r) => {
      const k = kw.get(r.keyword_id)!;
      const p = r.positions[own]!;
      const a = start.get(r.keyword_id)?.positions[own] ?? null;
      return { id: r.keyword_id, keyword: k?.keyword ?? "", position: p, start: a, traffic: keywordTraffic(p, k?.volume, r.features), volume: k?.volume ?? null, url: r.urls[own] ?? null };
    })
    .sort((a, b) => b.traffic - a.traffic || a.position - b.position)
    .slice(0, 8);

  const featureMap = new Map<SerpFeature, { present: number; owned: number; ownedStart: number }>();
  for (const r of endRows)
    for (const f of r.features) {
      if (f === "related_searches") continue;
      const e = featureMap.get(f) ?? { present: 0, owned: 0, ownedStart: 0 };
      e.present++;
      if (r.owned.includes(f)) e.owned++;
      featureMap.set(f, e);
    }
  for (const r of startRows) for (const f of r.owned) if (featureMap.has(f)) featureMap.get(f)!.ownedStart++;
  const features = [...featureMap.entries()].map(([feature, v]) => ({ feature, ...v })).sort((a, b) => b.present - a.present);

  const bands = (rows: RankRow[]) => {
    const b = { top3: 0, top10: 0, top20: 0, top100: 0, none: 0 };
    for (const r of rows) {
      const p = r.positions[own];
      if (p == null) b.none++;
      else if (p <= 3) b.top3++;
      else if (p <= 10) b.top10++;
      else if (p <= 20) b.top20++;
      else b.top100++;
    }
    return b;
  };
  return { daily, perDomain, positive, negative, topKeywords, features, bandsStart: bands(startRows), bandsEnd: bands(endRows), keywordCount: endRows.length, totalVolume: ctx.selected.reduce((s, k) => s + (k.volume ?? 0), 0) };
}

// ------------------------------------------------------------------------------------ Overview

export async function overview(ctx: Ctx): Promise<OverviewRow[]> {
  const own = ctx.project.domain;
  const [startRows, endRows, series] = await Promise.all([loadRows(ctx, ctx.startDay ? [ctx.startDay] : []), loadRows(ctx, ctx.endDay ? [ctx.endDay] : []), loadOwnSeries(ctx)]);
  const start = new Map(startRows.map((r) => [r.keyword_id, r]));
  const end = new Map(endRows.map((r) => [r.keyword_id, r]));
  return ctx.selected.map((k) => {
    const s = start.get(k.id);
    const e = end.get(k.id);
    const a = s?.positions[own] ?? null;
    const b = e?.positions[own] ?? null;
    const daysMap = series.get(k.id);
    const spark = ctx.days.map((d) => daysMap?.get(d) ?? null);
    const known = spark.filter((x): x is number => x != null);
    const competitors: OverviewRow["competitors"] = {};
    for (const c of ctx.campaign.competitors) competitors[c] = { start: s?.positions[c] ?? null, end: e?.positions[c] ?? null };
    return {
      id: k.id,
      keyword: k.keyword,
      tags: k.tags,
      intents: k.intents,
      volume: k.volume,
      cpc: k.cpc,
      kd: k.kd,
      start: a,
      end: b,
      change: a != null && b != null ? a - b : null,
      visibility: keywordVisibility(b),
      traffic: k.volume == null ? null : Math.round(keywordTraffic(b, k.volume, e?.features ?? [])),
      url: e?.urls[own] ?? null,
      features: (e?.features ?? []).filter((f) => f !== "related_searches"),
      owned: e?.owned ?? [],
      competitors,
      spark,
      best: known.length ? Math.min(...known) : null,
    };
  });
}

/** Detail for the keyword drawer: position history of every tracked domain, URLs and SERP. */
export async function keywordDetail(projectId: string, keywordId: string, device: Device, fromDay: string) {
  const rows = await query<RankRow>(
    "SELECT keyword_id, day, positions, urls, own_urls, features, owned, fs_owner FROM pt_rankings WHERE project_id=$1 AND keyword_id=$2 AND device=$3 AND day>=$4 ORDER BY day",
    [projectId, keywordId, device, fromDay],
  );
  const [serp] = await query<{ day: string; results: { d: string; p: number; u: string }[] }>("SELECT day, results FROM pt_serps WHERE keyword_id=$1 AND device=$2", [keywordId, device]);
  return { rows, serp: serp ?? null };
}

// ------------------------------------------------------------------------------------ Competitors

export async function competitors(ctx: Ctx) {
  const daily = await loadDaily(ctx);
  const totalVolume = ctx.selected.reduce((s, k) => s + (k.volume ?? 0), 0);
  const at = (domain: string, day: string | null) => (day ? (daily.find((d) => d.domain === domain && d.day === day) ?? null) : null);
  const rows = ctx.domains.map((domain, i) => {
    const s = at(domain, ctx.startDay);
    const e = at(domain, ctx.endDay);
    return {
      domain,
      index: i,
      own: i === 0,
      visibility: e?.visibility ?? 0,
      visibilityDelta: e && s ? e.visibility - s.visibility : null,
      sov: totalVolume && e ? (e.traffic / totalVolume) * 100 : null,
      sovDelta: totalVolume && e && s ? ((e.traffic - s.traffic) / totalVolume) * 100 : null,
      traffic: e?.traffic ?? 0,
      avgPosition: e?.avgPosition ?? null,
      avgPositionDelta: e?.avgPosition != null && s?.avgPosition != null ? s.avgPosition - e.avgPosition : null,
      top3: e?.top3 ?? 0,
      top10: e?.top10 ?? 0,
      ranked: e?.ranked ?? 0,
    };
  });

  // Domains discovered in the latest top-20 SERPs of the tracked keywords.
  const ids = new Set(ctx.selected.map((k) => k.id));
  const volumes = new Map(ctx.selected.map((k) => [k.id, k.volume]));
  const serps = await query<{ keyword_id: string; day: string; results: { d: string; p: number; u: string }[] }>("SELECT keyword_id, day, results FROM pt_serps WHERE project_id=$1 AND device=$2", [ctx.project.id, ctx.device]);
  const n = ctx.selected.length || 1;
  const found = new Map<string, { keywords: number; posSum: number; vis: number; traffic: number; top3: number; top10: number }>();
  for (const s of serps) {
    if (!ids.has(s.keyword_id)) continue;
    const seen = new Set<string>();
    for (const r of s.results) {
      if (!r.d || seen.has(r.d)) continue;
      seen.add(r.d);
      const e = found.get(r.d) ?? { keywords: 0, posSum: 0, vis: 0, traffic: 0, top3: 0, top10: 0 };
      e.keywords++;
      e.posSum += r.p;
      e.vis += keywordVisibility(r.p);
      e.traffic += keywordTraffic(r.p, volumes.get(s.keyword_id));
      if (r.p <= 3) e.top3++;
      if (r.p <= 10) e.top10++;
      found.set(r.d, e);
    }
  }
  const discovered = [...found.entries()]
    .map(([domain, e]) => ({ domain, tracked: ctx.domains.includes(domain), keywords: e.keywords, avgPosition: e.posSum / e.keywords, visibility: e.vis / n, traffic: e.traffic, top3: e.top3, top10: e.top10 }))
    .sort((a, b) => b.visibility - a.visibility)
    .slice(0, 30);
  return { rows, daily, discovered, serpDay: serps[0]?.day ?? null, totalVolume };
}

// ------------------------------------------------------------------------------------ Pages

export async function pages(ctx: Ctx, domain: string) {
  const [startRows, endRows] = await Promise.all([loadRows(ctx, ctx.startDay ? [ctx.startDay] : []), loadRows(ctx, ctx.endDay ? [ctx.endDay] : [])]);
  const kw = new Map(ctx.selected.map((k) => [k.id, k]));
  const n = endRows.length || 1;
  type Page = { url: string; keywords: number; keywordsStart: number; vis: number; visStart: number; traffic: number; posSum: number; top10: number; top: { keyword: string; position: number; id: string }[] };
  const map = new Map<string, Page>();
  const get = (url: string) => {
    let p = map.get(url);
    if (!p) map.set(url, (p = { url, keywords: 0, keywordsStart: 0, vis: 0, visStart: 0, traffic: 0, posSum: 0, top10: 0, top: [] }));
    return p;
  };
  for (const r of endRows) {
    const pos = r.positions[domain];
    const url = r.urls[domain];
    if (pos == null || !url) continue;
    const p = get(url);
    const k = kw.get(r.keyword_id);
    p.keywords++;
    p.vis += keywordVisibility(pos);
    p.traffic += keywordTraffic(pos, k?.volume, r.features);
    p.posSum += pos;
    if (pos <= 10) p.top10++;
    p.top.push({ keyword: k?.keyword ?? "", position: pos, id: r.keyword_id });
  }
  for (const r of startRows) {
    const pos = r.positions[domain];
    const url = r.urls[domain];
    if (pos == null || !url) continue;
    const p = get(url);
    p.keywordsStart++;
    p.visStart += keywordVisibility(pos);
  }
  return [...map.values()]
    .map((p) => ({
      url: p.url,
      keywords: p.keywords,
      keywordsDelta: p.keywords - p.keywordsStart,
      visibility: p.vis / n,
      visibilityDelta: (p.vis - p.visStart) / n,
      traffic: Math.round(p.traffic),
      avgPosition: p.keywords ? p.posSum / p.keywords : null,
      top10: p.top10,
      topKeywords: p.top.sort((a, b) => a.position - b.position).slice(0, 5),
    }))
    .sort((a, b) => b.visibility - a.visibility || b.keywordsDelta - a.keywordsDelta);
}

// ------------------------------------------------------------------------------------ Cannibalization

export async function cannibalization(ctx: Ctx) {
  const own = ctx.project.domain;
  if (!ctx.startDay) return { rows: [], score: 100, ranking: 0, affectedPages: 0, switches: 0, days: ctx.days };
  const ids = new Set(ctx.selected.map((k) => k.id));
  const data = await query<{ keyword_id: string; day: string; own_urls: { url: string; position: number }[] }>(
    "SELECT keyword_id, day, own_urls FROM pt_rankings WHERE project_id=$1 AND device=$2 AND day>=$3 ORDER BY day",
    [ctx.project.id, ctx.device, ctx.startDay],
  );
  const byKw = new Map<string, Map<string, { url: string; position: number }[]>>();
  for (const r of data) {
    if (!ids.has(r.keyword_id)) continue;
    const m = byKw.get(r.keyword_id) ?? new Map();
    m.set(r.day, r.own_urls ?? []);
    byKw.set(r.keyword_id, m);
  }
  const kw = new Map(ctx.selected.map((k) => [k.id, k]));
  let ranking = 0;
  const pagesHit = new Set<string>();
  let totalSwitches = 0;
  const rows = [];
  for (const [id, m] of byKw) {
    const list = ctx.days.map((d) => m.get(d) ?? []);
    const endUrls = list[list.length - 1] ?? [];
    if (list.some((l) => l.length)) ranking++;
    const urls: string[] = [];
    for (const l of list) for (const u of l) if (!urls.includes(u.url)) urls.push(u.url);
    let switches = 0;
    let prev: string | null = null;
    let multiDays = 0;
    for (const l of list) {
      if (l.length > 1) multiDays++;
      const top = l[0]?.url ?? null;
      if (top && prev && top !== prev) switches++;
      if (top) prev = top;
    }
    if (urls.length < 2) continue;
    totalSwitches += switches;
    urls.forEach((u) => pagesHit.add(u));
    const k = kw.get(id);
    const severity = endUrls.length > 1 ? "high" : switches >= 3 ? "high" : switches >= 1 ? "medium" : "low";
    rows.push({
      id,
      keyword: k?.keyword ?? "",
      volume: k?.volume ?? null,
      position: endUrls[0]?.position ?? null,
      urls: urls.map((u) => ({ url: u, days: list.filter((l) => l.some((x) => x.url === u)).length, current: endUrls.find((x) => x.url === u)?.position ?? null })),
      switches,
      multiDays,
      severity: severity as "high" | "medium" | "low",
      timeline: list.map((l) => (l.length ? urls.indexOf(l[0].url) : -1)),
    });
  }
  rows.sort((a, b) => (a.severity === b.severity ? b.switches + b.multiDays - (a.switches + a.multiDays) : a.severity === "high" ? -1 : b.severity === "high" ? 1 : a.severity === "medium" ? -1 : 1));
  const score = ranking ? Math.round((1 - rows.length / ranking) * 100) : 100;
  return { rows, score, ranking, affectedPages: pagesHit.size, switches: totalSwitches, days: ctx.days };
}

// ------------------------------------------------------------------------------------ SERP features

export async function serpFeatures(ctx: Ctx) {
  const own = ctx.project.domain;
  const [startRows, endRows] = await Promise.all([loadRows(ctx, ctx.startDay ? [ctx.startDay] : []), loadRows(ctx, ctx.endDay ? [ctx.endDay] : [])]);
  const ids = new Set(ctx.selected.map((k) => k.id));
  const trendRows = ctx.startDay
    ? await query<{ keyword_id: string; day: string; owned: SerpFeature[]; features: SerpFeature[] }>("SELECT keyword_id, day, owned, features FROM pt_rankings WHERE project_id=$1 AND device=$2 AND day>=$3", [ctx.project.id, ctx.device, ctx.startDay])
    : [];
  const trendMap = new Map<string, { owned: number; present: number }>();
  for (const r of trendRows) {
    if (!ids.has(r.keyword_id)) continue;
    const e = trendMap.get(r.day) ?? { owned: 0, present: 0 };
    e.owned += r.owned.filter((f) => f !== "related_searches").length;
    e.present += r.features.filter((f) => f !== "related_searches").length;
    trendMap.set(r.day, e);
  }
  const trend = ctx.days.map((d) => ({ day: d, owned: trendMap.get(d)?.owned ?? 0, present: trendMap.get(d)?.present ?? 0 }));
  const kw = new Map(ctx.selected.map((k) => [k.id, k]));
  const startMap = new Map(startRows.map((r) => [r.keyword_id, r]));
  const featureMap = new Map<SerpFeature, { present: number; owned: number; ownedStart: number; presentStart: number }>();
  for (const r of endRows)
    for (const f of r.features) {
      if (f === "related_searches") continue;
      const e = featureMap.get(f) ?? { present: 0, owned: 0, ownedStart: 0, presentStart: 0 };
      e.present++;
      if (r.owned.includes(f)) e.owned++;
      featureMap.set(f, e);
    }
  for (const r of startRows)
    for (const f of r.features) {
      const e = featureMap.get(f);
      if (!e) continue;
      e.presentStart++;
      if (r.owned.includes(f)) e.ownedStart++;
    }
  const features = [...featureMap.entries()].map(([feature, v]) => ({ feature, ...v })).sort((a, b) => b.present - a.present);
  const snippets = endRows
    .filter((r) => r.features.includes("featured_snippet"))
    .map((r) => {
      const k = kw.get(r.keyword_id);
      const pos = r.positions[own] ?? null;
      const owner = r.fs_owner;
      const prevOwner = startMap.get(r.keyword_id)?.fs_owner ?? null;
      return {
        id: r.keyword_id,
        keyword: k?.keyword ?? "",
        volume: k?.volume ?? null,
        position: pos,
        owner,
        prevOwner,
        ownerIsCompetitor: owner != null && ctx.campaign.competitors.includes(owner),
        status: (owner === own ? "owned" : pos != null && pos <= 10 ? "opportunity" : "other") as "owned" | "opportunity" | "other",
        url: r.urls[own] ?? null,
      };
    })
    .sort((a, b) => (a.status === b.status ? (b.volume ?? 0) - (a.volume ?? 0) : a.status === "opportunity" ? -1 : b.status === "opportunity" ? 1 : a.status === "owned" ? -1 : 1));
  const matrix = endRows.map((r) => ({ id: r.keyword_id, keyword: kw.get(r.keyword_id)?.keyword ?? "", position: r.positions[own] ?? null, features: r.features.filter((f) => f !== "related_searches"), owned: r.owned, volume: kw.get(r.keyword_id)?.volume ?? null }));
  return { features, snippets, trend, matrix };
}

// ------------------------------------------------------------------------------------ Devices

export async function devicesReport(ctx: Ctx) {
  const own = ctx.project.domain;
  const both = ctx.devices.length > 1;
  const daily: Record<string, DayAggregate[]> = {};
  const endRows: Record<string, RankRow[]> = {};
  for (const d of ctx.devices) {
    const sub = { ...ctx, device: d };
    daily[d] = (await loadDaily(sub, d)).filter((x) => x.domain === own);
    endRows[d] = ctx.endDay ? await loadRows(sub, [ctx.endDay], d) : [];
  }
  const kw = new Map(ctx.selected.map((k) => [k.id, k]));
  const rows = both
    ? endRows.desktop.map((r) => {
        const m = endRows.mobile.find((x) => x.keyword_id === r.keyword_id);
        const dp = r.positions[own] ?? null;
        const mp = m?.positions[own] ?? null;
        return { id: r.keyword_id, keyword: kw.get(r.keyword_id)?.keyword ?? "", volume: kw.get(r.keyword_id)?.volume ?? null, desktop: dp, mobile: mp, diff: dp != null && mp != null ? dp - mp : null, desktopUrl: r.urls[own] ?? null, mobileUrl: m?.urls[own] ?? null };
      })
    : [];
  return { both, daily, rows };
}

// ------------------------------------------------------------------------------------ Tags

export async function tagsReport(ctx: Ctx) {
  const own = ctx.project.domain;
  const all = { ...ctx, selected: ctx.keywords, filtered: false };
  const [startRows, endRows] = await Promise.all([loadRows(all, ctx.startDay ? [ctx.startDay] : []), loadRows(all, ctx.endDay ? [ctx.endDay] : [])]);
  const volumes = new Map(ctx.keywords.map((k) => [k.id, k.volume]));
  return ctx.tags.map((t) => {
    const ids = new Set(ctx.keywords.filter((k) => k.tags.some((x) => x.id === t.id)).map((k) => k.id));
    const [e] = aggregateDay(ctx.endDay ?? "", endRows.filter((r) => ids.has(r.keyword_id)), [own], volumes);
    const [s] = aggregateDay(ctx.startDay ?? "", startRows.filter((r) => ids.has(r.keyword_id)), [own], volumes);
    return {
      id: t.id,
      name: t.name,
      keywords: t.keywords,
      visibility: e.keywords ? e.visibility : null,
      visibilityDelta: e.keywords && s.keywords ? e.visibility - s.visibility : null,
      avgPosition: e.keywords ? e.avgPosition : null,
      traffic: e.keywords ? Math.round(e.traffic) : null,
      top3: e.top3,
      top10: e.top10,
      createdAt: t.createdAt,
    };
  });
}
