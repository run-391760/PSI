/**
 * On Page SEO Checker idea generation from real data only. Sources of each idea:
 *  - "live": the page we fetched from the user's site (HTML facts);
 *  - "serp": the real Google top 10 (DataForSEO) and those pages crawled for benchmarks;
 *  - "gsc":  the project's Search Console data for the page and its keyword.
 * Results stored before this (with demo benchmarks) have no `v: 2` and are hidden unless DEMO_DATA=true.
 */
import type { SerpFeature } from "@/lib/seo/types";
import { expectedCtr, type GscPageData, type RealRival, type RivalAvg, type SemanticTerm } from "./bench-map";
import type { PageFacts } from "./extract";
import { countKeyword, hasKeyword, normalizeText, wordList } from "./text";

export type IdeaType = "strategy" | "serp" | "semantic" | "content" | "backlinks" | "technical" | "ux";
export type Priority = "high" | "medium" | "low";
export const IDEA_TYPES: { id: IdeaType; label: string; description: string }[] = [
  { id: "strategy", label: "Strategy", description: "Keyword targeting, cannibalization and ranking potential" },
  { id: "serp", label: "SERP features", description: "How to win the rich results shown for the keyword" },
  { id: "semantic", label: "Semantic", description: "Related words, questions and queries to cover" },
  { id: "content", label: "Content", description: "Title, headings, meta description, length and keyword usage" },
  { id: "technical", label: "Technical issues", description: "Indexability, canonical, structured data and HTML issues" },
  { id: "ux", label: "User experience", description: "Readability, scannability and navigation" },
];
export const typeLabel = (t: IdeaType) => IDEA_TYPES.find((x) => x.id === t)?.label ?? t;

export type IdeaSource = "live" | "serp" | "gsc" | "demo";
export type Idea = { id: string; type: IdeaType; priority: Priority; title: string; detail: string; items?: string[]; source: IdeaSource };

export type KeywordUse = {
  inTitle: boolean;
  inH1: boolean;
  inMeta: boolean;
  inUrl: boolean;
  inFirst100: boolean;
  inH2: boolean;
  inAlt: boolean;
  mentions: number;
  density: number;
  semanticUsed: string[];
  semanticMissing: string[];
};

export type SerpBench = {
  features: SerpFeature[];
  position: number | null;
  rankingUrl: string | null;
  depth: number;
  avg: RivalAvg | null;
  rivals: Pick<RealRival, "position" | "domain" | "url" | "title" | "fetched" | "words" | "mentions" | "readability">[];
  semantic: SemanticTerm[];
  related: string[];
  questions: string[];
};

/** The benchmark stored with each result (what the page detail view needs). */
export type StoredBenchmark = {
  v: 2;
  serp: SerpBench | null;
  serpError: string | null;
  gsc: GscPageData | null;
  gscError: string | null;
};

export const isRealBenchmark = (b: unknown): b is StoredBenchmark => !!b && (b as { v?: number }).v === 2;

export function keywordUse(facts: PageFacts, text: string, alts: string[], url: string, keyword: string, semantic: SemanticTerm[]): KeywordUse {
  const first100 = wordList(text).slice(0, 100).join(" ");
  const mentions = countKeyword(text, keyword);
  const lower = normalizeText(text);
  const used: string[] = [],
    missing: string[] = [];
  for (const s of semantic) (countKeyword(lower, s.term) > 0 ? used : missing).push(s.term);
  let path = url;
  try {
    path = decodeURIComponent(new URL(url).pathname).replace(/[-_/]+/g, " ");
  } catch {
    /* keep raw */
  }
  return {
    inTitle: hasKeyword(facts.title, keyword),
    inH1: facts.h1s.some((h) => hasKeyword(h, keyword)),
    inMeta: hasKeyword(facts.metaDescription, keyword),
    inUrl: hasKeyword(path, keyword),
    inFirst100: hasKeyword(first100, keyword),
    inH2: facts.h2s.some((h) => hasKeyword(h, keyword)),
    inAlt: alts.some((a) => hasKeyword(a, keyword)),
    mentions,
    density: facts.words ? Math.round((mentions / facts.words) * 1000) / 10 : 0,
    semanticUsed: used,
    semanticMissing: missing,
  };
}

