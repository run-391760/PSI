import { Unlink } from "lucide-react";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import { requirePageUser } from "@/lib/auth";
import { getBacklinkGap } from "@/lib/competitive/backlink-gap";
import { BACKLINK_GAP_CATEGORIES, backlinkGapCategories, type BacklinkGapCategory } from "@/lib/competitive/gap-logic";
import { compareHref } from "@/lib/competitive/links";
import { parseDomains, spList, spStr } from "@/lib/competitive/shared";
import { compact } from "@/lib/format";
import { AsBadge, DomainAvatar } from "@/components/seo/badges";
import { DataSourceBadge, DemoNotice } from "@/components/seo/source-badge";
import { Grid, Page, PageHeader } from "@/components/shell/page";
import { MONTH_RANGES, TrendChart } from "@/components/charts/trend-chart";
import { series } from "@/components/charts/theme";
import { BacklinkGapTable } from "@/components/competitive/backlink-gap-table";
import { DomainsForm } from "@/components/competitive/domains-form";
import { OverlapCircles } from "@/components/competitive/overlap-circles";
import { Badge, Swatch } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Callout, EmptyState } from "@/components/ui/feedback";
import { MiniTable } from "@/components/ui/mini-table";
import { PrintButton } from "@/components/ui/print-button";
import { Bar } from "@/components/ui/progress";

export const metadata: Metadata = { title: "Backlink Gap" };

const CRUMBS = [{ label: "Competitive research" }, { label: "Backlink Gap", href: "/backlink-gap" }];
const EXAMPLES = [
  ["nike.com", "adidas.com", "zara.com"],
  ["healthline.com", "webmd.com", "mayoclinic.org", "verywellhealth.com"],
  ["coursera.org", "udemy.com", "edx.org"],
];

