import { requireUser } from "@/lib/auth";
import { escapeHtml, markdownToHtml } from "@/lib/content/markdown";
import { AppError } from "@/lib/domain";
import { detectFormat } from "@/lib/optimizer/intent";
import { parseDraft, slugify } from "@/lib/optimizer/parse";
import { generateSchema } from "@/lib/optimizer/schema";
import { getDraft, inputOf } from "@/lib/optimizer/store";

export const dynamic = "force-dynamic";

/** Publish package: standalone HTML (title, meta description, canonical, robots, Open Graph, JSON-LD) or the Markdown. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await params;
    const draft = await getDraft(user.id, id);
    const format = new URL(request.url).searchParams.get("format") === "md" ? "md" : "html";
    const name = slugify(draft.slug || draft.title || draft.keyword || "article") || "article";
    if (format === "md") {
      const front = ["---", `title: ${JSON.stringify(draft.title)}`, `description: ${JSON.stringify(draft.metaDescription)}`, `slug: ${JSON.stringify(draft.slug)}`, `keyword: ${JSON.stringify(draft.keyword)}`, ...(draft.meta.canonical ? [`canonical: ${JSON.stringify(draft.meta.canonical)}`] : []), ...(draft.meta.author?.name ? [`author: ${JSON.stringify(draft.meta.author.name)}`] : []), ...(draft.meta.publishedAt ? [`date: ${draft.meta.publishedAt}`] : []), ...(draft.meta.modifiedAt ? [`updated: ${draft.meta.modifiedAt}`] : []), "---", ""].join("\n");
      return new Response(front + draft.body, { headers: { "Content-Type": "text/markdown; charset=utf-8", "Content-Disposition": `attachment; filename="${name}.md"`, "Cache-Control": "no-store" } });
    }
    const doc = parseDraft(draft.body);
    let jsonLd = (draft.meta.schema ?? "").trim();
    if (!jsonLd) jsonLd = JSON.stringify(generateSchema(inputOf(draft), doc, detectFormat(draft.title, doc).format), null, 2);
    const m = draft.meta;
    const tag = (n: string, v?: string, attr = "name") => (v ? `<meta ${attr}="${n}" content="${escapeHtml(v)}">\n` : "");
    const head = [
      `<title>${escapeHtml(draft.title || doc.h1s[0]?.text || draft.keyword)}</title>`,
      tag("description", draft.metaDescription).trim(),
      tag("robots", m.robots || "index, follow").trim(),
      m.canonical || draft.url ? `<link rel="canonical" href="${escapeHtml(m.canonical || draft.url)}">` : "",
      tag("author", m.author?.name).trim(),
      tag("og:type", "article", "property").trim(),
      tag("og:title", draft.title, "property").trim(),
      tag("og:description", draft.metaDescription, "property").trim(),
      tag("og:url", m.canonical || draft.url, "property").trim(),
      tag("og:image", m.featuredImage || doc.images[0]?.src, "property").trim(),
      tag("article:published_time", m.publishedAt, "property").trim(),
      tag("article:modified_time", m.modifiedAt, "property").trim(),
      `<script type="application/ld+json">\n${jsonLd.replace(/<\/script/gi, "<\\/script")}\n</script>`,
    ]
      .filter(Boolean)
      .join("\n");
    const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
${head}
<style>
body{font:16px/1.65 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;max-width:760px;margin:40px auto;padding:0 20px;color:#1d2433}
h1,h2,h3{line-height:1.25}img{max-width:100%}blockquote{border-left:3px solid #d0d5dd;margin:0;padding-left:14px;color:#475467}
</style>
</head>
<body>
<article>
${markdownToHtml(draft.body)}
</article>
</body>
</html>
`;
    return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8", "Content-Disposition": `attachment; filename="${name}.html"`, "Cache-Control": "no-store" } });
  } catch (e) {
    const status = e instanceof AppError ? e.status : 500;
    return new Response(e instanceof Error ? e.message : "error", { status });
  }
}
