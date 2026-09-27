import { database } from "@/lib/domain";
import {
  anchors as engineAnchors,
  backlinks as engineBacklinks,
  domainCompetitors,
  domainEntity,
  domainFacts,
  GIANTS,
  linkVelocity,
  memo,
  referringDomains as engineReferringDomains,
  rng,
  round,
  topicById,
  topicPool,
} from "@/lib/seo/engine";
import { LINK_PLATFORMS } from "@/lib/seo/engine/vocab";
import { AS_BUCKETS, asBucketIndex, backlinkHeadline, countBy, hosting, linkingDomainAs, linkMix, pctChange, subnetOf, sumVelocity, tldOf } from "./metrics";
import {
  ANCHOR_TYPE_LABELS,
  type AnchorRow,
  type BacklinkRow,
  type BlHistoryPoint,
  type BlOverview,
  type BlSummary,
  type CompareData,
  type CompareEntry,
  type CompetitorRow,
  type IndexedPageRow,
  type IpRow,
  type OutboundRow,
  type RefDomainRow,
  type Share,
} from "./types";
export * from "./types";

/* ------------------------------------------------------------------------------------------------
 * Demo builders
 * ---------------------------------------------------------------------------------------------- */

const factsOf = (domain: string) => domainFacts(domain, domainEntity(domain).homeDb);

function scaleOf(domain: string) {
  const f = factsOf(domain);
  const rds = engineReferringDomains(domain);
  const bls = engineBacklinks(domain);
  return { f, rds, bls, rdScale: f.referringDomains / Math.max(1, rds.length), blScale: f.backlinks / Math.max(1, bls.length) };
}

/** Deterministic outbound-link profile (the engine has no outbound index). */
const outboundSample = memo((domain: string): { rows: OutboundRow[]; total: number; previous: number } => {
  const e = domainEntity(domain);
  const f = factsOf(domain);
  const h = backlinkHeadline(domain);
  const r = rng(`outbound:${domain}`);
  const total = Math.max(4, Math.round(h.referringDomains * r.range(0.03, 0.16) + 6 + 60 * e.strength));
  const previous = Math.max(1, Math.round(total * (1 - r.range(-0.035, 0.07))));
  const topic = topicById(f.topicId);
  const pool = [
    ...topicPool(f.topicId)
      .filter((p) => p.kind !== "giant")
      .map((p) => ({ domain: p.domain, category: topic.name })),
    ...LINK_PLATFORMS.map((d) => ({ domain: d, category: "Online communities" })),
    ...GIANTS.map((g) => ({ domain: g.domain, category: "Popular platforms" })),
  ].filter((c, i, arr) => c.domain !== domain && arr.findIndex((x) => x.domain === c.domain) === i);
  const inbound = new Set(engineReferringDomains(domain).map((x) => x.domain));
  const count = Math.min(pool.length, Math.min(total, 120));
  const picked = r.sample(pool, count);
  const now = Date.now();
  const rows = picked
    .map((c) => {
      const cr = rng(`outbound:${domain}:${c.domain}`);
      return {
        domain: c.domain,
        authorityScore: linkingDomainAs(c.domain),
        category: c.category,
        links: Math.max(1, Math.round(cr.logNormal(3, 1.1))),
        linksBack: inbound.has(c.domain),
        firstSeen: new Date(now - Math.round(cr.next() ** 1.4 * 4 * 365 * 86400000)).toISOString().slice(0, 10),
      };
    })
    .sort((a, b) => b.links - a.links || b.authorityScore - a.authorityScore);
  return { rows, total, previous };
}, 200);

export function demoSummary(domain: string): BlSummary {
  const f = factsOf(domain);
  const last = f.history[f.history.length - 1];
  const prev = f.history[f.history.length - 2];
  const out = outboundSample(domain);
  const ipRatio = f.referringIps / Math.max(1, f.referringDomains);
  return {
    domain,
    topicName: f.topicName,
    homeDb: f.homeDb,
    authorityScore: f.authorityScore,
    authorityDelta: last.authorityScore === prev.authorityScore ? null : pctChange(last.authorityScore, prev.authorityScore),
    referringDomains: f.referringDomains,
    referringDomainsDelta: pctChange(last.referringDomains, prev.referringDomains),
    backlinks: f.backlinks,
    backlinksDelta: pctChange(last.backlinks, prev.backlinks),
    referringIps: f.referringIps,
    referringIpsDelta: pctChange(Math.round(last.referringDomains * ipRatio), Math.round(prev.referringDomains * ipRatio)),
    outboundDomains: out.total,
    outboundDomainsDelta: pctChange(out.total, out.previous),
    followRatio: f.followRatio,
    sample: { referringDomains: engineReferringDomains(domain).length, backlinks: engineBacklinks(domain).length },
  };
}

