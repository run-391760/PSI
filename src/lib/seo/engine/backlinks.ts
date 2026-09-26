import { domainLabel } from "@/lib/domain";
import { brandPhrase, domainEntity, domainFacts, domainLinkStats, domainPages, slugify, topicPool } from "./domains";
import { topicById } from "./keywords";
import { clamp, hash, memo, rng, round, unit } from "./random";
import { LINK_PLATFORMS, NICHE_PREFIXES, NICHE_SUFFIXES, NICHE_TLDS, SPAM_STEMS, SPAM_TLDS, TOPICS } from "./vocab";

export type RefDomainKind = "peer" | "platform" | "blog" | "spam";
export type ReferringDomain = {
  domain: string;
  kind: RefDomainKind;
  authorityScore: number;
  backlinks: number;
  country: string;
  ip: string;
  category: string;
  firstSeen: string;
  lastSeen: string;
  isNew: boolean;
  isLost: boolean;
  follow: boolean;
};
export type Backlink = {
  sourceUrl: string;
  sourceTitle: string;
  sourceDomain: string;
  pageAuthorityScore: number;
  targetUrl: string;
  anchor: string;
  anchorType: AnchorType;
  type: "text" | "image" | "form" | "frame";
  rel: ("nofollow" | "ugc" | "sponsored")[];
  follow: boolean;
  firstSeen: string;
  lastSeen: string;
  isNew: boolean;
  isLost: boolean;
  externalLinks: number;
  internalLinks: number;
  language: string;
};
export type AnchorType = "branded" | "naked" | "generic" | "partial" | "exact" | "image";
export type Anchor = { anchor: string; type: AnchorType; referringDomains: number; backlinks: number; firstSeen: string; lastSeen: string };

const COUNTRIES = ["US", "US", "US", "IN", "GB", "DE", "CA", "AU", "FR", "NL", "BR", "ES", "IT", "JP", "SG"];
const DAY = 86400000;
const iso = (t: number) => new Date(t).toISOString().slice(0, 10);

type Candidate = { domain: string; kind: RefDomainKind; authorityScore: number; category: string };

const blogPool = memo((topicId: string): Candidate[] => {
  const topic = topicById(topicId);
  const r = rng(`blogpool:${topicId}`);
  const seen = new Set<string>();
  const out: Candidate[] = [];
  while (out.length < 1400) {
    const stem = r.pick(topic.stems);
    const word = r.pick(["blog", "notes", "journal", "review", "tips", "press", "digest", "weekly", "talk", "times", "post", "stories", ...NICHE_SUFFIXES]);
    const name = r.chance(0.35) ? `${r.pick(NICHE_PREFIXES)}${stem}${word}` : r.chance(0.5) ? `${stem}${word}` : `${stem}-${word}${r.int(1, 99)}`;
    const domain = `${name}${r.pick(NICHE_TLDS)}`;
    if (seen.has(domain)) continue;
    seen.add(domain);
    out.push({ domain, kind: "blog", authorityScore: Math.round(clamp(r.logNormal(22, 0.55), 1, 78)), category: topic.name });
  }
  return out;
}, 40);

const spamPool = memo((): Candidate[] => {
  const r = rng("spampool");
  const out: Candidate[] = [];
  const seen = new Set<string>();
  while (out.length < 260) {
    const domain = `${r.pick(SPAM_STEMS)}${r.chance(0.5) ? `-${r.int(1, 999)}` : ""}${r.pick(SPAM_TLDS)}`;
    if (seen.has(domain)) continue;
    seen.add(domain);
    out.push({ domain, kind: "spam", authorityScore: r.int(0, 12), category: "Unknown" });
  }
  return out;
});

function candidates(topicId: string): Candidate[] {
  const topic = topicById(topicId);
  const peers = topicPool(topicId).map((e) => ({ domain: e.domain, kind: "peer" as const, authorityScore: Math.round(6 + 90 * e.strength ** 1.1), category: topic.name }));
  const platforms = LINK_PLATFORMS.map((d) => ({ domain: d, kind: "platform" as const, authorityScore: 70 + (hash(d) % 29), category: "Online communities" }));
  const other = TOPICS.filter((t) => t.id !== topicId).flatMap((t) => blogPool(t.id).slice(0, 120));
  return [...peers, ...platforms, ...blogPool(topicId), ...other, ...spamPool()];
}

function fakeIp(domain: string) {
  const h = hash(`ip:${domain}`);
  const octet = (n: number) => Math.floor(h / 256 ** n) % 256;
  return `${(octet(0) % 200) + 20}.${octet(1)}.${octet(2)}.${octet(3)}`;
}

