import { countKeyword, hasKeyword, normalizeText, STOPWORDS, wordList } from "@/lib/content/text";
import { covered, STOP, type Ctx } from "../context";
import { contentTokens, slugify, stem } from "../parse";
import { gscCannibalEvidence, gscFor, gscQueryEvidence } from "../signals";
import type { EvidenceItem, Finding, FixOption, Intent } from "../types";
import { cap, clamp01, finding, na, pct, plural, YEAR_NOW } from "./util";

/** On-Page SEO module: keyword mapping, relevance, placement, overuse, semantic terms, title, meta, headings, slug. */

function slugOf(ctx: Ctx) {
  if (ctx.draft.slug) return ctx.draft.slug.replace(/^\/+|\/+$/g, "");
  try {
    return new URL(ctx.draft.url).pathname.split("/").filter(Boolean).pop() ?? "";
  } catch {
    return "";
  }
}

/** Keyword-based slug without stopwords (max 6 words). */
export function suggestedSlug(keyword: string) {
  const w = wordList(normalizeText(keyword)).filter((x) => !STOPWORDS.has(x) || ["how", "what", "why", "vs"].includes(x));
  return slugify(w.slice(0, 6).join(" "));
}

const tokenMatch = (text: string, ctx: Ctx) => {
  if (!ctx.kwTokens.length) return 0;
  const set = new Set(contentTokens(text, STOP).map(stem));
  return ctx.kwTokens.map(stem).filter((t) => set.has(t)).length / ctx.kwTokens.length;
};

export function keywordUrl(ctx: Ctx): Finding {
  if (!ctx.kw) return na("keyword-url", "Set a primary keyword to map it to a URL.");
  const slug = slugOf(ctx);
  const slugWords = slug.replace(/[-_]+/g, " ");
  const match = slug ? tokenMatch(slugWords, ctx) : 0;
  const clashes = ctx.others.filter((o) => normalizeText(o.keyword) === ctx.kw || (slug && o.slug && o.slug === slug));
  const items: EvidenceItem[] = [
    { label: ctx.draft.url ? `Target URL: ${ctx.draft.url}` : "No target URL set", detail: ctx.draft.url ? undefined : "Set the URL this article will be published at (Technical SEO tab).", tone: ctx.draft.url ? ("good" as const) : ("warning" as const) },
    { label: slug ? `Slug “${slug}” contains ${pct(match)} of the keyword` : "No slug set", tone: match >= 0.6 ? ("good" as const) : ("warning" as const) },
    ...clashes.map((o) => ({ label: `Cannibalization risk: “${o.title}” also targets ${normalizeText(o.keyword) === ctx.kw ? `“${o.keyword}”` : `the slug “${o.slug}”`}`, detail: "Two pages for one keyword compete with each other. Merge them or retarget one.", tone: "critical" as const, href: `/optimizer?doc=${o.id}` })),
  ];
  // Search Console: other live pages of the site that already rank for the keyword (evidence only).
  // keywordPages were fetched for the research keyword, so they are ignored once the primary keyword changes.
  const gsc = ctx.research && normalizeText(ctx.research.keyword) === ctx.kw ? gscFor(ctx.draft, ctx.research) : null;
  if (gsc) items.push(...gscCannibalEvidence(gsc, ctx.kw));
  const score = clamp01((ctx.draft.url ? 0.3 : 0.1) + 0.4 * match + (clashes.length ? 0 : 0.3));
  const fixes: FixOption[] = match < 0.6 ? [{ id: "slug-from-keyword", label: `Use slug “${suggestedSlug(ctx.kw)}”`, description: "Sets the URL slug from the primary keyword.", fix: { kind: "set", field: "slug", value: suggestedSlug(ctx.kw) }, safe: !slug }] : [];
  return finding("keyword-url", score, `“${ctx.kw}” → ${ctx.draft.url || (slug ? `/${slug}` : "no URL yet")}${clashes.length ? `; ${plural(clashes.length, "other draft")} target the same keyword` : "; no other draft targets this keyword"}.`, gsc ? ["content", "search-console"] : ["content"], { items, fixes, how: score < 0.8 ? "Give every keyword one target URL whose slug contains it, and keep other pages off that keyword." : undefined });
}

