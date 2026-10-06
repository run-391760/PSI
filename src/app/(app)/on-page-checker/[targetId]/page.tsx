import { ArrowLeft, Check, ExternalLink, Minus, X } from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { requirePageUser } from "@/lib/auth";
import { IDEA_TYPES, benchDemand, isRealBenchmark, priorityScore } from "@/lib/content/ideas";
import { doneIdeas, latestRun, listTargets, resultFor } from "@/lib/content/onpage";
import { fleschLabel } from "@/lib/content/text";
import { database } from "@/lib/domain";
import { compact, dateTimeLabel, displayUrl, num } from "@/lib/format";
import { findProject } from "@/lib/projects";
import { IdeaList } from "@/components/content/onpage/idea-list";
import { RunButton } from "@/components/content/onpage/run-button";
import { OpenInOptimizerButton } from "@/components/optimizer/open-in-optimizer";
import { DomainLink, KeywordLink, SerpFeatureIcons } from "@/components/seo/badges";
import { DataSourceBadge } from "@/components/seo/source-badge";
import { Page, PageHeader } from "@/components/shell/page";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Callout, EmptyState } from "@/components/ui/feedback";
import { Metric, MetricStrip } from "@/components/ui/metric";
import { MiniTable } from "@/components/ui/mini-table";
import { Bar } from "@/components/ui/progress";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Page ideas · On Page SEO Checker" };

function YesNo({ value }: { value: boolean | null | undefined }) {
  if (value == null) return <span className="text-text-3">n/a</span>;
  return value ? (
    <span className="inline-flex items-center gap-1 text-good-ink">
      <Check className="h-3.5 w-3.5" /> Yes
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 text-critical-ink">
      <X className="h-3.5 w-3.5" /> No
    </span>
  );
}
function Verdict({ ok }: { ok: boolean | null }) {
  if (ok == null) return <Minus className="h-3.5 w-3.5 text-text-3" aria-label="Not measured" />;
  return ok ? <Check className="h-3.5 w-3.5 text-good-ink" aria-label="On par" /> : <X className="h-3.5 w-3.5 text-critical-ink" aria-label="Below rivals" />;
}

