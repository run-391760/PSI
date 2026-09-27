import type { Metadata } from "next";
import { requirePageUser } from "@/lib/auth";
import { demoAllowed } from "@/lib/data-mode";
import { liveEnabled } from "@/lib/providers/source";
import { NeedsData } from "@/components/seo/needs-data";
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
  const available = live || demoAllowed();
  return (
    <Page className="overflow-x-clip">
      <PageHeader
        breadcrumbs={[{ label: "Link building" }, { label: "Bulk Analysis", href: "/bulk-analysis" }]}
        title="Bulk Analysis"
        description="Compare the backlink profiles of up to 200 domains, subdomains or URLs at once: authority, referring domains, link attributes and link velocity."
        meta={available ? <DataSourceBadge source={live ? "dataforseo" : "demo"} /> : undefined}
      />
      {available ? (
        <>
          <BulkAnalysis initial={initial} autoRun={!!initial} />
          {!live && <DemoNotice className="mt-6" />}
        </>
      ) : (
        <NeedsData
          providers={["dataforseo"]}
          title="Connect DataForSEO to compare backlink profiles in bulk"
          shows={[
            "Authority Score of up to 200 domains, subdomains or URLs",
            "Referring domains, backlinks and referring IPs",
            "Follow vs nofollow share of referring domains",
            "New and lost referring domains and backlinks (30 days)",
            "Sortable table with CSV export",
          ]}
        />
      )}
    </Page>
  );
}
