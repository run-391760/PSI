/** Client-safe types and constants shared by the Position Tracking pages, components and server code. */
import type { Intent, SerpFeature } from "@/lib/seo/types";

export type Device = "desktop" | "mobile";
export type DeviceMode = Device | "both";
export type CampaignSource = "demo" | "dataforseo";

/** Job kind of the rank check (registered in jobs.ts). */
export const CHECK_JOB = "position-tracking.check";
export const MAX_KEYWORDS = 500;
export const MAX_COMPETITORS = 10;
export const BACKFILL_DAYS = 30;
export const RANGES = [7, 30, 90] as const;
export type RangeDays = (typeof RANGES)[number];

export type Campaign = {
  projectId: string;
  engine: "google";
  db: string;
  location: string;
  device: DeviceMode;
  competitors: string[];
  source: CampaignSource;
  createdAt: string;
  updatedAt: string;
  lastCheckAt: string | null;
  firstDay: string | null;
  lastDay: string | null;
};

export type TagRef = { id: string; name: string };
export type Tag = TagRef & { keywords: number; createdAt: string };

export type TrackedKeyword = {
  id: string;
  keyword: string;
  volume: number | null;
  cpc: number | null;
  kd: number | null;
  intents: Intent[];
  tags: TagRef[];
  createdAt: string;
};

/** Setup / add-keywords input: one keyword with the tag names to assign. */
export type KeywordEntry = { keyword: string; tags: string[] };

export type DomainPoint = { domain: string; position: number | null; url: string | null };

/** Per-domain aggregate for one day (from pt_daily or computed on the fly for tag filters). */
export type DayAggregate = {
  day: string;
  domain: string;
  keywords: number;
  ranked: number;
  top3: number;
  top10: number;
  top20: number;
  top100: number;
  visibility: number;
  traffic: number;
  avgPosition: number | null;
};

// ------------------------------------------------------------------------------------ Alerts

export type AlertKind = "enter_top" | "leave_top" | "drop" | "rise" | "overtaken" | "visibility_change";
export type Severity = "info" | "success" | "warning" | "critical";

export const ALERT_KINDS: { id: AlertKind; label: string; thresholdLabel: string | null; defaultThreshold: number; defaultSeverity: Severity; describe: (n: number, competitor?: string | null) => string }[] = [
  { id: "enter_top", label: "Keyword enters top N", thresholdLabel: "Top N", defaultThreshold: 10, defaultSeverity: "success", describe: (n) => `Keyword enters the top ${n}` },
  { id: "leave_top", label: "Keyword leaves top N", thresholdLabel: "Top N", defaultThreshold: 10, defaultSeverity: "warning", describe: (n) => `Keyword drops out of the top ${n}` },
  { id: "drop", label: "Position drops by N or more", thresholdLabel: "Positions", defaultThreshold: 5, defaultSeverity: "warning", describe: (n) => `Position drops by ${n}+ places` },
  { id: "rise", label: "Position rises by N or more", thresholdLabel: "Positions", defaultThreshold: 5, defaultSeverity: "success", describe: (n) => `Position improves by ${n}+ places` },
  { id: "overtaken", label: "Competitor overtakes you", thresholdLabel: null, defaultThreshold: 0, defaultSeverity: "critical", describe: (_n, c) => `${c || "Any competitor"} overtakes you` },
  { id: "visibility_change", label: "Visibility changes by X%", thresholdLabel: "Change %", defaultThreshold: 10, defaultSeverity: "warning", describe: (n) => `Visibility changes by ${n}%+ day over day` },
];
export const alertKind = (id: string) => ALERT_KINDS.find((k) => k.id === id) ?? ALERT_KINDS[0];

export type AlertRule = {
  id: string;
  projectId: string;
  projectName: string;
  projectDomain: string;
  name: string;
  kind: AlertKind;
  threshold: number;
  device: Device | null;
  tagId: string | null;
  tagName: string | null;
  competitor: string | null;
  severity: Severity;
  enabled: boolean;
  lastTriggeredAt: string | null;
  triggerCount: number;
  createdAt: string;
};

export type AlertRuleInput = {
  projectId: string;
  name: string;
  kind: AlertKind;
  threshold: number;
  device: Device | null;
  tagId: string | null;
  competitor: string | null;
  severity: Severity;
  enabled: boolean;
};

// ------------------------------------------------------------------------------------ Report rows (client props)

export type OverviewRow = {
  id: string;
  keyword: string;
  tags: TagRef[];
  intents: Intent[];
  volume: number | null;
  cpc: number | null;
  kd: number | null;
  start: number | null;
  end: number | null;
  /** Positive = improved. Null when unknown / new / lost. */
  change: number | null;
  /** Keyword visibility 0..100 on the end day (CTR(pos)/CTR(1)). */
  visibility: number;
  traffic: number | null;
  url: string | null;
  features: SerpFeature[];
  owned: SerpFeature[];
  competitors: Record<string, { start: number | null; end: number | null }>;
  /** Own daily positions over the range (null = not in top 100), oldest first. */
  spark: (number | null)[];
  best: number | null;
};

export type ImpactRow = { id: string; keyword: string; start: number | null; end: number | null; impact: number; volume: number | null };
