/* eslint-disable @typescript-eslint/no-explicit-any */
import { dfs } from "@/lib/providers/dataforseo";
import { AS_BUCKETS, asBucketIndex, pctChange, subnetOf } from "./metrics";
import { anchorType, samplesByDomain } from "./map";
import {
  ANCHOR_TYPE_LABELS,
  type AnchorRow,
  type BacklinkRow,
  type BlOverview,
  type BlSummary,
  type CompareData,
  type CompareEntry,
  type CompetitorRow,
  type IndexedPageRow,
  type IpRow,
  type RefDomainRow,
  type Share,
} from "./types";

/**
 * DataForSEO Backlinks API mappings (live mode). Field names follow the v3 docs; everything is read
 * defensively and missing values stay empty/zero-free rather than falling back to demo numbers.
 * Costs: $0.02 per request + $0.00003 per returned row (reserved worst case below).
 */
const day = (s?: string | null) => (s ? String(s).slice(0, 10) : "");
const as = (rank?: number | null) => (rank == null ? 0 : Math.round(Math.min(1000, rank) / 10));
const cost = (rows: number) => 20000 + rows * 30;

function toShares(obj: Record<string, number> | undefined, limit = 7, label: (k: string) => string = (k) => k): Share[] {
  const entries = Object.entries(obj ?? {}).filter(([, v]) => typeof v === "number" && v > 0);
  const total = entries.reduce((s, [, v]) => s + v, 0) || 1;
  const sorted = entries.sort((a, b) => b[1] - a[1]);
  const top = sorted.slice(0, limit).map(([k, v]) => ({ label: label(k), value: v, share: Math.round((v / total) * 1000) / 10 }));
  const rest = sorted.slice(limit).reduce((s, [, v]) => s + v, 0);
  if (rest) top.push({ label: "Other", value: rest, share: Math.round((rest / total) * 1000) / 10 });
  return top;
}

async function summaryRaw(ownerId: string, target: string) {
  const [s] = await dfs(ownerId, "backlinks/summary/live", { target, include_subdomains: true, backlinks_status_type: "live" }, cost(1));
  return (s ?? {}) as any;
}

async function historyRaw(ownerId: string, target: string) {
  const from = new Date(Date.UTC(new Date().getUTCFullYear() - 2, new Date().getUTCMonth(), 1)).toISOString().slice(0, 10);
  const [h] = await dfs(ownerId, "backlinks/history/live", { target, date_from: from }, cost(30)).catch(() => [undefined]);
  return ((h as any)?.items ?? []) as any[];
}

export async function summary(ownerId: string, domain: string): Promise<BlSummary> {
  const [s, hist] = await Promise.all([summaryRaw(ownerId, domain), historyRaw(ownerId, domain)]);
  const prev = hist.length > 1 ? hist[hist.length - 2] : null;
  const rd = s.referring_domains ?? 0;
  return {
    domain,
    topicName: "",
    homeDb: "US",
    authorityScore: as(s.rank),
    authorityDelta: prev ? pctChange(as(s.rank), as(prev.rank)) : null,
    referringDomains: rd,
    referringDomainsDelta: prev ? pctChange(rd, prev.referring_domains) : null,
    backlinks: s.backlinks ?? 0,
    backlinksDelta: prev ? pctChange(s.backlinks, prev.backlinks) : null,
    referringIps: s.referring_ips ?? 0,
    referringIpsDelta: prev ? pctChange(s.referring_ips, prev.referring_ips) : null,
    outboundDomains: 0,
    outboundDomainsDelta: null,
    followRatio: rd ? 1 - (s.referring_domains_nofollow ?? 0) / rd : 0,
    sample: { referringDomains: 0, backlinks: 0 },
  };
}

