import type { ParsedDoc } from "./parse";
import type { ContentFormat, DraftInput } from "./types";

/**
 * Structured data for a draft: which schema.org types apply, a generated JSON-LD @graph built only
 * from what is visible in the draft, and validation of any JSON-LD (generated or pasted) against
 * required properties and the visible content.
 */

export type SchemaRec = { type: string; reason: string; essential: boolean };

const EDU = /\b(course|courses|program|programme|degree|diploma|certificate|certification|b\.?tech|m\.?tech|mba|bba|bca|mca|b\.?sc|m\.?sc|b\.?com|phd|ph\.d|admission|admissions|syllabus|curriculum|semester)\b/i;

export function recommendSchema(draft: DraftInput, doc: ParsedDoc, format: ContentFormat): SchemaRec[] {
  const out: SchemaRec[] = [];
  const type = draft.meta.pageType;
  if (format === "news" || type === "news") out.push({ type: "NewsArticle", reason: "Dated news content", essential: true });
  else if (format !== "landing" || type === "blog") out.push({ type: "BlogPosting", reason: "Editorial article: headline, author, dates and image in results", essential: true });
  if (doc.faqs.length >= 2) out.push({ type: "FAQPage", reason: `${doc.faqs.length} question-and-answer pairs are visible on the page`, essential: true });
  const steps = doc.lists.find((l) => l.ordered && l.items.length >= 3);
  if ((format === "how-to" || type === "how-to") && steps) out.push({ type: "HowTo", reason: `${steps.items.length} ordered steps`, essential: false });
  if ((format === "listicle" || type === "listicle") && doc.headings.filter((h) => h.level === 2).length >= 3) out.push({ type: "ItemList", reason: "List-style article with ranked items", essential: false });
  if (type === "course" || (EDU.test(`${draft.keyword} ${draft.title}`) && /\b(course|program|programme|degree|diploma)\b/i.test(`${draft.keyword} ${draft.title}`))) out.push({ type: "Course", reason: "Describes a course or program (provider, name, description)", essential: false });
  if (doc.embeds.some((e) => e.kind === "video")) out.push({ type: "VideoObject", reason: "Embedded video", essential: false });
  if (draft.url) out.push({ type: "BreadcrumbList", reason: "Shows the page's position in the site", essential: false });
  return out;
}

function absolute(u: string | undefined, base: string) {
  if (!u) return undefined;
  try {
    return new URL(u, base || undefined).toString();
  } catch {
    return u;
  }
}