type FeatureCtx = { facts: PageFacts | null; use: KeywordUse | null; keyword: string; questions: string[] };
const FEATURE_IDEAS: Partial<Record<SerpFeature, (ctx: FeatureCtx) => Omit<Idea, "id" | "type" | "source"> | null>> = {
  featured_snippet: ({ facts, keyword }) => ({
    priority: "high",
    title: "Target the featured snippet",
    detail: `Google shows a featured snippet for “${keyword}”. Answer the query in a 40–50 word paragraph right below a heading that repeats the question${facts && !facts.lists && !facts.tables ? ", and add a bulleted list or table (the page has none)" : ", and keep lists or tables for steps and comparisons"}.`,
  }),
  people_also_ask: ({ facts, questions }) => ({
    priority: "medium",
    title: "Answer “People also ask” questions",
    detail: `Add an FAQ section that answers the questions Google shows for this keyword${facts && !facts.schemaTypes.includes("FAQPage") ? " and mark it up with FAQPage structured data" : ""}.`,
    items: questions.slice(0, 6),
  }),
  video: ({ facts }) => (facts?.hasVideo ? null : { priority: "medium", title: "Add a video", detail: "The SERP for this keyword includes video results. Embed a short, relevant video with a descriptive title and VideoObject markup." }),
  image_pack: ({ facts, use }) =>
    facts && facts.images >= 3 && use?.inAlt ? null : { priority: "low", title: "Optimize for the image pack", detail: `Google shows an image pack. Add original images${facts ? ` (you have ${facts.images})` : ""} with descriptive file names and alt text that includes the keyword.` },
  reviews: ({ facts }) => (facts && facts.schemaTypes.some((t) => /Review|AggregateRating/.test(t)) ? null : { priority: "medium", title: "Earn review rich results", detail: "Results with review stars appear for this keyword. Add genuine reviews and Review / AggregateRating structured data." }),
  ai_overview: () => ({ priority: "medium", title: "Make passages citable in AI Overviews", detail: "Google shows an AI Overview. Write short, self-contained passages that answer sub-questions directly, cite sources and show author expertise and update dates." }),
  local_pack: ({ facts }) => (facts && facts.schemaTypes.includes("LocalBusiness") ? null : { priority: "medium", title: "Compete for the local pack", detail: "A map pack is shown. Add your address, phone and opening hours and use LocalBusiness structured data consistent with your Google Business Profile." }),
  shopping: ({ facts }) => (facts && facts.schemaTypes.includes("Product") ? null : { priority: "medium", title: "Qualify for shopping results", detail: "Shopping results appear for this keyword. Add Product structured data with price and availability, and submit products to Merchant Center." }),
  top_stories: () => ({ priority: "low", title: "Publish timely news coverage", detail: "Top stories are shown. Publish fresh articles with NewsArticle markup, clear dates and author bylines." }),
  knowledge_panel: ({ facts }) => (facts && facts.schemaTypes.includes("Organization") ? null : { priority: "low", title: "Strengthen entity signals", detail: "A knowledge panel is shown. Add Organization structured data with logo and sameAs links to your official profiles." }),
  discussions: () => ({ priority: "low", title: "Join the discussion results", detail: "Forum and discussion results appear. Add first-hand experience to your page and contribute helpful answers in relevant communities." }),
};

type IdeaContext = {
  url: string;
  keyword: string;
  domain: string;
  facts: PageFacts | null;
  use: KeywordUse | null;
  fetchError: string | null;
  fetchStatus: number | null;
  bench: StoredBenchmark;
};

const QUESTION = /^(how|what|why|when|where|which|who|can|is|are|does|do|should)\b/;

