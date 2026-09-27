/** Client-safe types and labels for the backlinks module (no server imports). */
import type { AnchorType } from "@/lib/seo/engine/backlinks";
export type { AnchorType };

export type VelocityPoint = { date: string; newReferringDomains: number; lostReferringDomains: number; newBacklinks: number; lostBacklinks: number };

export type BlHistoryPoint = { month: string; referringDomains: number; backlinks: number; authorityScore: number; referringIps: number };

export type BlSummary = {
  domain: string;
  topicName: string;
  homeDb: string;
  authorityScore: number;
  authorityDelta: number | null;
  referringDomains: number;
  referringDomainsDelta: number | null;
  backlinks: number;
  backlinksDelta: number | null;
  referringIps: number;
  referringIpsDelta: number | null;
  outboundDomains: number;
  outboundDomainsDelta: number | null;
  followRatio: number;
  /** Size of the per-domain sample the tables are built from. */
  sample: { referringDomains: number; backlinks: number };
};

export type Share = { label: string; value: number; share: number };

export type BlOverview = {
  history: BlHistoryPoint[];
  velocity: VelocityPoint[];
  last30: { newRd: number; lostRd: number; newBl: number; lostBl: number };
  asBuckets: { label: string; domains: number }[];
  categories: Share[];
  tlds: Share[];
  countries: (Share & { code: string; flag: string })[];
  anchors: { anchor: string; type: AnchorType; referringDomains: number; backlinks: number }[];
  anchorTypes: Share[];
  attributes: Share[];
  linkTypes: Share[];
  topPages: { url: string; referringDomains: number; backlinks: number }[];
  topReferringDomains: { domain: string; authorityScore: number; backlinks: number; country: string; firstSeen: string }[];
};

export type BacklinkRow = {
  id: string;
  sourceUrl: string;
  sourceTitle: string;
  sourceDomain: string;
  pageAs: number;
  targetUrl: string;
  anchor: string;
  anchorType: AnchorType;
  type: "text" | "image" | "form" | "frame";
  rel: string[];
  follow: boolean;
  firstSeen: string;
  lastSeen: string;
  isNew: boolean;
  isLost: boolean;
  externalLinks: number;
  internalLinks: number;
  language: string;
};

export type RefDomainRow = {
  domain: string;
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
  /** DataForSEO backlinks spam score (live only). */
  spamScore?: number | null;
};

export type AnchorRow = { anchor: string; type: AnchorType; referringDomains: number; backlinks: number; firstSeen: string; lastSeen: string; isNew: boolean };

export type IpRow = { ip: string; country: string; domains: number; sampleDomains: string[]; backlinks: number; firstSeen: string; lastSeen: string };

export type IndexedPageRow = { url: string; title: string; referringDomains: number; backlinks: number; followPct: number; topAnchor: string; firstSeen: string; lastSeen: string };

export type OutboundRow = { domain: string; authorityScore: number; category: string; links: number; linksBack: boolean; firstSeen: string };

export type CompetitorRow = { domain: string; authorityScore: number; level: number; common: number; referringDomains: number; backlinks: number };

export const ANCHOR_TYPE_LABELS: Record<AnchorType, string> = {
  branded: "Branded",
  naked: "Naked URL",
  generic: "Generic",
  partial: "Partial match",
  exact: "Exact match",
  image: "Image (no anchor)",
};

export type CompareEntry = {
  domain: string;
  authorityScore: number;
  referringDomains: number;
  referringDomainsDelta: number | null;
  backlinks: number;
  backlinksDelta: number | null;
  referringIps: number;
  followPct: number;
  textPct: number;
  imagePct: number;
  /** null when the provider did not return new/lost counts. */
  last30: { newRd: number; lostRd: number; newBl: number; lostBl: number } | null;
  asShares: number[];
  topCategory: string;
};
export type CompareData = {
  entries: CompareEntry[];
  /** Keys d0..d4 map to entries[i]. */
  rdHistory: Record<string, string | number>[];
  blHistory: Record<string, string | number>[];
  asBuckets: Record<string, string | number>[];
  newLost: Record<string, string | number>[];
  common: { referringDomains: number; sampleOverlapPct: number };
};


/* ------------------------------------------------------------------------------------------------
 * Bulk Analysis
 * ---------------------------------------------------------------------------------------------- */

export type BulkTarget = { input: string; target: string; kind: "domain" | "subdomain" | "url"; domain: string };
export type BulkInvalid = { line: number; value: string; reason: string };
export type BulkRow = {
  target: string;
  kind: BulkTarget["kind"];
  domain: string;
  authorityScore: number | null;
  referringDomains: number | null;
  backlinks: number | null;
  referringIps: number | null;
  followPct: number | null;
  nofollowPct: number | null;
  textPct: number | null;
  imagePct: number | null;
  newRd30: number | null;
  lostRd30: number | null;
  newBl30: number | null;
  lostBl30: number | null;
};

/* ------------------------------------------------------------------------------------------------
 * Backlink Audit
 * ---------------------------------------------------------------------------------------------- */

/** Toxicity thresholds (0–100): toxic ≥ 60, potentially toxic 45–59, non-toxic < 45. */
export const TOXIC_MIN = 60;
export const POTENTIAL_MIN = 45;
export type AuditLevel = "low" | "medium" | "high";
export type AuditList = "whitelist" | "remove" | "disavow";
export type RemoveStatus = "not_sent" | "sent" | "replied" | "removed" | "no_response";

