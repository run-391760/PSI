/**
 * On Page SEO Checker idea generation. Ideas based only on the fetched page are marked "live"; ideas
 * that rely on the demo engine (rival benchmarks, SERP features, backlinks, rankings) are marked "demo".
 */
import { ctrFor } from "@/lib/seo/engine";
import type { SerpFeature } from "@/lib/seo/types";
import type { BacklinkSource, Benchmark, RelatedKeyword, SemanticTerm } from "./benchmark";
import type { PageFacts } from "./extract";
import { countKeyword, hasKeyword, normalizeText, wordList } from "./text";

export type IdeaType = "strategy" | "serp" | "semantic" | "content" | "backlinks" | "technical" | "ux";
export type Priority = "high" | "medium" | "low";
export const IDEA_TYPES: { id: IdeaType; label: string; description: string }[] = [
  { id: "strategy", label: "Strategy", description: "Keyword targeting, cannibalization and ranking potential" },
  { id: "serp", label: "SERP features", description: "How to win the rich results shown for the keyword" },
  { id: "semantic", label: "Semantic", description: "Related words and subtopics your rivals cover" },
  { id: "content", label: "Content", description: "Title, headings, meta description, length and keyword usage" },
  { id: "backlinks", label: "Backlinks", description: "Domains that link to your rivals but not to you" },
  { id: "technical", label: "Technical issues", description: "Indexability, canonical, structured data and HTML issues" },
  { id: "ux", label: "User experience", description: "Readability, scannability and navigation" },
];
export const typeLabel = (t: IdeaType) => IDEA_TYPES.find((x) => x.id === t)?.label ?? t;

export type Idea = { id: string; type: IdeaType; priority: Priority; title: string; detail: string; items?: string[]; source: "live" | "demo" };

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

/** The slim benchmark stored with each result (what the page detail view needs). */
export type StoredBenchmark = {
  metrics: Benchmark["metrics"];
  position: number | null;
  rankingUrl: string | null;
  ownRefDomains: number;
  avg: Benchmark["avg"];
  rivals: Pick<Benchmark["rivals"][number], "position" | "domain" | "url" | "title" | "words" | "mentions" | "readability" | "refDomains">[];
  semantic: SemanticTerm[];
  related: RelatedKeyword[];
  questions: RelatedKeyword[];
  backlinkSources: BacklinkSource[];
};

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

