import type { Metadata } from "next";
import Link from "next/link";
import { requirePageUser } from "@/lib/auth";
import { database } from "@/lib/domain";
import { compact, timeAgo } from "@/lib/format";
import { getCampaign, listCampaigns } from "@/lib/keywords/ppc";
import { parseKeywordInput } from "@/lib/keywords/text";
import { DataSourceBadge, DemoNotice } from "@/components/seo/source-badge";
import { Grid, Page, PageHeader } from "@/components/shell/page";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Callout } from "@/components/ui/feedback";
import { MiniTable } from "@/components/ui/mini-table";
import { PpcPlanner } from "@/components/keywords/ppc-planner";
import { NewCampaignForm } from "@/components/keywords/ppc-new";
import { AppError } from "@/lib/domain";

export const metadata: Metadata = { title: "PPC Keyword Tool" };

const str = (v: string | string[] | undefined) => (typeof v === "string" ? v : "");
const BREADCRUMBS = [{ label: "Advertising" }, { label: "PPC Keyword Tool", href: "/ppc-keyword-tool" }];

export default async function PpcKeywordToolPage({ searchParams }: PageProps<"/ppc-keyword-tool">) {
  const user = await requirePageUser();
  const sp = await searchParams;
  const campaignId = str(sp.campaign);
  const detail = campaignId
    ? await getCampaign(user.id, campaignId).catch((e) => {
        if (e instanceof AppError && e.status === 404) return null;
        throw e;
      })
    : null;

  if (!detail) {
    const campaigns = await listCampaigns(user.id);
    const imported = str(sp.import) ? parseKeywordInput(str(sp.import), 5000).keywords : [];
    return (
      <Page>
        <PageHeader
          breadcrumbs={BREADCRUMBS}
          title="PPC Keyword Tool"
          description="Plan Google Ads campaigns: group keywords into ad groups by common words, set match types, add cross-group negatives, estimate clicks and cost, and export for Google Ads Editor."
        />
        {campaignId && <Callout tone="warning" className="mb-4">That campaign does not exist or belongs to another account.</Callout>}
        <Grid cols={2} className="lg:grid-cols-[1.25fr_1fr]">
          <Card>
            <CardHeader title={imported.length ? `New campaign from ${imported.length} imported keywords` : "New campaign"} description="Paste keywords from the Keyword Magic Tool or your own research." />
            <CardBody>
              <NewCampaignForm defaultKeywords={imported.join("\n")} defaultDb={database(str(sp.db)).code} defaultName={str(sp.name)} />
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="My campaigns" description={campaigns.length ? `${campaigns.length} campaign${campaigns.length === 1 ? "" : "s"}` : "No campaigns yet"} />
            <CardBody>
              {campaigns.length ? (
                <MiniTable
                  columns={[{ header: "Campaign" }, { header: "Groups", align: "right" }, { header: "Keywords", align: "right" }, { header: "Volume", align: "right" }, { header: "Updated", align: "right" }]}
                  rows={campaigns.map((c) => [
                    <Link key="n" href={`/ppc-keyword-tool?campaign=${c.id}`} className="font-medium text-link hover:underline">
                      {database(c.db).flag} {c.name}
                    </Link>,
                    c.groups,
                    c.keywords.toLocaleString(),
                    compact(c.volume),
                    <span key="u" className="text-text-3">
                      {timeAgo(c.updated_at)}
                    </span>,
                  ])}
                />
              ) : (
                <ul className="space-y-2.5 text-[12.5px] text-text-2">
                  <li><span className="font-medium text-text">Auto-grouping</span> splits keywords into tightly themed ad groups by their most common words.</li>
                  <li><span className="font-medium text-text">Cross-group negatives</span> stop ad groups from competing for the same search.</li>
                  <li><span className="font-medium text-text">Estimates</span> use search volume, CPC and your expected CTR per match type.</li>
                  <li><span className="font-medium text-text">Export</span> a CSV that Google Ads Editor imports directly (Campaign, Ad Group, Keyword, Criterion Type, Max CPC).</li>
                </ul>
              )}
            </CardBody>
          </Card>
        </Grid>
      </Page>
    );
  }

  const { campaign, groups } = detail;
  const selected = str(sp.group) === "all" || !groups.length ? "all" : groups.some((g) => g.id === str(sp.group)) ? str(sp.group) : groups[0].id;
  const sources = [...new Set(groups.flatMap((g) => g.keywords.map((k) => k.source)))];
  const info = database(campaign.db);
  return (
    <Page>
      <PageHeader
        breadcrumbs={[...BREADCRUMBS, { label: campaign.name }]}
        title="PPC Keyword Tool:"
        subject={campaign.name}
        meta={
          <>
            {(sources.length ? sources : ["demo"]).map((s) => (
              <DataSourceBadge key={s} source={s === "dataforseo" ? "dataforseo" : "demo"} fetchedAt={campaign.updated_at} />
            ))}
            <Badge>
              {info.flag} {info.name}
            </Badge>
            <Badge tone="brand">Search campaign</Badge>
          </>
        }
        actions={
          <ButtonLink href="/ppc-keyword-tool" variant="secondary">
            All campaigns
          </ButtonLink>
        }
      />
      <PpcPlanner detail={detail} selected={selected} />
      {sources.includes("demo") && <DemoNotice className="mt-6" />}
    </Page>
  );
}