export function keywordRelevance(ctx: Ctx): Finding {
  if (!ctx.kw) return na("keyword-relevance", "No primary keyword set.", "Set the primary keyword this article should rank for.");
  const d = ctx.doc;
  const freq = new Map<string, number>();
  for (const t of contentTokens(d.plain, STOP).map(stem)) freq.set(t, (freq.get(t) ?? 0) + 1);
  const top = [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15).map(([t]) => t);
  const kwStems = ctx.kwTokens.map(stem);
  const inTop = kwStems.filter((t) => top.includes(t)).length / Math.max(1, kwStems.length);
  const h2 = d.headings.filter((h) => h.level >= 2);
  const related = h2.length ? h2.filter((h) => tokenMatch(h.text, ctx) > 0 || covered(ctx, h.text) > 0).length / h2.length : 0;
  const titleMatch = Math.max(tokenMatch(ctx.draft.title, ctx), tokenMatch(d.h1s[0]?.text ?? "", ctx));
  const mentions = countKeyword(d.plain, ctx.kw);
  const score = 0.35 * inTop + 0.25 * titleMatch + 0.2 * clamp01(mentions / 3) + 0.2 * clamp01(related / 0.4);
  // Search Console: the queries the published URL already ranks for (evidence only, not scored).
  const gsc = gscFor(ctx.draft, ctx.research);
  const kd = ctx.research?.keywordData && normalizeText(ctx.research.keywordData.keyword) === ctx.kw ? ctx.research.keywordData : null;
  return finding("keyword-relevance", score, `“${ctx.kw}” ${inTop >= 0.99 ? "is among" : inTop > 0 ? "is partly among" : "is not among"} the article's most-used terms; ${plural(mentions, "exact mention")}.`, ["content", ...(gsc ? (["search-console"] as const) : []), ...(kd ? (["keyword-data"] as const) : [])], {
    items: [
      { label: "Most-used terms", detail: top.slice(0, 10).join(", "), tone: inTop >= 0.99 ? ("good" as const) : ("warning" as const) },
      { label: "Title / H1 describe the keyword", detail: pct(titleMatch), tone: titleMatch >= 0.99 ? ("good" as const) : ("warning" as const) },
      ...(gsc ? gscQueryEvidence(gsc, ctx.kw) : []),
    ],
    metrics: kd
      ? [
          { label: "Search volume", value: kd.volume == null ? "n/a" : kd.volume.toLocaleString("en-US") },
          { label: "Keyword difficulty", value: kd.kd == null ? "n/a" : String(Math.round(kd.kd)) },
          { label: "CPC", value: kd.cpc == null ? "n/a" : `$${kd.cpc.toFixed(2)}` },
        ]
      : undefined,
    how: score < 0.8 ? "Either make the article about the keyword (title, H1, main sections) or pick the keyword that describes what the article is really about." : undefined,
  });
}

