/** Shared SEO domain types used by the demo engine, live providers and UI. */

export type Intent = "informational" | "navigational" | "commercial" | "transactional";
export const INTENTS: Intent[] = ["informational", "navigational", "commercial", "transactional"];

export type SerpFeature =
  | "ai_overview"
  | "featured_snippet"
  | "people_also_ask"
  | "local_pack"
  | "image_pack"
  | "video"
  | "top_stories"
  | "shopping"
  | "reviews"
  | "sitelinks"
  | "knowledge_panel"
  | "ads_top"
  | "discussions"
  | "related_searches";

export const SERP_FEATURES: { id: SerpFeature; label: string }[] = [
  { id: "ai_overview", label: "AI Overview" },
  { id: "featured_snippet", label: "Featured snippet" },
  { id: "people_also_ask", label: "People also ask" },
  { id: "local_pack", label: "Local pack" },
  { id: "image_pack", label: "Image pack" },
  { id: "video", label: "Video" },
  { id: "top_stories", label: "Top stories" },
  { id: "shopping", label: "Shopping ads" },
  { id: "reviews", label: "Reviews" },
  { id: "sitelinks", label: "Sitelinks" },
  { id: "knowledge_panel", label: "Knowledge panel" },
  { id: "ads_top", label: "Ads top" },
  { id: "discussions", label: "Discussions and forums" },
  { id: "related_searches", label: "Related searches" },
];

export type KeywordMetrics = {
  keyword: string;
  db: string;
  /** Average monthly searches in `db` over the last 12 months. */
  volume: number;
  /** Sum across all regional databases. */
  globalVolume: number;
  /** USD. */
  cpc: number;
  /** Paid competition density 0..1. */
  competition: number;
  /** Keyword difficulty 0..100. */
  kd: number;
  intents: Intent[];
  serpFeatures: SerpFeature[];
  /** 12 monthly volumes, oldest first, ending last month. */
  trend: number[];
  /** Approximate number of results in the index. */
  results: number;
  words: number;
  topicId: string;
};

export type SerpResult = {
  position: number;
  domain: string;
  url: string;
  title: string;
  description: string;
};

export type RankedKeyword = {
  keyword: string;
  position: number;
  /** Position last month; null when the keyword is new. */
  previousPosition: number | null;
  url: string;
  metrics: KeywordMetrics;
  /** Estimated monthly organic visits from this keyword. */
  traffic: number;
  /** Share of the domain's organic traffic (0..100). */
  trafficPct: number;
  /** traffic × CPC, USD. */
  trafficCost: number;
  branded: boolean;
  /** SERP features where the domain itself appears. */
  ownedFeatures: SerpFeature[];
};

export type MonthlyPoint = {
  /** YYYY-MM */
  month: string;
  organicTraffic: number;
  organicKeywords: number;
  paidTraffic: number;
  paidKeywords: number;
  top3: number;
  top10: number;
  top20: number;
  top100: number;
  backlinks: number;
  referringDomains: number;
  authorityScore: number;
};

export type DomainFacts = {
  domain: string;
  db: string;
  topicId: string;
  topicName: string;
  homeDb: string;
  /** Relative strength 0..1 that drives every other metric. */
  strength: number;
  authorityScore: number;
  organicTraffic: number;
  organicKeywords: number;
  organicTrafficCost: number;
  paidTraffic: number;
  paidKeywords: number;
  paidTrafficCost: number;
  backlinks: number;
  referringDomains: number;
  referringIps: number;
  /** Follow share 0..1. */
  followRatio: number;
  /** Organic traffic change vs previous month, percent. */
  trafficChangePct: number;
  keywordsChangePct: number;
  /** 24 months, oldest first; last element is the current month. */
  history: MonthlyPoint[];
};

export type CountryShare = { db: string; name: string; flag: string; traffic: number; keywords: number; share: number };