export function generateIdeas(ctx: IdeaContext): Idea[] {
  const { url, keyword, facts, use, bench } = ctx;
  const ideas: Idea[] = [];
  const add = (type: IdeaType, code: string, source: IdeaSource, idea: Omit<Idea, "id" | "type" | "source">) => {
    if (!ideas.some((i) => i.id === `${type}:${code}`)) ideas.push({ id: `${type}:${code}`, type, source, ...idea });
  };
  const serp = bench.serp;
  const gsc = bench.gsc;
  const avg = serp?.avg ?? null;

  // ---------------------------------------------------------------- Strategy (Search Console)
  if (gsc) {
    const kwRow = gsc.queries.find((q) => normalizeText(q.query) === normalizeText(keyword));
    if (!kwRow) {
      add("strategy", "gsc-no-impressions", "gsc", {
        priority: "medium",
        title: "The page gets no Search Console impressions for this keyword",
        detail: `In the last 28 days Google didn't show ${displayPath(url)} for “${keyword}”. Check the keyword matches the page's intent, then align title, H1 and content with it.${gsc.queries[0] ? ` The page's top query is “${gsc.queries[0].query}”.` : ""}`,
      });
    } else if (kwRow.position >= 4 && kwRow.position <= 20) {
      add("strategy", "quick-win", "gsc", { priority: "high", title: `Quick win: average position ${kwRow.position}`, detail: `“${keyword}” brought ${kwRow.impressions.toLocaleString("en-US")} impressions and ${kwRow.clicks.toLocaleString("en-US")} clicks in 28 days. Moving into the top 3 usually multiplies clicks; apply the content ideas below first.` });
    } else if (kwRow.position > 20) {
      add("strategy", "low-rank", "gsc", { priority: "medium", title: `Average position ${kwRow.position}`, detail: "Positions beyond page 2 get almost no clicks. Align the page closely with the search intent and strengthen it with internal links." });
    } else {
      add("strategy", "top3", "gsc", { priority: "low", title: `Already at position ${kwRow.position}`, detail: "Protect the position: refresh the content regularly and keep the snippet compelling." });
    }
    const other = gsc.keywordPages.find((p) => normalizeUrl(p.url) !== normalizeUrl(facts?.finalUrl ?? url));
    const self = gsc.keywordPages.find((p) => normalizeUrl(p.url) === normalizeUrl(facts?.finalUrl ?? url));
    if (other && other.impressions >= (self?.impressions ?? 0))
      add("strategy", "cannibal", "gsc", { priority: "medium", title: "Another page of your site gets more impressions for this keyword", detail: `Search Console shows ${other.url} for “${keyword}” (${other.impressions.toLocaleString("en-US")} impressions, position ${other.position}). Choose one page for the keyword and link to it from the other.`, items: gsc.keywordPages.slice(0, 4).map((p) => `${displayPath(p.url)} · ${p.impressions.toLocaleString("en-US")} impr. · pos ${p.position}`) });
    if (gsc.page && gsc.page.impressions >= 300 && gsc.page.position <= 10 && gsc.page.ctr < expectedCtr(gsc.page.position) * 0.5)
      add("content", "low-ctr", "gsc", { priority: "high", title: `Low click-through rate (${(gsc.page.ctr * 100).toFixed(1)}%)`, detail: `The page averages position ${gsc.page.position} with ${gsc.page.impressions.toLocaleString("en-US")} impressions, but few searchers click. Rewrite the title and meta description to match what they search for and promise a clear benefit.` });
    if (facts) {
      const gaps = gsc.queries.filter((q) => q.impressions >= 10 && normalizeText(q.query) !== normalizeText(keyword) && !hasKeyword(facts.title, q.query) && !facts.h1s.some((h) => hasKeyword(h, q.query)) && wordList(q.query).length <= 6).slice(0, 8);
      if (gaps.length)
        add("content", "query-gap", "gsc", {
          priority: gaps[0].impressions >= 200 ? "high" : "medium",
          title: `${gaps.length} quer${gaps.length === 1 ? "y brings" : "ies bring"} impressions but ${gaps.length === 1 ? "isn't" : "aren't"} in the title or H1`,
          detail: "Google already shows this page for these searches. Work the most relevant ones into the title, H1 or a subheading and answer them in the text.",
          items: gaps.map((q) => `${q.query} · ${q.impressions.toLocaleString("en-US")} impr. · pos ${q.position}`),
        });
      const lower = normalizeText(facts.snippet + " " + facts.h2s.join(" "));
      const qs = gsc.queries.filter((q) => QUESTION.test(normalizeText(q.query)) && countKeyword(lower, q.query) === 0).slice(0, 6);
      if (qs.length) add("semantic", "gsc-questions", "gsc", { priority: "medium", title: "Answer the questions searchers find this page with", detail: "Search Console shows these question queries for the page. Add a section or FAQ that answers each one directly.", items: qs.map((q) => q.query) });
    }
  }

  // ---------------------------------------------------------------- Strategy + SERP features (real SERP)
  if (serp) {
    if (!gsc) {
      const pos = serp.position;
      if (pos == null) add("strategy", "not-ranking", "serp", { priority: "medium", title: `Your domain isn't in the top ${serp.depth} for this keyword`, detail: `Make this page the definitive resource for “${keyword}” and support it with internal links and backlinks.` });
      else if (pos >= 4 && pos <= 20) add("strategy", "quick-win", "serp", { priority: "high", title: `Quick win: you rank #${pos}`, detail: "Moving into the top 3 usually multiplies clicks. Apply the content and semantic ideas below first." });
      else if (pos > 20) add("strategy", "low-rank", "serp", { priority: "medium", title: `The page ranks #${pos}`, detail: "Positions beyond page 2 get almost no clicks. Align the page closely with the search intent and grow its authority with links." });
      else add("strategy", "top3", "serp", { priority: "low", title: `You already rank #${pos}`, detail: "Protect the position: refresh the content regularly and monitor rivals." });
      if (serp.rankingUrl && normalizeUrl(serp.rankingUrl) !== normalizeUrl(facts?.finalUrl ?? url))
        add("strategy", "cannibal", "serp", { priority: "medium", title: "Another page of your site ranks for this keyword", detail: `Google ranks ${serp.rankingUrl} for “${keyword}”. Choose one page for the keyword and link to it from the other.`, items: [serp.rankingUrl] });
    }
    for (const f of serp.features) {
      const idea = FEATURE_IDEAS[f]?.({ facts, use, keyword, questions: serp.questions });
      if (idea) add("serp", f, "serp", idea);
    }
  }

  // ---------------------------------------------------------------- Technical (live)
  if (!facts) {
    add("technical", "fetch", "live", {
      priority: "high",
      title: ctx.fetchStatus ? `The page returned HTTP ${ctx.fetchStatus}` : "The page could not be fetched",
      detail: ctx.fetchStatus ? `Search engines can't rank a page that returns ${ctx.fetchStatus}. Fix the URL or redirect it to the right page, then collect ideas again.` : `${ctx.fetchError ?? "The request failed."} Content, technical and UX ideas need a reachable page.`,
    });
  } else {
    if (normalizeUrl(facts.finalUrl) !== normalizeUrl(url)) add("technical", "redirect", "live", { priority: "medium", title: "The target URL redirects", detail: `It resolves to ${facts.finalUrl}. Use the final URL in internal links, sitemaps and this checker.` });
    if (!facts.https) add("technical", "https", "live", { priority: "high", title: "The page is not served over HTTPS", detail: "Serve the page over HTTPS and redirect the HTTP version." });
    if (facts.noindex) add("technical", "noindex", "live", { priority: "high", title: "The page is blocked from indexing (noindex)", detail: `Robots directive: “${facts.robots}”. Remove noindex if the page should rank.` });
    if (facts.canonical && normalizeUrl(facts.canonical) !== normalizeUrl(facts.finalUrl)) add("technical", "canonical-other", "live", { priority: "high", title: "Canonical points to another URL", detail: `The canonical is ${facts.canonical}, so Google may index that URL instead of this page.` });
    else if (!facts.canonical) add("technical", "canonical-missing", "live", { priority: "low", title: "No canonical tag", detail: "Add a self-referencing canonical to prevent duplicate URLs (parameters, tracking) from splitting signals." });
    if (facts.invalidJsonLd) add("technical", "jsonld", "live", { priority: "medium", title: `${facts.invalidJsonLd} invalid JSON-LD block${facts.invalidJsonLd > 1 ? "s" : ""}`, detail: "Fix the JSON syntax so search engines can read your structured data." });
    if (!facts.schemaTypes.length) add("technical", "schema", "live", { priority: "medium", title: "No structured data found", detail: "Add schema.org markup that matches the page type (e.g. Article, Product, FAQPage, BreadcrumbList) so it is eligible for rich results." });
    if (!facts.viewport) add("technical", "viewport", "live", { priority: "high", title: "No viewport meta tag", detail: "Without <meta name=\"viewport\"> the page is not mobile-friendly, and Google indexes the mobile version." });
    if (!facts.lang) add("technical", "lang", "live", { priority: "low", title: "Missing html lang attribute", detail: "Declare the page language (e.g. <html lang=\"en\">) for accessibility and language targeting." });
    if (facts.bytes > 600_000) add("technical", "html-size", "live", { priority: "low", title: `Large HTML document (${Math.round(facts.bytes / 1024)} KB)`, detail: "Heavy HTML slows rendering and crawling; remove inline data and unused markup." });
    if (facts.internalLinks + facts.externalLinks > 300) add("technical", "links", "live", { priority: "low", title: `Too many links on the page (${facts.internalLinks + facts.externalLinks})`, detail: "Hundreds of links dilute link equity and distract readers; keep the most useful ones." });
    if (!facts.og.title || !facts.og.image) add("technical", "og", "live", { priority: "low", title: "Incomplete Open Graph tags", detail: "Add og:title, og:description and og:image so shares look good on social networks and messengers." });
  }

  // ---------------------------------------------------------------- Content (live page, compared with the real top 10 when available)
  if (facts && use) {
    if (!facts.title) add("content", "title-missing", "live", { priority: "high", title: "Add a title tag", detail: `Write a unique title of 50–60 characters that starts with “${keyword}”.` });
    else if (!use.inTitle) add("content", "title-kw", "live", { priority: "high", title: "Use the keyword in the title", detail: `Current title: “${facts.title}”. Put “${keyword}” near the beginning.` });
    if (facts.title && (facts.title.length > 65 || facts.title.length < 25)) add("content", "title-length", "live", { priority: "low", title: `Title is ${facts.title.length > 65 ? "too long" : "too short"} (${facts.title.length} characters)`, detail: "Keep titles around 50–60 characters so they are not truncated in the SERP." });
    if (!facts.h1s.length) add("content", "h1-missing", "live", { priority: "high", title: "Add an H1 heading", detail: `Use one H1 that contains “${keyword}”.` });
    else if (!use.inH1) add("content", "h1-kw", "live", { priority: "medium", title: "Use the keyword in the H1", detail: `Current H1: “${facts.h1s[0]}”.` });
    if (facts.h1s.length > 1) add("content", "h1-multi", "live", { priority: "low", title: `${facts.h1s.length} H1 headings`, detail: "Use a single H1 for the main topic and H2–H3 for sections." });
    if (!facts.metaDescription) add("content", "meta-missing", "live", { priority: "medium", title: "Add a meta description", detail: `Write a 120–155 character summary that includes “${keyword}” and a reason to click.` });
    else if (!use.inMeta) add("content", "meta-kw", "live", { priority: "medium", title: "Use the keyword in the meta description", detail: `Google bolds query words in snippets. Current description: “${facts.metaDescription.slice(0, 160)}”.` });
    if (facts.metaDescription && (facts.metaDescription.length > 170 || facts.metaDescription.length < 70)) add("content", "meta-length", "live", { priority: "low", title: `Meta description is ${facts.metaDescription.length > 170 ? "too long" : "too short"} (${facts.metaDescription.length} chars)`, detail: "Aim for 120–155 characters." });
    if (use.mentions === 0) add("content", "kw-body", "live", { priority: "high", title: "The keyword doesn't appear in the text", detail: `Mention “${keyword}” naturally in the body${avg ? ` — the crawled top pages use it about ${avg.mentions} times` : ""}.` });
    else if (!use.inFirst100) add("content", "kw-first", "live", { priority: "medium", title: "Mention the keyword in the first 100 words", detail: "Early use confirms the topic to readers and search engines." });
    if (use.density > 3) add("content", "kw-stuffing", "live", { priority: "high", title: `Keyword density is high (${use.density}%)`, detail: "This can look like keyword stuffing. Replace some mentions with synonyms and related terms." });
    else if (avg && use.mentions > 0 && use.mentions < avg.mentions * 0.5) add("content", "kw-few", "serp", { priority: "low", title: "Use the keyword a bit more often", detail: `You mention it ${use.mentions}× vs about ${avg.mentions}× on the ${avg.crawled} crawled top-10 pages.` });
    if (avg && facts.words < avg.words * 0.8) add("content", "length", "serp", { priority: facts.words < avg.words * 0.5 ? "high" : "medium", title: `Increase the text length to about ${avg.words.toLocaleString("en-US")} words`, detail: `Your page has ${facts.words.toLocaleString("en-US")} words of main content; the crawled top-10 pages have ${avg.wordsRange[0].toLocaleString("en-US")}–${avg.wordsRange[1].toLocaleString("en-US")}. Cover the subtopics searchers expect rather than padding.` });
    if (avg?.readability != null && facts.flesch != null && facts.flesch < avg.readability - 10) add("content", "readability", "serp", { priority: "medium", title: "Make the text easier to read", detail: `Flesch reading ease is ${Math.round(facts.flesch)} vs ${avg.readability} on the top pages. Use shorter sentences (you average ${facts.avgSentenceLength} words) and simpler words.` });
    if (facts.imagesMissingAlt > 0) add("content", "alt", "live", { priority: "medium", title: `${facts.imagesMissingAlt} image${facts.imagesMissingAlt > 1 ? "s" : ""} without alt attribute`, detail: "Describe each meaningful image in its alt text; use the keyword where it fits naturally." });
    else if (facts.images > 0 && !use.inAlt) add("content", "alt-kw", "live", { priority: "low", title: "Use the keyword in an image alt text", detail: "At least one relevant image should describe the topic in its alt text." });
    if (!use.inUrl && !/^https?:\/\/[^/]+\/?$/.test(url)) add("content", "url", "live", { priority: "low", title: "The URL doesn't contain the keyword", detail: "Descriptive URLs help users; only change existing URLs with a 301 redirect." });
    if (avg && facts.images < avg.images * 0.4 && avg.images >= 3) add("content", "images", "serp", { priority: "low", title: "Add more visuals", detail: `The top pages use about ${avg.images} images; you have ${facts.images}.` });

    // ---------------------------------------------------------------- Semantic
    if (serp && use.semanticMissing.length && serp.semantic.length)
      add("semantic", "words", "serp", { priority: use.semanticMissing.length > serp.semantic.length / 2 ? "high" : "medium", title: "Cover words the top pages use", detail: `Several of the crawled top-10 pages use these words that your page doesn't (${use.semanticUsed.length} of ${serp.semantic.length} used).`, items: use.semanticMissing.slice(0, 12) });
    if (!use.inH2 && facts.h2s.length) add("semantic", "h2", "live", { priority: "low", title: "Use the keyword or a variation in a subheading", detail: `None of your ${facts.h2s.length} H2 headings mention “${keyword}”.` });
    if (avg && facts.h2s.length < Math.max(2, avg.h2 - 2)) add("semantic", "structure", "serp", { priority: "medium", title: "Cover more subtopics with H2 sections", detail: `You have ${facts.h2s.length} H2 sections; the top pages average ${avg.h2}.${serp?.related.length ? " Google's related searches suggest these subtopics:" : ""}`, items: serp?.related.slice(0, 5) });
  } else if (serp?.semantic.length) {
    add("semantic", "words-nopage", "serp", { priority: "medium", title: "Use words the top pages share", detail: "The crawled top-10 pages commonly use these words. Your page couldn't be fetched, so usage wasn't checked.", items: serp.semantic.slice(0, 12).map((s) => s.term) });
  }

  // ---------------------------------------------------------------- User experience (live)
  if (facts) {
    if (facts.longParagraphs) add("ux", "paragraphs", "live", { priority: "medium", title: `Break up ${facts.longParagraphs} long paragraph${facts.longParagraphs > 1 ? "s" : ""}`, detail: "Paragraphs over 150 words are hard to read on mobile. Aim for 2–4 sentences each." });
    if (facts.avgSentenceLength > 22) add("ux", "sentences", "live", { priority: "low", title: "Shorten your sentences", detail: `Sentences average ${facts.avgSentenceLength} words (${facts.longSentences} over 25 words). Aim for 15–20.` });
    if (facts.words > 1500 && facts.jumpLinks < 3) add("ux", "toc", "live", { priority: "low", title: "Add a table of contents", detail: "Long pages are easier to navigate with jump links to each section (and may earn sitelinks in the SERP)." });
    if (facts.internalLinks < 3) add("ux", "internal", "live", { priority: "medium", title: "Add internal links to related pages", detail: `The page has ${facts.internalLinks} internal link${facts.internalLinks === 1 ? "" : "s"}. Link to related content to keep readers on the site and spread authority.` });
    if (facts.imagesNoDimensions > 0 && facts.images > 0) add("ux", "cls", "live", { priority: "low", title: `${facts.imagesNoDimensions} image${facts.imagesNoDimensions > 1 ? "s" : ""} without width/height`, detail: "Set explicit dimensions to prevent layout shifts (CLS) while the page loads." });
    if (facts.words > 800 && !facts.lists && !facts.tables) add("ux", "scannable", "live", { priority: "low", title: "Make the content scannable", detail: "Use bulleted lists, tables or highlighted key points so readers can skim." });
  }
  const order: Record<Priority, number> = { high: 0, medium: 1, low: 2 };
  return ideas.sort((a, b) => order[a.priority] - order[b.priority]);
}

