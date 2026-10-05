import { normalizeText, STOPWORDS, wordList } from "@/lib/content/text";
import { STOP, type Ctx } from "../context";
import { ctaMatches, FUNNEL_FOR, hasCta } from "../intent";
import type { Finding, FixOption, Funnel } from "../types";
import { clamp01, finding, na, plural, quote } from "./util";

/** Internal Linking, Conversion, Media & UX and UX modules. */

const GENERIC_ANCHOR = /^(click here|here|this|this page|this post|this article|link|read more|learn more|more|go|see more|check it out|website)$/i;

type Opportunity = { url: string; title: string; phrase: string; paragraph: string };

/** Candidate internal pages: the site page list (sitemap/manual) plus the user's other drafts with a URL. */
export function internalOpportunities(ctx: Ctx): Opportunity[] {
  const pages = [...(ctx.draft.meta.sitePages ?? []), ...ctx.others.filter((o) => o.url).map((o) => ({ url: o.url, title: o.keyword || o.title }))];
  const linked = new Set(ctx.doc.links.map((l) => l.url.replace(/\/$/, "")));
  const self = ctx.draft.url.replace(/\/$/, "");
  const out: Opportunity[] = [];
  const used = new Set<string>();
  for (const p of pages) {
    const url = p.url.replace(/\/$/, "");
    if (!url || url === self || linked.has(url) || out.some((o) => o.url === p.url)) continue;
    // Longest 1–4 word phrase from the page title (no leading/trailing stopwords) found in a paragraph.
    const w = wordList(normalizeText(p.title.replace(/\s[|–—-]\s.*$/, "")));
    const grams: string[] = [];
    for (let n = Math.min(4, w.length); n >= 1; n--)
      for (let i = 0; i + n <= w.length; i++) {
        const g = w.slice(i, i + n);
        if (STOPWORDS.has(g[0]) || STOPWORDS.has(g[n - 1]) || (n === 1 && (g[0].length < 6 || STOP.has(g[0])))) continue;
        grams.push(g.join(" "));
      }
    for (const g of grams) {
      if (used.has(g)) continue;
      const re = new RegExp(`(?<![\\p{L}\\p{N}])${g.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\p{L}\\p{N}])`, "iu");
      const para = ctx.doc.paragraphs.find((x) => re.test(x.text) && !/\[[^\]]*\]\(/.test(x.raw.match(re)?.[0] ?? ""));
      if (para) {
        const m = para.text.match(re)![0];
        out.push({ url: p.url, title: p.title, phrase: m, paragraph: para.text });
        used.add(g);
        break;
      }
    }
    if (out.length >= 12) break;
  }
  return out;
}

export function internalLinks(ctx: Ctx): Finding {
  const internal = ctx.doc.links.filter((l) => l.internal);
  const opps = internalOpportunities(ctx);
  const sources = (ctx.draft.meta.sitePages?.length ?? 0) + ctx.others.filter((o) => o.url).length;
  const target = Math.max(2, Math.min(6, Math.floor(ctx.doc.words / 350)));
  const base = clamp01(internal.length / target);
  const score = sources ? clamp01(base * 0.7 + (opps.length ? 0.3 * (1 - Math.min(1, opps.length / 5)) : 0.3)) : base * 0.85;
  const fixes: FixOption[] = opps.slice(0, 8).map((o, i) => ({ id: `ilink-${i}`, label: `Link “${o.phrase}” → ${o.title}`, description: `Turns the first “${o.phrase}” into a link to ${o.url}.`, fix: { kind: "link", phrase: o.phrase, url: o.url }, safe: false }));
  return finding("internal-opportunities", score, `${plural(internal.length, "internal link")} (aim for ${target}+)${sources ? `; ${plural(opps.length, "contextual opportunity", "contextual opportunities")} found in ${plural(sources, "known page")}` : "; add your site pages to find opportunities"}.`, ["content"], {
    items: [...opps.map((o) => ({ label: `“${o.phrase}” → ${o.title}`, detail: quote(o.paragraph, 120), tone: "warning" as const, href: o.url })), ...internal.map((l) => ({ label: l.text || l.url, detail: `Already links to ${l.url}`, tone: "good" as const }))],
    fixes,
    how: !sources ? "Load your sitemap (or paste page URLs) above so the finder can match your pages to phrases in this article." : score < 0.8 ? "Add contextual links to related pages where the phrase appears naturally." : undefined,
  });
}