export async function overview(ownerId: string, domain: string): Promise<BlOverview> {
  const [s, hist, rds, anc, pgs] = await Promise.all([
    summaryRaw(ownerId, domain),
    historyRaw(ownerId, domain),
    referringDomains(ownerId, domain).catch(() => [] as RefDomainRow[]),
    anchors(ownerId, domain).catch(() => [] as AnchorRow[]),
    pages(ownerId, domain).catch(() => [] as IndexedPageRow[]),
  ]);
  const since = new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10);
  const [ts] = await dfs(ownerId, "backlinks/timeseries_new_lost_summary/live", { target: domain, date_from: since, group_range: "day" }, cost(90)).catch(() => [undefined]);
  const velocity = (((ts as any)?.items ?? []) as any[]).map((i) => ({
    date: day(i.date),
    newReferringDomains: i.new_referring_domains ?? 0,
    lostReferringDomains: i.lost_referring_domains ?? 0,
    newBacklinks: i.new_backlinks ?? 0,
    lostBacklinks: i.lost_backlinks ?? 0,
  }));
  const last30 = velocity.slice(-30).reduce((a, p) => ({ newRd: a.newRd + p.newReferringDomains, lostRd: a.lostRd + p.lostReferringDomains, newBl: a.newBl + p.newBacklinks, lostBl: a.lostBl + p.lostBacklinks }), { newRd: 0, lostRd: 0, newBl: 0, lostBl: 0 });
  const asCounts = AS_BUCKETS.map(() => 0);
  for (const r of rds) asCounts[Math.max(0, asBucketIndex(r.authorityScore))]++;
  const attrs = (s.referring_links_attributes ?? {}) as Record<string, number>;
  const types = (s.referring_links_types ?? {}) as Record<string, number>;
  const total = s.backlinks ?? 0;
  const nofollow = attrs.nofollow ?? 0;
  const typeShares = toShares({ Text: types.anchor ?? 0, Image: types.image ?? 0, Form: types.form ?? 0, Frame: (types.frame ?? 0) + (types.iframe ?? 0) }, 4);
  const anchorTypes = new Map<string, number>();
  for (const a of anc) anchorTypes.set(ANCHOR_TYPE_LABELS[a.type], (anchorTypes.get(ANCHOR_TYPE_LABELS[a.type]) ?? 0) + a.referringDomains);
  return {
    history: hist.map((h) => ({ month: day(h.date).slice(0, 7), referringDomains: h.referring_domains ?? 0, backlinks: h.backlinks ?? 0, authorityScore: as(h.rank), referringIps: h.referring_ips ?? 0 })),
    velocity,
    last30,
    asBuckets: AS_BUCKETS.map((b, i) => ({ label: b.label, domains: asCounts[i] })),
    categories: [],
    tlds: toShares(s.referring_links_tld, 7, (k) => `.${k}`),
    countries: toShares(s.referring_links_countries, 8).map((c) => ({ ...c, code: c.label, flag: "" })),
    anchors: anc.slice(0, 10).map((a) => ({ anchor: a.anchor, type: a.type, referringDomains: a.referringDomains, backlinks: a.backlinks })),
    anchorTypes: toShares(Object.fromEntries(anchorTypes), 6),
    attributes: total
      ? [
          { label: "Follow", value: Math.max(0, total - nofollow), share: Math.round(((total - nofollow) / total) * 1000) / 10 },
          { label: "Nofollow", value: nofollow, share: Math.round((nofollow / total) * 1000) / 10 },
          { label: "UGC", value: attrs.ugc ?? 0, share: Math.round(((attrs.ugc ?? 0) / total) * 1000) / 10 },
          { label: "Sponsored", value: attrs.sponsored ?? 0, share: Math.round(((attrs.sponsored ?? 0) / total) * 1000) / 10 },
        ]
      : [],
    linkTypes: typeShares,
    topPages: pgs.slice(0, 8).map((p) => ({ url: p.url, referringDomains: p.referringDomains, backlinks: p.backlinks })),
    topReferringDomains: rds.slice(0, 8).map((r) => ({ domain: r.domain, authorityScore: r.authorityScore, backlinks: r.backlinks, country: r.country, firstSeen: r.firstSeen })),
  };
}

export async function backlinks(ownerId: string, domain: string): Promise<BacklinkRow[]> {
  const [r] = await dfs(ownerId, "backlinks/backlinks/live", { target: domain, mode: "as_is", limit: 1000, order_by: ["rank,desc"] }, cost(1000));
  return (((r as any)?.items ?? []) as any[]).map((b, i) => {
    const rel = ((b.attributes ?? []) as string[]).filter((x) => ["nofollow", "ugc", "sponsored"].includes(x));
    const itemType = String(b.item_type ?? "anchor");
    return {
      id: String(i),
      sourceUrl: b.url_from ?? "",
      sourceTitle: b.page_from_title ?? "",
      sourceDomain: b.domain_from ?? "",
      pageAs: as(b.page_from_rank),
      targetUrl: b.url_to ?? "",
      anchor: b.anchor ?? "",
      anchorType: anchorType(b.anchor ?? "", domain),
      type: itemType === "image" ? "image" : itemType === "form" ? "form" : itemType.includes("frame") ? "frame" : "text",
      rel,
      follow: b.dofollow ?? !rel.includes("nofollow"),
      firstSeen: day(b.first_seen),
      lastSeen: day(b.last_seen),
      isNew: Boolean(b.is_new),
      isLost: Boolean(b.is_lost),
      externalLinks: b.page_from_external_links ?? 0,
      internalLinks: b.page_from_internal_links ?? 0,
      language: b.page_from_language ?? "",
    } satisfies BacklinkRow;
  });
}

