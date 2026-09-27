import { Swords } from "lucide-react";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import { requirePageUser } from "@/lib/auth";
import { KEYWORD_GAP_CATEGORIES, keywordGapCategories, type KeywordGapCategory } from "@/lib/competitive/gap-logic";
import { getKeywordGap, type GapKeyword, type GapType } from "@/lib/competitive/keyword-gap";
import { NeedsData } from "@/components/seo/needs-data";
import { demoAllowed } from "@/lib/data-mode";
import { liveEnabled } from "@/lib/providers/source";
import { compareHref, keywordListHref } from "@/lib/competitive/links";
import { parseDomains, spList, spStr } from "@/lib/competitive/shared";
import { database } from "@/lib/domain";
import { compact, pct } from "@/lib/format";
import { KdBadge, KeywordLink } from "@/components/seo/badges";
import { DataSourceBadge, DemoNotice } from "@/components/seo/source-badge";
import { Grid, Page, PageHeader } from "@/components/shell/page";
import { series } from "@/components/charts/theme";
import { DomainsForm } from "@/components/competitive/domains-form";
import { KeywordGapTable } from "@/components/competitive/keyword-gap-table";
import { OverlapCircles } from "@/components/competitive/overlap-circles";
import { Badge, Swatch } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardBody, CardFooter, CardHeader } from "@/components/ui/card";
import { Callout, EmptyState } from "@/components/ui/feedback";
import { MiniTable } from "@/components/ui/mini-table";
import { PrintButton } from "@/components/ui/print-button";
import { Bar } from "@/components/ui/progress";

export const metadata: Metadata = { title: "Keyword Gap" };

const CRUMBS = [{ label: "Competitive research" }, { label: "Keyword Gap", href: "/keyword-gap" }];
const EXAMPLES = [
  ["nike.com", "adidas.com", "zara.com", "hm.com"],
  ["healthline.com", "webmd.com", "mayoclinic.org"],
  ["coursera.org", "udemy.com", "edx.org", "simplilearn.com"],
];
const TYPES = [
  { value: "organic", label: "Organic keywords" },
  { value: "paid", label: "Paid keywords" },
];