function shares(map: Map<string, number>, scale: number, limit: number): Share[] {
  const total = [...map.values()].reduce((s, v) => s + v, 0) || 1;
  const sorted = [...map.entries()].sort((a, b) => b[1] - a[1]);
  const top = sorted.slice(0, limit).map(([label, n]) => ({ label, value: Math.round(n * scale), share: round((n / total) * 100, 1) }));
  const rest = sorted.slice(limit).reduce((s, [, n]) => s + n, 0);
  if (rest > 0) top.push({ label: "Other", value: Math.round(rest * scale), share: round((rest / total) * 100, 1) });
  return top;
}

export function demoOverview(domain: string): BlOverview {
  const { f, rds, bls, rdScale, blScale } = scaleOf(domain);
  const ipRatio = f.referringIps / Math.max(1, f.referringDomains);
  const velocity = linkVelocity(domain, 90);
  const mix = linkMix(domain);

  const asCounts = AS_BUCKETS.map(() => 0);
  for (const r of rds) asCounts[Math.max(0, asBucketIndex(r.authorityScore))]++;

  const countryMap = countBy(rds, (r) => hosting(r).country);
  const countries = shares(countryMap, rdScale, 8).map((s) => {
    const info = s.label === "Other" ? null : database(s.label);
    return { ...s, code: s.label, label: info?.name ?? "Other", flag: info?.flag ?? "🌐" };
  });

  const anchorList = engineAnchors(domain);
  const anchorTypeMap = new Map<string, number>();
  for (const a of anchorList) anchorTypeMap.set(ANCHOR_TYPE_LABELS[a.type], (anchorTypeMap.get(ANCHOR_TYPE_LABELS[a.type]) ?? 0) + a.referringDomains);

  const pages = new Map<string, { domains: Set<string>; backlinks: number }>();
  for (const b of bls) {
    const p = pages.get(b.targetUrl) ?? { domains: new Set<string>(), backlinks: 0 };
    p.domains.add(b.sourceDomain);
    p.backlinks++;
    pages.set(b.targetUrl, p);
  }

  const total = f.backlinks;
  return {
    history: f.history.map((h) => ({ month: h.month, referringDomains: h.referringDomains, backlinks: h.backlinks, authorityScore: h.authorityScore, referringIps: Math.round(h.referringDomains * ipRatio) })),
    velocity,
    last30: sumVelocity(velocity.slice(-30)),
    asBuckets: AS_BUCKETS.map((b, i) => ({ label: b.label, domains: Math.round(asCounts[i] * rdScale) })),
    categories: shares(countBy(rds, (r) => r.category), rdScale, 7),
    tlds: shares(countBy(rds, (r) => tldOf(r.domain)), rdScale, 7),
    countries,
    anchors: anchorList.slice(0, 10).map((a) => ({ anchor: a.anchor, type: a.type, referringDomains: a.referringDomains, backlinks: a.backlinks })),
    anchorTypes: shares(anchorTypeMap, 1, 6),
    attributes: [
      { label: "Follow", value: Math.round(total * mix.follow), share: round(mix.follow * 100, 1) },
      { label: "Nofollow", value: Math.round(total * mix.nofollow), share: round(mix.nofollow * 100, 1) },
      { label: "UGC", value: Math.round(total * mix.ugc), share: round(mix.ugc * 100, 1) },
      { label: "Sponsored", value: Math.round(total * mix.sponsored), share: round(mix.sponsored * 100, 1) },
    ],
    linkTypes: [
      { label: "Text", value: Math.round(total * mix.text), share: round(mix.text * 100, 1) },
      { label: "Image", value: Math.round(total * mix.image), share: round(mix.image * 100, 1) },
      { label: "Form", value: Math.round(total * mix.form), share: round(mix.form * 100, 1) },
      { label: "Frame", value: Math.round(total * mix.frame), share: round(mix.frame * 100, 1) },
    ],
    topPages: [...pages.entries()]
      .map(([url, p]) => ({ url, referringDomains: Math.max(1, Math.round(p.domains.size * rdScale)), backlinks: Math.max(1, Math.round(p.backlinks * blScale)) }))
      .sort((a, b) => b.referringDomains - a.referringDomains)
      .slice(0, 8),
    topReferringDomains: rds.slice(0, 8).map((r) => ({ domain: r.domain, authorityScore: r.authorityScore, backlinks: r.backlinks, country: hosting(r).country, firstSeen: r.firstSeen })),
  };
}

