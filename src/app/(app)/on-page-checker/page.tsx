import { ArrowRight, FileSearch2, Lightbulb, ListChecks, Radio } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { requirePageUser } from "@/lib/auth";
import { IDEA_LABELS, IDEA_TYPES, benchDemand, priorityScore, type IdeaType } from "@/lib/content/ideas";
import { MAX_TARGETS, activeJob, doneIdeas, latestRun, latestRunsByProject, listTargets, openIdeas, recentRuns, runResults, type Suggestion } from "@/lib/content/onpage";
import { gscPairs } from "@/lib/content/real";
import { getProjectGoogle } from "@/lib/google/data";
import { googleConfigured } from "@/lib/google/oauth";
import { liveEnabled } from "@/lib/providers/source";
import { NeedsData } from "@/components/seo/needs-data";
import type { GscSuggestions } from "@/components/content/onpage/targets-manager";
import { database } from "@/lib/domain";
import { compact, dateTimeLabel, displayUrl, timeAgo } from "@/lib/format";
import { findProject, listProjects } from "@/lib/projects";
import { BarChart } from "@/components/charts/bar-chart";
import { TrendChart } from "@/components/charts/trend-chart";
import { JobProgress } from "@/components/content/job-progress";
import { IdeasTable, type IdeaRow } from "@/components/content/onpage/ideas-table";
import { RunButton } from "@/components/content/onpage/run-button";
import { WeeklyToggle } from "@/components/content/onpage/weekly-toggle";
import { getSchedule } from "@/lib/jobs/queue";
import { TargetsManager } from "@/components/content/onpage/targets-manager";
import { ProjectGate } from "@/components/projects/project-gate";
import { ProjectSwitcher } from "@/components/projects/project-switcher";
import { DataSourceBadge } from "@/components/seo/source-badge";
import { Grid, Page, PageHeader } from "@/components/shell/page";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardFooter, CardHeader } from "@/components/ui/card";
import { Callout, EmptyState } from "@/components/ui/feedback";
import { Metric, MetricStrip } from "@/components/ui/metric";
import { MiniTable } from "@/components/ui/mini-table";
import { Bar, DistributionBar } from "@/components/ui/progress";
import { TabsNav } from "@/components/ui/tabs";

export const metadata: Metadata = { title: "On Page SEO Checker" };

const BREADCRUMBS = [{ label: "On page & tech SEO" }, { label: "On Page SEO Checker", href: "/on-page-checker" }];
const DESCRIPTION = "Page-level optimization ideas: each page is fetched live, checked against its target keyword and compared with the real top 10 and your Search Console data when connected.";

function priorityColor(score: number) {
  return score >= 70 ? "var(--critical)" : score >= 45 ? "var(--serious)" : score >= 25 ? "var(--warning)" : "var(--good)";
}

