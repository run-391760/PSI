import { requireUser } from "@/lib/auth";
import { toCsv } from "@/lib/csv";
import { AppError } from "@/lib/domain";
import { CHECK_MAP } from "@/lib/site-audit/checks";
import { allIssues, allLinks, issueRows, ownedCrawl, pageExport } from "@/lib/site-audit/data";

export const dynamic = "force-dynamic";

/**
 * CSV exports of a crawl: ?crawl=<id>&type=issue&check=<checkId> | issues | pages | links.
 * Only crawls of the signed-in user's projects are exported.
 */
export async function GET(request: Request) {
  try {
    const user = await requireUser();
    const sp = new URL(request.url).searchParams;
    const crawl = await ownedCrawl(user.id, sp.get("crawl") ?? "");
    const type = sp.get("type") ?? "issues";
    const date = crawl.started_at.slice(0, 10);
    let rows: (string | number | null | undefined)[][];
    let name: string;
    if (type === "issue") {
      const check = CHECK_MAP[sp.get("check") ?? ""];
      if (!check) throw new AppError("Unknown check.", 404);
      const data = await issueRows(crawl.id, check.id);
      rows = [["URL", "Details", "HTTP status", "Crawl depth", "Incoming internal links", "Page title"], ...data.map((r) => [r.url, r.detail, r.status, r.depth, r.inlinks, r.title])];
      name = `site-audit-${crawl.domain}-${check.id}-${date}`;
    } else if (type === "issues") {
      const data = await allIssues(crawl.id);
      rows = [
        ["Severity", "Category", "Issue", "URL", "Details"],
        ...data.map((r) => {
          const c = CHECK_MAP[r.check_id];
          return [c?.severity ?? "", c?.category ?? "", c?.title ?? r.check_id, r.url, r.detail];
        }),
      ];
      name = `site-audit-${crawl.domain}-issues-${date}`;
    } else if (type === "pages") {
      const data = await pageExport(crawl.id);
      const cols = Object.keys(data[0] ?? { url: "" });
      rows = [cols, ...data.map((r) => cols.map((c) => (r[c] == null ? "" : String(r[c]))))];
      name = `site-audit-${crawl.domain}-pages-${date}`;
    } else if (type === "links") {
      const data = await allLinks(crawl.id);
      rows = [["Source URL", "Target URL", "Anchor", "Internal", "Nofollow", "rel", "Target status"], ...data.map((r) => [r.source, r.target, r.anchor, r.internal ? "yes" : "no", r.nofollow ? "yes" : "no", r.rel, r.status])];
      name = `site-audit-${crawl.domain}-links-${date}`;
    } else throw new AppError("Unknown export type.", 400);
    return new Response("﻿" + toCsv(rows), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${name.replace(/[^\w.-]+/g, "-")}.csv"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    const status = e instanceof AppError ? e.status : 500;
    if (status === 500) console.error(e);
    return new Response(e instanceof Error ? e.message : "Export failed.", { status });
  }
}