export const REMOVE_STATUS_LABELS: Record<RemoveStatus, string> = {
  not_sent: "Not contacted",
  sent: "Request sent",
  replied: "Replied",
  removed: "Link removed",
  no_response: "No response",
};

/** Toxic markers with the explanation shown in tooltips. */
export const MARKER_INFO: Record<string, string> = {
  "Spam in domain name": "The domain name contains words typical of spam sites (casino, pills, loans, link directories…).",
  "Suspicious TLD": "The domain uses a top-level domain that is frequently abused by spam sites (.xyz, .top, .click, .icu…).",
  "Low Authority Score": "The linking domain has a very low Authority Score (under 5): it passes little value and is often low quality.",
  "Sitewide link": "The domain links to you 200+ times, typical of footer, sidebar or blogroll links that search engines can treat as unnatural.",
  "Link network": "The domain shows footprints shared with other linking domains, typical of private blog networks (PBNs).",
  "Too many outbound links": "Pages on this domain link out to hundreds of sites — a pattern of link farms and low-quality directories.",
  "Potentially unnatural anchor text": "Anchors from this domain look manipulative: keyword-rich rather than branded or natural.",
  "Same IP network": "Several domains linking to you are hosted on the same IP subnet, a common link-network footprint.",
  "Unrelated category": "The linking site's topic is unrelated to your site's topic.",
  "Geo mismatch": "The linking site is hosted outside your target country and outside common hosting countries.",
  "Money anchor text": "Links from this domain use a keyword-rich anchor that does not mention your brand or domain.",
  "High spam score": "DataForSEO's backlinks spam score for this domain is 60 or higher (computed from signals of the linking pages).",
  "Not in latest audit": "This domain was not found in the latest audit; it may have removed its links. It stays in your list until you restore it.",
};

export type AuditDomainRow = {
  domain: string;
  toxicity: number;
  markers: string[];
  authorityScore: number;
  backlinks: number;
  country: string;
  ip: string;
  category: string;
  follow: boolean;
  firstSeen: string;
  lastSeen: string;
  sampleUrl: string;
  sampleAnchor: string;
  /** Detected (first audited) in the latest run. */
  isNew: boolean;
  list: AuditList | null;
  contact: string;
  status: RemoveStatus;
  note: string;
  listedAt: string | null;
};

export type AuditRunRow = {
  id: string;
  trigger: string;
  analyzed: number;
  backlinks: number;
  toxic: number;
  potentiallyToxic: number;
  nonToxic: number;
  toxicScore: number;
  level: AuditLevel;
  newToxic: number;
  createdAt: string;
};

export type JobStatusDto = { id: string; kind: string; status: string; progress: number; total: number; message: string | null; error: string | null };

/* ------------------------------------------------------------------------------------------------
 * Link Building Tool
 * ---------------------------------------------------------------------------------------------- */

export type LbSettings = { keywords: string[]; competitors: string[]; senderName: string; templateSubject: string; templateBody: string; updatedAt: string; prospectCount: number | null };

export type LbProspect = {
  domain: string;
  rating: number;
  score: number;
  authorityScore: number;
  category: string;
  relevance: "high" | "medium" | "low";
  competitors: string[];
  keywords: { keyword: string; position: number }[];
  source: "competitors" | "keywords" | "both";
  reason: string;
};

export type OutreachStatus = "to_contact" | "sent" | "replied" | "acquired" | "rejected";
export const OUTREACH_STATUSES: OutreachStatus[] = ["to_contact", "sent", "replied", "acquired", "rejected"];
export const OUTREACH_LABELS: Record<OutreachStatus, string> = {
  to_contact: "To contact",
  sent: "Email sent",
  replied: "Replied",
  acquired: "Link acquired",
  rejected: "Rejected",
};

export type PipelineRow = {
  domain: string;
  state: "in_progress" | "rejected";
  status: OutreachStatus;
  /** null when unknown (e.g. the prospect was rated from demo data that is now hidden). */
  rating: number | null;
  reason: string;
  authorityScore: number | null;
  contactName: string;
  contactEmail: string;
  notes: string;
  createdAt: string;
  updatedAt: string;
};

export type LinkStatus = "pending" | "active" | "lost" | "unknown";
export type LbLinkRow = {
  id: string;
  prospectDomain: string | null;
  sourceUrl: string;
  status: LinkStatus;
  reason: string;
  anchor: string | null;
  rel: string[];
  targetUrl: string | null;
  httpStatus: number | null;
  checks: number;
  lastCheckedAt: string | null;
  firstActiveAt: string | null;
  lostAt: string | null;
  createdAt: string;
};

export const MERGE_FIELDS = ["{{domain}}", "{{name}}", "{{our_site}}"] as const;
export const DEFAULT_TEMPLATE = {
  subject: "A resource for {{domain}} readers",
  body: `Hi {{name}},

I've been reading {{domain}} and really enjoyed your recent articles — they're some of the most useful on the topic.

I work on {{our_site}}. We recently published an in-depth guide that I think would be a genuinely helpful addition to one of your resource pages, and I'd be happy to share it.

Would you be open to taking a look? If it's a fit, a link from {{domain}} would mean a lot to us.

Thanks for your time,
`,
};

/** Replace merge fields in an outreach template. */
export function renderTemplate(text: string, vars: { domain: string; name: string; ourSite: string }) {
  return text
    .replace(/\{\{\s*domain\s*\}\}/gi, vars.domain)
    .replace(/\{\{\s*name\s*\}\}/gi, vars.name || "there")
    .replace(/\{\{\s*our_site\s*\}\}/gi, vars.ourSite);
}
