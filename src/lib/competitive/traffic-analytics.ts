import { CHANNEL_LABELS, domainEntity, domainFacts, domainSubdomains, memo, round, trafficFacts, type TrafficChannel, type TrafficFacts } from "@/lib/seo/engine";
import { demo, type Sourced } from "@/lib/providers/source";
import { changePct, demoDelta } from "./shared";

export const CHANNEL_ORDER: TrafficChannel[] = ["direct", "organic", "paid", "referral", "social", "email", "ai"];
export { CHANNEL_LABELS };

export type TrafficReport = Omit<TrafficFacts, "history"> & {
  topicName: string;
  authorityScore: number;
  history: { month: string; visits: number; uniqueVisitors: number; desktop: number; mobile: number }[];
  deltas: { uniqueVisitors: number; pagesPerVisit: number; avgVisitDuration: number; bounceRate: number; yoy: number };
  subdomains: { subdomain: string; share: number; visits: number; uniqueVisitors: number }[];
  /** Visits by channel keyed by channel id (for comparison charts). */
  channelShare: Record<TrafficChannel, number>;
};

const NOTE = "Clickstream traffic estimates are not offered by the connected providers; this report always uses the demo engine.";

const build = memo((domain: string): TrafficReport => {
  const t = trafficFacts(domain);
  const e = domainEntity(domain);
  const f = domainFacts(domain, e.homeDb);
  // Keep the trend consistent with the headline numbers: rescale unique visitors so the last point
  // equals the headline and split every month by the same device share.
  const lastUv = t.history[t.history.length - 1]?.uniqueVisitors || 1;
  const uvScale = t.uniqueVisitors / lastUv;
  const mobile = t.devices.mobile / 100;
  const history = t.history.map((h) => ({
    month: h.month,
    visits: h.visits,
    uniqueVisitors: Math.round(h.uniqueVisitors * uvScale),
    desktop: Math.round(h.visits * (1 - mobile)),
    mobile: Math.round(h.visits * mobile),
  }));
  const n = history.length;
  const uvChange = changePct(history[n - 2]?.uniqueVisitors, history[n - 1]?.uniqueVisitors);
  const uvRatio = t.uniqueVisitors / Math.max(1, t.visits);
  const subs = domainSubdomains(domain, e.homeDb);
  const channelShare = Object.fromEntries(CHANNEL_ORDER.map((c) => [c, t.channels.find((x) => x.channel === c)?.share ?? 0])) as Record<TrafficChannel, number>;
  return {
    ...t,
    topicName: f.topicName,
    authorityScore: f.authorityScore,
    history,
    deltas: {
      uniqueVisitors: uvChange,
      pagesPerVisit: demoDelta(`ppv:${domain}`, 8),
      avgVisitDuration: demoDelta(`dur:${domain}`, 12),
      bounceRate: demoDelta(`bounce:${domain}`, 6),
      yoy: changePct(history[n - 13]?.visits, history[n - 1]?.visits),
    },
    subdomains: subs.slice(0, 15).map((s) => {
      const visits = Math.round((t.visits * s.trafficPct) / 100);
      return { subdomain: s.subdomain, share: s.trafficPct, visits, uniqueVisitors: Math.round(visits * uvRatio) };
    }),
    channelShare,
  };
}, 100);

export async function getTrafficReport(domain: string): Promise<Sourced<TrafficReport>> {
  return demo(build(domain), NOTE);
}

export async function getTrafficCompare(domains: string[]): Promise<Sourced<TrafficReport[]>> {
  return demo(domains.map((d) => build(d)), NOTE);
}

/** Share of the comparison group's visits (0..100). */
export function shareOfVisits(reports: TrafficReport[]) {
  const total = reports.reduce((s, r) => s + r.visits, 0) || 1;
  return reports.map((r) => round((r.visits / total) * 100, 1));
}