export default async function KeywordGapPage({ searchParams }: PageProps<"/keyword-gap">) {
  const user = await requirePageUser();
  const sp = await searchParams;
  const raw = spList(sp.d);
  const db = database(spStr(sp.db) || "US").code;
  const type: GapType = spStr(sp.type) === "paid" ? "paid" : "organic";
  const catParam = spStr(sp.cat) as KeywordGapCategory;
  const cat = KEYWORD_GAP_CATEGORIES.some((c) => c.id === catParam) ? catParam : "all";
  const { domains, invalid, truncated } = parseDomains(raw);

  const header = (subject?: string, meta?: ReactNode) => (
    <PageHeader breadcrumbs={CRUMBS} title={subject ? "Keyword Gap:" : "Keyword Gap"} subject={subject} description={subject ? undefined : "Compare the keyword profiles of up to 5 domains and find the keywords your competitors rank for but you don't."} meta={meta} actions={subject ? <PrintButton /> : undefined}>
      <DomainsForm key={domains.join(",")} initial={domains.length ? domains : raw} db={db} typeOptions={TYPES} type={type} />
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
            icon={<Swords className="h-5 w-5" />}
            title="Find the keywords your competitors win"
            description="Enter your domain first, then up to four competitors. Try an example:"
            action={
              <div className="flex flex-col items-center gap-2">
                {EXAMPLES.map((e) => (
                  <ButtonLink key={e.join()} href={compareHref("/keyword-gap", e, { db: "US" })} size="sm">
                    {e[0]} vs {e.slice(1).join(", ")}
                  </ButtonLink>
                ))}
              </div>
            }
          />
        </Card>
      </Page>
    );

  if (!liveEnabled() && !demoAllowed())
    return (
      <Page>
        {header(`${domains[0]} vs ${domains.length - 1} competitor${domains.length > 2 ? "s" : ""}`)}
        <NeedsData
         
          providers={["dataforseo"]}
          title="Keyword Gap needs DataForSEO"
          shows={[
            "Keywords every competitor ranks for but you don't (missing)",
            "Keywords where competitors outrank you (weak) and where you lead (strong)",
            "Untapped and unique keywords with volume, KD and CPC",
            "Keyword overlap between up to 5 domains, organic or paid",
          ]}
        >
          <p className="mt-3 text-[12.5px] text-text-2">Search Console only covers your own site, so it cannot show which keywords competitors rank for. For your own queries, see Organic Research.</p>
        </NeedsData>
      </Page>
    );

  const { data, source, fetchedAt } = await getKeywordGap(user.id, domains, db, type);
  const info = database(db);
  const you = domains[0];
  const rows = data.rows;
  const withCats = rows.map((r) => ({ r, cats: keywordGapCategories(r.positions) }));
  const missing = withCats.filter((x) => x.cats.includes("missing")).map((x) => x.r);
  const untapped = withCats.filter((x) => x.cats.includes("untapped") && !x.cats.includes("missing")).map((x) => x.r);
  const weak = withCats.filter((x) => x.cats.includes("weak")).map((x) => x.r);
  const bestComp = (r: GapKeyword) => {
    let best: { i: number; p: number } | null = null;
    for (let i = 1; i < r.positions.length; i++) {
      const p = r.positions[i];
      if (p != null && (best == null || p < best.p)) best = { i, p };
    }
    return best;
  };
  const base = compareHref("/keyword-gap", domains, { db, type });
  const catLink = (c: KeywordGapCategory) => `${base}&cat=${c}#details`;

  return (
    <Page>
      {header(
        `${you} vs ${domains.length - 1} competitor${domains.length > 2 ? "s" : ""}`,
        <>
          <DataSourceBadge source={source} fetchedAt={fetchedAt} />
          <Badge>
            {info.flag} {info.name}
          </Badge>
          <Badge tone="brand">{type === "organic" ? "Organic keywords" : "Paid keywords"}</Badge>
        </>,
      )}
      {invalid.length > 0 && <Callout tone="warning" className="mb-4">Ignored invalid entries: {invalid.join(", ")}.</Callout>}
      {truncated && <Callout tone="info" className="mb-4">Only the first 5 domains are compared.</Callout>}

      <Grid cols={2} className="mb-4 lg:grid-cols-[1fr_1.35fr]">
        <Card>
          <CardHeader title="Keyword overlap" info="Circle area is proportional to the number of keywords; the number in the middle is shared by all domains." />
          <CardBody>
            <OverlapCircles items={data.domains.map((d, i) => ({ label: d.domain, count: d.sampleKeywords, color: series(i) }))} overlap={data.overlap} sharedByAll={data.sharedByAll} sharedLabel={domains.length > 2 ? "shared by all" : "shared"} height={230} />
            <p className="mt-1 text-center text-[11.5px] text-text-3">Circles and overlap use the analyzed keywords of each domain.</p>
            <MiniTable
              className="mt-3"
              columns={[{ header: "Domain" }, { header: "Est. keywords", align: "right" }, { header: "Analyzed", align: "right" }, { header: "Shared with you", align: "right" }, { header: type === "organic" ? "Traffic" : "Paid traffic", align: "right" }]}
              rows={data.domains.map((d, i) => [
                <span key="d" className="inline-flex min-w-0 items-center gap-1.5">
                  <Swatch color={series(i)} shape="dot" />
                  <Link href={`/${type === "organic" ? "organic-research" : "advertising-research"}?q=${d.domain}&db=${db}`} className="truncate text-link hover:underline">
                    {d.domain}
                  </Link>
                  {i === 0 && <Badge tone="brand">You</Badge>}
                </span>,
                compact(d.totalKeywords),
                compact(d.sampleKeywords),
                i === 0 ? "–" : `${compact(data.overlap[0][i])} (${pct((data.overlap[0][i] / Math.max(1, d.sampleKeywords)) * 100, 0)})`,
                compact(d.traffic),
              ])}
            />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title={`Top opportunities for ${you}`} description="Highest-volume keywords to target next" />
          <CardBody className="grid gap-5 md:grid-cols-2">
            <Opportunity title="Missing" note="All competitors rank, you don't" rows={missing} db={db} domains={domains} bestComp={bestComp} href={catLink("missing")} count={data.counts.missing} />
            {domains.length > 2 ? (
              <Opportunity title="Untapped" note="Some competitors rank, you don't (excluding missing)" rows={untapped} db={db} domains={domains} bestComp={bestComp} href={catLink("untapped")} count={data.counts.untapped} />
            ) : (
              <Opportunity title="Weak" note="You rank lower than the competitor" rows={weak} db={db} domains={domains} bestComp={bestComp} href={catLink("weak")} count={data.counts.weak} />
            )}
          </CardBody>
          {weak.length > 0 && (
            <CardFooter className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-text-2">
                <span className="font-semibold text-text">{compact(data.counts.weak)}</span> weak keywords where every competitor outranks you
              </span>
              <span className="flex gap-3">
                <Link href={catLink("weak")} className="text-link hover:underline">
                  View weak →
                </Link>
                <Link href={keywordListHref(missing.slice(0, 100).map((r) => r.keyword), db)} className="text-link hover:underline">
                  Add top missing to a list →
                </Link>
              </span>
            </CardFooter>
          )}
        </Card>
      </Grid>

      <Card className="mb-4">
        <CardHeader title="Keyword profile by category" description="Number of keywords in each gap category" />
        <CardBody>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
            {KEYWORD_GAP_CATEGORIES.filter((c) => c.id !== "all").map((c) => (
              <Link key={c.id} href={catLink(c.id)} className="rounded-md border border-border p-3 hover:bg-surface-2" title={c.note}>
                <div className="text-[12.5px] text-text-2">{c.label}</div>
                <div className="mt-0.5 text-[20px] font-semibold tracking-tight">{compact(data.counts[c.id])}</div>
                <Bar value={data.counts[c.id]} max={data.counts.all || 1} className="mt-1.5" />
              </Link>
            ))}
          </div>
        </CardBody>
      </Card>

      <Card id="details">
        <CardHeader title={`All keyword details for ${you}`} description={`${compact(rows.length)} keywords across ${domains.length} domains · positions in ${info.name}`} />
        <KeywordGapTable rows={rows} domains={domains} db={db} counts={data.counts} initialCat={cat} type={type} />
      </Card>
      {source === "demo" && <DemoNotice className="mt-6" />}
    </Page>
  );
}