export default async function BacklinkGapPage({ searchParams }: PageProps<"/backlink-gap">) {
  const user = await requirePageUser();
  const sp = await searchParams;
  const raw = spList(sp.d);
  const catParam = spStr(sp.cat) as BacklinkGapCategory;
  const cat = BACKLINK_GAP_CATEGORIES.some((c) => c.id === catParam) ? catParam : "best";
  const { domains, invalid, truncated } = parseDomains(raw);

  const header = (subject?: string, meta?: ReactNode) => (
    <PageHeader breadcrumbs={CRUMBS} title={subject ? "Backlink Gap:" : "Backlink Gap"} subject={subject} description={subject ? undefined : "Compare the backlink profiles of up to 5 domains and find the websites that link to your competitors but not to you."} meta={meta} actions={subject ? <PrintButton /> : undefined}>
      <DomainsForm key={domains.join(",")} initial={domains.length ? domains : raw} showDb={false} submitLabel="Find prospects" />
    </PageHeader>
  );

  if (domains.length < 2)
    return (
      <Page>
        {header()}
        {invalid.length > 0 && <Callout tone="warning" className="mb-4">Not a valid domain: {invalid.join(", ")}.</Callout>}
        {domains.length === 1 && <Callout tone="info" className="mb-4">Add at least one competitor to compare with {domains[0]}.</Callout>}
        <Card>
          <EmptyState
            icon={<Unlink className="h-5 w-5" />}
            title="Find link building prospects"
            description="Enter your domain first, then up to four competitors. Try an example:"
            action={
              <div className="flex flex-col items-center gap-2">
                {EXAMPLES.map((e) => (
                  <ButtonLink key={e.join()} href={compareHref("/backlink-gap", e)} size="sm">
                    {e[0]} vs {e.slice(1).join(", ")}
                  </ButtonLink>
                ))}
              </div>
            }
          />
        </Card>
      </Page>
    );

  const { data, source, fetchedAt } = await getBacklinkGap(user.id, domains);
  const you = domains[0];
  const best = data.rows.filter((r) => backlinkGapCategories(r.counts).includes("best")).slice(0, 8);
  const base = compareHref("/backlink-gap", domains);

  return (
    <Page>
      {header(
        `${you} vs ${domains.length - 1} competitor${domains.length > 2 ? "s" : ""}`,
        <>
          <DataSourceBadge source={source} fetchedAt={fetchedAt} />
          <Badge tone="brand">Root domains · all backlinks</Badge>
        </>,
      )}
      {invalid.length > 0 && <Callout tone="warning" className="mb-4">Ignored invalid entries: {invalid.join(", ")}.</Callout>}
      {truncated && <Callout tone="info" className="mb-4">Only the first 5 domains are compared.</Callout>}

      <Card className="mb-4">
        <div className="grid divide-y divide-border sm:grid-flow-col sm:auto-cols-fr sm:divide-x sm:divide-y-0">
          {data.targets.map((t, i) => (
            <div key={t.domain} className="min-w-0 px-4 py-3">
              <div className="flex items-center gap-2 text-[12.5px]">
                <Swatch color={series(i)} shape="dot" />
                <Link href={`/backlink-analytics?q=${t.domain}`} className="truncate font-medium text-link hover:underline">
                  {t.domain}
                </Link>
                {i === 0 && <Badge tone="brand">You</Badge>}
              </div>
              <div className="mt-1.5 flex items-baseline gap-2">
                <span className="text-[22px] font-semibold tracking-tight">{compact(t.referringDomains)}</span>
                <span className="text-[12px] text-text-3">referring domains</span>
              </div>
              <div className="mt-0.5 flex items-center gap-2 text-[12px] text-text-3">
                {t.authorityScore != null && <AsBadge score={t.authorityScore} />}
                <span>{compact(t.backlinks)} backlinks</span>
              </div>
            </div>
          ))}
        </div>
      </Card>

      <Grid cols={2} className="mb-4 lg:grid-cols-[1.5fr_1fr]">
        <Card>
          <CardHeader title="Referring domains trend" description="One line per domain" />
          <CardBody>
            {data.trend.length ? (
              <TrendChart data={data.trend} xKey="month" series={domains.map((d, i) => ({ key: `t${i}`, label: d }))} ranges={MONTH_RANGES} defaultRange="1y" height={270} />
            ) : (
              <p className="py-10 text-center text-[13px] text-text-3">History is not available from the connected provider.</p>
            )}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Referring domains overlap" info="Circle area is proportional to the number of referring domains in the analyzed sample; the middle number links to all domains." />
          <CardBody>
            <OverlapCircles items={data.targets.map((t, i) => ({ label: t.domain, count: t.sample, color: series(i) }))} overlap={data.overlap} sharedByAll={data.sharedByAll} sharedLabel="link to all" height={220} />
            <ul className="mt-3 space-y-1.5 text-[12.5px]">
              {data.targets.map((t, i) => (
                <li key={t.domain} className="flex items-center justify-between gap-2">
                  <span className="inline-flex min-w-0 items-center gap-1.5">
                    <Swatch color={series(i)} shape="dot" />
                    <span className="truncate text-text-2">{t.domain}</span>
                  </span>
                  <span className="tabular text-text">
                    {compact(t.sample)} <span className="text-text-3">in sample</span>
                    {i > 0 && <span className="text-text-3"> · {compact(data.overlap[0][i])} shared with you</span>}
                  </span>
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      </Grid>

      <Grid cols={2} className="mb-4">
        <Card>
          <CardHeader title={`Best prospects for ${you}`} description="Strongest domains linking to every competitor but not to you" />
          <CardBody>
            <MiniTable
              empty="No domain links to all competitors without linking to you."
              columns={[{ header: "Domain" }, { header: "AS", align: "right" }, { header: "Links to competitors", align: "right" }]}
              rows={best.map((r) => [
                <Link key="d" href={`/backlink-analytics?q=${r.domain}`} className="inline-flex min-w-0 items-center gap-1.5 text-link hover:underline">
                  <DomainAvatar domain={r.domain} />
                  <span className="max-w-[240px] truncate">{r.domain}</span>
                </Link>,
                r.authorityScore == null ? "n/a" : <AsBadge key="as" score={r.authorityScore} />,
                compact(r.counts.slice(1).reduce((a, c) => a + c, 0)),
              ])}
            />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Prospects by category" />
          <CardBody>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {BACKLINK_GAP_CATEGORIES.filter((c) => c.id !== "all").map((c) => (
                <Link key={c.id} href={`${base}&cat=${c.id}#details`} className="rounded-md border border-border p-3 hover:bg-surface-2" title={c.note}>
                  <div className="text-[12.5px] text-text-2">{c.label}</div>
                  <div className="mt-0.5 text-[20px] font-semibold tracking-tight">{compact(data.counts[c.id])}</div>
                  <Bar value={data.counts[c.id]} max={data.counts.all || 1} className="mt-1.5" />
                </Link>
              ))}
            </div>
            <p className="mt-3 text-[12px] text-text-3">
              {compact(data.counts.all)} referring domains across all {domains.length} domains (largest {compact(Math.max(...data.targets.map((t) => t.sample)))} per domain analyzed).
            </p>
          </CardBody>
        </Card>
      </Grid>

      <Card id="details">
        <CardHeader title="Referring domains" description="Select domains to copy them for outreach" />
        <BacklinkGapTable rows={data.rows} targets={domains} counts={data.counts} initialCat={cat} />
      </Card>
      {source === "demo" && <DemoNotice className="mt-6" />}
    </Page>
  );
}
