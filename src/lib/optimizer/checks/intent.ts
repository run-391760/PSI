import { FORMAT_LABEL, formatFit, INTENT_LABEL, intentSignals } from "../intent";
import { covered, type Ctx } from "../context";
import type { ContentFormat, Finding, FixOption, Intent } from "../types";
import { blend, clamp01, finding, na, pct, plural } from "./util";

/** Search Intent module: intent analyzer, match score, mismatch detector, SERP content and features. */

const IDEAL: Record<Intent, ContentFormat[]> = {
  informational: ["guide", "how-to"],
  commercial: ["listicle", "comparison", "review"],
  transactional: ["landing"],
  navigational: ["landing"],
  local: ["landing", "guide"],
};

function idealFormats(ctx: Ctx): ContentFormat[] {
  const serp = Object.entries(ctx.intent.serpFormats).sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0));
  if (serp.length) return serp.slice(0, 2).map(([f]) => f as ContentFormat);
  return IDEAL[ctx.intent.dominant];
}

export function matchScore(ctx: Ctx) {
  const fit = formatFit(ctx.intent.dominant, ctx.intent.format);
  const sig = intentSignals(ctx.intent.dominant, ctx.kw, ctx.doc, ctx.draft.title);
  const serpTop = idealFormats(ctx);
  // Following the SERP's own format counts even when our generic table disagrees.
  const serpBonus = ctx.intent.serp && serpTop.includes(ctx.intent.format) ? 0.15 : 0;
  const heuristic = clamp01(0.55 * fit + 0.45 * sig.score + serpBonus);
  return { score: blend(heuristic, ctx.ai?.intent.match), fit, sig };
}

function intentSources(ctx: Ctx) {
  return ["content" as const, ...(ctx.research?.serpSource === "serp" ? (["serp"] as const) : ctx.competitors.length ? (["competitors"] as const) : []), ...(ctx.ai ? (["ai"] as const) : [])];
}

export function intentAnalyzer(ctx: Ctx): Finding {
  if (!ctx.kw) return na("intent-analyzer", "Set a primary keyword to analyze search intent.");
  const { dominant, keyword, serp, ai, format } = ctx.intent;
  const fit = formatFit(dominant, format);
  const from = ai ? "Claude's review" : serp ? (ctx.research?.serpSource === "serp" ? "the live Google results" : "the competitor pages") : "the query wording";
  const items = [
    { label: `Query wording: ${INTENT_LABEL[keyword]}`, detail: ctx.intent.keywordSignals.join("; "), tone: "neutral" as const },
    serp
      ? { label: `Ranking pages: ${INTENT_LABEL[serp]}`, detail: Object.entries(ctx.intent.serpFormats).map(([f, n]) => `${FORMAT_LABEL[f as ContentFormat]} ×${n}`).join(", "), tone: "neutral" as const }
      : { label: "Ranking pages: not analyzed", detail: "Run SERP research (or add competitor URLs) to read the intent from the pages that rank.", tone: "warning" as const },
    ...(ctx.ai ? [{ label: `Claude: ${INTENT_LABEL[ctx.ai.intent.dominant]}`, detail: ctx.ai.intent.reason, tone: "neutral" as const }] : []),
    { label: `This article reads as: ${FORMAT_LABEL[format]}`, detail: ctx.intent.formatSignals.join("; "), tone: fit >= 0.8 ? ("good" as const) : fit >= 0.5 ? ("warning" as const) : ("critical" as const) },
  ];
  const ideal = idealFormats(ctx);
  return finding(
    "intent-analyzer",
    fit,
    `Dominant intent is ${INTENT_LABEL[dominant].toLowerCase()} (from ${from}); the article is a ${FORMAT_LABEL[format].toLowerCase()}, which ${fit >= 0.8 ? "fits" : fit >= 0.5 ? "partly fits" : "does not fit"} that intent.`,
    intentSources(ctx),
    {
      items,
      metrics: [
        { label: "Dominant intent", value: INTENT_LABEL[dominant] },
        { label: "Article format", value: FORMAT_LABEL[format] },
        { label: "Format fit", value: pct(fit) },
      ],
      how: fit >= 0.8 ? undefined : `Searchers for “${ctx.kw}” expect a ${ideal.map((f) => FORMAT_LABEL[f].toLowerCase()).join(" or ")}. Restructure the article in that format (title, headings and sections), or target a keyword whose intent matches what you wrote.`,
    },
  );
}