export function keywordPlacement(ctx: Ctx): Finding {
  if (!ctx.kw) return na("keyword-placement", "Set a primary keyword to audit its placement.");
  const d = ctx.doc;
  const first100 = d.paragraphs.map((p) => p.text).join(" ").split(/\s+/).slice(0, 100).join(" ");
  const lastSection = d.conclusion?.text ?? d.paragraphs.slice(-2).map((p) => p.text).join(" ");
  const loose = (t: string) => hasKeyword(t, ctx.kw) || tokenMatch(t, ctx) >= 0.99;
  const spots = [
    { id: "title", label: "SEO title", ok: loose(ctx.draft.title), w: 0.2 },
    { id: "h1", label: "H1", ok: loose(d.h1s[0]?.text ?? ""), w: 0.2 },
    { id: "intro", label: "First 100 words", ok: loose(first100), w: 0.2 },
    { id: "subheading", label: "At least one H2/H3", ok: d.headings.some((h) => h.level >= 2 && loose(h.text)), w: 0.15 },
    { id: "meta", label: "Meta description", ok: loose(ctx.draft.metaDescription), w: 0.1 },
    { id: "slug", label: "URL slug", ok: tokenMatch(slugOf(ctx).replace(/-/g, " "), ctx) >= 0.99, w: 0.1 },
    { id: "end", label: "Conclusion", ok: loose(lastSection), w: 0.05 },
  ];
  const score = spots.reduce((a, s) => a + (s.ok ? s.w : 0), 0);
  const fixes: FixOption[] = [];
  const h1 = d.h1s[0]?.text;
  if (!spots[1].ok && loose(ctx.draft.title)) fixes.push({ id: "h1-from-title", label: "Use the title as H1", description: `Sets the H1 to “${ctx.draft.title}”.`, fix: { kind: "set-h1", text: ctx.draft.title }, safe: !h1 });
  if (!spots[5].ok) fixes.push({ id: "placement-slug", label: `Use slug “${suggestedSlug(ctx.kw)}”`, description: "Puts the keyword in the URL slug.", fix: { kind: "set", field: "slug", value: suggestedSlug(ctx.kw) }, safe: !slugOf(ctx) });
  if (!spots[2].ok) fixes.push({ id: "placement-intro", label: "Mention the keyword in the introduction", description: "Claude rewrites the first paragraph to name the topic naturally.", ai: { task: "intro", instruction: `Rewrite the introduction so it naturally mentions “${ctx.kw}” in the first sentence or two. Keep it under 110 words.` }, safe: false });
  return finding("keyword-placement", score, `Keyword found in ${spots.filter((s) => s.ok).length} of ${spots.length} key places.`, ["content"], {
    items: spots.map((s) => ({ label: s.label, detail: s.ok ? "Contains the keyword" : "Missing", tone: s.ok ? ("good" as const) : s.w >= 0.2 ? ("critical" as const) : ("warning" as const) })),
    fixes,
    how: score < 0.8 ? `Use “${ctx.kw}” naturally in: ${spots.filter((s) => !s.ok).map((s) => s.label).join(", ")}.` : undefined,
  });
}

export function keywordOveruse(ctx: Ctx): Finding {
  if (!ctx.kw) return na("keyword-overuse", "Set a primary keyword to check for overuse.");
  const d = ctx.doc;
  const n = countKeyword(d.plain, ctx.kw);
  // Short drafts are measured against 300 words so a couple of mentions do not read as stuffing.
  const density = (n * Math.max(1, ctx.kw.split(" ").length)) / Math.max(300, d.words);
  const stuffedSentences = d.sentences.filter((s) => countKeyword(s, ctx.kw) >= 2);
  const h2 = d.headings.filter((h) => h.level === 2);
  const headingShare = h2.length >= 4 ? h2.filter((h) => hasKeyword(h.text, ctx.kw)).length / h2.length : 0;
  const titleRepeat = countKeyword(ctx.draft.title, ctx.kw) >= 2;
  const score = clamp01(1 - Math.max(0, density - 0.02) * 30 - stuffedSentences.length * 0.1 - (headingShare > 0.5 ? 0.25 : 0) - (titleRepeat ? 0.2 : 0));
  return finding("keyword-overuse", score, `Keyword density ${(density * 100).toFixed(1)}% (${plural(n, "mention")}); ${plural(stuffedSentences.length, "sentence")} repeat it.`, ["content"], {
    metrics: [
      { label: "Density", value: `${(density * 100).toFixed(2)}%` },
      { label: "Mentions", value: String(n) },
      { label: "H2s with keyword", value: h2.length ? pct(h2.filter((h) => hasKeyword(h.text, ctx.kw)).length / h2.length) : "n/a" },
    ],
    items: [
      ...stuffedSentences.slice(0, 5).map((s) => ({ label: s.length > 150 ? `${s.slice(0, 150)}…` : s, detail: "Keyword repeated in one sentence", tone: "warning" as const })),
      ...(headingShare > 0.5 ? [{ label: `${pct(headingShare)} of H2 headings repeat the keyword`, detail: "Vary headings with related terms.", tone: "warning" as const }] : []),
      ...(titleRepeat ? [{ label: "Keyword repeated in the title", tone: "warning" as const }] : []),
    ],
    fixes: score < 0.8 ? [{ id: "overuse-rewrite", label: "Vary repeated keyword mentions", description: "Claude rewrites sentences that repeat the keyword using pronouns and related terms.", ai: { task: "rewrite", instruction: `Reduce repetition of “${ctx.kw}”: rewrite sentences that use it more than once, using synonyms, related terms or pronouns. Keep at most one exact mention per paragraph.` }, safe: false }] : undefined,
    how: score < 0.8 ? "Keep density under ~2% and use related terms instead of repeating the exact phrase." : undefined,
  });
}

