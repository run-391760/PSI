import type { Metadata } from "next";
import { CrawlerWorkspace } from "@/components/optimizer/crawler/workspace";
import { DataSourceBadge } from "@/components/seo/source-badge";
import { Page, PageHeader } from "@/components/shell/page";
import { requirePageUser } from "@/lib/auth";
import { listCrawls } from "@/lib/optimizer/crawl/store";

export const metadata: Metadata = { title: "Live crawler · Pre-Publish Optimizer" };

/**
 * Live crawler: enter a site, watch the spider walk each page and reach for the links, headings and
 * images it checks, with every flag measured from the live HTML and each page scored by the
 * optimizer engine. Past crawls replay from storage. `?crawl=<id>` opens a stored crawl.
 */
export default async function CrawlerPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requirePageUser();
  const sp = await searchParams;
  const crawls = await listCrawls(user.id);
  const openId = typeof sp.crawl === "string" ? sp.crawl.slice(0, 64) : null;
  return (
    <Page wide>
      <PageHeader
        title="Live crawler"
        description="Crawl your site and watch SynapseSEOBot inspect every page: broken and redirected links, headings, alt text, titles, meta, indexability and thin content, plus an optimizer score per page."
        breadcrumbs={[{ label: "Pre-Publish Optimizer", href: "/optimizer" }, { label: "Live crawler" }]}
        meta={
          <>
            <DataSourceBadge source="crawler" note="pages fetched live from the site; robots.txt respected" />
            <span className="text-[12px] text-text-3">Scores: Pre-Publish Optimizer engine (58 checks) on each page’s HTML</span>
          </>
        }
      />
      <CrawlerWorkspace crawls={crawls} openId={openId} />
    </Page>
  );
}
