import { ArrowRight, Layers, ListChecks, Search } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { requirePageUser } from "@/lib/auth";
import { database } from "@/lib/domain";
import { compact, money, pct } from "@/lib/format";
import { getBulkOverview, getKeywordOverview, type IdeaBlock } from "@/lib/keywords/overview";
import { normalizeKw, parseKeywordInput } from "@/lib/keywords/text";
import { listProjects } from "@/lib/projects";
import { SERP_FEATURES } from "@/lib/seo/types";
import { INTENTS } from "@/lib/seo/types";
import { FeatureIcon, INTENT_META, IntentBadges, KD_BANDS, KdBadge, KeywordLink, kdBand } from "@/components/seo/badges";
import { DataSourceBadge, DemoNotice } from "@/components/seo/source-badge";
import { ToolSearch } from "@/components/seo/tool-search";
import { Grid, Page, PageHeader } from "@/components/shell/page";
import { BarChart } from "@/components/charts/bar-chart";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardBody, CardFooter, CardHeader } from "@/components/ui/card";
import { Callout, EmptyState } from "@/components/ui/feedback";
import { Metric, MetricStrip } from "@/components/ui/metric";
import { MiniTable } from "@/components/ui/mini-table";
import { PrintButton } from "@/components/ui/print-button";
import { Bar, DistributionBar, Gauge } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import { AddToListButton } from "@/components/keywords/add-to-list";
import { KeywordMetricsTable } from "@/components/keywords/bulk-table";
import { SerpTable } from "@/components/keywords/serp-table";
import { SourceBadges } from "@/components/keywords/source-badges";

export const metadata: Metadata = { title: "Keyword Overview" };

const EXAMPLES = ["running shoes", "best crm software", "how to lose weight", "mba colleges in india", "home loan"];
const BREADCRUMBS = [{ label: "Keyword research" }, { label: "Keyword Overview", href: "/keyword-overview" }];
const MAX_BULK = 100;