/** Sample of referring domains (largest first), consistent across tools. */
export const referringDomains = memo((domain: string): ReferringDomain[] => {
  const e = domainEntity(domain);
  const facts = domainFacts(domain, e.homeDb);
  const topicId = facts.topicId;
  const s = e.strength;
  const target = Math.min(facts.referringDomains, 600);
  const pool = candidates(topicId).filter((c) => c.domain !== domain);
  const now = Date.now();
  const scored = pool.map((c) => {
    const base = c.kind === "platform" ? 0.25 + 0.7 * s : c.kind === "peer" ? 0.15 + 0.5 * s : c.kind === "spam" ? 0.1 + 0.25 * (1 - s) : 0.9;
    return { c, u: unit(`rd:${domain}:${c.domain}`) / base };
  });
  scored.sort((a, b) => a.u - b.u);
  return scored.slice(0, target).map(({ c }) => {
    const r = rng(`rdd:${domain}:${c.domain}`);
    const firstSeen = now - Math.round(r.next() ** 1.6 * 5 * 365 * DAY);
    const isLost = r.chance(0.035);
    const lastSeen = isLost ? now - r.int(1, 30) * DAY : now - r.int(0, 6) * DAY;
    const sitewide = r.chance(c.kind === "spam" ? 0.4 : 0.06);
    return {
      domain: c.domain,
      kind: c.kind,
      authorityScore: c.authorityScore,
      backlinks: sitewide ? r.int(40, 2400) : Math.max(1, Math.round(r.logNormal(2, 0.9))),
      country: c.kind === "platform" ? "US" : r.pick(COUNTRIES),
      ip: fakeIp(c.domain),
      category: c.category,
      firstSeen: iso(firstSeen),
      lastSeen: iso(lastSeen),
      isNew: now - firstSeen < 30 * DAY,
      isLost,
      follow: c.kind === "platform" ? r.chance(0.2) : r.chance(facts.followRatio),
    };
  }).sort((a, b) => b.authorityScore - a.authorityScore);
}, 200);

function anchorFor(domain: string, keywordish: string[], r: ReturnType<typeof rng>): { anchor: string; type: AnchorType } {
  const brand = brandPhrase(domain);
  const t = r.weighted<AnchorType>(["branded", "naked", "generic", "partial", "exact", "image"], [34, 20, 20, 15, 6, 5]);
  if (t === "branded") return { anchor: r.pick([brand, domainLabel(domain), brand.replace(/\b[a-z]/g, (x) => x.toUpperCase())]), type: t };
  if (t === "naked") return { anchor: r.pick([domain, `www.${domain}`, `https://www.${domain}/`, `https://${domain}`]), type: t };
  if (t === "generic") return { anchor: r.pick(["click here", "website", "here", "read more", "learn more", "this article", "source", "visit site", "link", "official site"]), type: t };
  if (t === "exact") return { anchor: r.pick(keywordish), type: t };
  if (t === "image") return { anchor: "", type: t };
  return { anchor: `${r.pick(["guide to", "best", "tips on", "more about", "the"])} ${r.pick(keywordish)}`, type: "partial" };
}

/** Backlink sample (up to ~1,500 rows) consistent with referringDomains(). */
export const backlinks = memo((domain: string): Backlink[] => {
  const e = domainEntity(domain);
  const facts = domainFacts(domain, e.homeDb);
  const topic = topicById(facts.topicId);
  const pages = domainPages(domain, e.homeDb).slice(0, 25).map((p) => p.url);
  const targets = [`https://www.${domain}/`, ...pages];
  const out: Backlink[] = [];
  for (const rd of referringDomains(domain)) {
    const r = rng(`bls:${domain}:${rd.domain}`);
    const count = Math.min(rd.backlinks, rd.backlinks > 20 ? 6 : 3);
    for (let i = 0; i < count && out.length < 1500; i++) {
      const { anchor, type: anchorType } = anchorFor(domain, topic.heads, r);
      const type = anchorType === "image" ? "image" : r.weighted(["text", "form", "frame"] as const, [96, 2, 2]);
      const rel: Backlink["rel"] = [];
      if (!rd.follow) rel.push("nofollow");
      if (rd.kind === "platform" && r.chance(0.5)) rel.push("ugc");
      if (r.chance(0.03)) rel.push("sponsored");
      const slug = slugify(`${r.pick(topic.heads)} ${r.pick(["guide", "review", "resources", "list", "news", "tips", "2026"])}`);
      const first = Date.parse(rd.firstSeen) + r.int(0, 60) * DAY;
      out.push({
        sourceUrl: `https://${rd.domain}/${rd.kind === "platform" ? `${slug}-${hash(rd.domain + i) % 9999}` : `${r.chance(0.5) ? "blog/" : ""}${slug}/`}`,
        sourceTitle: `${slug.replace(/-/g, " ").replace(/\b[a-z]/g, (c) => c.toUpperCase())} | ${domainLabel(rd.domain)}`,
        sourceDomain: rd.domain,
        pageAuthorityScore: Math.round(clamp(rd.authorityScore * r.range(0.3, 0.9), 0, 100)),
        targetUrl: r.pick(targets),
        anchor,
        anchorType,
        type,
        rel,
        follow: !rel.includes("nofollow"),
        firstSeen: iso(Math.min(first, Date.now())),
        lastSeen: rd.lastSeen,
        isNew: rd.isNew,
        isLost: rd.isLost,
        externalLinks: rd.kind === "spam" ? r.int(80, 900) : r.int(3, 120),
        internalLinks: r.int(10, 300),
        language: rd.country === "DE" ? "de" : rd.country === "FR" ? "fr" : rd.country === "ES" ? "es" : "en",
      });
    }
  }
  return out;
}, 100);