export function generateSchema(draft: DraftInput, doc: ParsedDoc, format: ContentFormat): Record<string, unknown> {
  const recs = new Set(recommendSchema(draft, doc, format).map((r) => r.type));
  const m = draft.meta;
  const url = draft.url || m.canonical || "";
  const graph: Record<string, unknown>[] = [];
  const orgId = m.organization?.url ? `${m.organization.url.replace(/\/$/, "")}/#organization` : undefined;
  const author = m.author?.name ? { "@type": "Person", name: m.author.name, ...(m.author.url ? { url: m.author.url } : {}), ...(m.author.credentials ? { jobTitle: m.author.credentials } : {}) } : undefined;
  const publisher = m.organization?.name ? { "@type": "Organization", ...(orgId ? { "@id": orgId } : {}), name: m.organization.name, ...(m.organization.url ? { url: m.organization.url } : {}), ...(m.organization.logo ? { logo: { "@type": "ImageObject", url: m.organization.logo } } : {}) } : undefined;
  const image = absolute(m.featuredImage || doc.images[0]?.src, url);
  const articleType = recs.has("NewsArticle") ? "NewsArticle" : recs.has("BlogPosting") ? "BlogPosting" : null;
  if (articleType)
    graph.push({
      "@type": articleType,
      ...(url ? { "@id": `${url}#article`, mainEntityOfPage: url } : {}),
      headline: (draft.title || doc.h1s[0]?.text || "").slice(0, 110),
      ...(draft.metaDescription ? { description: draft.metaDescription } : {}),
      ...(image ? { image } : {}),
      ...(author ? { author } : {}),
      ...(publisher ? { publisher } : {}),
      ...(m.publishedAt ? { datePublished: m.publishedAt } : {}),
      ...(m.modifiedAt || m.publishedAt ? { dateModified: m.modifiedAt || m.publishedAt } : {}),
      ...(draft.keyword ? { keywords: [draft.keyword, ...draft.keywords].join(", ") } : {}),
      wordCount: doc.words,
    });
  if (recs.has("FAQPage")) graph.push({ "@type": "FAQPage", ...(url ? { "@id": `${url}#faq` } : {}), mainEntity: doc.faqs.slice(0, 20).map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })) });
  if (recs.has("HowTo")) {
    const list = doc.lists.find((l) => l.ordered && l.items.length >= 3)!;
    graph.push({ "@type": "HowTo", name: doc.h1s[0]?.text || draft.title, step: list.items.map((s, i) => ({ "@type": "HowToStep", position: i + 1, text: s })) });
  }
  if (recs.has("ItemList")) graph.push({ "@type": "ItemList", itemListElement: doc.headings.filter((h) => h.level === 2).filter((h) => !/^(conclusion|faq|frequently|key takeaways|summary)/i.test(h.text)).map((h, i) => ({ "@type": "ListItem", position: i + 1, name: h.text.replace(/^\d+[.)]?\s*/, "") })) });
  if (recs.has("Course")) graph.push({ "@type": "Course", name: doc.h1s[0]?.text || draft.title, description: draft.metaDescription || doc.intro.text.slice(0, 300), ...(publisher ? { provider: publisher } : {}) });
  if (recs.has("VideoObject")) {
    const v = doc.embeds.find((e) => e.kind === "video")!;
    graph.push({ "@type": "VideoObject", name: draft.title, description: draft.metaDescription || doc.intro.text.slice(0, 200), embedUrl: v.src, ...(image ? { thumbnailUrl: image } : {}), ...(m.publishedAt ? { uploadDate: m.publishedAt } : {}) });
  }
  if (recs.has("BreadcrumbList") && url) {
    try {
      const u = new URL(url);
      const parts = u.pathname.split("/").filter(Boolean);
      graph.push({
        "@type": "BreadcrumbList",
        itemListElement: [{ name: m.organization?.name || u.hostname, path: "" }, ...parts.map((p, i) => ({ name: i === parts.length - 1 ? draft.title || p : p.replace(/[-_]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()), path: `/${parts.slice(0, i + 1).join("/")}` }))].map((c, i) => ({ "@type": "ListItem", position: i + 1, name: c.name, item: `${u.origin}${c.path || "/"}` })),
      });
    } catch {
      /* not an absolute URL */
    }
  }
  return { "@context": "https://schema.org", "@graph": graph };
}

export type SchemaIssue = { level: "error" | "warning"; message: string };

const REQUIRED: Record<string, { required: string[]; recommended: string[] }> = {
  Article: { required: ["headline"], recommended: ["author", "datePublished", "image", "publisher", "dateModified"] },
  BlogPosting: { required: ["headline"], recommended: ["author", "datePublished", "image", "publisher", "dateModified"] },
  NewsArticle: { required: ["headline", "datePublished"], recommended: ["author", "image", "publisher", "dateModified"] },
  FAQPage: { required: ["mainEntity"], recommended: [] },
  HowTo: { required: ["name", "step"], recommended: ["image", "totalTime"] },
  ItemList: { required: ["itemListElement"], recommended: [] },
  Course: { required: ["name", "description"], recommended: ["provider"] },
  VideoObject: { required: ["name", "thumbnailUrl", "uploadDate"], recommended: ["description", "contentUrl", "embedUrl"] },
  BreadcrumbList: { required: ["itemListElement"], recommended: [] },
  Organization: { required: ["name"], recommended: ["url", "logo"] },
  Person: { required: ["name"], recommended: ["url"] },
};

/** Flatten a JSON-LD document (object, array or @graph) into typed nodes. */
export function schemaNodes(json: unknown): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  const visit = (n: unknown) => {
    if (Array.isArray(n)) return n.forEach(visit);
    if (!n || typeof n !== "object") return;
    const o = n as Record<string, unknown>;
    if (Array.isArray(o["@graph"])) (o["@graph"] as unknown[]).forEach(visit);
    if (o["@type"]) out.push(o);
  };
  visit(json);
  return out;
}

export const typesOf = (n: Record<string, unknown>) => (Array.isArray(n["@type"]) ? (n["@type"] as string[]) : [String(n["@type"])]);