const displayPath = (u: string) => {
  try {
    return new URL(u).pathname || "/";
  } catch {
    return u;
  }
};

export function normalizeUrl(u: string) {
  try {
    const x = new URL(u);
    return `${x.hostname.replace(/^www\./, "")}${x.pathname.replace(/\/$/, "")}${x.search}`.toLowerCase();
  } catch {
    return u.toLowerCase();
  }
}

/** Real demand/position of a stored benchmark: Search Console impressions and position when linked, else the SERP position. */
export function benchDemand(b: unknown): { impressions: number | null; position: number | null } {
  if (!isRealBenchmark(b)) return { impressions: null, position: null };
  if (b.gsc) return { impressions: b.gsc.page?.impressions ?? 0, position: b.gsc.page?.position ?? null };
  return { impressions: null, position: b.serp?.position ?? null };
}

/** 0..100: ranking opportunity (from real impressions/position when known) plus weight of open ideas. */
export function priorityScore(bench: unknown, ideas: Idea[]) {
  const { impressions, position } = benchDemand(bench);
  let s1: number;
  if (impressions != null && impressions > 0) {
    const room = position == null ? 1 : position <= 3 ? 0.15 : position <= 20 ? 1 : 0.6;
    s1 = Math.min(1, Math.log10(1 + impressions * room) / 4.5) * 60;
  } else s1 = position == null ? 15 : position <= 3 ? 5 : position <= 20 ? 35 : 20;
  const high = ideas.filter((i) => i.priority === "high").length,
    med = ideas.filter((i) => i.priority === "medium").length;
  const s2 = Math.min(40, high * 7 + med * 2.5 + (ideas.length - high - med) * 0.5);
  return Math.round(s1 + s2);
}