export function intentMatch(ctx: Ctx): Finding {
  if (!ctx.kw) return na("intent-match", "Set a primary keyword to score intent match.");
  const { score, fit, sig } = matchScore(ctx);
  const fixes: FixOption[] = sig.missing.slice(0, 3).map((m, i) => ({
    id: `intent-add-${i}`,
    label: `Add: ${m}`,
    description: `Claude drafts a section that adds ${m}, matched to the article's tone, for you to review.`,
    ai: { task: "section", instruction: `Add a section to the article that provides ${m} for readers searching “${ctx.kw}” (${INTENT_LABEL[ctx.intent.dominant].toLowerCase()} intent).` },
    safe: false,
  }));
  return finding("intent-match", score, `${pct(score)} match with ${INTENT_LABEL[ctx.intent.dominant].toLowerCase()} intent: format fit ${pct(fit)}, ${sig.found.length} of ${sig.found.length + sig.missing.length} intent signals present.`, intentSources(ctx), {
    items: [...sig.found.map((x) => ({ label: x, tone: "good" as const })), ...sig.missing.map((x) => ({ label: `Missing: ${x}`, tone: "warning" as const }))],
    metrics: [
      { label: "Match score", value: pct(score) },
      { label: "Format fit", value: pct(fit) },
      { label: "Intent signals", value: `${sig.found.length}/${sig.found.length + sig.missing.length}` },
      ...(ctx.ai ? [{ label: "Claude's match", value: pct(ctx.ai.intent.match) }] : []),
    ],
    how: sig.missing.length ? `Add ${sig.missing.join(", ")}.` : undefined,
    fixes,
  });
}

export function intentMismatch(ctx: Ctx): Finding {
  if (!ctx.kw) return na("intent-mismatch", "Set a primary keyword to detect intent mismatches.");
  const { score: match } = matchScore(ctx);
  const items = [];
  if (ctx.intent.serp && ctx.intent.serp !== ctx.intent.keyword)
    items.push({ label: `The query wording suggests ${INTENT_LABEL[ctx.intent.keyword].toLowerCase()}, but the ranking pages serve ${INTENT_LABEL[ctx.intent.serp].toLowerCase()} intent.`, detail: "Follow the ranking pages: they show what Google rewards.", tone: "warning" as const });
  if (ctx.intent.contentIntent !== ctx.intent.dominant)
    items.push({ label: `Article intent (${INTENT_LABEL[ctx.intent.contentIntent].toLowerCase()}) differs from the dominant intent (${INTENT_LABEL[ctx.intent.dominant].toLowerCase()}).`, tone: match < 0.45 ? ("critical" as const) : ("warning" as const) });
  const score = clamp01((match - 0.3) / 0.4);
  const severe = match < 0.3;
  return finding(
    "intent-mismatch",
    score,
    severe ? "Severe mismatch: the article does not serve what searchers of this keyword want." : match < 0.45 ? "Mismatch: the article only partly serves the keyword's intent." : items.length ? "No blocking mismatch, with minor intent differences to review." : "No mismatch between the keyword's intent and the article.",
    intentSources(ctx),
    {
      items,
      blocker: severe ? `Severe search intent mismatch for “${ctx.kw}”: rewrite for ${INTENT_LABEL[ctx.intent.dominant].toLowerCase()} intent or change the target keyword.` : undefined,
      how: match < 0.45 ? `Either rewrite the article as a ${idealFormats(ctx).map((f) => FORMAT_LABEL[f].toLowerCase()).join(" / ")}, or retarget it to a keyword with ${INTENT_LABEL[ctx.intent.contentIntent].toLowerCase()} intent.` : undefined,
    },
  );
}