export default async function KeywordOverviewPage({ searchParams }: PageProps<"/keyword-overview">) {
  const user = await requirePageUser();
  const sp = await searchParams;
  const raw = typeof sp.q === "string" ? sp.q : "";
  const db = database(typeof sp.db === "string" ? sp.db : "US").code;
  const parsed = parseKeywordInput(raw, MAX_BULK);
  const keywords = parsed.keywords.filter((k) => /[\p{L}\p{N}]/u.test(k));
  const overflow = parsed.overflow;
  const tooLong = raw.split(/[\n,;\t]+/).some((k) => k.trim().length > 255);

  if (!keywords.length)
    return (
      <Page>
        <PageHeader breadcrumbs={BREADCRUMBS} title="Keyword Overview" description="Everything about a keyword in one report: search volume by country, difficulty, intent, CPC, trend, SERP features, the ranking pages and keyword ideas.">
          <ToolSearch placeholder="Enter a keyword, e.g. running shoes" defaultValue={raw} />
        </PageHeader>
        {raw.trim() && <Callout tone="warning" className="mb-4">{tooLong ? "Keywords can be at most 255 characters." : "Enter a keyword with at least one letter or number."}</Callout>}
        <Grid cols={2} className="lg:grid-cols-[1.4fr_1fr]">
          <Card>
            <EmptyState
              icon={<Search className="h-5 w-5" />}
              title="Analyze any keyword"
              description="Get volume, keyword difficulty, intent, CPC, trend and the full SERP. Try one of these:"
              action={
                <div className="flex flex-wrap justify-center gap-2">
                  {EXAMPLES.map((e) => (
                    <ButtonLink key={e} href={`/keyword-overview?q=${encodeURIComponent(e)}&db=${db}`} size="sm">
                      {e}
                    </ButtonLink>
                  ))}
                </div>
              }
            />
          </Card>
          <Card>
            <CardHeader title="Bulk analysis" description={`Paste up to ${MAX_BULK} keywords, one per line or comma separated.`} info="Bulk mode shows volume, KD, intent, CPC and trend for every keyword in one table with CSV export." />
            <CardBody>
              <ToolSearch multi placeholder={"running shoes\ntrail running shoes\nbest running shoes for women"} buttonLabel="Analyze" defaultValue="" />
            </CardBody>
          </Card>
        </Grid>
      </Page>
    );

  if (keywords.length > 1) return <BulkView userId={user.id} keywords={keywords} overflow={overflow} db={db} />;

  const keyword = normalizeKw(keywords[0]);
  const projects = await listProjects(user.id);
  const projectDomains = projects.map((p) => p.domain);
  const o = await getKeywordOverview(user.id, keyword, db, projectDomains);
  const m = o.metrics;
  const info = database(db);
  const band = m.kd == null ? null : kdBand(m.kd);
  const magic = (extra = "") => `/keyword-magic-tool?q=${encodeURIComponent(keyword)}&db=${db}${extra}`;
  const trendData = o.months.map((month, i) => ({ month, volume: m.trend[i] ?? null }));
  const countryMax = o.countries[0]?.volume || 1;
  const projectHits = o.serp.filter((r) => r.isProject);
  const presentFeatures = SERP_FEATURES.filter((f) => m.features.includes(f.id) && f.id !== "related_searches");

  return (
    <Page>
      <PageHeader
        breadcrumbs={BREADCRUMBS}
        title="Keyword Overview:"
        subject={keyword}
        meta={
          <>
            <SourceBadges source={o.source} fetchedAt={o.fetchedAt} autocomplete={o.autocomplete} />
            <Badge>
              {info.flag} {info.name}
            </Badge>
            {o.topicName && <Badge tone="brand">{o.topicName}</Badge>}
          </>
        }
        actions={
          <>
            <AddToListButton keywords={[keyword]} db={db} defaultName={keyword} from="keyword-overview" />
            <ButtonLink href={magic()} variant="secondary">
              Keyword Magic Tool
            </ButtonLink>
            <PrintButton />
          </>
        }
      >
        <ToolSearch placeholder="Enter a keyword (or several, comma separated, for bulk analysis)" />
      </PageHeader>

      {projectHits.length > 0 && (
        <Callout tone="good" className="mb-4" title="Your project ranks for this keyword">
          {projectHits.map((h) => `${h.domain} is #${h.position}`).join(" · ")} in {info.name}. Track it daily in{" "}
          <Link href={`/position-tracking?import=${encodeURIComponent(keyword)}`} className="text-link hover:underline">
            Position Tracking
          </Link>
          .
        </Callout>
      )}

      <Grid cols={3} className="mb-4 lg:grid-cols-[1fr_1fr_1.45fr]">
        <Card>
          <CardBody className="pt-4">
            <Metric label={<span className="inline-flex items-center gap-1">Volume {info.flag}</span>} value={m.volume == null ? "n/a" : m.volume.toLocaleString()} size="lg" info={`Average monthly searches in ${info.name} over the last 12 months.`} />
            <div className="mt-4 border-t border-border pt-3">
              <div className="mb-1 flex items-center gap-1 text-[12.5px] text-text-2">
                Keyword Difficulty
              </div>
              {band && m.kd != null ? (
                <div className="flex items-center gap-4">
                  <Gauge value={m.kd} color={band.color} size={116} label={`${m.kd}%`} />
                  <div className="min-w-0">
                    <div className="text-[15px] font-semibold text-text">{band.label}</div>
                    <p className="mt-0.5 text-[12.5px] leading-snug text-text-2">{band.note}</p>
                    {o.rdNeeded != null && (
                      <p className="mt-1.5 text-[12px] text-text-3">
                        Top-10 pages have a median of <span className="font-medium text-text-2">{compact(o.rdNeeded)} referring domains</span>.
                      </p>
                    )}
                  </div>
                </div>
              ) : (
                <p className="py-4 text-[13px] text-text-3">Difficulty is not available for this keyword.</p>
              )}
              <div className="mt-3 flex h-1.5 overflow-hidden rounded-full" aria-hidden>
                {KD_BANDS.map((b, i) => (
                  <div key={b.label} style={{ width: `${b.max - (i ? KD_BANDS[i - 1].max : -1)}%`, background: b.color, opacity: band?.label === b.label ? 1 : 0.28 }} />
                ))}
              </div>
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardBody className="pt-4">
            <Metric label="Global volume" value={o.globalVolume == null ? "n/a" : compact(o.globalVolume)} size="lg" info="Sum of average monthly searches across all regional databases." />
            {o.countries.length ? (
              <ul className="mt-4 space-y-2 border-t border-border pt-3">
                {o.countries.slice(0, 7).map((c) => (
                  <li key={c.db} className="grid grid-cols-[92px_1fr_56px] items-center gap-2 text-[12.5px]">
                    <Link href={`/keyword-overview?q=${encodeURIComponent(keyword)}&db=${c.db}`} className={cn("truncate", c.db === db ? "font-semibold text-text" : "text-link hover:underline")} title={c.name}>
                      {c.flag} {c.db}
                    </Link>
                    <Bar value={c.volume} max={countryMax} />
                    <span className="tabular text-right text-text">{compact(c.volume)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-4 border-t border-border pt-3 text-[13px] text-text-3">Country split is not available from the connected provider.</p>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardBody className="pt-4">
            <div className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
              <div className="col-span-2">
                <div className="text-[12.5px] text-text-2">Intent</div>
                <div className="mt-1.5">{m.intents.length ? <IntentBadges intents={m.intents} full /> : <span className="text-text-3">n/a</span>}</div>
                {m.intents[0] && <p className="mt-1 text-[11.5px] leading-snug text-text-3">{INTENT_META[m.intents[0]].note}</p>}
              </div>
              <Metric label="CPC" value={money(m.cpc)} size="sm" info="Average cost per click advertisers paid (USD)." />
              <Metric label="Com." value={m.competition == null ? "n/a" : m.competition.toFixed(2)} size="sm" info="Competitive density of advertisers, 0–1." />
            </div>
            <div className="mt-3 border-t border-border pt-3">
              <div className="mb-1 flex items-center justify-between text-[12.5px] text-text-2">
                <span>Trend · last 12 months</span>
                <span className="text-text-3">Results: {compact(m.results)}</span>
              </div>
              {m.trend.length ? <BarChart data={trendData} xKey="month" xFormat="monthShort" series={[{ key: "volume", label: "Searches" }]} height={150} /> : <p className="py-8 text-center text-[13px] text-text-3">No trend data.</p>}
            </div>
          </CardBody>
        </Card>
      </Grid>

      <Grid cols={3} className="mb-4">
        <IdeasCard title="Keyword variations" block={o.variations} db={db} href={magic()} showKd />
        <IdeasCard title="Questions" block={o.questions} db={db} href={magic("&questions=1")} showKd />
        <IdeasCard title="Related keywords" block={o.related} db={db} href={magic("&match=related")} related />
      </Grid>

      <Grid cols={2} className="mb-4 lg:grid-cols-[1.5fr_1fr]">
        <Card>
          <CardHeader
            title="Keyword strategy"
            description="Topics and pages built by grouping the variations whose Google results overlap"
            info="Keywords whose top-10 results share at least 3 URLs can be targeted by the same page."
            actions={
              o.strategy ? (
                <ButtonLink size="sm" variant="primary" href={`/keyword-strategy?import=${encodeURIComponent(o.strategy.importKeywords.join(","))}&db=${db}&name=${encodeURIComponent(keyword)}`}>
                  <Layers className="h-3.5 w-3.5" /> Build strategy
                </ButtonLink>
              ) : undefined
            }
          />
          <CardBody>
            {o.strategy ? (
              <div className="grid gap-3 sm:grid-cols-[1fr_1.2fr]">
                <div className="rounded-lg border border-brand/30 bg-brand-soft/40 p-3">
                  <div className="text-[11.5px] font-semibold tracking-wide text-brand-ink uppercase">Pillar page</div>
                  <div className="mt-1 text-[15px] font-semibold text-text">{o.strategy.pillar}</div>
                  <div className="mt-1 text-[12.5px] text-text-2">
                    {o.strategy.pillarKeywords} keyword{o.strategy.pillarKeywords === 1 ? "" : "s"} · {compact(o.strategy.pillarVolume)} volume
                  </div>
                </div>
                <div>
                  <div className="mb-1.5 text-[11.5px] font-semibold tracking-wide text-text-3 uppercase">Subpages</div>
                  {o.strategy.subpages.length ? (
                    <ul className="space-y-1.5">
                      {o.strategy.subpages.map((s) => (
                        <li key={s.name} className="flex items-center gap-2 text-[13px]">
                          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-text-3" aria-hidden />
                          <KeywordLink keyword={s.name} db={db} className="min-w-0 flex-1 truncate" />
                          <span className="shrink-0 text-[12px] text-text-3">
                            {s.keywords} kw · {compact(s.volume)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-[12.5px] text-text-3">All top variations can be covered by the pillar page.</p>
                  )}
                </div>
              </div>
            ) : (
              <p className="py-6 text-center text-[13px] text-text-3">Not enough keyword variations to suggest a topic structure.</p>
            )}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="SERP features" description={`${presentFeatures.length} of ${SERP_FEATURES.length - 1} features on the results page`} />
          <CardBody>
            <ul className="grid grid-cols-2 gap-x-3 gap-y-1.5">
              {SERP_FEATURES.filter((f) => f.id !== "related_searches").map((f) => {
                const on = m.features.includes(f.id);
                return (
                  <li key={f.id} className={cn("flex items-center gap-2 text-[12.5px]", on ? "text-text" : "text-text-3 opacity-60")}>
                    <span className={cn("inline-flex h-5 w-5 items-center justify-center rounded", on ? "bg-brand-soft text-brand-ink" : "")}>
                      <FeatureIcon feature={f.id} />
                    </span>
                    <span className="truncate">{f.label}</span>
                  </li>
                );
              })}
            </ul>
          </CardBody>
        </Card>
      </Grid>

      <Card className="mb-4">
        <CardHeader
          title="SERP analysis"
          description={`Google top ${o.serp.length} for “${keyword}” in ${info.name}${projectDomains.length ? " · your project domains are included in the ranking" : ""}`}
          actions={
            <ButtonLink size="sm" variant="ghost" href={`/seo-content-template?q=${encodeURIComponent(keyword)}&db=${db}`}>
              Content brief <ArrowRight className="h-3.5 w-3.5" />
            </ButtonLink>
          }
        />
        {o.serp.length ? <SerpTable rows={o.serp} keyword={keyword} db={db} /> : <p className="px-4 pb-6 text-center text-[13px] text-text-3">SERP data is not available right now.</p>}
      </Card>

      {o.ads.length > 0 && (
        <Card className="mb-4">
          <CardHeader title="Ads copies" description={`Competition ${m.competition?.toFixed(2) ?? "n/a"} · advertisers bid on this keyword`} info="Sample text ads shown for this keyword (demo data)." />
          <CardBody>
            <Grid cols={3}>
              {o.ads.map((a) => (
                <div key={a.domain} className="rounded-md border border-border p-3">
                  <div className="text-[11.5px] text-text-3">
                    <span className="mr-1.5 font-semibold text-text">Sponsored</span>
                    {a.displayUrl}
                  </div>
                  <div className="mt-0.5 text-[14px] leading-snug text-link">{a.title}</div>
                  <div className="mt-0.5 text-[12.5px] text-text-2">{a.description}</div>
                </div>
              ))}
            </Grid>
          </CardBody>
        </Card>
      )}
      {o.source === "demo" && <DemoNotice className="mt-6" />}
    </Page>
  );
}

function IdeasCard({ title, block, db, href, showKd, related }: { title: string; block: IdeaBlock; db: string; href: string; showKd?: boolean; related?: boolean }) {
  return (
    <Card className="flex flex-col">
      <CardHeader title={title} href={href} />
      <CardBody className="flex-1">
        <div className="mb-2 flex items-baseline gap-4">
          <div>
            <div className="text-[20px] font-semibold text-text">{compact(block.total)}</div>
            <div className="text-[11.5px] text-text-3">keywords</div>
          </div>
          <div>
            <div className="text-[20px] font-semibold text-text">{compact(block.volume)}</div>
            <div className="text-[11.5px] text-text-3">total volume</div>
          </div>
        </div>
        <MiniTable
          empty="No keywords found."
          columns={[{ header: "Keyword" }, ...(related ? [{ header: "Related", align: "right" as const }] : []), { header: "Volume", align: "right" as const }, ...(showKd ? [{ header: "KD %", align: "right" as const }] : [])]}
          rows={block.top.map((r) => [
            <KeywordLink key="k" keyword={r.keyword} db={db} className="line-clamp-1 break-all" />,
            ...(related ? [<span key="r">{r.rel != null ? `${r.rel}%` : "n/a"}</span>] : []),
            r.volume == null ? "n/a" : compact(r.volume),
            ...(showKd ? [<KdBadge key="kd" kd={r.kd} />] : []),
          ])}
        />
      </CardBody>
      <CardFooter>
        <Link href={href} className="text-link hover:underline">
          View all {block.total.toLocaleString()} keywords →
        </Link>
      </CardFooter>
    </Card>
  );
}

async function BulkView({ userId, keywords, overflow, db }: { userId: string; keywords: string[]; overflow: number; db: string }) {
  const res = await getBulkOverview(userId, keywords, db);
  const rows = res.data.map((r) => ({ ...r, globalVolume: res.global?.[r.keyword] ?? null }));
  const info = database(db);
  const vol = rows.reduce((s, r) => s + (r.volume ?? 0), 0);
  const kds = rows.filter((r) => r.kd != null);
  const cpcs = rows.filter((r) => r.cpc != null);
  const avgKd = kds.length ? Math.round(kds.reduce((s, r) => s + (r.kd ?? 0), 0) / kds.length) : null;
  const bands = KD_BANDS.map((b, i) => ({ label: b.label, keywords: kds.filter((r) => (r.kd as number) <= b.max && (r.kd as number) > (i ? KD_BANDS[i - 1].max : -1)).length }));
  const intents = INTENTS.map((i, idx) => ({ label: INTENT_META[i].label, value: rows.filter((r) => r.intents[0] === i).length, color: `var(--series-${idx + 1})` }));
  return (
    <Page>
      <PageHeader
        breadcrumbs={BREADCRUMBS}
        title="Keyword Overview:"
        subject={`${keywords.length} keywords`}
        meta={
          <>
            <DataSourceBadge source={res.source} fetchedAt={res.fetchedAt} />
            <Badge>
              {info.flag} {info.name}
            </Badge>
            <Badge tone="brand">Bulk analysis</Badge>
          </>
        }
        actions={
          <>
            <AddToListButton keywords={keywords} db={db} defaultName="Bulk analysis" from="keyword-overview" label="Add all to list" />
            <ButtonLink href={`/position-tracking?import=${encodeURIComponent(keywords.join(","))}`} variant="secondary">
              <ListChecks className="h-4 w-4" /> Track positions
            </ButtonLink>
          </>
        }
      >
        <ToolSearch multi defaultValue={keywords.join("\n")} placeholder="One keyword per line" buttonLabel="Analyze" />
      </PageHeader>
      {overflow > 0 && (
        <Callout tone="warning" className="mb-4">
          Bulk analysis handles up to {MAX_BULK} keywords at a time; the last {overflow.toLocaleString()} were skipped.
        </Callout>
      )}
      <Card className="mb-4">
        <MetricStrip>
          <Metric label="Keywords" value={rows.length.toLocaleString()} />
          <Metric label="Total volume" value={compact(vol)} sub={`${info.flag} ${info.name}`} />
          <Metric label="Average KD" value={avgKd == null ? "n/a" : `${avgKd}%`} sub={avgKd == null ? undefined : kdBand(avgKd).label} />
          <Metric label="Average CPC" value={cpcs.length ? money(cpcs.reduce((s, r) => s + (r.cpc ?? 0), 0) / cpcs.length) : "n/a"} />
          <Metric label="Question keywords" value={rows.filter((r) => /^(what|how|why|when|where|which|who|is|are|can|does|do|should)\b/.test(r.keyword)).length} sub={pct((rows.filter((r) => /^(what|how|why|when|where|which|who|is|are|can|does|do|should)\b/.test(r.keyword)).length / Math.max(1, rows.length)) * 100, 0)} />
        </MetricStrip>
      </Card>
      <Grid cols={2} className="mb-4">
        <Card>
          <CardHeader title="Keyword difficulty distribution" description="Keywords per difficulty band" />
          <CardBody>
            <BarChart data={bands} xKey="label" series={[{ key: "keywords", label: "Keywords" }]} valueLabels height={200} />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Search intent" description="Primary intent of each keyword" />
          <CardBody>
            <DistributionBar segments={intents} format={(v, s) => `${v} · ${s.toFixed(0)}%`} />
          </CardBody>
        </Card>
      </Grid>
      <Card>
        <CardHeader title="Keywords" description="Select keywords to add them to a list, or export everything as CSV." />
        <KeywordMetricsTable rows={rows} db={db} exportName={`keyword-overview-bulk_${db}`} listName="Bulk analysis" showGlobal={res.global != null} />
      </Card>
      {res.source === "demo" && <DemoNotice className="mt-6" />}
    </Page>
  );
}