/** Generic labels for aggregating the same idea across pages. */
export const IDEA_LABELS: Record<string, string> = {
  "strategy:not-ranking": "Not in the top results",
  "strategy:gsc-no-impressions": "No impressions for the keyword",
  "content:low-ctr": "Low click-through rate",
  "content:query-gap": "Queries missing from title/H1",
  "semantic:gsc-questions": "Unanswered question queries",
  "semantic:words-nopage": "Words the top pages share",
  "strategy:quick-win": "Quick win: ranks #4–20",
  "strategy:low-rank": "Ranks beyond page 2",
  "strategy:top3": "Already in the top 3",
  "strategy:cannibal": "Another page ranks for the keyword",
  "technical:fetch": "Page could not be fetched",
  "technical:redirect": "Target URL redirects",
  "technical:canonical-missing": "No canonical tag",
  "technical:canonical-other": "Canonical points elsewhere",
  "technical:schema": "No structured data",
  "technical:og": "Incomplete Open Graph tags",
  "technical:jsonld": "Invalid JSON-LD",
  "technical:html-size": "Large HTML document",
  "content:length": "Text shorter than the top pages",
  "content:title-kw": "Keyword missing from title",
  "content:title-length": "Title length",
  "content:h1-kw": "Keyword missing from H1",
  "content:h1-missing": "No H1 heading",
  "content:h1-multi": "Multiple H1 headings",
  "content:meta-kw": "Keyword missing from meta description",
  "content:meta-missing": "No meta description",
  "content:meta-length": "Meta description length",
  "content:kw-body": "Keyword not in the text",
  "content:kw-first": "Keyword not in the first 100 words",
  "content:kw-few": "Keyword used less than rivals",
  "content:readability": "Harder to read than rivals",
  "content:alt": "Images without alt",
  "content:alt-kw": "Keyword not in image alt",
  "content:url": "Keyword not in URL",
  "content:images": "Fewer visuals than rivals",
  "semantic:words": "Missing words the top pages use",
  "semantic:h2": "Keyword not in subheadings",
  "semantic:structure": "Fewer H2 sections than rivals",
  "ux:paragraphs": "Long paragraphs",
  "ux:sentences": "Long sentences",
  "ux:toc": "No table of contents",
  "ux:internal": "Few internal links",
  "ux:cls": "Images without dimensions",
  "ux:scannable": "Not scannable (no lists/tables)",
};