export function semanticCoverage(ctx: Ctx): Finding {
  const terms = ctx.terms;
  if (!terms.length) return na("semantic-coverage", "No related terms yet.", "Run SERP research (ranking pages or Google Autocomplete) or generate a content brief to get related terms.");
  const used = terms.filter((t) => covered(ctx, t.text) >= 0.99);
  const ratio = used.length / terms.length;
  const src = terms[0].source;
  return finding("semantic-coverage", clamp01(ratio / 0.7), `Uses ${used.length} of ${terms.length} related terms (${src === "competitors" ? "shared by ranking pages" : src === "autocomplete" ? "from Google Autocomplete" : "from the brief"}).`, [src === "competitors" ? "competitors" : src === "autocomplete" ? "autocomplete" : "content"], {
    items: [
      ...terms.filter((t) => !used.includes(t)).map((t) => ({ label: t.text, detail: t.source === "competitors" ? `Used by ${t.support} ranking pages` : `Source: ${t.source}`, tone: "warning" as const })),
      ...used.map((t) => ({ label: t.text, detail: "Used", tone: "good" as const })),
    ],
    how: ratio < 0.7 ? "Work the missing concepts in where they genuinely help the explanation — never as a list of keywords." : undefined,
  });
}

const TITLE_WORDS: Record<Intent, RegExp> = {
  informational: /\b(how|what|why|guide|explained|tips|ways|steps|everything|complete|beginner|meaning|examples?)\b/i,
  commercial: /\b(best|top|vs|versus|review|compared?|comparison|alternatives?|\d+)\b/i,
  transactional: /\b(apply|buy|price|pricing|fees?|admissions?|book|order|get|enrol|enroll|register|deals?|cost)\b/i,
  navigational: /./,
  local: /\b(near|in [A-Z]|location|address|campus|city)\b/i,
};

export function titleVariants(ctx: Ctx): string[] {
  const k = cap(ctx.kw);
  const y = YEAR_NOW();
  const vs = /^(.+?)\s+(?:vs\.?|versus)\s+(.+?)(?:\s+(?:which is better|difference|comparison))?$/i.exec(ctx.kw);
  if (vs) {
    const [a, b] = [cap(vs[1]), cap(vs[2])];
    return [`${a} vs ${b}: Which Is Better? (${y})`, `${a} vs ${b}: Key Differences Explained`, `${a} or ${b}? Scope, Subjects and Careers Compared`].filter((t) => t.length <= 65);
  }
  const by: Record<Intent, string[]> = {
    informational: [`${k}: A Complete Guide (${y})`, `What Is ${k}? Everything You Need to Know`, `${k} Explained: Key Facts, Tips and Examples`],
    commercial: [`Best ${k} in ${y}: Compared and Reviewed`, `${k}: Top Options Compared (${y})`, `${k} — Which Is Right for You?`],
    transactional: [`${k}: Fees, Eligibility and How to Apply (${y})`, `${k} — Apply Online in ${y}`, `${k}: Prices, Process and Next Steps`],
    navigational: [`${k} — Official Information and Links`, `${k}: Where to Go and What You Need`],
    local: [`${k}: Location, Contact and Directions`, `${k} Near You — Address and Timings`],
  };
  return by[ctx.intent.dominant].filter((t) => t.length <= 65);
}

