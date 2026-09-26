import { parse } from "tldts";
import { clamp, domainEntity, domainLinkStats, hash, linkVelocity, memo, rng, round, TOPICS, unit } from "@/lib/seo/engine";
import { LINK_PLATFORMS } from "@/lib/seo/engine/vocab";

/**
 * Cheap backlink headline for any domain — the engine's domainLinkStats(), which domainFacts() also
 * uses, so numbers match Domain Overview without building the organic keyword sample.
 */
export const backlinkHeadline = (domain: string) => ({ domain, ...domainLinkStats(domain) });

/** Topic id the engine assigns to a domain (giants get a hash-picked topic, like domainFacts). */
export function topicIdOf(domain: string) {
  const e = domainEntity(domain);
  return e.topicId === "*" ? TOPICS[hash(domain) % TOPICS.length].id : e.topicId;
}

const DAY = 86400000;
const iso = (t: number) => new Date(t).toISOString().slice(0, 10);

import type { VelocityPoint } from "./types";
export type { VelocityPoint };

/** The engine's linkVelocity() (cheap: it only needs domainLinkStats). */
export function quickVelocity(domain: string, days = 30): VelocityPoint[] {
  return linkVelocity(domain, days);
}

export function sumVelocity(points: VelocityPoint[]) {
  return points.reduce(
    (a, p) => ({ newRd: a.newRd + p.newReferringDomains, lostRd: a.lostRd + p.lostReferringDomains, newBl: a.newBl + p.newBacklinks, lostBl: a.lostBl + p.lostBacklinks }),
    { newRd: 0, lostRd: 0, newBl: 0, lostBl: 0 },
  );
}

/**
 * Index-wide link mix of a domain's backlinks (shares 0..1): link types are exclusive, UGC/sponsored
 * are attributes that can co-occur with nofollow. Deterministic per domain so Backlink Analytics and
 * Bulk Analysis agree.
 */
export function linkMix(domain: string) {
  const r = rng(`bl-mix:${domain}`);
  const image = r.range(0.035, 0.07);
  const form = r.range(0.008, 0.026);
  const frame = r.range(0.008, 0.024);
  const h = backlinkHeadline(domain);
  const ugc = r.range(0.002, 0.018) + (1 - h.followRatio) * 0.02;
  const sponsored = r.range(0.012, 0.04);
  return { text: 1 - image - form - frame, image, form, frame, follow: h.followRatio, nofollow: 1 - h.followRatio, ugc, sponsored };
}

/** The engine's synthetic IPs can carry negative octets; normalize them to a valid dotted quad. */
export function cleanIp(ip: string) {
  const parts = ip.split(".").map((p) => Math.abs(Number.parseInt(p, 10) || 0) % 256);
  while (parts.length < 4) parts.push(0);
  return parts.slice(0, 4).join(".");
}
const SHARED_HOSTS: [string, string][] = [
  ["104.21.48", "US"],
  ["172.67.182", "US"],
  ["192.0.78", "US"],
  ["185.199.108", "US"],
  ["151.101.65", "US"],
  ["35.186.238", "US"],
  ["198.185.159", "US"],
  ["23.227.38", "CA"],
];
const SPAM_NETS: [string, string][] = [
  ["45.83.64", "NL"],
  ["91.215.85", "DE"],
  ["185.107.56", "NL"],
];
/**
 * Hosting IP and IP-geolocated country of a referring domain. The engine assigns every domain a
 * unique synthetic IP; real link profiles show clustering (shared hosting, CDNs, link networks), so a
 * deterministic share of domains is placed on shared subnets and spam domains on a few small networks.
 */
export function hosting(rd: { domain: string; ip: string; kind?: string; country: string }): { ip: string; country: string } {
  if (rd.kind === "spam") {
    const [net, country] = SPAM_NETS[hash(`spamnet:${rd.domain}`) % SPAM_NETS.length];
    return { ip: `${net}.${10 + (hash(`spamip:${rd.domain}`) % 5)}`, country };
  }
  if (rd.kind !== "platform" && unit(`host:${rd.domain}`) < 0.22) {
    const [net, country] = SHARED_HOSTS[hash(`hostnet:${rd.domain}`) % SHARED_HOSTS.length];
    return { ip: `${net}.${1 + (hash(`hostip:${rd.domain}`) % 14)}`, country };
  }
  return { ip: cleanIp(rd.ip), country: rd.country };
}

/** True for CDN / shared-hosting subnets, where many unrelated sites naturally share an IP range. */
export const isSharedHost = (ip: string) => SHARED_HOSTS.some(([h]) => ip.startsWith(`${h}.`));

/** Authority Score shown for a linking domain; link platforms use the engine's platform scores. */
export function linkingDomainAs(domain: string) {
  if ((LINK_PLATFORMS as readonly string[]).includes(domain)) return 70 + (hash(domain) % 29);
  return backlinkHeadline(domain).authorityScore;
}

export const subnetOf = (ip: string) => `${cleanIp(ip).split(".").slice(0, 3).join(".")}.0/24`;

export function tldOf(domain: string) {
  const suffix = parse(domain).publicSuffix;
  return suffix ? `.${suffix}` : `.${domain.split(".").pop()}`;
}

export const AS_BUCKETS: { label: string; min: number; max: number }[] = Array.from({ length: 10 }, (_, i) => ({
  label: i === 0 ? "0–10" : `${i * 10 + 1}–${i === 9 ? 100 : (i + 1) * 10}`,
  min: i === 0 ? 0 : i * 10 + 1,
  max: i === 9 ? 100 : (i + 1) * 10,
}));
export const asBucketIndex = (as: number) => AS_BUCKETS.findIndex((b) => as >= b.min && as <= b.max);

/** Percent change a -> b, one decimal; null when unknown. */
export function pctChange(current: number | null | undefined, previous: number | null | undefined) {
  if (current == null || previous == null || !previous) return null;
  return round(((current - previous) / previous) * 100, 1);
}

/** Group-by count helper. */
export function countBy<T>(items: T[], key: (item: T) => string) {
  const map = new Map<string, number>();
  for (const it of items) map.set(key(it), (map.get(key(it)) ?? 0) + 1);
  return map;
}

/** Split a free-text list of domains ("a.com, b.com\nc.com") into trimmed entries. */
export const splitList = (text: string) =>
  text
    .split(/[\s,;]+/)
    .map((s) => s.trim())
    .filter(Boolean);