export async function referringDomains(ownerId: string, domain: string): Promise<RefDomainRow[]> {
  const [r] = await dfs(ownerId, "backlinks/referring_domains/live", { target: domain, limit: 1000, order_by: ["rank,desc"] }, cost(1000));
  const cutoff = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  return (((r as any)?.items ?? []) as any[]).map((d) => ({
    domain: d.domain ?? "",
    authorityScore: as(d.rank),
    backlinks: d.backlinks ?? 0,
    country: "",
    ip: "",
    category: "",
    firstSeen: day(d.first_seen),
    lastSeen: day(d.lost_date) || "",
    isNew: day(d.first_seen) >= cutoff,
    isLost: Boolean(d.lost_date),
    follow: (d.referring_links_attributes?.nofollow ?? 0) < (d.backlinks ?? 0),
    spamScore: typeof d.backlinks_spam_score === "number" ? d.backlinks_spam_score : null,
  }));
}

export async function anchors(ownerId: string, domain: string): Promise<AnchorRow[]> {
  const [r] = await dfs(ownerId, "backlinks/anchors/live", { target: domain, limit: 1000, order_by: ["referring_domains,desc"] }, cost(1000));
  const cutoff = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  return (((r as any)?.items ?? []) as any[]).map((a) => ({
    anchor: a.anchor || "<EmptyAnchor>",
    type: anchorType(a.anchor ?? "", domain),
    referringDomains: a.referring_domains ?? 0,
    backlinks: a.backlinks ?? 0,
    firstSeen: day(a.first_seen),
    lastSeen: day(a.lost_date),
    isNew: day(a.first_seen) >= cutoff,
  }));
}

export async function networks(ownerId: string, domain: string): Promise<{ ips: IpRow[]; subnets: IpRow[] }> {
  const get = async (type: "ip" | "subnet") => {
    const [r] = await dfs(ownerId, "backlinks/referring_networks/live", { target: domain, network_address_type: type, limit: 1000 }, cost(1000));
    return (((r as any)?.items ?? []) as any[]).map((n) => ({
      ip: type === "subnet" && n.network_address ? subnetOf(n.network_address) : (n.network_address ?? ""),
      country: "",
      domains: n.referring_domains ?? 0,
      sampleDomains: [],
      backlinks: n.backlinks ?? 0,
      firstSeen: day(n.first_seen),
      lastSeen: day(n.lost_date),
    }));
  };
  const [ips, subnets] = await Promise.all([get("ip"), get("subnet")]);
  return { ips, subnets };
}

export async function pages(ownerId: string, domain: string): Promise<IndexedPageRow[]> {
  const [r] = await dfs(ownerId, "backlinks/domain_pages/live", { target: domain, limit: 1000, order_by: ["page_summary.referring_domains,desc"] }, cost(1000));
  return (((r as any)?.items ?? []) as any[]).map((p) => {
    const ps = p.page_summary ?? {};
    const bl = ps.backlinks ?? 0;
    return {
      url: p.page ?? "",
      title: p.meta?.title ?? "",
      referringDomains: ps.referring_domains ?? 0,
      backlinks: bl,
      followPct: bl ? Math.round(((bl - (ps.referring_links_attributes?.nofollow ?? 0)) / bl) * 1000) / 10 : 0,
      topAnchor: "",
      firstSeen: day(ps.first_seen),
      lastSeen: day(ps.lost_date),
    };
  });
}

export async function competitors(ownerId: string, domain: string): Promise<CompetitorRow[]> {
  const [r] = await dfs(ownerId, "backlinks/competitors/live", { target: domain, limit: 20, exclude_large_domains: true }, cost(20));
  const items = (((r as any)?.items ?? []) as any[]).filter((c) => c.target && c.target !== domain);
  const max = Math.max(1, ...items.map((c) => c.intersections ?? 0));
  const targets = items.map((c) => String(c.target));
  // Real totals for the competitors (bulk endpoints); left at 0 (= shown as n/a) if they fail.
  const [bls, rds] = targets.length
    ? await Promise.all([
        dfs(ownerId, "backlinks/bulk_backlinks/live", { targets }, cost(targets.length)).catch(() => []),
        dfs(ownerId, "backlinks/bulk_referring_domains/live", { targets }, cost(targets.length)).catch(() => []),
      ])
    : [[], []];
  const by = (res: any[]) => new Map<string, any>((((res?.[0] as any)?.items ?? []) as any[]).map((i) => [i.target, i]));
  const blMap = by(bls as any[]);
  const rdMap = by(rds as any[]);
  return items.map((c) => ({
    domain: c.target,
    authorityScore: as(c.rank),
    level: (c.intersections ?? 0) / max,
    common: c.intersections ?? 0,
    referringDomains: rdMap.get(c.target)?.referring_domains ?? 0,
    backlinks: blMap.get(c.target)?.backlinks ?? 0,
  }));
}