export function title(ctx: Ctx): Finding {
  const t = ctx.draft.title.trim();
  if (!t) return finding("title", 0, "No SEO title.", ["content"], { blocker: "The SEO title is empty.", how: "Write a 30–60 character title that includes the keyword.", fixes: ctx.kw ? titleVariants(ctx).map((v, i) => ({ id: `title-${i}`, label: `Use “${v}”`, description: "Sets the SEO title.", fix: { kind: "set", field: "title", value: v }, safe: false })) : undefined });
  const len = t.length;
  const lenScore = len >= 30 && len <= 60 ? 1 : len > 60 && len <= 70 ? 0.6 : len >= 20 && len < 30 ? 0.6 : 0.2;
  const kwIn = ctx.kw ? (hasKeyword(t, ctx.kw) ? 1 : tokenMatch(t, ctx) >= 0.99 ? 0.8 : tokenMatch(t, ctx) * 0.5) : 0.5;
  const pos = ctx.kw ? t.toLowerCase().indexOf(ctx.kwTokens[0] ?? "") : -1;
  const front = pos >= 0 && pos <= len / 2;
  const intentOk = TITLE_WORDS[ctx.intent.dominant].test(t);
  const appeal = /\d|\(|\[|:|—|-|\?/.test(t) || /\b(guide|tips|best|how|why|complete|easy|proven|essential|free)\b/i.test(t);
  const caps = /^[^a-z]*$/.test(t) && /[A-Z]{4,}/.test(t);
  const repeat = ctx.kw && countKeyword(t, ctx.kw) >= 2;
  const clickbait = /\b(you won't believe|shocking|mind[- ]blowing|this one trick|insane)\b/i.test(t);
  const score = clamp01(0.25 * lenScore + 0.35 * kwIn + 0.1 * (front ? 1 : 0) + 0.15 * (intentOk ? 1 : 0) + 0.15 * (appeal ? 1 : 0) - (caps ? 0.15 : 0) - (repeat ? 0.15 : 0) - (clickbait ? 0.2 : 0));
  const variants = ctx.kw ? titleVariants(ctx).filter((v) => v.toLowerCase() !== t.toLowerCase()) : [];
  return finding("title", score, `“${t}” — ${len} characters${ctx.kw ? `, keyword ${kwIn >= 0.99 ? "included" : kwIn > 0 ? "partly included" : "missing"}` : ""}.`, ["content"], {
    items: [
      { label: "Length", detail: `${len} characters (aim for 30–60, ~580px)`, tone: lenScore === 1 ? ("good" as const) : ("warning" as const) },
      { label: "Keyword", detail: kwIn >= 0.99 ? (front ? "Included, near the start" : "Included") : "Not included", tone: kwIn >= 0.99 ? ("good" as const) : ("critical" as const) },
      { label: "Intent alignment", detail: intentOk ? `Wording fits ${ctx.intent.dominant} intent` : `Add wording searchers with ${ctx.intent.dominant} intent expect`, tone: intentOk ? ("good" as const) : ("warning" as const) },
      { label: "Click appeal", detail: appeal ? "Has a number, benefit or clear promise" : "Add a number, benefit or clear promise", tone: appeal ? ("good" as const) : ("warning" as const) },
      ...(caps ? [{ label: "All caps", tone: "warning" as const }] : []),
      ...(repeat ? [{ label: "Keyword repeated", tone: "warning" as const }] : []),
      ...(clickbait ? [{ label: "Clickbait wording", tone: "critical" as const }] : []),
    ],
    fixes: score < 0.85
      ? [
          ...variants.slice(0, 3).map((v, i) => ({ id: `title-${i}`, label: `Use “${v}”`, description: "Template-based title for this intent. Sets the SEO title.", fix: { kind: "set" as const, field: "title" as const, value: v }, safe: false })),
          { id: "title-ai", label: "Write title options with Claude", description: "Claude writes 5 titles; pick one to apply.", ai: { task: "title" as const, instruction: `Write 5 SEO titles (30–60 characters) for “${ctx.kw}” with ${ctx.intent.dominant} intent. Front-load the keyword, be specific, no clickbait.` }, safe: false },
        ]
      : undefined,
    how: score < 0.85 ? "Put the keyword near the start, stay within 30–60 characters, match the intent and make a clear promise." : undefined,
  });
}

/** First sentences of the introduction, trimmed to ≤155 characters on a word boundary. */
export function metaFromIntro(ctx: Ctx) {
  const src = ctx.doc.intro.text || ctx.doc.paragraphs[0]?.text || "";
  const sentences = src.split(/(?<=[.!?])\s+/);
  let out = "";
  for (const s of sentences) {
    if ((out + " " + s).trim().length > 155) break;
    out = (out + " " + s).trim();
  }
  if (!out) out = src.slice(0, 152).replace(/\s+\S*$/, "") + "…";
  if (ctx.kw && !hasKeyword(out, ctx.kw) && out.length + ctx.kw.length + 3 <= 158) out = `${cap(ctx.kw)}: ${out.charAt(0).toLowerCase()}${out.slice(1)}`;
  return out;
}

export function metaDescription(ctx: Ctx): Finding {
  const m = ctx.draft.metaDescription.trim();
  const gen = metaFromIntro(ctx);
  const genFix: FixOption | null = gen.length >= 70 ? { id: "meta-from-intro", label: "Generate from the introduction", description: `Sets: “${gen}”`, fix: { kind: "set", field: "metaDescription", value: gen }, safe: !m } : null;
  const aiFix: FixOption = { id: "meta-ai", label: "Write with Claude", description: "Claude writes a 140–155 character description with the keyword and a reason to click.", ai: { task: "meta", instruction: `Write a meta description (140–155 characters) for “${ctx.kw}”: include the keyword, say what the reader gets, end with a soft call to action.` }, safe: false };
  if (!m) return finding("meta-description", 0.1, "No meta description: Google will pick text from the page.", ["content"], { fixes: [genFix, aiFix].filter(Boolean) as FixOption[], how: "Write a 120–160 character summary with the keyword and a reason to click." });
  const len = m.length;
  const lenScore = len >= 120 && len <= 160 ? 1 : (len >= 70 && len < 120) || (len > 160 && len <= 200) ? 0.6 : 0.2;
  const kw = ctx.kw ? hasKeyword(m, ctx.kw) || tokenMatch(m, ctx) >= 0.99 : true;
  const action = /\b(learn|discover|find out|compare|get|see|apply|explore|read|check|know|understand|download|book|start|try)\b/i.test(m);
  const dup = m.toLowerCase() === ctx.draft.title.toLowerCase();
  const score = clamp01(0.4 * lenScore + 0.3 * (kw ? 1 : 0) + 0.2 * (action ? 1 : 0) + 0.1 * (/[.!?]$/.test(m) ? 1 : 0.5) - (dup ? 0.4 : 0));
  return finding("meta-description", score, `${len} characters${ctx.kw ? `, keyword ${kw ? "included" : "missing"}` : ""}${action ? ", with a call to action" : ""}.`, ["content"], {
    items: [
      { label: "Length", detail: `${len} characters (aim for 120–160)`, tone: lenScore === 1 ? ("good" as const) : ("warning" as const) },
      { label: "Keyword", detail: kw ? "Included" : "Missing", tone: kw ? ("good" as const) : ("warning" as const) },
      { label: "Reason to click", detail: action ? "Has an action word" : "Add what the reader gets (learn, compare, apply…)", tone: action ? ("good" as const) : ("warning" as const) },
      ...(dup ? [{ label: "Same as the title", tone: "warning" as const }] : []),
    ],
    fixes: score < 0.8 ? ([genFix, aiFix].filter(Boolean) as FixOption[]) : undefined,
  });
}

export function headings(ctx: Ctx): Finding {
  const d = ctx.doc;
  const hs = d.headings;
  const issues: { label: string; tone: "warning" | "critical"; fix?: FixOption }[] = [];
  if (!d.h1s.length) issues.push({ label: "No H1 heading", tone: "critical", fix: ctx.draft.title ? { id: "h1-add", label: "Add the title as H1", description: `Adds “# ${ctx.draft.title}” at the top.`, fix: { kind: "set-h1", text: ctx.draft.title }, safe: true } : undefined });
  if (d.h1s.length > 1) issues.push({ label: `${d.h1s.length} H1 headings (use exactly one)`, tone: "critical" });
  const skips: { from: number; to: number; text: string; line: number }[] = [];
  for (let i = 1; i < hs.length; i++) if (hs[i].level > hs[i - 1].level + 1) skips.push({ from: hs[i - 1].level, to: hs[i].level, text: hs[i].text, line: hs[i].line });
  for (const s of skips) {
    const raw = d.lines[s.line];
    issues.push({ label: `Skipped level: H${s.from} → H${s.to} at “${s.text}”`, tone: "warning", fix: /^\s*#{1,6}\s/.test(raw) ? { id: `h-skip-${s.line}`, label: `Make “${s.text}” an H${s.from + 1}`, description: "Fixes the heading level.", fix: { kind: "replace", find: raw, replace: raw.replace(/^(\s*)#{1,6}/, `$1${"#".repeat(s.from + 1)}`) }, safe: true } : undefined });
  }
  const empty = hs.filter((h) => !h.text.trim());
  if (empty.length) issues.push({ label: `${plural(empty.length, "empty heading")}`, tone: "warning" });
  const seen = new Map<string, number>();
  for (const h of hs) seen.set(h.text.toLowerCase(), (seen.get(h.text.toLowerCase()) ?? 0) + 1);
  for (const [t, n] of seen) if (n > 1 && t) issues.push({ label: `Duplicate heading “${t}” (${n}×)`, tone: "warning" });
  for (const h of hs.filter((x) => x.text.length > 80)) issues.push({ label: `Very long heading: “${h.text.slice(0, 60)}…”`, tone: "warning" });
  const h2 = hs.filter((h) => h.level === 2).length;
  const need = d.words > 500 ? Math.max(2, Math.floor(d.words / 450)) : 1;
  if (d.words > 300 && h2 < need) issues.push({ label: `Only ${h2} H2 headings for ${d.words} words`, tone: "warning" });
  const crit = issues.filter((i) => i.tone === "critical").length;
  const score = clamp01(1 - crit * 0.35 - (issues.length - crit) * 0.1);
  return finding("headings", score, issues.length ? `${plural(issues.length, "heading issue")}: ${d.h1s.length} H1, ${h2} H2, ${hs.filter((h) => h.level >= 3).length} H3–H6.` : `Clean hierarchy: 1 H1, ${h2} H2, ${hs.filter((h) => h.level >= 3).length} H3–H6.`, ["content"], {
    items: [...issues.map((i) => ({ label: i.label, tone: i.tone })), ...hs.slice(0, 30).map((h) => ({ label: `${"  ".repeat(h.level - 1)}H${h.level} ${h.text}`, tone: "neutral" as const }))],
    fixes: issues.map((i) => i.fix).filter(Boolean) as FixOption[],
    blocker: !d.h1s.length && d.words > 0 ? "The article has no H1 heading." : undefined,
    how: issues.length ? "One H1, then H2 sections with H3 sub-points, without skipping levels." : undefined,
  });
}

export function slug(ctx: Ctx): Finding {
  const s = slugOf(ctx);
  const suggested = ctx.kw ? suggestedSlug(ctx.kw) : slugify(ctx.draft.title);
  const fix: FixOption | null = suggested && suggested !== s ? { id: "slug-set", label: `Use “${suggested}”`, description: "Sets the URL slug.", fix: { kind: "set", field: "slug", value: suggested }, safe: !s } : null;
  if (!s) return finding("slug", 0.3, "No URL slug set.", ["content"], { fixes: fix ? [fix] : undefined, how: "Use a short, lowercase, hyphenated slug with the keyword." });
  const w = s.split(/[-_]/).filter(Boolean);
  const problems = [
    s !== s.toLowerCase() && "uppercase letters",
    /_/.test(s) && "underscores (use hyphens)",
    /%20|\s/.test(s) && "spaces",
    /[?=&]/.test(s) && "query parameters",
    s.length > 60 && `${s.length} characters (keep under 60)`,
    w.length > 6 && `${w.length} words (keep 3–6)`,
    w.filter((x) => STOPWORDS.has(x.toLowerCase())).length > 1 && "stop words",
    /\b(19|20)\d{2}\b/.test(s) && "a year (makes the URL look dated when you update the article)",
    /\d{4,}|[a-f0-9]{8,}/i.test(s.replace(/\b(19|20)\d{2}\b/, "")) && "IDs or numbers",
    ctx.kw && tokenMatch(s.replace(/-/g, " "), ctx) < 0.99 && "missing keyword words",
  ].filter(Boolean) as string[];
  const score = clamp01(1 - problems.length * 0.2);
  return finding("slug", score, problems.length ? `“/${s}” has ${problems.join(", ")}.` : `“/${s}” is short, readable and descriptive.`, ["content"], { items: problems.map((p) => ({ label: p, tone: "warning" as const })), fixes: problems.length && fix ? [fix] : undefined });
}