const FEATURE_IDEAS: Partial<Record<SerpFeature, (ctx: IdeaContext) => Omit<Idea, "id" | "type" | "source"> | null>> = {
  featured_snippet: ({ facts, keyword }) => ({
    priority: "high",
    title: "Target the featured snippet",
    detail: `Google shows a featured snippet for “${keyword}”. Answer the query in a 40–50 word paragraph right below a heading that repeats the question${facts && !facts.lists && !facts.tables ? ", and add a bulleted list or table (the page has none)" : ", and keep lists or tables for steps and comparisons"}.`,
  }),
  people_also_ask: ({ bench, facts }) => ({
    priority: "medium",
    title: "Answer “People also ask” questions",
    detail: `Add an FAQ section that answers the related questions searchers ask${facts && !facts.schemaTypes.includes("FAQPage") ? " and mark it up with FAQPage structured data" : ""}.`,
    items: bench.questions.slice(0, 5).map((q) => q.keyword),
  }),
  video: ({ facts }) => (facts?.hasVideo ? null : { priority: "medium", title: "Add a video", detail: "The SERP for this keyword includes video results. Embed a short, relevant video with a descriptive title and VideoObject markup to compete for the video carousel." }),
  image_pack: ({ facts, use }) =>
    facts && facts.images >= 3 && use?.inAlt
      ? null
      : { priority: "low", title: "Optimize for the image pack", detail: `Google shows an image pack. Add original images${facts ? ` (you have ${facts.images})` : ""} with descriptive file names and alt text that includes the keyword.` },
  reviews: ({ facts }) =>
    facts && facts.schemaTypes.some((t) => /Review|AggregateRating/.test(t)) ? null : { priority: "medium", title: "Earn review rich results", detail: "Review stars appear for this keyword. Add genuine reviews and Review / AggregateRating structured data to stand out." },
  ai_overview: () => ({ priority: "medium", title: "Make passages citable in AI Overviews", detail: "Google shows an AI Overview. Write short, self-contained passages that answer sub-questions directly, cite sources and show author expertise and update dates." }),
  local_pack: ({ facts }) => (facts && facts.schemaTypes.includes("LocalBusiness") ? null : { priority: "medium", title: "Compete for the local pack", detail: "A map pack is shown. Add your address, phone and opening hours, embed a map and use LocalBusiness structured data consistent with your Google Business Profile." }),
  shopping: ({ facts }) => (facts && facts.schemaTypes.includes("Product") ? null : { priority: "medium", title: "Qualify for shopping results", detail: "Shopping results appear for this keyword. Add Product structured data with price, availability and reviews, and submit products to Merchant Center." }),
  top_stories: () => ({ priority: "low", title: "Publish timely news coverage", detail: "Top stories are shown. Publish fresh articles with NewsArticle markup, clear dates and author bylines." }),
  knowledge_panel: ({ facts }) => (facts && facts.schemaTypes.includes("Organization") ? null : { priority: "low", title: "Strengthen entity signals", detail: "A knowledge panel is shown. Add Organization structured data with logo and sameAs links to your official profiles." }),
  discussions: () => ({ priority: "low", title: "Join the discussion results", detail: "Forum and discussion results appear. Contribute helpful answers on relevant communities and add first-hand experience to your page." }),
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

export function generateIdeas(ctx: IdeaContext): Idea[] {
  const { url, keyword, facts, use, bench } = ctx;
  const ideas: Idea[] = [];
  const add = (type: IdeaType, code: string, source: Idea["source"], idea: Omit<Idea, "id" | "type" | "source">) => ideas.push({ id: `${type}:${code}`, type, source, ...idea });
  const vol = bench.metrics.volume;
  const pos = bench.position;

  // ---------------------------------------------------------------- Strategy (demo)
  if (pos == null) add("strategy", "not-ranking", "demo", { priority: vol >= 1000 ? "high" : "medium", title: "Your domain doesn't rank in the top 100 for this keyword", detail: `“${keyword}” has ${vol.toLocaleString("en-US")} monthly searches. Make this page the definitive resource for the query and support it with internal links and backlinks.` });
  else if (pos >= 4 && pos <= 20) {
    const gain = Math.round(vol * (ctrFor(3, bench.metrics.serpFeatures) - ctrFor(pos, bench.metrics.serpFeatures)));
    add("strategy", "quick-win", "demo", { priority: "high", title: `Quick win: you rank #${pos}`, detail: `Moving into the top 3 could add about ${gain.toLocaleString("en-US")} visits a month. Apply the content and semantic ideas below first — they have the biggest impact at this position.` });
  } else if (pos > 20) add("strategy", "low-rank", "demo", { priority: "medium", title: `The page ranks #${pos}`, detail: "Positions beyond page 2 get almost no clicks. Align the page closely with the search intent and grow its authority with links." });
  else add("strategy", "top3", "demo", { priority: "low", title: `You already rank #${pos}`, detail: "Protect the position: refresh the content regularly and monitor rivals that gain on you." });
  if (bench.rankingUrl && normalizeUrl(bench.rankingUrl) !== normalizeUrl(url))
    add("strategy", "cannibal", "demo", { priority: "medium", title: "Another page of your site ranks for this keyword", detail: `Google ranks ${bench.rankingUrl} for “${keyword}”. Choose one page for the keyword: consolidate the content or make the target page clearly more relevant and link to it from the other page.`, items: [bench.rankingUrl] });
  const intent = bench.metrics.intents[0];
  if ((intent === "transactional" || intent === "commercial") && /\/(blog|news|articles?)\//i.test(url))
    add("strategy", "intent", "demo", { priority: "medium", title: `Search intent looks ${intent}`, detail: `Searchers want to ${intent === "transactional" ? "buy or act" : "compare options"}, but the target is a blog post. Consider targeting this keyword with a product, category or comparison page.` });
  else if (intent === "informational" && facts && facts.words < 400)
    add("strategy", "intent-thin", "live", { priority: "medium", title: "Informational query, thin page", detail: `Searchers want an in-depth answer, but the page has only ${facts.words} words of main content.` });
  if (vol < 50 && bench.related[0] && bench.related[0].volume >= 500)
    add("strategy", "low-volume", "demo", { priority: "low", title: "The keyword has little search demand", detail: `“${keyword}” gets about ${vol} searches a month. Consider also targeting a related keyword with more demand.`, items: bench.related.slice(0, 3).map((r) => `${r.keyword} (${r.volume.toLocaleString("en-US")}/mo)`) });

  // ---------------------------------------------------------------- SERP features (demo)
  for (const f of bench.metrics.serpFeatures) {
    const make = FEATURE_IDEAS[f];
    const idea = make?.({ ...ctx });
    if (idea) add("serp", f, "demo", idea);
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
    if (!facts.schemaTypes.length) {
      const suggestions = intent === "transactional" ? ["Product", "Offer", "BreadcrumbList"] : intent === "commercial" ? ["Review", "ItemList", "FAQPage"] : intent === "navigational" ? ["Organization", "WebSite"] : ["Article", "FAQPage", "BreadcrumbList"];
      add("technical", "schema", "live", { priority: "medium", title: "No structured data found", detail: "Add schema.org markup that matches the page type so it is eligible for rich results.", items: suggestions });
    }
    if (!facts.viewport) add("technical", "viewport", "live", { priority: "high", title: "No viewport meta tag", detail: "Without <meta name=\"viewport\"> the page is not mobile-friendly, and Google indexes the mobile version." });
    if (!facts.lang) add("technical", "lang", "live", { priority: "low", title: "Missing html lang attribute", detail: "Declare the page language (e.g. <html lang=\"en\">) for accessibility and language targeting." });
    if (facts.bytes > 600_000) add("technical", "html-size", "live", { priority: "low", title: `Large HTML document (${Math.round(facts.bytes / 1024)} KB)`, detail: "Heavy HTML slows rendering and crawling; remove inline data and unused markup." });
    if (facts.internalLinks + facts.externalLinks > 300) add("technical", "links", "live", { priority: "low", title: `Too many links on the page (${facts.internalLinks + facts.externalLinks})`, detail: "Hundreds of links dilute link equity and distract readers; keep the most useful ones." });
    if (!facts.og.title || !facts.og.image) add("technical", "og", "live", { priority: "low", title: "Incomplete Open Graph tags", detail: "Add og:title, og:description and og:image so shares look good on social networks and messengers." });
  }

  // ---------------------------------------------------------------- Content (live + demo comparisons)
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
    if (use.mentions === 0) add("content", "kw-body", "live", { priority: "high", title: "The keyword doesn't appear in the text", detail: `Mention “${keyword}” naturally in the body — rivals use it about ${bench.avg.mentions} times.` });
    else if (!use.inFirst100) add("content", "kw-first", "live", { priority: "medium", title: "Mention the keyword in the first 100 words", detail: "Early use confirms the topic to readers and search engines." });
    if (use.density > 3) add("content", "kw-stuffing", "live", { priority: "high", title: `Keyword density is high (${use.density}%)`, detail: "This can look like keyword stuffing. Replace some mentions with synonyms and related terms." });
    else if (use.mentions > 0 && use.mentions < bench.avg.mentions * 0.5) add("content", "kw-few", "demo", { priority: "low", title: "Use the keyword a bit more often", detail: `You mention it ${use.mentions}× vs about ${bench.avg.mentions}× on top-10 pages.` });
    if (facts.words < bench.avg.words * 0.8) add("content", "length", "demo", { priority: facts.words < bench.avg.words * 0.5 ? "high" : "medium", title: `Increase the text length to about ${bench.avg.words.toLocaleString("en-US")} words`, detail: `Your page has ${facts.words.toLocaleString("en-US")} words of main content; top-10 pages have ${bench.avg.wordsRange[0].toLocaleString("en-US")}–${bench.avg.wordsRange[1].toLocaleString("en-US")}. Cover the subtopics searchers expect rather than padding.` });
    if (facts.flesch != null && facts.flesch < bench.avg.readability - 10) add("content", "readability", "demo", { priority: "medium", title: "Make the text easier to read", detail: `Flesch reading ease is ${Math.round(facts.flesch)} vs ${bench.avg.readability} for rivals. Use shorter sentences (you average ${facts.avgSentenceLength} words) and simpler words.` });
    if (facts.imagesMissingAlt > 0) add("content", "alt", "live", { priority: "medium", title: `${facts.imagesMissingAlt} image${facts.imagesMissingAlt > 1 ? "s" : ""} without alt attribute`, detail: "Describe each meaningful image in its alt text; use the keyword where it fits naturally." });
    else if (facts.images > 0 && !use.inAlt) add("content", "alt-kw", "live", { priority: "low", title: "Use the keyword in an image alt text", detail: "At least one relevant image should describe the topic in its alt text." });
    if (!use.inUrl && !/^https?:\/\/[^/]+\/?$/.test(url)) add("content", "url", "live", { priority: "low", title: "The URL doesn't contain the keyword", detail: "Descriptive URLs help users; only change existing URLs with a 301 redirect." });
    if (facts.images < bench.avg.images * 0.4 && bench.avg.images >= 3) add("content", "images", "demo", { priority: "low", title: "Add more visuals", detail: `Rivals use about ${bench.avg.images} images; you have ${facts.images}.` });

    // ---------------------------------------------------------------- Semantic
    if (use.semanticMissing.length) add("semantic", "words", "demo", { priority: use.semanticMissing.length > bench.semantic.length / 2 ? "high" : "medium", title: "Enrich your content with semantically related words", detail: `Top-10 pages use these words that your page doesn't (${use.semanticUsed.length} of ${bench.semantic.length} used).`, items: use.semanticMissing.slice(0, 12) });
    if (!use.inH2 && facts.h2s.length) add("semantic", "h2", "live", { priority: "low", title: "Use the keyword or a variation in a subheading", detail: `None of your ${facts.h2s.length} H2 headings mention “${keyword}”.` });
    if (facts.h2s.length < Math.max(2, bench.avg.h2 - 2)) add("semantic", "structure", "demo", { priority: "medium", title: "Cover more subtopics with H2 sections", detail: `You have ${facts.h2s.length} H2 sections; rivals average ${bench.avg.h2}. Related searches suggest these subtopics:`, items: bench.related.slice(0, 5).map((r) => r.keyword) });
  } else {
    add("semantic", "words-nopage", "demo", { priority: "medium", title: "Use semantically related words", detail: "Top-10 pages for this keyword commonly use these words. Your page couldn't be fetched, so usage wasn't checked.", items: bench.semantic.slice(0, 12).map((s) => s.term) });
  }

  // ---------------------------------------------------------------- Backlinks (demo)
  if (bench.backlinkSources.length) add("backlinks", "gap", "demo", { priority: bench.backlinkSources.length >= 5 ? "high" : "medium", title: `Try to get backlinks from ${bench.backlinkSources.length} domains that link to your rivals`, detail: "These sites link to several of the top-10 pages but not to your domain.", items: bench.backlinkSources.slice(0, 8).map((b) => `${b.domain} · AS ${b.authorityScore} · links to ${b.rivals} rivals`) });
  if (bench.ownRefDomains < bench.avg.refDomains * 0.5) add("backlinks", "page-rd", "demo", { priority: "medium", title: "Build links to this page", detail: `The page has about ${bench.ownRefDomains.toLocaleString("en-US")} referring domains vs ${bench.avg.refDomains.toLocaleString("en-US")} for the average top-10 page.` });

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

export function normalizeUrl(u: string) {
  try {
    const x = new URL(u);
    return `${x.hostname.replace(/^www\./, "")}${x.pathname.replace(/\/$/, "")}${x.search}`.toLowerCase();
  } catch {
    return u.toLowerCase();
  }
}

/** 0..100: traffic potential of reaching the top 3 plus weight of open ideas. */
export function priorityScore(volume: number, position: number | null, ideas: Idea[], features: SerpFeature[] = []) {
  const current = position == null ? 0 : ctrFor(position, features);
  const uplift = Math.max(0, volume * (ctrFor(3, features) - current));
  const s1 = Math.min(1, Math.log10(1 + uplift) / 4.5) * 60;
  const high = ideas.filter((i) => i.priority === "high").length,
    med = ideas.filter((i) => i.priority === "medium").length;
  const s2 = Math.min(40, high * 7 + med * 2.5 + (ideas.length - high - med) * 0.5);
  return Math.round(s1 + s2);
}

/** Generic labels for aggregating the same idea across pages. */
export const IDEA_LABELS: Record<string, string> = {
  "strategy:not-ranking": "Not ranking in the top 100",
  "strategy:quick-win": "Quick win: ranks #4–20",
  "strategy:low-rank": "Ranks beyond page 2",
  "strategy:top3": "Already in the top 3",
  "strategy:cannibal": "Another page ranks for the keyword",
  "strategy:intent": "Page type doesn't match search intent",
  "strategy:intent-thin": "Thin page for an informational query",
  "strategy:low-volume": "Keyword has little demand",
  "technical:fetch": "Page could not be fetched",
  "technical:redirect": "Target URL redirects",
  "technical:canonical-missing": "No canonical tag",
  "technical:canonical-other": "Canonical points elsewhere",
  "technical:schema": "No structured data",
  "technical:og": "Incomplete Open Graph tags",
  "technical:jsonld": "Invalid JSON-LD",
  "technical:html-size": "Large HTML document",
  "content:length": "Text shorter than rivals",
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
  "semantic:words": "Missing semantically related words",
  "semantic:h2": "Keyword not in subheadings",
  "semantic:structure": "Fewer H2 sections than rivals",
  "backlinks:gap": "Backlink gap vs rivals",
  "backlinks:page-rd": "Fewer referring domains than rivals",
  "ux:paragraphs": "Long paragraphs",
  "ux:sentences": "Long sentences",
  "ux:toc": "No table of contents",
  "ux:internal": "Few internal links",
  "ux:cls": "Images without dimensions",
  "ux:scannable": "Not scannable (no lists/tables)",
};