export async function compare(ownerId: string, domains: string[]): Promise<CompareData> {
  const entries: CompareEntry[] = [];
  const histories: any[][] = [];
  for (const d of domains) {
    const [s, hist] = await Promise.all([summaryRaw(ownerId, d), historyRaw(ownerId, d)]);
    const prev = hist.length > 1 ? hist[hist.length - 2] : null;
    const total = s.backlinks ?? 0;
    const types = s.referring_links_types ?? {};
    entries.push({
      domain: d,
      authorityScore: as(s.rank),
      referringDomains: s.referring_domains ?? 0,
      referringDomainsDelta: prev ? pctChange(s.referring_domains, prev.referring_domains) : null,
      backlinks: total,
      backlinksDelta: prev ? pctChange(total, prev.backlinks) : null,
      referringIps: s.referring_ips ?? 0,
      followPct: total ? Math.round(((total - (s.referring_links_attributes?.nofollow ?? 0)) / total) * 1000) / 10 : 0,
      textPct: total ? Math.round(((types.anchor ?? 0) / total) * 1000) / 10 : 0,
      imagePct: total ? Math.round(((types.image ?? 0) / total) * 1000) / 10 : 0,
      last30: null,
      asShares: AS_BUCKETS.map(() => 0),
      topCategory: "",
    });
    histories.push(hist);
  }
  const months = (histories[0] ?? []).map((h) => day(h.date).slice(0, 7));
  return {
    entries,
    rdHistory: months.map((month, i) => Object.fromEntries([["month", month], ...histories.map((h, j) => [`d${j}`, h[i]?.referring_domains ?? 0])])),
    blHistory: months.map((month, i) => Object.fromEntries([["month", month], ...histories.map((h, j) => [`d${j}`, h[i]?.backlinks ?? 0])])),
    asBuckets: [],
    newLost: [],
    common: { referringDomains: 0, sampleOverlapPct: 0 },
  };
}

/** Bulk metrics for up to 200 targets (ranks, backlinks, referring domains, new/lost in the last 30 days). */
export async function bulk(ownerId: string, targets: string[]) {
  const since = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  const [ranks, bls, rds, nlr, nlb] = await Promise.all([
    dfs(ownerId, "backlinks/bulk_ranks/live", { targets }, cost(targets.length)),
    dfs(ownerId, "backlinks/bulk_backlinks/live", { targets }, cost(targets.length)),
    dfs(ownerId, "backlinks/bulk_referring_domains/live", { targets }, cost(targets.length)),
    dfs(ownerId, "backlinks/bulk_new_lost_referring_domains/live", { targets, date_from: since }, cost(targets.length)).catch(() => []),
    dfs(ownerId, "backlinks/bulk_new_lost_backlinks/live", { targets, date_from: since }, cost(targets.length)).catch(() => []),
  ]);
  const by = (res: any[]) => new Map<string, any>((((res?.[0] as any)?.items ?? []) as any[]).map((i) => [i.target, i]));
  return { ranks: by(ranks), backlinks: by(bls), referringDomains: by(rds), newLostRd: by(nlr as any[]), newLostBl: by(nlb as any[]) };
}

/** Referring domains with DataForSEO's spam score, for the Backlink Audit in live mode. */
export async function auditDomains(ownerId: string, domain: string) {
  const [r] = await dfs(ownerId, "backlinks/referring_domains/live", { target: domain, limit: 1000, order_by: ["backlinks_spam_score,desc"] }, cost(1000));
  return (((r as any)?.items ?? []) as any[]).map((d) => ({
    domain: String(d.domain ?? ""),
    spamScore: typeof d.backlinks_spam_score === "number" ? d.backlinks_spam_score : null,
    authorityScore: as(d.rank),
    backlinks: Number(d.backlinks ?? 0),
    firstSeen: day(d.first_seen),
    lastSeen: day(d.lost_date),
    follow: (d.referring_links_attributes?.nofollow ?? 0) < (d.backlinks ?? 0),
  }));
}

/** One sample backlink per referring domain (anchor, source URL, IP, country) for the live audit. */
export async function auditSamples(ownerId: string, domain: string) {
  const [r] = await dfs(ownerId, "backlinks/backlinks/live", { target: domain, mode: "one_per_domain", limit: 1000 }, cost(1000)).catch(() => [undefined]);
  return samplesByDomain(((r as any)?.items ?? []) as any[]);
}
