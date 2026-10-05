/**
 * AI Pre-Publish SEO & Content Optimizer — shared types (client-safe, no server imports).
 * A draft is audited by ~58 checks (one per PDF feature); findings roll up into eight weighted
 * categories, an overall score out of 10, severities, publication blockers and a publish status.
 */

export type ModuleId =
  | "search-intent"
  | "content-quality"
  | "on-page"
  | "serp-ai"
  | "topical"
  | "eeat"
  | "links-ux"
  | "internal-linking"
  | "conversion"
  | "media-ux"
  | "schema"
  | "technical"
  | "ux"
  | "workflow"
  | "reporting"
  | "ai-optimization"
  | "content-planning";

/** The eight scoring categories (PDF page 2). */
export type CategoryId = "intent" | "quality" | "topical" | "onpage" | "eeat" | "serp" | "linking" | "technical";

/** Feature priority from the PDF; drives check weight and issue severity. */
export type Priority = "critical" | "high" | "medium";
export type Severity = "critical" | "high" | "medium" | "low";
export type Status = "pass" | "warn" | "fail" | "na";
export type Stage = "Pre-Writing" | "Pre-Publish" | "Reporting" | "Monitoring";

export type Intent = "informational" | "commercial" | "transactional" | "navigational" | "local";
export type ContentFormat = "how-to" | "guide" | "listicle" | "comparison" | "review" | "landing" | "news";
export type PageType = "blog" | "guide" | "how-to" | "listicle" | "comparison" | "review" | "landing" | "news" | "course";
export type Funnel = "awareness" | "consideration" | "decision";

/** Where a finding's evidence came from (shown on every card). */
export type EvidenceSource = "content" | "serp" | "competitors" | "autocomplete" | "ai" | "live-url";

export type Person = { name?: string; bio?: string; credentials?: string; url?: string };

/** Draft settings kept in opt_drafts.meta. Everything is optional; checks report what is missing. */
export type DraftMeta = {
  db?: string;
  pageType?: PageType;
  funnel?: Funnel;
  author?: Person;
  organization?: { name?: string; url?: string; logo?: string };
  publishedAt?: string;
  modifiedAt?: string;
  canonical?: string;
  robots?: string;
  featuredImage?: string;
  cta?: { text?: string; url?: string };
  competitors?: string[];
  sitePages?: { url: string; title: string }[];
  sitemapUrl?: string;
  schema?: string;
  checklist?: Record<string, boolean>;
  /** Content brief the draft was created from (outline and coverage targets). */
  brief?: Brief | null;
};

export type DraftInput = {
  title: string;
  keyword: string;
  keywords: string[];
  metaDescription: string;
  slug: string;
  url: string;
  body: string;
  meta: DraftMeta;
};

export type Draft = DraftInput & {
  id: string;
  status: "draft" | "published";
  score: number | null;
  baselineScore: number | null;
  createdAt: string;
  updatedAt: string;
  publishedAt: string | null;
};

// -------------------------------------------------------------------------------- research data

export type CompetitorPage = {
  url: string;
  domain: string;
  position: number | null;
  title: string;
  metaDescription: string;
  h1: string;
  headings: { level: number; text: string }[];
  words: number;
  format: ContentFormat | null;
  hasFaq: boolean;
  tables: number;
  lists: number;
  images: number;
  hasVideo: boolean;
  schemaTypes: string[];
  questions: string[];
  /** Main text, truncated (used for gaps, entities and overlap). */
  text: string;
  error: string | null;
};

export type Research = {
  keyword: string;
  db: string;
  /** "serp" = live Google results from DataForSEO; "urls" = competitor URLs the user supplied. */
  serpSource: "serp" | "urls" | "none";
  features: string[];
  paa: string[];
  related: string[];
  autocomplete: string[];
  competitors: CompetitorPage[];
  fetchedAt: string;
  notes: string[];
};

/** Optional Claude review of the subjective checks (scores 0..1). */
export type AiReview = {
  model: string;
  reviewedAt: string;
  bodyHash: string;
  bodyLength?: number;
  intent: { dominant: Intent; match: number; reason: string };
  peopleFirst: { score: number; reason: string };
  originality: { score: number; reason: string };
  informationGain: { score: number; reason: string };
  experience: { score: number; reason: string };
  completeness: { score: number; missing: string[] };
  entities: string[];
  claims: { text: string; risk: "high" | "medium" | "low"; reason: string }[];
  recommendations: { title: string; why: string; how: string; module: ModuleId; priority: Severity }[];
};