export function demoBacklinks(domain: string): BacklinkRow[] {
  return engineBacklinks(domain).map((b, i) => ({
    id: `${i}`,
    sourceUrl: b.sourceUrl,
    sourceTitle: b.sourceTitle,
    sourceDomain: b.sourceDomain,
    pageAs: b.pageAuthorityScore,
    targetUrl: b.targetUrl,
    anchor: b.anchor,
    anchorType: b.anchorType,
    type: b.type,
    rel: b.rel,
    follow: b.follow,
    firstSeen: b.firstSeen,
    lastSeen: b.lastSeen,
    isNew: b.isNew,
    isLost: b.isLost,
    externalLinks: b.externalLinks,
    internalLinks: b.internalLinks,
    language: b.language,
  }));
}

export function demoReferringDomains(domain: string): RefDomainRow[] {
  return engineReferringDomains(domain).map((r) => ({
    domain: r.domain,
    authorityScore: r.authorityScore,
    backlinks: r.backlinks,
    country: hosting(r).country,
    ip: hosting(r).ip,
    category: r.category,
    firstSeen: r.firstSeen,
    lastSeen: r.lastSeen,
    isNew: r.isNew,
    isLost: r.isLost,
    follow: r.follow,
  }));
}

export function demoAnchors(domain: string): AnchorRow[] {
  const cutoff = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  return engineAnchors(domain).map((a) => ({ ...a, isNew: a.firstSeen >= cutoff }));
}

export function demoIps(domain: string): { ips: IpRow[]; subnets: IpRow[] } {
  const rds = engineReferringDomains(domain);
  const group = (key: (ip: string) => string) => {
    const map = new Map<string, IpRow>();
    for (const r of rds) {
      const host = hosting(r);
      const k = key(host.ip);
      const row = map.get(k) ?? { ip: k, country: host.country, domains: 0, sampleDomains: [], backlinks: 0, firstSeen: r.firstSeen, lastSeen: r.lastSeen };
      row.domains++;
      if (row.sampleDomains.length < 3) row.sampleDomains.push(r.domain);
      row.backlinks += r.backlinks;
      if (r.firstSeen < row.firstSeen) row.firstSeen = r.firstSeen;
      if (r.lastSeen > row.lastSeen) row.lastSeen = r.lastSeen;
      map.set(k, row);
    }
    return [...map.values()].sort((a, b) => b.domains - a.domains || b.backlinks - a.backlinks);
  };
  return { ips: group((ip) => ip), subnets: group(subnetOf) };
}

function titleFromUrl(url: string, domain: string) {
  try {
    const u = new URL(url);
    const seg = u.pathname.split("/").filter(Boolean).pop();
    if (!seg) return `${domain} — Home`;
    return seg.replace(/[-_]+/g, " ").replace(/\b[a-z]/g, (c) => c.toUpperCase());
  } catch {
    return url;
  }
}

