import type { Ctx } from "../context";
import { generateSchema, recommendSchema, validateSchema } from "../schema";
import type { Finding, FixOption } from "../types";
import { clamp01, finding, plural } from "./util";

/** Schema and Technical SEO modules. */

const pretty = (o: unknown) => JSON.stringify(o, null, 2);

export function schemaRecommend(ctx: Ctx): Finding {
  const recs = recommendSchema(ctx.draft, ctx.doc, ctx.intent.format);
  const present = new Set(validateSchema(ctx.draft.meta.schema ?? "", ctx.draft, ctx.doc).types);
  const essential = recs.filter((r) => r.essential);
  const have = recs.filter((r) => present.has(r.type) || (r.type === "BlogPosting" && (present.has("Article") || present.has("NewsArticle"))));
  const score = recs.length ? (essential.length ? 0.7 * (essential.filter((r) => have.includes(r)).length / essential.length) + 0.3 * (have.length / recs.length) : have.length / recs.length) : 1;
  return finding("schema-recommend", score, recs.length ? `Recommended: ${recs.map((r) => r.type).join(", ")}. ${have.length} of ${recs.length} in place.` : "No structured data applies to this content.", ["content"], {
    items: recs.map((r) => ({ label: r.type, detail: `${r.reason}${r.essential ? " · essential" : ""}`, tone: have.includes(r) ? ("good" as const) : r.essential ? ("critical" as const) : ("warning" as const) })),
    how: score < 0.8 ? "Generate the JSON-LD (Schema Generator) and add it to the page." : undefined,
  });
}

export function schemaGenerate(ctx: Ctx): Finding {
  const generated = pretty(generateSchema(ctx.draft, ctx.doc, ctx.intent.format));
  const current = (ctx.draft.meta.schema ?? "").trim();
  const recs = recommendSchema(ctx.draft, ctx.doc, ctx.intent.format).map((r) => r.type);
  const types = validateSchema(current, ctx.draft, ctx.doc).types;
  const missing = recs.filter((t) => !types.includes(t) && !(t === "BlogPosting" && types.some((x) => /Article/.test(x))));
  const fix: FixOption = { id: "schema-use-generated", label: current ? "Replace with regenerated JSON-LD" : "Use the generated JSON-LD", description: `Sets the article's structured data to a @graph with ${recs.join(", ")}, built from the visible content and article settings.`, fix: { kind: "meta", patch: { schema: generated } }, safe: !current };
  const score = !current ? 0.35 : missing.length ? clamp01(1 - missing.length / Math.max(1, recs.length)) : 1;
  return finding("schema-generate", score, current ? (missing.length ? `JSON-LD present; missing ${missing.join(", ")}.` : `JSON-LD present with ${types.join(", ")}.`) : `No JSON-LD yet. Generated: ${recs.join(", ") || "none applicable"}.`, ["content"], {
    items: missing.map((t) => ({ label: `${t} not in the current JSON-LD`, tone: "warning" as const })),
    fixes: !current || missing.length ? [fix] : undefined,
  });
}

export function schemaValidate(ctx: Ctx): Finding {
  const text = ctx.draft.meta.schema ?? "";
  if (!text.trim()) return finding("schema-validate", null, "No JSON-LD to validate yet.", ["content"], { status: "na", how: "Use the Schema Generator, or paste your own JSON-LD in the Schema tab." });
  const v = validateSchema(text, ctx.draft, ctx.doc);
  const errors = v.issues.filter((i) => i.level === "error");
  const warnings = v.issues.filter((i) => i.level === "warning");
  const score = v.parseError ? 0 : clamp01(1 - errors.length * 0.3 - warnings.length * 0.06);
  return finding("schema-validate", score, v.parseError ? "The JSON-LD is not valid JSON." : `${v.types.join(", ")}: ${plural(errors.length, "error")}, ${plural(warnings.length, "warning")}.`, ["content"], {
    items: v.issues.map((i) => ({ label: i.message, tone: i.level === "error" ? ("critical" as const) : ("warning" as const) })),
    blocker: v.parseError ? "The JSON-LD structured data is invalid JSON: fix or regenerate it." : undefined,
  });
}

export function articleMetadata(ctx: Ctx): Finding {
  const m = ctx.draft.meta;
  const now = ctx.now.getTime();
  const pub = m.publishedAt ? Date.parse(m.publishedAt) : NaN;
  const mod = m.modifiedAt ? Date.parse(m.modifiedAt) : NaN;
  const parts = [
    { label: "Author", ok: !!m.author?.name, detail: m.author?.name ?? "Not set" },
    { label: "Publication date", ok: !Number.isNaN(pub), detail: m.publishedAt ?? "Not set (set it when you publish)" },
    { label: "Last updated date", ok: !Number.isNaN(mod) && (Number.isNaN(pub) || mod >= pub), detail: m.modifiedAt ? (mod < pub ? "Before the publication date" : m.modifiedAt) : "Not set" },
    { label: "Dates not in the future", ok: !(pub > now + 86400000) && !(mod > now + 86400000), detail: "" },
    { label: "Featured image", ok: !!(m.featuredImage || ctx.doc.images[0]), detail: m.featuredImage || ctx.doc.images[0]?.src || "Not set" },
    { label: "Publisher / organization", ok: !!m.organization?.name, detail: m.organization?.name ?? "Not set" },
  ];
  const today = ctx.now.toISOString().slice(0, 10);
  const fixes: FixOption[] = [];
  if (!m.modifiedAt) fixes.push({ id: "meta-modified-today", label: `Set “last updated” to ${today}`, description: "Sets the modified date to today.", fix: { kind: "meta", patch: { modifiedAt: today } }, safe: true });
  if (!m.featuredImage && ctx.doc.images[0]) fixes.push({ id: "meta-featured", label: "Use the first image as featured image", description: ctx.doc.images[0].src, fix: { kind: "meta", patch: { featuredImage: ctx.doc.images[0].src } }, safe: true });
  const score = parts.filter((p) => p.ok).length / parts.length;
  return finding("article-metadata", score, `${parts.filter((p) => p.ok).length} of ${parts.length} metadata fields complete.`, ["content"], { items: parts.map((p) => ({ label: p.label, detail: p.detail, tone: p.ok ? ("good" as const) : ("warning" as const) })), fixes });
}

