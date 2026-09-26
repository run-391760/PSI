import { ArrowRight } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import type { BlOverview, BlSummary } from "@/lib/backlinks/types";
import { ANCHOR_TYPE_LABELS } from "@/lib/backlinks/types";
import { compact, displayUrl, pct } from "@/lib/format";
import { BarChart } from "@/components/charts/bar-chart";
import { DonutChart } from "@/components/charts/donut-chart";
import { MONTH_RANGES, TrendChart } from "@/components/charts/trend-chart";
import { AsBadge, DomainLink } from "@/components/seo/badges";
import { Grid } from "@/components/shell/page";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardBody, CardFooter, CardHeader } from "@/components/ui/card";
import { MiniTable } from "@/components/ui/mini-table";
import { DistributionBar } from "@/components/ui/progress";
import { CountryLabel, ShareList, shortDate } from "@/components/backlinks/bits";
import { VelocityChart } from "@/components/backlinks/velocity-chart";

const tabHref = (domain: string, tab: string) => `/backlink-analytics?q=${encodeURIComponent(domain)}&tab=${tab}`;

function Empty({ children }: { children: ReactNode }) {
  return <p className="py-8 text-center text-[13px] text-text-3">{children}</p>;
}

export function OverviewSections({ s, o }: { s: BlSummary; o: BlOverview }) {
  const domain = s.domain;
  const anchorTotal = o.anchorTypes.reduce((a, t) => a + t.value, 0) || 1;
  const attrMax = Math.max(1, ...o.attributes.map((a) => a.value));
  return (
    <>
      <Grid cols={2} className="mb-4">
        <Card>
          <CardHeader title="Referring domains" description={`${compact(s.referringDomains)} domains now · monthly trend`} info="Unique root domains linking to the analyzed domain at the end of each month." />
          <CardBody>
            {o.history.length ? (
              <TrendChart data={o.history} xKey="month" series={[{ key: "referringDomains", label: "Referring domains" }]} ranges={MONTH_RANGES} defaultRange="2y" type="area" height={220} />
            ) : (
              <Empty>No history available.</Empty>
            )}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Backlinks" description={`${compact(s.backlinks)} backlinks now · monthly trend`} info="Total links pointing to the analyzed domain at the end of each month." />
          <CardBody>
            {o.history.length ? (
              <TrendChart data={o.history} xKey="month" series={[{ key: "backlinks", label: "Backlinks", color: "var(--series-7)" }]} ranges={MONTH_RANGES} defaultRange="2y" type="area" height={220} />
            ) : (
              <Empty>No history available.</Empty>
            )}
          </CardBody>
        </Card>
      </Grid>

      <Grid cols={2} className="mb-4 lg:grid-cols-[1.4fr_1fr]">
        <Card>
          <CardHeader title="New & lost" description="Links gained and lost per day" info="Daily new and lost referring domains or backlinks. Lost links are shown below the axis." />
          <CardBody>{o.velocity.length ? <VelocityChart data={o.velocity} /> : <Empty>No link velocity data.</Empty>}</CardBody>
        </Card>
        <Card>
          <CardHeader title="Authority Score of referring domains" description="How strong the linking domains are" info="Referring domains grouped by their Authority Score (0–100)." />
          <CardBody>
            <BarChart data={o.asBuckets} xKey="label" layout="bars" categoryWidth={52} valueLabels series={[{ key: "domains", label: "Referring domains" }]} height={290} />
          </CardBody>
        </Card>
      </Grid>

      <Grid cols={3} className="mb-4">
        <Card>
          <CardHeader title="Categories of referring domains" info="Topical category of the linking sites." href={tabHref(domain, "referring-domains")} />
          <CardBody>
            {o.categories.length ? <ShareList items={o.categories.map((c) => ({ ...c, key: c.label }))} format={compact} labelWidth="w-36" /> : <Empty>Categories are not available from the connected provider.</Empty>}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Referring domains by country" info="Country of the server hosting each referring domain." href={tabHref(domain, "referring-domains")} />
          <CardBody>
            {o.countries.length ? (
              <ShareList items={o.countries.map((c) => ({ key: c.code, label: c.label === "Other" ? "🌐 Other" : <CountryLabel code={c.code} />, value: c.value, share: c.share }))} format={compact} color="var(--series-3)" labelWidth="w-36" />
            ) : (
              <Empty>No country data.</Empty>
            )}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Top-level domains" info="Distribution of referring domains by top-level domain (TLD)." />
          <CardBody>
            {o.tlds.length ? <ShareList items={o.tlds.map((t) => ({ ...t, key: t.label }))} format={compact} color="var(--series-2)" labelWidth="w-20" /> : <Empty>No TLD data.</Empty>}
          </CardBody>
        </Card>
      </Grid>

      <Grid cols={2} className="mb-4 lg:grid-cols-[1.5fr_1fr]">
        <Card>
          <CardHeader title="Top anchors" description="Most used link texts" href={tabHref(domain, "anchors")} />
          <CardBody>
            <MiniTable
              empty="No anchors found."
              columns={[{ header: "Anchor" }, { header: "Type" }, { header: "Domains", align: "right" }, { header: "Backlinks", align: "right" }]}
              rows={o.anchors.slice(0, 10).map((a) => [
                <span key="a" className={a.anchor === "<EmptyAnchor>" ? "text-text-3 italic" : "block max-w-[300px] truncate"} title={a.anchor}>
                  {a.anchor}
                </span>,
                <span key="t" className="text-[12px] whitespace-nowrap text-text-3">
                  {ANCHOR_TYPE_LABELS[a.type]}
                </span>,
                compact(a.referringDomains),
                compact(a.backlinks),
              ])}
            />
          </CardBody>
          <CardFooter>
            <Link href={tabHref(domain, "anchors")} className="text-link hover:underline">
              View all anchors →
            </Link>
          </CardFooter>
        </Card>
        <Card>
          <CardHeader title="Link attributes & types" info="Follow links pass authority; nofollow, UGC (user-generated content) and sponsored links carry a rel attribute. UGC and sponsored links can also be nofollow." />
          <CardBody>
            {o.attributes.length ? (
              <ul className="space-y-2.5">
                {o.attributes.map((a, i) => (
                  <li key={a.label} className="grid grid-cols-[88px_1fr_64px_48px] items-center gap-2 text-[13px]">
                    <span className="text-text-2">{a.label}</span>
                    <span className="h-2 overflow-hidden rounded-full bg-surface-3">
                      <span className="block h-full rounded-full" style={{ width: `${(a.value / attrMax) * 100}%`, background: `var(--series-${i + 1})` }} />
                    </span>
                    <span className="tabular text-right font-medium">{compact(a.value)}</span>
                    <span className="tabular text-right text-[12px] text-text-3">{a.share.toFixed(1)}%</span>
                  </li>
                ))}
              </ul>
            ) : (
              <Empty>No attribute data.</Empty>
            )}
            <div className="mt-5 border-t border-border pt-4">
              <div className="mb-3 text-[12.5px] font-medium text-text-2">Link types</div>
              {o.linkTypes.length ? <DonutChart size={116} data={o.linkTypes.map((t) => ({ label: t.label, value: t.value }))} centerValue={pct(o.linkTypes[0]?.share ?? 0, 0)} centerLabel={o.linkTypes[0]?.label.toLowerCase()} /> : <Empty>No link type data.</Empty>}
            </div>
            {o.anchorTypes.length > 0 && (
              <div className="mt-5 border-t border-border pt-4">
                <div className="mb-2 text-[12.5px] font-medium text-text-2">Anchor types (by referring domains)</div>
                <DistributionBar segments={o.anchorTypes.map((t, i) => ({ label: t.label, value: t.value, color: `var(--series-${i + 1})` }))} format={(v) => pct((v / anchorTotal) * 100)} />
              </div>
            )}
          </CardBody>
        </Card>
      </Grid>

      <Grid cols={2} className="mb-4">
        <Card>
          <CardHeader title="Top indexed pages" description="Pages of this domain with the most referring domains" href={tabHref(domain, "indexed-pages")} />
          <CardBody>
            <MiniTable
              empty="No pages with backlinks."
              columns={[{ header: "Page" }, { header: "Domains", align: "right" }, { header: "Backlinks", align: "right" }]}
              rows={o.topPages.map((p) => [
                <a key="u" href={p.url} target="_blank" rel="noopener noreferrer" className="block max-w-[360px] truncate text-link hover:underline" title={p.url}>
                  {displayUrl(p.url)}
                </a>,
                compact(p.referringDomains),
                compact(p.backlinks),
              ])}
            />
          </CardBody>
          <CardFooter>
            <Link href={tabHref(domain, "indexed-pages")} className="text-link hover:underline">
              View all indexed pages →
            </Link>
          </CardFooter>
        </Card>
        <Card>
          <CardHeader
            title="Top referring domains"
            description="Strongest domains linking here"
            href={tabHref(domain, "referring-domains")}
            actions={
              <ButtonLink href={`/backlink-audit`} size="sm" variant="ghost">
                Audit links <ArrowRight className="h-3.5 w-3.5" />
              </ButtonLink>
            }
          />
          <CardBody>
            <MiniTable
              empty="No referring domains."
              columns={[{ header: "Domain" }, { header: "AS", align: "right" }, { header: "Backlinks", align: "right" }, { header: "Country" }, { header: "First seen", align: "right" }]}
              rows={o.topReferringDomains.map((r) => [
                <DomainLink key="d" domain={r.domain} className="max-w-[200px]" />,
                <AsBadge key="as" score={r.authorityScore} />,
                compact(r.backlinks),
                <CountryLabel key="c" code={r.country} short />,
                <span key="f" className="whitespace-nowrap text-text-2">
                  {shortDate(r.firstSeen)}
                </span>,
              ])}
            />
          </CardBody>
          <CardFooter>
            <Link href={tabHref(domain, "referring-domains")} className="text-link hover:underline">
              View all referring domains →
            </Link>
          </CardFooter>
        </Card>
      </Grid>
    </>
  );
}
