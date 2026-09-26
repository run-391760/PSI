/** Shared Site Audit types (client-safe: no server imports). */

export type Severity = "error" | "warning" | "notice";
export const CATEGORIES = ["Crawlability", "HTTPS", "International SEO", "Performance", "Internal linking", "Markup", "Content", "Core Web Vitals"] as const;
export type Category = (typeof CATEGORIES)[number];

export type CrawlSource = "website" | "sitemap" | "both";
export type AuditConfig = {
  startUrl: string;
  limit: number;
  source: CrawlSource;
  device: "desktop" | "mobile";
  /** Crawl every host of the registrable domain (true) or only the start URL's host (false). */
  subdomains: boolean;
  allow: string[];
  disallow: string[];
  /** Minimum delay between requests to one host (ms). robots.txt Crawl-delay wins when larger. */
  delayMs: number;
  checkExternal: boolean;
  schedule: "off" | "daily" | "weekly";
};

export type CrawlStatus = "running" | "done" | "stopped" | "failed";

export type RedirectStep = { url: string; status: number };

export type HtmlFacts = {
  title: string | null;
  titleCount: number;
  description: string | null;
  descriptionCount: number;
  h1: string[];
  h2: string[];
  canonical: string | null;
  canonicals: string[];
  canonicalHeader: string | null;
  metaRobots: string;
  noindex: boolean;
  nofollow: boolean;
  hreflang: { lang: string; href: string | null; raw: string }[];
  lang: string | null;
  viewport: string | null;
  charset: string | null;
  doctype: boolean;
  metaRefresh: string | null;
  wordCount: number;
  textRatio: number;
  contentHash: string;
  simhash: string;
  /** MinHash signature (64 × 32-bit, hex) for Jaccard-based near-duplicate detection. */
  minhash?: string;
  internalLinks: number;
  externalLinks: number;
  uniqueInternal: number;
  uniqueExternal: number;
  nofollowInternal: number;
  nofollowExternal: number;
  emptyAnchors: number;
  httpLinks: number;
  images: number;
  imagesMissingAlt: number;
  missingAltSamples: string[];
  scripts: number;
  stylesheets: number;
  iframes: number;
  jsonLd: { count: number; types: string[]; errors: string[] };
  microdata: string[];
  og: Record<string, string>;
  twitter: Record<string, string>;
  mixedContent: string[];
  frames: boolean;
  flash: boolean;
  amp: boolean;
};

export type PageHeaders = {
  hsts: string | null;
  csp: string | null;
  xcto: string | null;
  xfo: string | null;
  referrer: string | null;
  encoding: string | null;
  xRobots: string | null;
  server: string | null;
  cacheControl: string | null;
  lastModified: string | null;
  linkCanonical: string | null;
};

/** Everything recorded for one URL (stored in audit_pages.data). */
export type PageData = {
  error: string | null;
  source: "start" | "link" | "sitemap" | "redirect";
  foundOn: string | null;
  redirectChain: RedirectStep[];
  redirectLoop: boolean;
  blocked: "robots" | null;
  /** The response was a bot-protection interstitial (challenge/CAPTCHA), not the real page. */
  challenge?: boolean;
  ttfbMs: number | null;
  transferBytes: number | null;
  truncated: boolean;
  headers: PageHeaders | null;
  html: HtmlFacts | null;
  /** Resolved end of the redirect chain across crawled rows. */
  resolvedFinal?: string | null;
  resolvedStatus?: number | null;
  resolvedHops?: number;
};

export type PsiMetric = { value: number | null; status: "good" | "ni" | "poor" | null };
export type PsiPage = {
  url: string;
  strategy: "mobile" | "desktop";
  ok: boolean;
  error?: string;
  score: number | null;
  lab: { lcp: PsiMetric; cls: PsiMetric; tbt: PsiMetric; fcp: PsiMetric; si: PsiMetric };
  field: { lcp: PsiMetric; inp: PsiMetric; cls: PsiMetric; fcp: PsiMetric; ttfb: PsiMetric; overall: string | null } | null;
  origin: { lcp: PsiMetric; inp: PsiMetric; cls: PsiMetric; overall: string | null } | null;
  fetchedAt: string;
};
export type CwvSummary = {
  status: "ok" | "partial" | "unavailable" | "disabled";
  note: string | null;
  strategy: "mobile" | "desktop";
  pages: PsiPage[];
  measuredAt: string;
};

export type SiteFacts = {
  host: string;
  origin: string;
  homepage: { url: string; finalUrl: string | null; status: number | null; chain: RedirectStep[] };
  robots: { url: string; status: number | null; found: boolean; bytes: number; sitemaps: string[]; crawlDelay: number | null; error: string | null; excerpt: string };
  sitemaps: { url: string; status: number | null; kind: "urlset" | "index" | "invalid" | "missing"; urls: number; bytes: number; errors: string[]; fromRobots: boolean }[];
  sitemapUrlCount: number;
  llms: { url: string; status: number | null; found: boolean; bytes: number; firstLine: string | null; problems: string[] };
  https: { supported: boolean; error: string | null; httpRedirects: boolean | null; httpStatus: number | null; httpLocation: string | null };
  tls: { protocol: string | null; validTo: string | null; issuer: string | null; subject: string | null; error: string | null } | null;
  www: { altHost: string; status: number | null; location: string | null; ok: boolean | null; note: string };
  scopeNote: string;
  frontierExhausted: boolean;
  /** HTTPS / www / llms.txt probes ran (false when the crawl was stopped early). */
  probed: boolean;
  /** Why the crawl was cut short by rate limiting / bot protection (null when it wasn't). */
  throttled?: string | null;
  blockedMore: number;
  externalChecked: number;
  resourcesChecked: number;
  effectiveDelayMs: number;
  /** Times the crawler slowed down because the site rate-limited, challenged or timed out. */
  backoffEvents?: number;
  userAgent: string;
};

export type ThemeKey = "crawlability" | "https" | "international" | "cwv" | "performance" | "linking" | "markup";
export type CrawlStats = {
  byCheck: Record<string, number>;
  pagesByCheck: Record<string, number>;
  breakdown: { healthy: number; broken: number; issues: number; redirected: number; blocked: number };
  themes: Record<ThemeKey, number | null>;
  pages: number;
  htmlPages: number;
  /** Fetched pages (not blocked) and how many of them have errors / warnings. */
  fetched?: number;
  pagesWithErrors?: number;
  pagesWithWarnings?: number;
  durationMs: number;
};

export type LiveProgress = {
  phase: string;
  crawled: number;
  discovered: number;
  queued: number;
  limit: number;
  broken: number;
  redirects: number;
  recent: { url: string; status: number | null; ms: number | null }[];
  startedAt: string;
};
