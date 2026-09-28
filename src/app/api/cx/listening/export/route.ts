import { requireUser } from "@/lib/auth";
import { AppError } from "@/lib/domain";
import { toCsv } from "@/lib/csv";
import { getCxBrand } from "@/lib/cx/context";
import { exportMentions, readFilters } from "@/lib/cx/listening/data";
import { sourceLabel } from "@/lib/cx/listening/sources";

export const dynamic = "force-dynamic";

/** CSV export of stored mentions for a brand, honouring the feed/dashboard filters. */
export async function GET(req: Request) {
  try {
    const user = await requireUser();
    const url = new URL(req.url);
    const sp = Object.fromEntries(url.searchParams.entries());
    const project = await getCxBrand(user.id, sp.brand ?? "", { write: false });
    const rows = await exportMentions(project.id, readFilters(sp));
    const csv = toCsv([
      ["Published", "Topic", "Topic type", "Source", "Author", "Handle", "Followers", "Title", "Text", "URL", "Language", "Sentiment", "Sentiment score", "Intent", "Status", "Tags", "Engagement"],
      ...rows.map((m) => [
        m.published_at ? new Date(m.published_at).toISOString() : "",
        m.topic_name ?? "",
        m.topic_kind ?? "",
        sourceLabel(m.source),
        m.author,
        m.author_handle ?? "",
        m.author_followers ?? "",
        m.title,
        m.body,
        m.url ?? "",
        m.language ?? "",
        m.sentiment ?? "",
        m.sentiment_score ?? "",
        m.intent ?? "",
        m.status,
        m.tags.join("; "),
        Object.entries(m.engagement ?? {}).map(([k, v]) => `${k}: ${v}`).join("; "),
      ]),
    ]);
    const name = `mentions-${project.domain || project.name}-${new Date().toISOString().slice(0, 10)}.csv`.replace(/[^\w.-]+/g, "-");
    return new Response(csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${name}"`, "Cache-Control": "no-store" } });
  } catch (e) {
    return new Response(e instanceof Error ? e.message : "error", { status: e instanceof AppError ? e.status : 500 });
  }
}