export default async function OnPageCheckerPage({ searchParams }: PageProps<"/on-page-checker">) {
  const user = await requirePageUser();
  const sp = await searchParams;
  const projects = await listProjects(user.id);
  const project = await findProject(user.id, typeof sp.project === "string" ? sp.project : null);

  if (!project) {
    const runs = await latestRunsByProject(user.id);
    return (
      <Page>
        <PageHeader breadcrumbs={BREADCRUMBS} title="On Page SEO Checker" description={DESCRIPTION} />
        <ProjectGate
          projects={projects}
          basePath="/on-page-checker"
          title="On Page SEO Checker"
          description="Pick the site whose pages you want to optimize."
          status={Object.fromEntries(
            [...runs.entries()].map(([id, r]) => [
              id,
              <span key={id}>
                <span className="font-medium text-text">{r.ideas}</span> ideas · {r.pages} pages · {timeAgo(r.finished_at)}
              </span>,
            ]),
          )}
        />
        <Grid cols={3} className="mt-4">
          {[
            { icon: <ListChecks className="h-4 w-4" />, title: "1. Choose pages and keywords", text: "Discover pages on your live site, pick them from Search Console, or import a CSV of URL + keyword pairs." },
            { icon: <Radio className="h-4 w-4" />, title: "2. We fetch and benchmark", text: "Each page is fetched for real (robots.txt respected), compared with the crawled Google top 10 (DataForSEO) and your Search Console queries." },
            { icon: <Lightbulb className="h-4 w-4" />, title: "3. Act on prioritized ideas", text: "Strategy, SERP features, semantic, content, technical and UX ideas, ranked by real impressions and position." },
          ].map((s) => (
            <Card key={s.title}>
              <CardBody className="pt-4">
                <div className="mb-2 flex h-8 w-8 items-center justify-center rounded-md bg-brand-soft text-brand-ink">{s.icon}</div>
                <div className="text-[13.5px] font-semibold">{s.title}</div>
                <p className="mt-1 text-[13px] text-text-2">{s.text}</p>
              </CardBody>
            </Card>
          ))}
        </Grid>
      </Page>
    );
  }

  const db = database(project.country).code;
  const [targets, run, job, runs, done, schedule, link] = await Promise.all([
    listTargets(project.id),
    latestRun(project.id),
    activeJob(project.id),
    recentRuns(project.id),
    doneIdeas(project.id),
    getSchedule(project.id, "content.onpage"),
    googleConfigured() ? getProjectGoogle(project.id) : Promise.resolve(null),
  ]);
  const serpOn = liveEnabled();
  const gscSite = link?.gscSite ?? null;
  let gsc: GscSuggestions;
  if (!googleConfigured()) gsc = { status: "unavailable", reason: "Connect Search Console (Google) to pick your pages with the most clicks and their top queries." };
  else if (!gscSite) gsc = { status: "unavailable", reason: `Link a Search Console property to ${project.domain} in Organic Traffic Insights to see page and query suggestions here.` };
  else {
    try {
      const r = await gscPairs(user.id, gscSite, 30);
      gsc = { status: "ok", rows: r.data.map((p): Suggestion => ({ url: p.url, keyword: p.keyword, clicks: p.clicks, impressions: p.impressions, position: p.position, origin: "gsc" })), fetchedAt: r.fetchedAt };
    } catch (e) {
      gsc = { status: "unavailable", reason: `Search Console data could not be loaded: ${e instanceof Error ? e.message : "request failed"}` };
    }
  }
  const results = run ? await runResults(run.id) : [];
  const targetIds = new Set(targets.map((t) => t.id));
  const liveResults = results.filter((r) => targetIds.has(r.target_id));
  const tab = typeof sp.tab === "string" ? sp.tab : run ? "overview" : "setup";
  const base = `/on-page-checker?project=${project.id}`;

  const header = (
    <PageHeader
      breadcrumbs={BREADCRUMBS}
      title="On Page SEO Checker:"
      subject={project.domain}
      meta={
        <>
          <DataSourceBadge source="crawler" fetchedAt={run ? (run.finished_at ?? run.created_at) : undefined} note="page facts fetched from your site" />
          {serpOn && <DataSourceBadge source="dataforseo" note="live top 10, crawled for benchmarks" />}
          {gscSite && <DataSourceBadge source="search-console" note={gscSite} />}
          <Badge>
            {database(db).flag} {database(db).name}
          </Badge>
          {run && <span className="text-[12px] text-text-3">Last collected {dateTimeLabel(run.finished_at ?? run.created_at)}</span>}
        </>
      }
      actions={
        <>
          <ProjectSwitcher projects={projects} current={project.id} />
          {targets.length > 0 && <WeeklyToggle projectId={project.id} enabled={!!schedule?.enabled} next={schedule?.next_run_at ? dateTimeLabel(schedule.next_run_at) : null} />}
          <RunButton projectId={project.id} rerun={!!run} disabled={!!job || !targets.length} />
        </>
      }
    />
  );

  const progress = job && (
    <div className="mb-4">
      <JobProgress jobId={job.id} initial={{ status: job.status, progress: job.progress, total: job.total, message: job.message, error: job.error }} />
    </div>
  );

  const missing = [...(serpOn ? [] : (["dataforseo"] as const)), ...(gscSite ? [] : (["google"] as const))];
  const sourcesCard = missing.length ? (
    <NeedsData
      compact
      className="mb-4"
      providers={[...missing]}
      title={missing.length === 2 ? "Ideas use your live pages only — connect data for benchmarks" : missing[0] === "dataforseo" ? "Connect DataForSEO for top-10 benchmarks" : `Link Search Console to ${project.domain} for query ideas`}
      shows={[
        ...(serpOn ? [] : ["Live Google top 10 per keyword, crawled to benchmark length, readability and structure", "Words the top pages share, SERP features and People-also-ask questions"]),
        ...(gscSite ? [] : ["Queries each page gets impressions for but lacks in its title or H1", "Real position, clicks and CTR per page; cannibalization between your pages", "Page + keyword suggestions from your top pages"]),
      ]}
    />
  ) : null;

  const setup = (
    <TargetsManager
      projectId={project.id}
      domain={project.domain}
      max={MAX_TARGETS}
      targets={targets.map((t) => ({ id: t.id, url: t.url, keyword: t.keyword, origin: t.origin }))}
      gsc={gsc}
    />
  );

  if (!run)
    return (
      <Page>
        {header}
        {progress}
        {!job && (
          <Callout tone="info" className="mb-4" title={targets.length ? `${targets.length} page${targets.length === 1 ? "" : "s"} ready` : "Start by adding pages and target keywords"}>
            {targets.length ? "Click “Collect ideas” to fetch the pages and check them against their keywords." : "Discover pages on your live site, pick them from Search Console, or add URL + keyword pairs manually. Up to 50 pairs per project."}
          </Callout>
        )}
        {sourcesCard}
        {setup}
      </Page>
    );

  // ---------------------------------------------------------------- aggregates
  const rows: IdeaRow[] = liveResults.map((r) => {
    const open = openIdeas(r, done);
    const byType: Partial<Record<IdeaType, number>> = {};
    for (const i of open) byType[i.type] = (byType[i.type] ?? 0) + 1;
    return {
      targetId: r.target_id,
      url: r.url,
      keyword: r.keyword,
      impressions: benchDemand(r.benchmark).impressions,
      position: benchDemand(r.benchmark).position,
      priority: priorityScore(r.benchmark, open),
      total: r.ideas.length,
      open: open.length,
      high: open.filter((i) => i.priority === "high").length,
      byType,
      status: r.page ? null : r.fetch_status ? `HTTP ${r.fetch_status}` : "Not fetched",
    };
  });
  const allOpen = liveResults.flatMap((r) => openIdeas(r, done));
  const totalIdeas = liveResults.reduce((s, r) => s + r.ideas.length, 0);
  const high = allOpen.filter((i) => i.priority === "high").length;
  const optimized = rows.filter((r) => r.high === 0).length;
  const fetched = liveResults.filter((r) => r.page).length;
  const prev = runs[1];
  const delta = prev && prev.ideas ? ((run.ideas - prev.ideas) / prev.ideas) * 100 : null;
  const byType = IDEA_TYPES.map((t) => ({ label: t.label, ideas: allOpen.filter((i) => i.type === t.id).length }));
  const common = [...allOpen.reduce((m, i) => m.set(i.id, (m.get(i.id) ?? 0) + 1), new Map<string, number>()).entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
  const titleFor = (id: string) => IDEA_LABELS[id] ?? allOpen.find((i) => i.id === id)?.title ?? id;
  const top = [...rows].sort((a, b) => b.priority - a.priority).slice(0, 6);
  const live = allOpen.filter((i) => i.source === "live").length;
  const fromSerp = allOpen.filter((i) => i.source === "serp").length;
  const fromGsc = allOpen.filter((i) => i.source === "gsc").length;
  const trend = [...runs].reverse().map((r) => ({ date: dateTimeLabel(r.finished_at ?? r.created_at), ideas: r.ideas }));
  const stale = targets.length !== liveResults.length;

  return (
    <Page>
      {header}
      {progress}
      {stale && !job && (
        <Callout tone="info" className="mb-4" action={<RunButton projectId={project.id} rerun size="sm" variant="secondary" />}>
          Your page list changed since the last collection ({targets.length} pages now, {liveResults.length} with ideas). Recollect to update.
        </Callout>
      )}
      <TabsNav
        className="mb-4"
        items={[
          { href: base, label: "Overview" },
          { href: `${base}&tab=ideas`, label: "Optimization ideas", count: allOpen.length },
          { href: `${base}&tab=setup`, label: "Pages & keywords", count: targets.length },
        ]}
      />

      {tab !== "setup" && sourcesCard}
      {tab === "setup" ? (
        <>
          {sourcesCard}
          {setup}
        </>
      ) : tab === "ideas" ? (
        <Card>
          <CardHeader title="Optimization ideas by page" description="Open ideas per page and category. Sort by priority to see where to start." />
          <IdeasTable rows={rows} projectId={project.id} domain={project.domain} />
        </Card>
      ) : (
        <>
          <Card className="mb-4">
            <MetricStrip>
              <Metric label="Total ideas" value={compact(allOpen.length)} delta={delta} deltaLabel="vs previous check" upIsGood={false} sub={`${totalIdeas - allOpen.length} marked done`} href={`${base}&tab=ideas`} />
              <Metric label="High priority" value={high} sub="Ideas with the biggest impact" />
              <Metric label="Pages checked" value={`${fetched} / ${liveResults.length}`} sub={fetched < liveResults.length ? `${liveResults.length - fetched} could not be fetched` : "All fetched live"} />
              <Metric label="Pages optimized" value={`${optimized} / ${rows.length}`} info="Pages with no open high-priority ideas." sub="No open high-priority ideas" />
              <Metric label="Ideas from your pages" value={`${allOpen.length ? Math.round((live / allOpen.length) * 100) : 0}%`} sub={`${live} page · ${fromSerp} top 10 · ${fromGsc} Search Console`} />
            </MetricStrip>
          </Card>

          <Grid cols={2} className="mb-4 lg:grid-cols-[1fr_1.25fr]">
            <Card>
              <CardHeader title="Ideas by type" description="Open ideas across all pages" />
              <CardBody>
                <BarChart data={byType} xKey="label" series={[{ key: "ideas", label: "Ideas" }]} layout="bars" categoryWidth={112} valueLabels height={250} />
              </CardBody>
            </Card>
            <Card>
              <CardHeader title="Top pages to optimize" description="Highest priority first: real impressions and position plus open high-priority ideas" href={`${base}&tab=ideas`} />
              <CardBody>
                <MiniTable
                  columns={[{ header: "Page · keyword" }, { header: "Priority", className: "w-32" }, { header: "Ideas", align: "right" }, { header: "Impr. (28d)", align: "right" }]}
                  rows={top.map((r) => [
                    <Link key="u" href={`/on-page-checker/${r.targetId}?project=${project.id}`} className="group block max-w-[170px] min-w-0 sm:max-w-[300px]">
                      <span className="block truncate text-link group-hover:underline" title={r.url}>
                        {displayUrl(r.url)}
                      </span>
                      <span className="block truncate text-[12px] text-text-3">{r.keyword}</span>
                    </Link>,
                    <div key="p" className="flex items-center gap-2">
                      <Bar value={r.priority} color={priorityColor(r.priority)} className="w-16" />
                      <span className="tabular text-[12.5px] font-medium">{r.priority}</span>
                    </div>,
                    <span key="i" className="tabular">
                      {r.open}
                      {r.high > 0 && <span className="ml-1 text-[11.5px] text-critical-ink">({r.high} high)</span>}
                    </span>,
                    r.impressions == null ? <span key="v" className="text-text-3">n/a</span> : compact(r.impressions),
                  ])}
                />
              </CardBody>
              <CardFooter>
                <Link href={`${base}&tab=ideas`} className="inline-flex items-center gap-1 text-link hover:underline">
                  All {rows.length} pages <ArrowRight className="h-3.5 w-3.5" />
                </Link>
              </CardFooter>
            </Card>
          </Grid>

          <Grid cols={2} className="mb-4">
            <Card>
              <CardHeader title="Most common ideas" description="How many pages each idea applies to" />
              <CardBody>
                {common.length ? (
                  <ul className="space-y-2.5">
                    {common.map(([id, n]) => (
                      <li key={id} className="grid grid-cols-[1fr_110px_36px] items-center gap-3 text-[13px]">
                        <span className="truncate text-text-2" title={titleFor(id)}>
                          {titleFor(id)}
                        </span>
                        <Bar value={n} max={rows.length} />
                        <span className="tabular text-right font-medium">{n}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <EmptyState icon={<FileSearch2 className="h-5 w-5" />} title="No open ideas" description="Every idea is marked done. Recollect ideas to re-check your pages." />
                )}
              </CardBody>
            </Card>
            <Card>
              <CardHeader title="Where the ideas come from" info="Page ideas come from the HTML we fetched from your site; top-10 ideas from the live Google results crawled for comparison (DataForSEO); Search Console ideas from your own query data." />
              <CardBody>
                <DistributionBar
                  segments={[
                    { label: "Your live page", value: live, color: "var(--series-3)" },
                    { label: "Top-10 benchmark", value: fromSerp, color: "var(--series-1)" },
                    { label: "Search Console", value: fromGsc, color: "var(--series-2)" },
                  ]}
                  format={(v, s) => `${v} · ${s.toFixed(0)}%`}
                />
                {trend.length >= 2 ? (
                  <div className="mt-5 border-t border-border pt-4">
                    <div className="mb-2 text-[12.5px] font-medium text-text-2">Ideas per check</div>
                    <TrendChart data={trend} xKey="date" xFormat="raw" series={[{ key: "ideas", label: "Ideas" }]} height={140} yFormat="number" />
                  </div>
                ) : (
                  <p className="mt-5 border-t border-border pt-4 text-[12.5px] text-text-3">Recollect ideas after you update pages to track progress over time.</p>
                )}
              </CardBody>
            </Card>
          </Grid>
        </>
      )}
      <p className="mt-6 text-[12px] text-text-3">
        Page facts (title, headings, text, images, links, schema, indexability) are measured from a live fetch.{serpOn ? " Benchmarks come from the live Google top 10 (DataForSEO), each page crawled with robots.txt respected." : ""}{gscSite ? " Query, position and click data come from Search Console (last 28 days)." : ""}
      </p>
    </Page>
  );
}
