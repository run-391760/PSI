import { cached, demo, liveEnabled, type Sourced } from "@/lib/providers/source";
import {
  demoAnchors,
  demoBacklinks,
  demoCompare,
  demoCompetitors,
  demoIndexedPages,
  demoIps,
  demoOutbound,
  demoOverview,
  demoReferringDomains,
  demoSummary,
  type AnchorRow,
  type BacklinkRow,
  type BlOverview,
  type BlSummary,
  type CompareData,
  type CompetitorRow,
  type IndexedPageRow,
  type IpRow,
  type OutboundRow,
  type RefDomainRow,
} from "./analytics";
import * as live from "./live";

/**
 * Backlink Analytics data access. Demo engine by default; DataForSEO Backlinks API when credentials are
 * configured (each call cached for 24h). Live and demo numbers are never mixed: fields the provider
 * does not return stay empty.
 */
const TTL = 24;

export async function getBlSummary(ownerId: string, domain: string): Promise<Sourced<BlSummary>> {
  if (liveEnabled()) return cached(`bl:summary:${domain}`, "dataforseo", TTL, () => live.summary(ownerId, domain));
  return demo(demoSummary(domain));
}

export async function getBlOverview(ownerId: string, domain: string): Promise<Sourced<BlOverview>> {
  if (liveEnabled()) return cached(`bl:overview:${domain}`, "dataforseo", TTL, () => live.overview(ownerId, domain));
  return demo(demoOverview(domain));
}

export async function getBlBacklinks(ownerId: string, domain: string): Promise<Sourced<BacklinkRow[]>> {
  if (liveEnabled()) return cached(`bl:backlinks:${domain}`, "dataforseo", TTL, () => live.backlinks(ownerId, domain));
  return demo(demoBacklinks(domain));
}

export async function getBlReferringDomains(ownerId: string, domain: string): Promise<Sourced<RefDomainRow[]>> {
  if (liveEnabled()) return cached(`bl:rd:${domain}`, "dataforseo", TTL, () => live.referringDomains(ownerId, domain));
  return demo(demoReferringDomains(domain));
}

export async function getBlAnchors(ownerId: string, domain: string): Promise<Sourced<AnchorRow[]>> {
  if (liveEnabled()) return cached(`bl:anchors:${domain}`, "dataforseo", TTL, () => live.anchors(ownerId, domain));
  return demo(demoAnchors(domain));
}

export async function getBlIps(ownerId: string, domain: string): Promise<Sourced<{ ips: IpRow[]; subnets: IpRow[] }>> {
  if (liveEnabled()) return cached(`bl:ips:${domain}`, "dataforseo", TTL, () => live.networks(ownerId, domain));
  return demo(demoIps(domain));
}

export async function getBlIndexedPages(ownerId: string, domain: string): Promise<Sourced<IndexedPageRow[]>> {
  if (liveEnabled()) return cached(`bl:pages:${domain}`, "dataforseo", TTL, () => live.pages(ownerId, domain));
  return demo(demoIndexedPages(domain));
}

export async function getBlOutbound(ownerId: string, domain: string): Promise<Sourced<{ rows: OutboundRow[]; total: number }>> {
  // The DataForSEO Backlinks API has no outbound-domain index; live mode shows an explanation instead.
  if (liveEnabled()) return { data: { rows: [], total: 0 }, source: "dataforseo", fetchedAt: new Date().toISOString(), live: true, note: "Outbound domains are not available from the connected provider." };
  return demo(demoOutbound(domain));
}

export async function getBlCompetitors(ownerId: string, domain: string): Promise<Sourced<CompetitorRow[]>> {
  if (liveEnabled()) return cached(`bl:competitors:${domain}`, "dataforseo", TTL, () => live.competitors(ownerId, domain));
  return demo(demoCompetitors(domain));
}

export async function getBlCompare(ownerId: string, domains: string[]): Promise<Sourced<CompareData>> {
  if (liveEnabled()) return cached(`bl:compare:${domains.join(",")}`, "dataforseo", TTL, () => live.compare(ownerId, domains));
  return demo(demoCompare(domains));
}
