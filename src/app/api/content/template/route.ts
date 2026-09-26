import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { AppError } from "@/lib/domain";
import { htmlDocument, markdownToHtml } from "@/lib/content/markdown";
import { buildTemplate, parseTemplateKeywords, templateMarkdown } from "@/lib/content/template";

export const dynamic = "force-dynamic";

/** Download the SEO Content Template as Markdown or HTML: GET ?q=kw1,kw2&db=US&format=md|html */
export async function GET(request: Request) {
  try {
    await requireUser();
    const url = new URL(request.url);
    const keywords = parseTemplateKeywords(url.searchParams.get("q") ?? "");
    if (!keywords.length) throw new AppError("Enter at least one keyword.");
    const format = url.searchParams.get("format") === "html" ? "html" : "md";
    const { data } = buildTemplate(keywords, url.searchParams.get("db") ?? "US");
    const md = templateMarkdown(data);
    const slug = keywords[0].replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").slice(0, 60) || "template";
    const body = format === "html" ? htmlDocument(`SEO content template: ${keywords.join(", ")}`, markdownToHtml(md)) : md;
    return new NextResponse(body, {
      headers: {
        "Content-Type": format === "html" ? "text/html; charset=utf-8" : "text/markdown; charset=utf-8",
        "Content-Disposition": `attachment; filename="seo-content-template-${slug}.${format}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    const status = e instanceof AppError ? e.status : 500;
    return NextResponse.json({ error: e instanceof Error ? e.message : "Export failed." }, { status });
  }
}
