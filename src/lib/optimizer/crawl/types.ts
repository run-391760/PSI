/**
 * Types of the live crawler (client-safe): the page snapshot the spider walks over, the "touch"
 * events it emits per element, the flags (real measured issues), and the Server-Sent Events of a run.
 */

export type BlockTag = "title" | "meta" | "head" | "h1" | "h2" | "h3" | "p" | "li" | "a" | "img" | "table";

/** One element of the page snapshot, in document order. Links inside text carry `parent`. */
export type Block = {
  id: string;
  tag: BlockTag;
  /** Visible text (truncated); for images the alt text; for tables the caption or first row. */
  text: string;
  /** Real heading level (1–6) for h1/h2/h3 blocks; h4–h6 are shown as h3. */
  level?: number;
  href?: string;
  src?: string;
  /** Raw alt attribute of an image (null = attribute missing). */
  alt?: string | null;
  /** The text block a link sits in (the link is rendered inline in that block). */
  parent?: string;
  /** Text split into plain runs and link runs (`a` = link block id), for blocks containing links. */
  segs?: { t: string; a?: string }[];
  /** First rows of a table (cell text, truncated). */
  rows?: string[][];
  ordered?: boolean;
  /** Word count of the full paragraph/list item (before truncation). */
  words?: number;
  truncated?: boolean;
};

export type TouchKind = "link" | "heading" | "image" | "text" | "meta";
export type TouchAction = "fetched" | "flagged" | "ok";
export type FlagSeverity = "critical" | "high" | "medium" | "low";

/** Identifiers of the measured issues the crawler flags. */
export type FlagRule =
  | "http-error"
  | "noindex"
  | "canonical-other"
  | "title-missing"
  | "title-length"
  | "meta-missing"
  | "meta-length"
  | "lang-missing"
  | "viewport-missing"
  | "h1-missing"
  | "h1-multiple"
  | "heading-skip"
  | "heading-empty"
  | "thin-content"
  | "long-paragraph"
  | "img-alt-missing"
  | "img-alt-empty"
  | "img-mixed"
  | "anchor-generic"
  | "anchor-empty"
  | "link-insecure"
  | "link-broken"
  | "link-redirect"
  | "link-error"
  | "slow-response";

export type Flag = { rule: FlagRule; severity: FlagSeverity; label: string; blockId: string | null };

/** The spider inspected one element: what it is and what it found. */
export type Touch = { blockId: string; kind: TouchKind; action: TouchAction; label: string; rule?: FlagRule };

export type LinkStatus = {
  url: string;
  status: number | null;
  redirects: number;
  finalUrl: string | null;
  error: string | null;
  ms: number | null;
  method: "HEAD" | "GET" | "known" | "skipped";
  /** Why the link was not requested (e.g. robots.txt disallows it). */
  note?: string;
};

export type PageScore = {
  /** Optimizer engine score out of 10 (null when the page had no readable text). */
  score: number | null;
  status: "ready" | "needs-improvement" | "blocked" | null;
  /** The keyword the engine scored against (inferred from the URL slug or title). */
  keyword: string;
  top: { feature: string; name: string; severity: FlagSeverity | null; text: string }[];
  counts: { critical: number; high: number; medium: number; low: number; passed: number } | null;
};

export type PageResult = {
  index: number;
  url: string;
  finalUrl: string;
  depth: number;
  /** Index of the page the URL was discovered on (null for the start URL). */
  from: number | null;
  status: number | null;
  timing: { ttfbMs: number | null; totalMs: number | null };
  redirects: number;
  title: string;
  contentType: string | null;
  words: number | null;
  blocks: Block[];
  touches: Touch[];
  flags: Flag[];
  score: PageScore | null;
  error: string | null;
  /** Links on the page that were status-checked. */
  linksChecked: number;
};

export type CrawlSummary = {
  pages: number;
  ok: number;
  errors: number;
  skipped: number;
  flags: number;
  byRule: { rule: FlagRule; label: string; severity: FlagSeverity; count: number }[];
  bySeverity: Record<FlagSeverity, number>;
  avgScore: number | null;
  worst: { index: number; url: string; score: number | null; flags: number }[];
  durationMs: number;
  stopReason: string | null;
};

export type CrawlStatus = "running" | "done" | "cancelled" | "failed";

export type Skip = { url: string; reason: string };

/** A stored crawl (opt_crawls row). */
export type CrawlRecord = {
  id: string;
  startUrl: string;
  domain: string;
  status: CrawlStatus;
  maxPages: number;
  pages: PageResult[];
  skips: Skip[];
  summary: CrawlSummary | null;
  createdAt: string;
  finishedAt: string | null;
};
export type CrawlListItem = Pick<CrawlRecord, "id" | "startUrl" | "domain" | "status" | "createdAt" | "finishedAt"> & { pages: number; flags: number; avgScore: number | null };

/** Server-Sent Events of one crawl, in emission order. */
export type CrawlEvent =
  | { type: "start"; id: string; startUrl: string; domain: string; maxPages: number; maxDepth: number; crawlDelayMs: number; robots: "found" | "missing"; startedAt: string; timeCapMs: number }
  | { type: "queue"; added: { url: string; depth: number; from: number }[]; queued: number }
  | { type: "fetching"; url: string; depth: number; done: number }
  | { type: "page"; page: Omit<PageResult, "touches" | "flags" | "score" | "linksChecked"> }
  | { type: "touch"; page: number; touch: Touch }
  | { type: "flag"; page: number; flag: Flag }
  | { type: "score"; page: number; score: PageScore; linksChecked: number }
  | { type: "skip"; skip: Skip }
  | { type: "summary"; summary: CrawlSummary }
  | { type: "done"; id: string; status: CrawlStatus; saved: boolean }
  | { type: "error"; message: string };