export function serpContent(ctx: Ctx): Finding {
  const comps = ctx.competitors;
  if (comps.length < 2) return na("serp-content", "No competitor pages analyzed yet.", "Run SERP research in this tab (live Google results with DataForSEO), or add 2–5 competitor URLs.");
  const formats = ctx.intent.serpFormats;
  const top = Object.entries(formats).sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0))[0];
  const formatScore = top ? ((formats[ctx.intent.format] ?? 0) / comps.length >= 0.3 ? 1 : formatFit(ctx.intent.dominant, ctx.intent.format) * 0.7) : 0.5;
  const shared = ctx.subtopics.filter((s) => s.source === "competitors");
  const headingCov = shared.length ? shared.filter((s) => covered(ctx, s.text) >= 0.6).length / shared.length : 0.7;
  const words = comps.map((c) => c.words).sort((a, b) => a - b);
  const median = words[Math.floor(words.length / 2)];
  const depth = clamp01(ctx.doc.words / Math.max(1, median * 0.6));
  const share = (fn: (c: (typeof comps)[number]) => boolean) => comps.filter(fn).length / comps.length;
  const patterns = [
    { label: "FAQ section", share: share((c) => c.hasFaq), has: ctx.doc.faqs.length >= 2 },
    { label: "Tables", share: share((c) => c.tables > 0), has: ctx.doc.tables.length > 0 },
    { label: "Lists", share: share((c) => c.lists > 1), has: ctx.doc.lists.length > 0 },
    { label: "Video", share: share((c) => c.hasVideo), has: ctx.doc.embeds.some((e) => e.kind === "video") },
    { label: "Images", share: share((c) => c.images > 1), has: ctx.doc.images.length > 0 },
  ].filter((p) => p.share >= 0.5);
  const patternScore = patterns.length ? patterns.filter((p) => p.has).length / patterns.length : 1;
  const score = 0.35 * formatScore + 0.35 * headingCov + 0.15 * patternScore + 0.15 * depth;
  return finding("serp-content", score, `Analyzed ${plural(comps.length, "ranking page")}: mostly ${top ? FORMAT_LABEL[top[0] as ContentFormat].toLowerCase() : "mixed formats"}, median ${median.toLocaleString()} words; you cover ${pct(headingCov)} of their shared topics.`, [ctx.research?.serpSource === "serp" ? "serp" : "competitors", "content"], {
    metrics: [
      { label: "Pages analyzed", value: String(comps.length) },
      { label: "Median length", value: `${median.toLocaleString()} words` },
      { label: "Your length", value: `${ctx.doc.words.toLocaleString()} words` },
      { label: "Shared topics covered", value: pct(headingCov) },
    ],
    items: [
      ...patterns.map((p) => ({ label: `${p.label}: used by ${pct(p.share)} of ranking pages`, detail: p.has ? "Your article has this too." : "Your article does not.", tone: p.has ? ("good" as const) : ("warning" as const) })),
      ...comps.slice(0, 10).map((c) => ({ label: `${c.position ? `#${c.position} ` : ""}${c.domain}`, detail: `${c.title} · ${c.words.toLocaleString()} words · ${c.headings.filter((h) => h.level === 2).length} H2 · ${c.format ? FORMAT_LABEL[c.format] : "n/a"}`, tone: "neutral" as const, href: c.url })),
    ],
    how: score < 0.8 ? "Match the dominant format, cover the subtopics most ranking pages share (see Topical SEO) and add the content patterns most of them use. Length is only a small part of this score." : undefined,
  });
}

const FEATURE_LABEL: Record<string, string> = {
  featured_snippet: "Featured snippet",
  people_also_ask: "People Also Ask",
  video: "Video results",
  image_pack: "Image pack",
  local_pack: "Local pack",
  reviews: "Review stars",
  top_stories: "Top stories",
  ai_overview: "AI Overview",
  knowledge_panel: "Knowledge panel",
  discussions: "Discussions & forums",
  shopping: "Shopping results",
  related_searches: "Related searches",
  ads_top: "Ads",
};

export function serpFeatures(ctx: Ctx): Finding {
  if (!ctx.kw) return na("serp-features", "Set a primary keyword to analyze SERP features.");
  const live = ctx.research?.serpSource === "serp";
  let features = live ? [...(ctx.research?.features ?? [])] : [];
  if (!live) {
    // Inferred from the query wording when there is no live SERP.
    if (/^(what|how|why|who|when|where|is|are|can|does)\b/.test(ctx.kw) || ctx.intent.dominant === "informational") features.push("featured_snippet", "people_also_ask", "ai_overview");
    if (/\bhow to\b|\btutorial\b|\bsteps?\b/.test(ctx.kw)) features.push("video");
    if (/\b(ideas|design|photos?|images?|examples|logo|campus)\b/.test(ctx.kw)) features.push("image_pack");
    if (ctx.intent.dominant === "local") features.push("local_pack");
    if (ctx.intent.dominant === "commercial") features.push("reviews");
    features = [...new Set(features)];
  }
  const d = ctx.doc;
  const conciseAnswer = d.paragraphs.some((p) => p.words >= 35 && p.words <= 65 && (/\b(is|are|means|refers to)\b/i.test(p.text.split(/[.!?]/)[0] ?? "") || d.headings.some((h) => /\?$/.test(h.text) && h.line < p.line && p.line - h.line <= 3)));
  const checks: Record<string, { ready: boolean; how: string }> = {
    featured_snippet: { ready: conciseAnswer || d.tables.length > 0 || d.lists.some((l) => l.ordered && l.items.length >= 3), how: "Answer the main question in a 40–60 word paragraph right under a question heading, or use a numbered list / table." },
    people_also_ask: { ready: d.faqs.length >= 3 || d.headings.filter((h) => /\?$/.test(h.text)).length >= 3, how: "Add an FAQ section answering 3+ related questions, each under its own question heading." },
    ai_overview: { ready: conciseAnswer, how: "Open with a direct, self-contained answer to the query that an AI overview can quote." },
    video: { ready: d.embeds.some((e) => e.kind === "video"), how: "Embed a short video (YouTube) that shows the steps." },
    image_pack: { ready: d.images.some((i) => i.alt.length > 3), how: "Add original images with descriptive alt text." },
    local_pack: { ready: /\b(address|located|campus|directions|map)\b/i.test(d.plain), how: "Include the address, area served and a map link; keep the Google Business Profile up to date." },
    reviews: { ready: /\b(rating|rated|stars?|reviews?)\b/i.test(d.plain), how: "Show ratings or review summaries (and mark them up only when they are genuine third-party reviews)." },
    top_stories: { ready: ctx.intent.format === "news" && !!ctx.draft.meta.publishedAt, how: "Publish as a dated news article with NewsArticle schema." },
  };
  const applicable = features.filter((f) => checks[f]);
  const ready = applicable.filter((f) => checks[f].ready);
  const score = applicable.length ? ready.length / applicable.length : 1;
  return finding(
    "serp-features",
    score,
    features.length ? `${live ? "Live SERP shows" : "Likely SERP features (inferred from the query; run SERP research for the real page)"}: ${features.map((f) => FEATURE_LABEL[f] ?? f).join(", ")}. Prepared for ${ready.length} of ${applicable.length}.` : "No SERP features to target for this query.",
    [live ? "serp" : "content"],
    {
      items: features.map((f) => (checks[f] ? { label: FEATURE_LABEL[f] ?? f, detail: checks[f].ready ? "Prepared" : checks[f].how, tone: checks[f].ready ? ("good" as const) : ("warning" as const) } : { label: FEATURE_LABEL[f] ?? f, detail: "Shown on the results page; no content change needed.", tone: "neutral" as const })),
      how: applicable.length > ready.length ? applicable.filter((f) => !checks[f].ready).map((f) => checks[f].how).join(" ") : undefined,
    },
  );
}