export function anchors(domain: string): Anchor[] {
  const map = new Map<string, Anchor & { domains: Set<string> }>();
  for (const b of backlinks(domain)) {
    const key = b.anchor || "<EmptyAnchor>";
    const a = map.get(key) ?? { anchor: key, type: b.anchorType, referringDomains: 0, backlinks: 0, firstSeen: b.firstSeen, lastSeen: b.lastSeen, domains: new Set<string>() };
    a.backlinks++;
    a.domains.add(b.sourceDomain);
    if (b.firstSeen < a.firstSeen) a.firstSeen = b.firstSeen;
    if (b.lastSeen > a.lastSeen) a.lastSeen = b.lastSeen;
    map.set(key, a);
  }
  const facts = domainFacts(domain, domainEntity(domain).homeDb);
  const sample = backlinks(domain).length || 1;
  const scale = facts.backlinks / sample;
  const rdScale = facts.referringDomains / (referringDomains(domain).length || 1);
  return [...map.values()]
    .map(({ domains, ...a }) => ({ ...a, referringDomains: Math.max(1, Math.round(domains.size * rdScale)), backlinks: Math.max(1, Math.round(a.backlinks * scale)) }))
    .sort((a, b) => b.referringDomains - a.referringDomains);
}

/** Daily new/lost referring domains and backlinks for the last `days` days. */
export function linkVelocity(domain: string, days = 90) {
  const facts = domainLinkStats(domain);
  const monthlyNewRd = Math.max(1, facts.referringDomains * 0.045);
  const out: { date: string; newReferringDomains: number; lostReferringDomains: number; newBacklinks: number; lostBacklinks: number }[] = [];
  const today = Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate());
  for (let i = days - 1; i >= 0; i--) {
    const t = today - i * DAY;
    const r = rng(`vel:${domain}:${iso(t)}`);
    const n = Math.max(0, Math.round(r.logNormal(monthlyNewRd / 30, 0.6)));
    const l = Math.max(0, Math.round(n * r.range(0.4, 0.95)));
    const perRd = facts.backlinks / Math.max(1, facts.referringDomains);
    out.push({ date: iso(t), newReferringDomains: n, lostReferringDomains: l, newBacklinks: Math.round(n * perRd * r.range(0.3, 1.2)), lostBacklinks: Math.round(l * perRd * r.range(0.3, 1.2)) });
  }
  return out;
}

/** Toxicity score + markers for Backlink Audit. */
export function toxicity(rd: ReferringDomain) {
  const markers: string[] = [];
  const r = rng(`tox:${rd.domain}`);
  let score = r.int(0, 18);
  if (rd.kind === "spam") {
    score += 45 + r.int(0, 35);
    markers.push("Spam in domain name");
  }
  if (SPAM_TLDS.some((t) => rd.domain.endsWith(t))) {
    score += 12;
    markers.push("Suspicious TLD");
  }
  if (rd.authorityScore < 5) {
    score += 10;
    markers.push("Low Authority Score");
  }
  if (rd.backlinks > 200) {
    score += 8;
    markers.push("Sitewide link");
  }
  if (rd.kind === "spam" && r.chance(0.6)) markers.push("Link network");
  if (rd.kind === "spam" && r.chance(0.5)) markers.push("Too many outbound links");
  if (rd.kind === "blog" && r.chance(0.05)) {
    score += 25;
    markers.push("Potentially unnatural anchor text");
  }
  if (r.chance(0.04)) {
    score += 10;
    markers.push("Same IP network");
  }
  return { score: clamp(score, 0, 100), markers };
}

export function distribution<T extends string>(values: T[]) {
  const map = new Map<T, number>();
  for (const v of values) map.set(v, (map.get(v) ?? 0) + 1);
  const total = values.length || 1;
  return [...map.entries()].map(([key, count]) => ({ key, count, share: round((count / total) * 100, 1) })).sort((a, b) => b.count - a.count);
}