function host(u: string) {
  try {
    return new URL(u).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

export function canonical(ctx: Ctx): Finding {
  const url = ctx.draft.url.trim();
  const c = (ctx.draft.meta.canonical ?? "").trim();
  const same = (a: string, b: string) => a.replace(/\/$/, "").replace(/^http:/, "https:") === b.replace(/\/$/, "").replace(/^http:/, "https:");
  const set: FixOption | null = url ? { id: "canonical-self", label: "Set a self-referencing canonical", description: `canonical → ${url}`, fix: { kind: "meta", patch: { canonical: url } }, safe: !c } : null;
  const live = ctx.live?.canonical;
  if (!url && !c) return finding("canonical", 0.4, "No target URL or canonical set.", ["content"], { how: "Set the URL this article will be published at; the canonical should point to it." });
  if (!c) return finding("canonical", 0.6, `No canonical set; recommended: ${url}.`, ["content"], { fixes: set ? [set] : undefined });
  const cross = url && host(c) && host(url) && host(c) !== host(url);
  const differs = url && !same(c, url);
  const liveMismatch = live && !same(live, c);
  const score = cross ? 0 : differs ? 0.4 : liveMismatch ? 0.6 : 1;
  return finding("canonical", score, cross ? `Canonical points to another site (${host(c)}).` : differs ? `Canonical (${c}) points to a different URL than this article.` : liveMismatch ? `The live page's canonical (${live}) differs from the planned one.` : "Self-referencing canonical.", ctx.live ? ["content", "live-url"] : ["content"], {
    items: [{ label: `Canonical: ${c}`, tone: score === 1 ? ("good" as const) : ("warning" as const) }, ...(url ? [{ label: `Article URL: ${url}`, tone: "neutral" as const }] : []), ...(live ? [{ label: `Live canonical: ${live}`, tone: liveMismatch ? ("warning" as const) : ("good" as const) }] : [])],
    fixes: score < 1 && set ? [{ ...set, safe: false }] : undefined,
    blocker: cross ? `The canonical points to another domain (${host(c)}): this article would not be indexed for your site.` : undefined,
    how: differs ? "Only point the canonical elsewhere when this page duplicates that one; otherwise make it self-referencing." : undefined,
  });
}

export function indexability(ctx: Ctx): Finding {
  const robots = (ctx.draft.meta.robots ?? "index, follow").toLowerCase();
  const noindex = /\b(noindex|none)\b/.test(robots);
  const nofollow = /\bnofollow\b/.test(robots);
  const url = ctx.draft.url.trim();
  const live = ctx.live;
  const items: { label: string; detail?: string; tone: "good" | "warning" | "critical" | "neutral" }[] = [
    { label: `Robots meta: ${robots}`, tone: noindex ? "critical" : nofollow ? "warning" : "good" },
    { label: url ? `URL: ${url}` : "No target URL", tone: url ? (url.startsWith("https://") ? "good" : "warning") : "warning", detail: url && !url.startsWith("https://") ? "Use HTTPS" : undefined },
  ];
  let score = (noindex ? 0 : 0.5) + (nofollow ? 0 : 0.1) + (url ? (url.startsWith("https://") ? 0.2 : 0.1) : 0) + (ctx.draft.slug || url ? 0.1 : 0) + 0.1;
  if (live) {
    const ok = live.status != null && live.status < 400 && !live.noindex && live.robotsAllowed !== false;
    items.push({ label: `Live check (${live.checkedAt.slice(0, 10)}): ${live.error ? live.error : `HTTP ${live.status}`}`, detail: [live.noindex ? "noindex on the live page" : null, live.xRobots ? `X-Robots-Tag: ${live.xRobots}` : null, live.robotsAllowed === false ? "blocked by robots.txt" : live.robotsAllowed ? "allowed by robots.txt" : null].filter(Boolean).join(" · ") || undefined, tone: ok ? "good" : "critical" });
    if (!ok) score = Math.min(score, 0.3);
  } else items.push({ label: "Live URL not checked", detail: url ? "After publishing, run the live check to confirm status, robots.txt and X-Robots-Tag." : undefined, tone: "neutral" });
  const fixes: FixOption[] = noindex ? [{ id: "robots-index", label: "Set robots to “index, follow”", description: "Removes noindex so the page can appear in search.", fix: { kind: "meta", patch: { robots: "index, follow" } }, safe: false }] : [];
  return finding("indexability", score, noindex ? "The article is set to noindex: it cannot appear in search." : live && (live.noindex || (live.status ?? 0) >= 400 || live.robotsAllowed === false) ? "The live page is not indexable." : "No indexability blockers found.", live ? ["content", "live-url"] : ["content"], {
    items,
    fixes,
    blocker: noindex ? "Robots meta is set to noindex." : live && live.robotsAllowed === false ? "robots.txt blocks the live URL." : live && live.noindex ? "The live page sends noindex." : undefined,
  });
}