export type LinkCheck = { checkedAt: string; results: { url: string; status: number | null; error: string | null }[] };
export type LiveCheck = {
  checkedAt: string;
  url: string;
  status: number | null;
  noindex: boolean;
  xRobots: string | null;
  canonical: string | null;
  robotsAllowed: boolean | null;
  title: string;
  error: string | null;
  pagespeed?: { performance: number | null; lcp: number | null; cls: number | null; inp: number | null } | null;
};

export type ResearchBundle = { research: Research | null; ai: AiReview | null; links: LinkCheck | null; live: LiveCheck | null };

// -------------------------------------------------------------------------------- briefs

export type Brief = {
  keyword: string;
  db: string;
  intent: Intent;
  format: ContentFormat;
  funnel: Funnel;
  audience: string;
  titleIdeas: string[];
  metaDescription: string;
  outline: { level: 2 | 3; text: string; notes?: string }[];
  entities: string[];
  questions: string[];
  coverage: string[];
  wordRange: [number, number] | null;
  sources: string[];
  generatedBy: "ai" | "research";
  createdAt: string;
};

// -------------------------------------------------------------------------------- fixes

export type InsertPosition = "start" | "after-h1" | "after-intro" | "before-conclusion" | "end" | { afterHeading: string };

export type Fix =
  | { kind: "set"; field: "title" | "metaDescription" | "slug" | "url" | "keyword"; value: string }
  | { kind: "meta"; patch: Partial<DraftMeta> }
  | { kind: "replace"; find: string; replace: string; all?: boolean; last?: boolean }
  | { kind: "insert"; markdown: string; position: InsertPosition }
  | { kind: "set-h1"; text: string }
  | { kind: "link"; phrase: string; url: string }
  | { kind: "alt"; src: string; alt: string }
  | { kind: "batch"; fixes: Fix[] };

export type AiTask = "title" | "meta" | "intro" | "conclusion" | "section" | "faq" | "rewrite" | "claims" | "cta";

export type FixOption = {
  id: string;
  label: string;
  /** What the change does, shown before applying. */
  description: string;
  fix?: Fix;
  /** Content written by Claude on demand (preview first, then apply). */
  ai?: { task: AiTask; instruction: string; target?: string };
  /** Deterministic and complete (no placeholders): included in "Apply all safe fixes". */
  safe: boolean;
};

// -------------------------------------------------------------------------------- findings & report

export type EvidenceItem = { label: string; detail?: string; tone?: "good" | "warning" | "critical" | "neutral"; href?: string };

export type Finding = {
  feature: string;
  status: Status;
  /** 0..1; null when the check could not run (status "na"). */
  score: number | null;
  summary: string;
  how?: string;
  items?: EvidenceItem[];
  metrics?: { label: string; value: string }[];
  fixes?: FixOption[];
  /** Publication blocker: prevents "Ready to publish" regardless of the score. */
  blocker?: string;
  sources: EvidenceSource[];
  severity: Severity | null;
};

export type CategoryScore = { id: CategoryId; label: string; weight: number; score: number | null; checks: number; measured: number };

export type PublishStatus = "ready" | "needs-improvement" | "blocked";

export type Report = {
  overall: number | null;
  weighted: number | null;
  cap: { value: number; reason: string } | null;
  categories: CategoryScore[];
  findings: Finding[];
  counts: { critical: number; high: number; medium: number; low: number; passed: number; na: number; total: number };
  blockers: { feature: string; message: string }[];
  status: PublishStatus;
  readiness: number;
  topRecommendation: { feature: string; text: string } | null;
  intent: IntentProfile;
  words: number;
  analyzedAt: string;
};

export type IntentProfile = {
  keyword: Intent;
  keywordSignals: string[];
  serp: Intent | null;
  serpFormats: Partial<Record<ContentFormat, number>>;
  ai: Intent | null;
  dominant: Intent;
  format: ContentFormat;
  formatSignals: string[];
  contentIntent: Intent;
};

/** Compact summary kept on the draft row and in revisions. */
export type ReportSummary = Pick<Report, "overall" | "status" | "readiness"> & {
  categories: Record<CategoryId, number | null>;
  counts: Report["counts"];
  blockers: number;
};