function Opportunity({
  title,
  note,
  rows,
  db,
  domains,
  bestComp,
  href,
  count,
}: {
  title: string;
  note: string;
  rows: GapKeyword[];
  db: string;
  domains: string[];
  bestComp: (r: GapKeyword) => { i: number; p: number } | null;
  href: string;
  count: number;
}) {
  return (
    <div className="min-w-0">
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <div className="text-[13px] font-semibold">
          {title} <span className="font-normal text-text-3">· {compact(count)}</span>
        </div>
        <Link href={href} className="text-[12px] text-link hover:underline">
          View all
        </Link>
      </div>
      <div className="mb-2 text-[12px] text-text-3">{note}</div>
      <MiniTable
        empty="No keywords in this category."
        columns={[{ header: "Keyword" }, { header: "Volume", align: "right" }, { header: "KD", align: "right" }, { header: <span title="Best competitor position">Comp.</span>, align: "right" }]}
        rows={rows.slice(0, 7).map((r) => {
          const b = bestComp(r);
          return [
            <KeywordLink key="k" keyword={r.keyword} db={db} className="block max-w-[140px] truncate" />,
            compact(r.volume),
            <KdBadge key="kd" kd={r.kd} />,
            b ? (
              <span key="b" className="inline-flex items-center justify-end gap-1" title={domains[b.i]}>
                <Swatch color={series(b.i)} shape="dot" />
                {b.p}
              </span>
            ) : (
              "–"
            ),
          ];
        })}
      />
    </div>
  );
}