export function anchorText(ctx: Ctx): Finding {
  const internal = ctx.doc.links.filter((l) => l.internal);
  if (!internal.length) return na("anchor-text", "No internal links to review yet.", "Add internal links (see Internal Link Opportunity Finder).");
  const issues: { label: string; detail: string }[] = [];
  for (const l of internal) {
    const t = l.text.trim();
    if (!t || GENERIC_ANCHOR.test(t)) issues.push({ label: `“${t || "(empty)"}” → ${l.url}`, detail: "Generic anchor: describe the destination" });
    else if (/^https?:\/\//i.test(t)) issues.push({ label: t, detail: "Naked URL as anchor" });
    else if (wordList(t).length > 10) issues.push({ label: `“${t.slice(0, 60)}…”`, detail: "Anchor longer than 10 words" });
  }
  const byUrl = new Map<string, string[]>();
  for (const l of internal) byUrl.set(l.url, [...(byUrl.get(l.url) ?? []), l.text]);
  for (const [url, anchors] of byUrl) if (anchors.length > 2) issues.push({ label: url, detail: `Linked ${anchors.length}× from this article — once or twice is enough` });
  const byText = new Map<string, Set<string>>();
  for (const l of internal) byText.set(l.text.toLowerCase(), new Set([...(byText.get(l.text.toLowerCase()) ?? []), l.url]));
  for (const [t, urls] of byText) if (urls.size > 1 && t) issues.push({ label: `“${t}”`, detail: `Same anchor points to ${urls.size} different pages` });
  const score = clamp01(1 - issues.length / Math.max(2, internal.length));
  return finding("anchor-text", score, issues.length ? `${plural(issues.length, "anchor issue")} across ${plural(internal.length, "internal link")}.` : `All ${plural(internal.length, "internal link")} use descriptive anchors.`, ["content"], { items: issues.map((i) => ({ ...i, tone: "warning" as const })), how: issues.length ? "Use 2–6 descriptive words that say what the linked page is about." : undefined });
}

const SOFT = /\b(subscribe|newsletter|download (the |our |a )?(guide|checklist|ebook|e-book)|read (more|next|our)|learn more|explore|related guide|follow us|watch)\b/i;
const MID = /\b(compare|brochure|prospectus|webinar|demo|free consultation|talk to (a |an |our )?(counsel+or|advisor|expert)|request (info|information|a call|callback)|book a (call|tour|visit|campus tour)|check eligibility|free trial|virtual tour|open day)\b/i;
const HARD = /\b(apply now|apply today|apply online|enrol+ now|register now|buy now|order now|book now|sign up|get started|contact (us|sales|admissions)|call (us|now)|enquire now|start your application|reserve)\b/i;

function ctaBlock(text: string, url?: string) {
  return url ? `**[${text}](${url})**` : `**${text}**`;
}

export function cta(ctx: Ctx): Finding {
  const d = ctx.doc;
  if (d.words < 50) return na("cta", "Add the article text to audit it.");
  const lines = ctx.draft.body.split("\n");
  const ctaLines = lines.map((l, i) => ({ l, i })).filter((x) => hasCta(x.l) || (ctx.draft.meta.cta?.url && x.l.includes(ctx.draft.meta.cta.url)));
  const found = ctaMatches(d.plain);
  const late = ctaLines.some((x) => x.i >= lines.length * 0.6);
  const many = ctaLines.length > 6;
  const score = !ctaLines.length ? 0.2 : clamp01((late ? 1 : 0.7) - (many ? 0.2 : 0));
  const c = ctx.draft.meta.cta;
  const stage = ctx.draft.meta.funnel ?? FUNNEL_FOR[ctx.intent.dominant];
  const defaultText = stage === "awareness" ? "Explore our related guides" : stage === "consideration" ? "Talk to an advisor" : "Apply now";
  const fixes: FixOption[] = !late
    ? [
        c?.text
          ? { id: "cta-insert", label: `Add CTA “${c.text}”`, description: "Inserts your call to action before the conclusion.", fix: { kind: "insert", markdown: ctaBlock(c.text, c.url), position: "end" }, safe: true }
          : { id: "cta-scaffold", label: `Add CTA “${defaultText}”`, description: "Inserts a call to action at the end; set the link in the CTA settings above.", fix: { kind: "insert", markdown: `${ctaBlock(defaultText)} [Write: link to the next step]`, position: "end" }, safe: false },
      ]
    : [];
  return finding("cta", score, ctaLines.length ? `${plural(ctaLines.length, "call to action")}${late ? ", including one near the end" : ", none near the end"}${found.length ? `: ${found.slice(0, 3).map((f) => `“${f}”`).join(", ")}` : ""}.` : "No call to action: readers have no next step.", ["content"], {
    items: ctaLines.slice(0, 8).map((x) => ({ label: quote(x.l.replace(/[*#>[\]]/g, "").replace(/\(.*?\)/g, "").trim(), 120), detail: `Line ${x.i + 1}`, tone: "good" as const })),
    fixes,
    how: score < 0.8 ? "End with one clear next step (and optionally one mid-article) that fits the reader's stage." : undefined,
  });
}

export function conversionAlignment(ctx: Ctx): Finding {
  const d = ctx.doc;
  if (d.words < 50) return na("conversion-alignment", "Add the article text to audit it.");
  const stage: Funnel = ctx.draft.meta.funnel ?? FUNNEL_FOR[ctx.intent.dominant];
  const text = `${d.plain}\n${ctx.draft.meta.cta?.text ?? ""}`;
  const has = { soft: SOFT.test(text), mid: MID.test(text), hard: HARD.test(text) };
  const fit: Record<Funnel, number> = {
    awareness: has.soft || has.mid ? (has.hard && !has.soft && !has.mid ? 0.5 : 1) : has.hard ? 0.45 : 0.2,
    consideration: has.mid ? 1 : has.soft && has.hard ? 0.8 : has.hard ? 0.6 : has.soft ? 0.55 : 0.2,
    decision: has.hard ? 1 : has.mid ? 0.65 : has.soft ? 0.35 : 0.15,
  };
  const want = { awareness: "a soft next step (related guide, newsletter, download)", consideration: "a mid-funnel step (compare, brochure, webinar, talk to an advisor)", decision: "a direct action (apply, buy, book, contact)" }[stage];
  const score = fit[stage];
  return finding("conversion-alignment", score, `Reader stage: ${stage}${ctx.draft.meta.funnel ? "" : ` (from ${ctx.intent.dominant} intent)`}. CTAs found: ${[has.soft && "soft", has.mid && "mid-funnel", has.hard && "direct"].filter(Boolean).join(", ") || "none"}.`, ["content"], {
    items: [
      { label: "Soft (learn, subscribe, download)", detail: has.soft ? "Present" : "None", tone: has.soft ? ("good" as const) : ("neutral" as const) },
      { label: "Mid-funnel (compare, brochure, advisor)", detail: has.mid ? "Present" : "None", tone: has.mid ? ("good" as const) : ("neutral" as const) },
      { label: "Direct (apply, buy, contact)", detail: has.hard ? "Present" : "None", tone: has.hard ? ("good" as const) : ("neutral" as const) },
    ],
    how: score < 0.8 ? `Readers at the ${stage} stage respond best to ${want}.` : undefined,
  });
}

function humanize(src: string) {
  const file = decodeURIComponent(src.split(/[?#]/)[0].split("/").pop() ?? "").replace(/\.[a-z0-9]{2,5}$/i, "");
  if (/^(img|image|dsc|photo|pic|screenshot|untitled|whatsapp|download)[-_ ]?\d*/i.test(file) || /^[a-f0-9-]{10,}$/i.test(file) || /^\d+$/.test(file)) return null;
  const words = file.replace(/[-_]+/g, " ").replace(/\s+\d+$/, "").trim();
  return wordList(words).length >= 2 ? words.charAt(0).toUpperCase() + words.slice(1) : null;
}

export function imageSeo(ctx: Ctx): Finding {
  const imgs = ctx.doc.images;
  if (!imgs.length) return finding("image-seo", ctx.doc.words > 600 ? 0.5 : 0.8, ctx.doc.words > 600 ? "No images in a long article." : "No images (fine for a short piece).", ["content"], { how: ctx.doc.words > 600 ? "Add at least one relevant, original image with descriptive alt text (see Media Opportunity Finder)." : undefined });
  const rows = imgs.map((im) => {
    const alt = im.alt.trim();
    const altOk = alt.length >= 5 && alt.length <= 125 && !/^(image|photo|picture|img|graphic|screenshot)(\s*\d*)?$/i.test(alt) && !/\.(png|jpe?g|webp|gif)$/i.test(alt);
    const file = decodeURIComponent(im.src.split(/[?#]/)[0].split("/").pop() ?? "");
    const fileOk = !!humanize(im.src) || /^data:/.test(im.src);
    return { im, alt, altOk, file, fileOk };
  });
  const firstLine = imgs[0].line / Math.max(1, ctx.doc.lines.length);
  const placementOk = firstLine <= 0.35;
  const captions = imgs.filter((i) => i.caption).length;
  const score = clamp01(0.55 * (rows.filter((r) => r.altOk).length / rows.length) + 0.2 * (rows.filter((r) => r.fileOk).length / rows.length) + 0.15 * (placementOk ? 1 : 0) + 0.1 * (captions / imgs.length));
  const fixes: FixOption[] = rows
    .filter((r) => !r.altOk)
    .map((r) => ({ r, alt: humanize(r.im.src) }))
    .filter((x) => x.alt)
    .slice(0, 8)
    .map((x, i) => ({ id: `alt-${i}`, label: `Alt “${x.alt}”`, description: `Sets alt text for ${x.r.file} from its descriptive filename.`, fix: { kind: "alt", src: x.r.im.src, alt: x.alt! }, safe: true }));
  return finding("image-seo", score, `${plural(imgs.length, "image")}: ${rows.filter((r) => r.altOk).length} with good alt text, ${rows.filter((r) => r.fileOk).length} with descriptive filenames, ${captions} captioned.`, ["content"], {
    items: rows.map((r) => ({ label: r.file || r.im.src.slice(0, 60), detail: [r.altOk ? `alt “${r.alt}”` : r.alt ? `weak alt “${r.alt}”` : "missing alt", r.fileOk ? null : "non-descriptive filename", r.im.caption ? "captioned" : null].filter(Boolean).join(" · "), tone: r.altOk ? ("good" as const) : ("warning" as const) })),
    fixes,
    how: score < 0.8 ? `Describe each image in its alt text (5–125 characters), use descriptive filenames (e.g. ${normalizeText(ctx.kw || "topic").replace(/\s+/g, "-")}-example.jpg), add captions and place the first image near the top.` : undefined,
  });
}

export function mediaOpportunities(ctx: Ctx): Finding {
  const d = ctx.doc;
  if (d.words < 150) return na("media-opportunities", "Add more text to find media opportunities.");
  const ops: { where: string; what: string; fix?: FixOption }[] = [];
  for (const s of d.sections) {
    if (!s.heading) continue;
    const h = s.heading.text;
    const numbers = (s.text.match(/\b\d[\d,.]*%?/g) ?? []).length;
    if (/\b(vs|versus|compar|difference|differences|options|alternatives|types|plans|pricing|fees)\b/i.test(h) && !s.tables)
      ops.push({ where: h, what: "Comparison table", fix: { id: `table-${s.index}`, label: `Add a table under “${h}”`, description: "Inserts a comparison-table scaffold with [Write: …] cells.", fix: { kind: "insert", markdown: "| Option | Key facts | Best for |\n| --- | --- | --- |\n| [Write: option] | [Write: facts] | [Write: who it suits] |", position: { afterHeading: h } }, safe: false } });
    else if (numbers >= 5 && !s.images && !s.tables) ops.push({ where: h, what: `Chart (${numbers} figures in this section)` });
    if (/\b(how to|steps?|process|procedure|apply|install|set ?up|guide)\b/i.test(h) && !s.images) ops.push({ where: h, what: "Screenshots or step images" });
  }
  for (const l of d.lists.filter((x) => x.ordered && x.items.length >= 5)) ops.push({ where: `List starting “${l.items[0].slice(0, 40)}”`, what: "Infographic of the process" });
  if (d.words > 1200 && !d.embeds.some((e) => e.kind === "video") && (ctx.intent.format === "how-to" || ctx.intent.dominant === "informational")) ops.push({ where: "Article", what: "Short explainer video (earns video results)" });
  if (!d.images.length && d.words > 500) ops.push({ where: "Top of the article", what: "Featured image (also used for social sharing)" });
  const score = clamp01(1 - ops.length * 0.12);
  return finding("media-opportunities", score, ops.length ? `${plural(ops.length, "place")} where media would help readers.` : "Media use looks sufficient for this content.", ["content"], { items: ops.map((o) => ({ label: o.what, detail: o.where, tone: "warning" as const })), fixes: ops.map((o) => o.fix).filter(Boolean) as FixOption[] });
}

export function mobile(ctx: Ctx): Finding {
  const d = ctx.doc;
  if (d.words < 50) return na("mobile", "Add the article text to audit it.");
  const longParas = d.paragraphs.filter((p) => p.words > 100);
  const wideTables = d.tables.filter((t) => t.cols > 4);
  const unbroken = d.paragraphs.filter((p) => /\S{40,}/.test(p.text.replace(/https?:\/\/\S+/g, "")));
  const nakedUrls = d.paragraphs.filter((p) => /(^|\s)https?:\/\/\S{30,}/.test(p.raw));
  const wideCode = ctx.draft.body.split("\n").filter((l) => l.length > 90 && /^( {4}|\t)/.test(l)).length;
  const longHeadings = d.headings.filter((h) => h.text.length > 70);
  const issues = [
    ...longParas.slice(0, 5).map((p) => ({ label: `Paragraph of ${p.words} words`, detail: `${quote(p.text, 80)} — over ~6 lines on a phone` })),
    ...wideTables.map((t) => ({ label: `Table with ${t.cols} columns`, detail: "Needs horizontal scrolling on phones; keep to 3–4 columns" })),
    ...unbroken.map((p) => ({ label: "Very long unbroken word", detail: quote(p.text, 60) })),
    ...nakedUrls.map((p) => ({ label: "Long naked URL in text", detail: "Use a short descriptive link instead" })),
    ...(wideCode ? [{ label: `${wideCode} wide code lines`, detail: "Wrap or shorten" }] : []),
    ...longHeadings.map((h) => ({ label: `Long heading (${h.text.length} chars)`, detail: quote(h.text, 70) })),
  ];
  const score = clamp01(1 - issues.length * 0.12);
  return finding("mobile", score, issues.length ? `${plural(issues.length, "mobile reading issue")}.` : "Content structure reads well on phones.", ["content"], { items: issues.map((i) => ({ ...i, tone: "warning" as const })), how: issues.length ? "Short paragraphs (2–4 sentences), narrow tables and descriptive links read better on small screens." : undefined });
}

export function pageExperience(ctx: Ctx): Finding {
  const d = ctx.doc;
  if (d.words < 50) return na("page-experience", "Add the article text to audit it.");
  const toc = d.headings.some((h) => /table of contents|contents|in this (guide|article)/i.test(h.text)) || d.links.filter((l) => l.url.startsWith("#")).length >= 3;
  const iframes = d.embeds.filter((e) => e.kind === "iframe").length;
  const videos = d.embeds.filter((e) => e.kind === "video").length;
  const parts = [
    { label: "Table of contents for long content", ok: d.words < 1500 || toc, detail: d.words < 1500 ? "Not needed under 1,500 words" : toc ? "Present" : `${d.words.toLocaleString()} words without a table of contents` },
    { label: "Light embeds", ok: iframes + videos <= 3, detail: `${iframes} iframes, ${videos} videos (each embed slows the page)` },
    { label: "Reasonable image count", ok: d.images.length <= 20, detail: `${d.images.length} images${d.images.length > 20 ? " — lazy-load and compress them" : ""}` },
    { label: "Scannable sections", ok: d.headings.length >= Math.floor(d.words / 400), detail: `${d.headings.length} headings` },
    { label: "Live page checked", ok: !ctx.live || (!!ctx.live.status && ctx.live.status < 400), detail: ctx.live ? (ctx.live.error ? `Error: ${ctx.live.error}` : `HTTP ${ctx.live.status}`) : "Not published yet / not checked" },
  ];
  const psi = ctx.live?.pagespeed;
  if (psi) {
    const lcp = psi.lcp != null ? psi.lcp / 1000 : null;
    parts.push({ label: "Core Web Vitals (PageSpeed, mobile)", ok: (psi.performance ?? 0) >= 50 && (lcp == null || lcp <= 2.5) && (psi.cls == null || psi.cls <= 0.1), detail: `performance ${psi.performance ?? "n/a"}${lcp != null ? `, LCP ${lcp.toFixed(1)}s` : ""}${psi.cls != null ? `, CLS ${psi.cls.toFixed(2)}` : ""}${psi.inp != null ? `, INP ${Math.round(psi.inp)}ms` : ""}` });
  }
  const fixes: FixOption[] = [];
  if (d.words >= 1500 && !toc) {
    const h2 = d.headings.filter((h) => h.level === 2);
    const anchor = (t: string) => t.toLowerCase().replace(/[^a-z0-9\s-]/g, "").trim().replace(/\s+/g, "-");
    fixes.push({ id: "toc", label: "Insert a table of contents", description: `Adds a linked list of the ${h2.length} sections after the introduction.`, fix: { kind: "insert", markdown: `**Contents**\n\n${h2.map((h) => `- [${h.text}](#${anchor(h.text)})`).join("\n")}`, position: "after-intro" }, safe: true });
  }
  const score = parts.filter((p) => p.ok).length / parts.length;
  return finding("page-experience", score, `${parts.filter((p) => p.ok).length} of ${parts.length} page experience checks pass.`, ctx.live ? ["content", "live-url"] : ["content"], { items: parts.map((p) => ({ label: p.label, detail: p.detail, tone: p.ok ? ("good" as const) : ("warning" as const) })), fixes });
}

export function accessibility(ctx: Ctx): Finding {
  const d = ctx.doc;
  if (d.words < 50) return na("accessibility", "Add the article text to audit it.");
  const noAlt = d.images.filter((i) => !i.alt.trim());
  const generic = d.links.filter((l) => GENERIC_ANCHOR.test(l.text.trim()) || !l.text.trim());
  let skipped = 0;
  for (let i = 1; i < d.headings.length; i++) if (d.headings[i].level > d.headings[i - 1].level + 1) skipped++;
  const emptyHeaders = d.tables.filter((t) => t.headers.some((h) => !h.trim()));
  const caps = d.paragraphs.filter((p) => /\b[A-Z]{4,}(\s+[A-Z]{4,}){3,}\b/.test(p.text));
  const emoji = (d.plain.match(/\p{Extended_Pictographic}/gu) ?? []).length;
  const color = /\b(in|the) (red|green|blue|yellow|orange) (text|button|box|link|highlighted)\b|\bclick the (red|green|blue) /i.test(d.plain);
  const parts = [
    { label: "Images have alt text", ok: !noAlt.length, detail: noAlt.length ? `${noAlt.length} without alt` : "All images" },
    { label: "Descriptive link text", ok: !generic.length, detail: generic.length ? `${generic.length} generic/empty link texts` : "All links" },
    { label: "Heading levels in order", ok: !skipped, detail: skipped ? `${skipped} skipped levels` : "No skipped levels" },
    { label: "Tables have header cells", ok: !emptyHeaders.length, detail: emptyHeaders.length ? `${emptyHeaders.length} tables with empty headers` : `${d.tables.length} tables` },
    { label: "No ALL-CAPS passages", ok: !caps.length, detail: caps.length ? `${caps.length} passages` : "None" },
    { label: "Moderate emoji use", ok: emoji <= Math.max(3, d.words / 300), detail: `${emoji} emoji` },
    { label: "Not relying on colour alone", ok: !color, detail: color ? "Refers to elements by colour" : "OK" },
  ];
  const score = parts.filter((p) => p.ok).length / parts.length;
  return finding("accessibility", score, `${parts.filter((p) => p.ok).length} of ${parts.length} accessibility checks pass.`, ["content"], { items: parts.map((p) => ({ label: p.label, detail: p.detail, tone: p.ok ? ("good" as const) : ("warning" as const) })) });
}