export default async function PageIdeas({ params, searchParams }: PageProps<"/on-page-checker/[targetId]">) {
  const user = await requirePageUser();
  const { targetId } = await params;
  const sp = await searchParams;
  const project = await findProject(user.id, typeof sp.project === "string" ? sp.project : null);
  if (!project) notFound();
  const [targets, run, done] = await Promise.all([listTargets(project.id), latestRun(project.id), doneIdeas(project.id)]);
  const target = targets.find((t) => t.id === targetId);
  if (!target) notFound();
  const base = `/on-page-checker?project=${project.id}`;
  const result = run ? await resultFor(run.id, targetId) : null;
  const db = database(project.country).code;

  const header = (
    <PageHeader
      breadcrumbs={[{ label: "On page & tech SEO" }, { label: "On Page SEO Checker", href: base }, { label: "Page ideas" }]}
      title="Ideas for"
      subject={<span className="break-all">{displayUrl(target.url)}</span>}
      meta={
        <>
          <Badge tone="brand">Keyword: {target.keyword}</Badge>
          {result?.page && <DataSourceBadge source="crawler" fetchedAt={run?.finished_at ?? undefined} note="page facts" />}
          {isRealBenchmark(result?.benchmark) && result.benchmark.serp && <DataSourceBadge source="dataforseo" note="live top 10" />}
          {isRealBenchmark(result?.benchmark) && result.benchmark.gsc && <DataSourceBadge source="search-console" note="last 28 days" />}
          <Badge>
            {database(db).flag} {database(db).name}
          </Badge>
        </>
      }
      actions={
        <>
          <ButtonLink href={`${base}&tab=ideas`} variant="ghost">
            <ArrowLeft className="h-4 w-4" /> All pages
          </ButtonLink>
          <ButtonLink href={target.url} target="_blank" rel="noopener noreferrer">
            <ExternalLink className="h-4 w-4" /> Open page
          </ButtonLink>
          <OpenInOptimizerButton keyword={target.keyword} url={target.url} db={db} />
        </>
      }
    />
  );

  if (!result || !isRealBenchmark(result.benchmark))
    return (
      <Page>
        {header}
        <Card>
          <EmptyState title="No ideas for this page yet" description="This page was added after the last check. Collect ideas to analyze it." action={<RunButton projectId={project.id} rerun={!!run} />} />
        </Card>
      </Page>
    );

  const b = result.benchmark;
  const serp = b.serp;
  const avg = serp?.avg ?? null;
  const gsc = b.gsc;
  const f = result.page;
  const kw = f?.kw ?? null;
  const doneSet = done.get(targetId) ?? new Set<string>();
  const open = result.ideas.filter((i) => !doneSet.has(i.id));
  const priority = priorityScore(b, open);
  const demand = benchDemand(b);
  const types = IDEA_TYPES.filter((t) => result.ideas.some((i) => i.type === t.id));
  const kwQuery = gsc?.queries.find((q) => q.query.toLowerCase() === target.keyword.toLowerCase()) ?? null;

  const compare: { label: string; you: ReactNode; rivals: ReactNode; ok: boolean | null }[] = avg
    ? [
        { label: "Words (main content)", you: f ? num(f.words) : "n/a", rivals: `${num(avg.words)} (${num(avg.wordsRange[0])}–${num(avg.wordsRange[1])})`, ok: f ? f.words >= avg.words * 0.8 : null },
        { label: "Keyword mentions", you: kw ? kw.mentions : "n/a", rivals: avg.mentions, ok: kw ? kw.mentions >= avg.mentions * 0.5 && kw.density <= 3 : null },
        { label: "Readability (Flesch)", you: f?.flesch != null ? Math.round(f.flesch) : "n/a", rivals: avg.readability ?? "n/a", ok: f?.flesch != null && avg.readability != null ? f.flesch >= avg.readability - 10 : null },
        { label: "H2 sections", you: f ? f.h2s.length : "n/a", rivals: avg.h2, ok: f ? f.h2s.length >= Math.max(2, avg.h2 - 2) : null },
        { label: "Images", you: f ? f.images : "n/a", rivals: avg.images, ok: f ? f.images >= avg.images * 0.4 || avg.images < 3 : null },
        { label: "Keyword in title", you: <YesNo value={kw?.inTitle} />, rivals: `${avg.titleKw}% of pages`, ok: kw ? kw.inTitle : null },
        { label: "Keyword in H1", you: <YesNo value={kw?.inH1} />, rivals: `${avg.h1Kw}% of pages`, ok: kw ? kw.inH1 : null },
        { label: "Keyword in meta description", you: <YesNo value={kw?.inMeta} />, rivals: `${avg.metaKw}% of pages`, ok: kw ? kw.inMeta : null },
        { label: "Video", you: <YesNo value={f?.hasVideo} />, rivals: `${avg.video}% of pages`, ok: f ? f.hasVideo || avg.video < 40 : null },
      ]
    : [];
  const semUsed = new Set(kw?.semanticUsed ?? []);

  return (
    <Page>
      {header}
      {!f && (
        <Callout tone="critical" className="mb-4" title={result.fetch_status ? `The page returned HTTP ${result.fetch_status}` : "The page could not be fetched"}>
          {result.fetch_error && !/^HTTP \d+$/.test(result.fetch_error) ? `${result.fetch_error.replace(/\.?$/, ".")} ` : ""}Content, technical and user-experience ideas need a reachable HTML page; Search Console and top-10 ideas are still shown.
        </Callout>
      )}
      <Card className="mb-4">
        <MetricStrip>
          <Metric label="Priority" value={priority} info="0–100: traffic you could gain by reaching the top 3, plus the weight of open high-priority ideas." sub={<Bar value={priority} className="mt-1 w-24" color={priority >= 70 ? "var(--critical)" : priority >= 45 ? "var(--serious)" : priority >= 25 ? "var(--warning)" : "var(--good)"} />} />
          <Metric label="Open ideas" value={open.length} sub={`${open.filter((i) => i.priority === "high").length} high priority · ${result.ideas.length - open.length} done`} />
          <Metric label="Impressions (28d)" value={demand.impressions == null ? "n/a" : compact(demand.impressions)} sub={gsc ? (kwQuery ? `${compact(kwQuery.impressions)} for “${target.keyword}”` : `None for “${target.keyword}”`) : "Link Search Console"} info="Search Console impressions of this page in the last 28 days." />
          <Metric
            label={gsc ? "Avg. position (page)" : "Your position"}
            value={gsc ? (gsc.page ? gsc.page.position : "n/a") : serp ? (serp.position ? `#${serp.position}` : `>${serp.depth}`) : "n/a"}
            sub={gsc ? (kwQuery ? `#${kwQuery.position} for the keyword` : "Keyword not in its queries") : serp?.rankingUrl ? <span className="block max-w-56 truncate" title={serp.rankingUrl}>{displayUrl(serp.rankingUrl)}</span> : serp ? "Not in the live results" : "Needs Search Console or DataForSEO"}
          />
          <Metric label="Readability" value={f?.flesch != null ? Math.round(f.flesch) : "n/a"} sub={f?.flesch != null ? `${fleschLabel(f.flesch).label}${avg?.readability != null ? ` · top pages ${avg.readability}` : ""}` : "Page not fetched"} />
        </MetricStrip>
      </Card>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1.55fr_1fr]">
        <div className="min-w-0">
          <IdeaList ideas={result.ideas} done={[...doneSet]} projectId={project.id} targetId={targetId} types={types} />
        </div>
        <div className="min-w-0 space-y-4">
          {avg && (
            <Card>
              <CardHeader title="Your page vs the top 10" info={`Your values are measured from the live page. Averages come from the ${avg.crawled} top-10 pages we could crawl for this keyword.`} />
              <CardBody>
                <MiniTable
                  columns={[{ header: "" }, { header: "Your page", align: "right" }, { header: "Top-10 avg.", align: "right" }, { header: "", align: "center", className: "w-6" }]}
                  rows={compare.map((c) => [
                    <span key="l" className="text-text-2">
                      {c.label}
                    </span>,
                    <span key="y" className="font-medium text-text">
                      {c.you}
                    </span>,
                    <span key="r" className="text-text-2">
                      {c.rivals}
                    </span>,
                    <Verdict key="v" ok={c.ok} />,
                  ])}
                />
              </CardBody>
            </Card>
          )}

          {gsc && (
            <Card>
              <CardHeader title="Search Console queries for this page" description={`${gsc.start} – ${gsc.end}${gsc.page ? ` · ${compact(gsc.page.clicks)} clicks · CTR ${(gsc.page.ctr * 100).toFixed(1)}%` : ""}`} />
              <CardBody>
                <MiniTable
                  empty="Search Console has no queries for this URL in the last 28 days."
                  columns={[{ header: "Query" }, { header: "Clicks", align: "right" }, { header: "Impr.", align: "right" }, { header: "Pos.", align: "right" }]}
                  rows={gsc.queries.slice(0, 10).map((q) => [
                    <span key="q" className="block max-w-[220px] truncate" title={q.query}>
                      {q.query}
                    </span>,
                    compact(q.clicks),
                    compact(q.impressions),
                    q.position,
                  ])}
                />
              </CardBody>
            </Card>
          )}

          {serp && serp.semantic.length > 0 && (
            <Card>
              <CardHeader title="Words the top pages use" description={kw ? `${semUsed.size} of ${serp.semantic.length} used on your page` : "Usage not checked (page not fetched)"} info="Words and phrases used by several of the crawled top-10 pages. Usage on your page is checked in the live text." />
              <CardBody>
                <ul className="flex flex-wrap gap-1.5">
                  {serp.semantic.map((s) => {
                    const used = semUsed.has(s.term);
                    return (
                      <li key={s.term} className={cn("inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[12.5px]", used ? "border-good/40 bg-good-soft text-good-ink" : "border-border bg-surface-2 text-text-2")} title={`Used by ${s.rivals} of ${s.of} crawled pages`}>
                        {used && <Check className="h-3 w-3" />}
                        {s.term}
                        <span className="text-[11px] opacity-70">
                          {s.rivals}/{s.of}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </CardBody>
            </Card>
          )}

          {f && (
            <Card>
              <CardHeader title="Page snapshot" description={`Fetched ${run?.finished_at ? dateTimeLabel(run.finished_at) : ""}`} />
              <CardBody className="space-y-2.5 text-[13px]">
                {[
                  ["Title", f.title || "—", f.title ? `${f.title.length} chars` : null],
                  ["Meta description", f.metaDescription || "—", f.metaDescription ? `${f.metaDescription.length} chars` : null],
                  ["H1", f.h1s.join(" · ") || "—", f.h1s.length > 1 ? `${f.h1s.length} H1s` : null],
                  ["Canonical", f.canonical ? displayUrl(f.canonical) : "—", null],
                  ["Structured data", f.schemaTypes.join(", ") || "None", null],
                  ["Links", `${f.internalLinks} internal · ${f.externalLinks} external`, null],
                ].map(([label, value, note]) => (
                  <div key={label as string} className="grid grid-cols-[112px_1fr] gap-2">
                    <span className="text-text-3">{label}</span>
                    <span className="min-w-0 break-words text-text">
                      {value}
                      {note && <span className="ml-1.5 text-[11.5px] text-text-3">({note})</span>}
                    </span>
                  </div>
                ))}
              </CardBody>
            </Card>
          )}

          {serp && (
            <Card>
              <CardHeader title="Top 10 for this keyword" description={serp.features.length ? <span className="inline-flex items-center gap-2">SERP features <SerpFeatureIcons features={serp.features} /></span> : "Live Google results"} href={`/keyword-overview?q=${encodeURIComponent(target.keyword)}&db=${db}`} />
              <CardBody>
                <MiniTable
                  columns={[{ header: "#" }, { header: "Page" }, { header: "Words", align: "right" }, { header: "Flesch", align: "right" }]}
                  rows={serp.rivals.map((r) => [
                    r.position,
                    <div key="d" className="max-w-[210px] min-w-0">
                      <DomainLink domain={r.domain} db={db} />
                      <a href={r.url} target="_blank" rel="noopener noreferrer" className="block truncate text-[11.5px] text-text-3 hover:underline" title={r.title}>
                        {r.title}
                      </a>
                    </div>,
                    r.words == null ? <span key="w" className="text-text-3" title="Could not be crawled">n/a</span> : num(r.words),
                    r.readability ?? <span key="r" className="text-text-3">n/a</span>,
                  ])}
                />
              </CardBody>
            </Card>
          )}
          {b.serpError && <Callout tone="warning">Top-10 benchmark failed: {b.serpError}</Callout>}
          {b.gscError && <Callout tone="warning">Search Console data failed: {b.gscError}</Callout>}
          <div className="text-[12.5px] text-text-3">
            Research this keyword further in <KeywordLink keyword={target.keyword} db={db} />.
          </div>
        </div>
      </div>
    </Page>
  );
}