export function validateSchema(text: string, draft: DraftInput, doc: ParsedDoc): { valid: boolean; types: string[]; issues: SchemaIssue[]; parseError: string | null } {
  const raw = text.trim().replace(/^<script[^>]*>|<\/script>$/gi, "").trim();
  if (!raw) return { valid: false, types: [], issues: [], parseError: null };
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (e) {
    return { valid: false, types: [], issues: [{ level: "error", message: `Invalid JSON: ${e instanceof Error ? e.message : "parse error"}` }], parseError: e instanceof Error ? e.message : "parse error" };
  }
  const issues: SchemaIssue[] = [];
  const top = Array.isArray(json) ? json : [json];
  for (const t of top) if (t && typeof t === "object" && !String((t as Record<string, unknown>)["@context"] ?? "").includes("schema.org")) issues.push({ level: "error", message: "Missing @context \"https://schema.org\"." });
  const nodes = schemaNodes(json);
  if (!nodes.length) issues.push({ level: "error", message: "No @type found." });
  const visible = `${draft.title}\n${doc.plain}`.toLowerCase();
  const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  for (const n of nodes) {
    for (const type of typesOf(n)) {
      const spec = REQUIRED[type];
      if (!spec) continue;
      for (const p of spec.required) if (n[p] == null || n[p] === "" || (Array.isArray(n[p]) && !(n[p] as unknown[]).length)) issues.push({ level: "error", message: `${type}: missing required “${p}”.` });
      for (const p of spec.recommended) if (n[p] == null || n[p] === "") issues.push({ level: "warning", message: `${type}: recommended “${p}” is missing.` });
      if (/Article|BlogPosting/.test(type)) {
        const headline = String(n.headline ?? "");
        if (headline.length > 110) issues.push({ level: "warning", message: `${type}: headline is over 110 characters.` });
        if (headline && norm(headline) !== norm(draft.title) && norm(headline) !== norm(doc.h1s[0]?.text ?? "")) issues.push({ level: "warning", message: `${type}: headline “${headline.slice(0, 60)}” doesn't match the title or H1.` });
        for (const d of ["datePublished", "dateModified"]) if (n[d] && Number.isNaN(Date.parse(String(n[d])))) issues.push({ level: "error", message: `${type}: ${d} is not an ISO 8601 date.` });
        if (n.datePublished && draft.meta.publishedAt && String(n.datePublished).slice(0, 10) !== draft.meta.publishedAt.slice(0, 10)) issues.push({ level: "warning", message: `${type}: datePublished differs from the article's published date.` });
        const a = n.author as Record<string, unknown> | undefined;
        const an = Array.isArray(a) ? String((a[0] as Record<string, unknown>)?.name ?? "") : String(a?.name ?? "");
        if (a && !an) issues.push({ level: "error", message: `${type}: author needs a name.` });
        if (an && draft.meta.author?.name && norm(an) !== norm(draft.meta.author.name)) issues.push({ level: "warning", message: `${type}: author “${an}” differs from the article's author.` });
      }
      if (type === "FAQPage") {
        const qs = Array.isArray(n.mainEntity) ? (n.mainEntity as Record<string, unknown>[]) : [];
        for (const q of qs) {
          const name = String(q?.name ?? "");
          const ans = String((q?.acceptedAnswer as Record<string, unknown>)?.text ?? "");
          if (!name || !ans) issues.push({ level: "error", message: "FAQPage: every Question needs a name and acceptedAnswer.text." });
          else if (!visible.includes(norm(name).split(" ").slice(0, 5).join(" ")) && !visible.includes(name.toLowerCase().slice(0, 30))) issues.push({ level: "error", message: `FAQPage: “${name.slice(0, 60)}” is not visible on the page (marked-up FAQs must be shown).` });
        }
      }
      if (type === "HowTo") {
        const steps = Array.isArray(n.step) ? (n.step as unknown[]).length : 0;
        if (steps < 2) issues.push({ level: "error", message: "HowTo: needs at least 2 steps." });
      }
      if (/Review|AggregateRating/.test(type) || n.aggregateRating) issues.push({ level: "warning", message: "Review/rating markup about your own organization (self-serving reviews) is not eligible for review stars." });
    }
  }
  const types = [...new Set(nodes.flatMap(typesOf))];
  return { valid: !issues.some((i) => i.level === "error"), types, issues, parseError: null };
}