export function demoIndexedPages(domain: string): IndexedPageRow[] {
  const { bls, rdScale, blScale } = scaleOf(domain);
  const map = new Map<string, { domains: Set<string>; backlinks: number; follow: number; anchors: Map<string, number>; first: string; last: string }>();
  for (const b of bls) {
    const p = map.get(b.targetUrl) ?? { domains: new Set<string>(), backlinks: 0, follow: 0, anchors: new Map<string, number>(), first: b.firstSeen, last: b.lastSeen };
    p.domains.add(b.sourceDomain);
    p.backlinks++;
    if (b.follow) p.follow++;
    const a = b.anchor || "<EmptyAnchor>";
    p.anchors.set(a, (p.anchors.get(a) ?? 0) + 1);
    if (b.firstSeen < p.first) p.first = b.firstSeen;
    if (b.lastSeen > p.last) p.last = b.lastSeen;
    map.set(b.targetUrl, p);
  }
  return [...map.entries()]
    .map(([url, p]) => ({
      url,
      title: titleFromUrl(url, domain),
      referringDomains: Math.max(1, Math.round(p.domains.size * rdScale)),
      backlinks: Math.max(1, Math.round(p.backlinks * blScale)),
      followPct: round((p.follow / p.backlinks) * 100, 1),
      topAnchor: [...p.anchors.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "",
      firstSeen: p.first,
      lastSeen: p.last,
    }))
    .sort((a, b) => b.referringDomains - a.referringDomains);
}

export function demoOutbound(domain: string): { rows: OutboundRow[]; total: number } {
  const o = outboundSample(domain);
  return { rows: o.rows, total: o.total };
}

/** Domains with similar backlink profiles: ranked by shared referring domains (sample overlap). */
export const demoCompetitors = memo((domain: string): CompetitorRow[] => {
  const f = factsOf(domain);
  const mine = engineReferringDomains(domain);
  const mineSet = new Set(mine.map((r) => r.domain));
  const myScale = f.referringDomains / Math.max(1, mine.length);
  const organic = domainCompetitors(domain, f.homeDb, 10).map((c) => c.domain);
  const peers = topicPool(f.topicId)
    .filter((p) => p.kind !== "giant" && p.domain !== domain)
    .sort((a, b) => Math.abs(a.strength - f.strength) - Math.abs(b.strength - f.strength))
    .slice(0, 10)
    .map((p) => p.domain);
  const candidates = [...new Set([...organic, ...peers])].filter((d) => d !== domain).slice(0, 14);
  const rows = candidates.map((c) => {
    const theirs = engineReferringDomains(c);
    const h = backlinkHeadline(c);
    let common = 0;
    for (const r of theirs) if (mineSet.has(r.domain)) common++;
    const theirScale = h.referringDomains / Math.max(1, theirs.length);
    const jaccard = common / Math.max(1, mine.length + theirs.length - common);
    return { domain: c, authorityScore: h.authorityScore, level: jaccard, common: Math.round(common * Math.min(myScale, theirScale)), referringDomains: h.referringDomains, backlinks: h.backlinks };
  });
  const maxLevel = Math.max(...rows.map((r) => r.level), 0.0001);
  return rows
    .map((r) => ({ ...r, level: round(r.level / maxLevel, 3) }))
    .filter((r) => r.common > 0)
    .sort((a, b) => b.level - a.level);
}, 100);

/* ------------------------------------------------------------------------------------------------
 * Compare mode
 * ---------------------------------------------------------------------------------------------- */

export function demoCompare(domains: string[]): CompareData {
  const entries: CompareEntry[] = [];
  const histories: BlHistoryPoint[][] = [];
  const sets: Set<string>[] = [];
  for (const d of domains) {
    const f = factsOf(d);
    const rds = engineReferringDomains(d);
    sets.push(new Set(rds.map((r) => r.domain)));
    const last = f.history[f.history.length - 1];
    const prev = f.history[f.history.length - 2];
    const mix = linkMix(d);
    const asCounts = AS_BUCKETS.map(() => 0);
    for (const r of rds) asCounts[Math.max(0, asBucketIndex(r.authorityScore))]++;
    const cats = [...countBy(rds, (r) => r.category).entries()].sort((a, b) => b[1] - a[1]);
    entries.push({
      domain: d,
      authorityScore: f.authorityScore,
      referringDomains: f.referringDomains,
      referringDomainsDelta: pctChange(last.referringDomains, prev.referringDomains),
      backlinks: f.backlinks,
      backlinksDelta: pctChange(last.backlinks, prev.backlinks),
      referringIps: f.referringIps,
      followPct: round(mix.follow * 100, 1),
      textPct: round(mix.text * 100, 1),
      imagePct: round(mix.image * 100, 1),
      last30: sumVelocity(linkVelocity(d, 30)),
      asShares: asCounts.map((n) => round((n / Math.max(1, rds.length)) * 100, 1)),
      topCategory: cats[0]?.[0] ?? "n/a",
    });
    histories.push(f.history.map((h) => ({ month: h.month, referringDomains: h.referringDomains, backlinks: h.backlinks, authorityScore: h.authorityScore, referringIps: 0 })));
  }
  const months = histories[0]?.map((h) => h.month) ?? [];
  const rdHistory = months.map((month, i) => Object.fromEntries([["month", month], ...histories.map((h, j) => [`d${j}`, h[i]?.referringDomains ?? 0])]));
  const blHistory = months.map((month, i) => Object.fromEntries([["month", month], ...histories.map((h, j) => [`d${j}`, h[i]?.backlinks ?? 0])]));
  const asBuckets = AS_BUCKETS.map((b, i) => Object.fromEntries([["label", b.label], ...entries.map((e, j) => [`d${j}`, e.asShares[i]])]));
  const newLost = entries.map((e) => ({ label: e.domain, new: e.last30?.newRd ?? 0, lost: e.last30?.lostRd ?? 0 }));
  let shared = 0;
  if (sets.length > 1) for (const d of sets[0]) if (sets.slice(1).every((s) => s.has(d))) shared++;
  return {
    entries,
    rdHistory,
    blHistory,
    asBuckets,
    newLost,
    common: { referringDomains: shared, sampleOverlapPct: sets[0]?.size ? round((shared / sets[0].size) * 100, 1) : 0 },
  };
}
