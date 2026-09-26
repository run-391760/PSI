import type { Metadata } from "next";
import { requirePageUser } from "@/lib/auth";
import { liveEnabled } from "@/lib/providers/source";
import { DataSourceBadge, DemoNotice } from "@/components/seo/source-badge";
import { Page, PageHeader } from "@/components/shell/page";
import { BulkAnalysis } from "@/components/backlinks/bulk-analysis";

export const metadata: Metadata = { title: "Bulk Analysis" };

export default async function BulkAnalysisPage({ searchParams }: PageProps<"/bulk-analysis">) {
  await requirePageUser();
  const sp = await searchParams;
  const q = typeof sp.q === "string" ? sp.q : "";
  const initial = q
    ? q
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
        .slice(0, 200)
        .join("\n")
    : undefined;
  const live = liveEnabled();
  return (
    <Page className="overflow-x-clip">
      <PageHeader
        breadcrumbs={[{ label: "Link building" }, { label: "Bulk Analysis", href: "/bulk-analysis" }]}
        title="Bulk Analysis"
        description="Compare the backlink profiles of up to 200 domains, subdomains or URLs at once: authority, referring domains, link attributes and link velocity."
        meta={<DataSourceBadge source={live ? "dataforseo" : "demo"} />}
      />
      <BulkAnalysis initial={initial} autoRun={!!initial} />
      {!live && <DemoNotice className="mt-6" />}
    </Page>
  );
}
