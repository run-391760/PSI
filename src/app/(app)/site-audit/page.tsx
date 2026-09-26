import { CalendarClock, Monitor, Smartphone } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { requirePageUser } from "@/lib/auth";
import { timeAgo } from "@/lib/format";
import { getSchedule, latestJob } from "@/lib/jobs/queue";
import { findProject, listProjects } from "@/lib/projects";
import { CRAWL_KIND, CWV_KIND, getConfig } from "@/lib/site-audit/config";
import { getCrawl, latestByProject, latestCompleted, listCrawls } from "@/lib/site-audit/data";
import { DataSourceBadge } from "@/components/seo/source-badge";
import { Page, PageHeader } from "@/components/shell/page";
import { ProjectGate } from "@/components/projects/project-gate";
import { ProjectSwitcher } from "@/components/projects/project-switcher";
import { CrawlPicker } from "@/components/site-audit/crawl-picker";
import { CrawlProgress, RerunButton } from "@/components/site-audit/crawl-controls";
import { AuditSettingsButton } from "@/components/site-audit/settings-form";
import { scoreTone } from "@/components/site-audit/ui";
import { Badge } from "@/components/ui/badge";
import { Callout } from "@/components/ui/feedback";
import { PrintButton } from "@/components/ui/print-button";
import { TabsNav } from "@/components/ui/tabs";
import { type AuditCtx, crawlLabel, makeHref } from "./_views/context";
import { CompareView } from "./_views/compare";
import { IssuesView } from "./_views/issues";
import { OverviewView } from "./_views/overview";
import { PagesView } from "./_views/pages";
import { ReportsView } from "./_views/reports";
import { SetupView } from "./_views/setup";
import { StatisticsView } from "./_views/statistics";

export const metadata: Metadata = { title: "Site Audit" };

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function SiteAuditPage({ searchParams }: PageProps<"/site-audit">) {
  const user = await requirePageUser();
  const raw = await searchParams;
  const sp = Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, one(v)])) as Record<string, string | undefined>;
  const projects = await listProjects(user.id);
  const project = await findProject(user.id, sp.project);
  const breadcrumbs = [{ label: "On page & tech SEO" }, { label: "Site Audit", href: "/site-audit" }];

  if (!project) {
    const latest = await latestByProject(user.id);
    const status = Object.fromEntries(
      [...latest.entries()].map(([id, c]) => [
        id,
        <span key={id} className="inline-flex items-center gap-2">
          <Badge tone={scoreTone(c.health)}>Health {c.health ?? 0}%</Badge>
          <span className="hidden text-text-3 sm:inline">{timeAgo(c.started_at)}</span>
        </span>,
      ]),
    );
    return (
      <Page>
        <PageHeader breadcrumbs={breadcrumbs} title="Site Audit" description="Crawl your website like a search engine and fix technical SEO issues: broken links, redirects, duplicates, HTTPS, hreflang, structured data, Core Web Vitals and more." />
        {sp.project && <Callout tone="warning" className="mb-4">That project was not found. Choose one of your projects below.</Callout>}
        <ProjectGate projects={projects} basePath="/site-audit" title="Site Audit" description="Pick a project to audit its website." status={status} />
      </Page>
    );
  }

  const config = getConfig(project);
  const [crawls, job, cwvJob, schedule, latestDone] = await Promise.all([
    listCrawls(project.id, 40),
    latestJob(project.id, CRAWL_KIND),
    latestJob(project.id, CWV_KIND),
    getSchedule(project.id, CRAWL_KIND),
    latestCompleted(project.id),
  ]);
  const running = job && (job.status === "queued" || job.status === "running") ? job : null;
  const requested = sp.crawl && sp.crawl !== latestDone?.id ? await getCrawl(project.id, sp.crawl) : null;
  const older = requested && (requested.status === "done" || requested.status === "stopped") ? requested : null;
  const crawlParam = older?.id ?? null;
  const crawl = older ?? latestDone;
  const finished = crawls.filter((c) => c.status === "done" || c.status === "stopped");
  const lastFailed = crawls[0]?.status === "failed" && !running ? crawls[0] : null;
  const href = makeHref(project.id, crawlParam);
  const tab = sp.tab ?? "overview";

  const header = (
    <PageHeader
      breadcrumbs={breadcrumbs}
      title="Site Audit:"
      subject={project.domain}
      meta={
        crawl ? (
          <>
            <DataSourceBadge source="crawler" fetchedAt={crawl.finished_at ?? crawl.started_at} note={`${crawl.pages_crawled} pages · SynapseSEOBot`} />
            <Badge>
              {crawl.pages_crawled.toLocaleString()} page{crawl.pages_crawled === 1 ? "" : "s"} crawled
            </Badge>
            <Badge>
              {crawl.config.device === "mobile" ? <Smartphone className="h-3 w-3" /> : <Monitor className="h-3 w-3" />}
              {crawl.config.device === "mobile" ? "Mobile" : "Desktop"} bot
            </Badge>
            {crawl.status === "stopped" && <Badge tone="warning">Stopped early (partial)</Badge>}
            {schedule?.enabled && (
              <Badge tone="brand" title={`Next run ${new Date(schedule.next_run_at).toUTCString()}`}>
                <CalendarClock className="h-3 w-3" /> {schedule.cadence === "daily" ? "Daily" : "Weekly"} re-crawl
              </Badge>
            )}
            <CrawlPicker options={finished.map((c) => ({ id: c.id, label: `Crawl of ${crawlLabel(c)}` }))} current={crawl.id} latestId={latestDone?.id ?? crawl.id} />
          </>
        ) : (
          <DataSourceBadge source="crawler" />
        )
      }
      actions={
        <>
          {projects.length > 1 && <ProjectSwitcher projects={projects} current={project.id} />}
          {(crawl || running) && <AuditSettingsButton projectId={project.id} domain={project.domain} initial={config} />}
          {crawl && !running && <RerunButton projectId={project.id} />}
          {crawl && <PrintButton />}
        </>
      }
    />
  );

  if (!crawl) {
    return (
      <Page>
        {header}
        {lastFailed && (
          <Callout tone="critical" className="mb-4" title="The last crawl failed">
            {lastFailed.error ?? "Unknown error."}
          </Callout>
        )}
        {running ? (
          <CrawlProgress projectId={project.id} jobId={running.id} limit={config.limit} hasPrevious={false} />
        ) : (
          <SetupView project={project} config={config} />
        )}
      </Page>
    );
  }

  const idx = finished.findIndex((c) => c.id === crawl.id);
  const previous = idx >= 0 ? (finished[idx + 1] ?? null) : null;
  const ctx: AuditCtx = {
    project,
    config,
    crawl,
    previous,
    crawls: finished,
    sp,
    href,
    runningCwvJob: cwvJob && (cwvJob.status === "queued" || cwvJob.status === "running") ? cwvJob.id : null,
  };
  const issueCount = crawl.errors + crawl.warnings + crawl.notices;
  const tabs = [
    { href: href({}), label: "Overview" },
    { href: href({ tab: "issues" }), label: "Issues", count: issueCount.toLocaleString() },
    { href: href({ tab: "pages" }), label: "Crawled pages", count: crawl.pages_crawled.toLocaleString() },
    { href: href({ tab: "statistics" }), label: "Statistics" },
    { href: href({ tab: "reports" }), label: "Thematic reports" },
    { href: href({ tab: "compare" }), label: "Compare crawls", count: finished.length > 1 ? finished.length : undefined },
  ];

  return (
    <Page>
      {header}
      {running && <CrawlProgress projectId={project.id} jobId={running.id} limit={config.limit} hasPrevious />}
      {lastFailed && (
        <Callout tone="critical" className="mb-4" title={`The crawl started ${timeAgo(lastFailed.started_at)} failed`}>
          {lastFailed.error ?? "Unknown error."} Showing the last successful crawl.
        </Callout>
      )}
      {crawlParam && (
        <Callout tone="info" className="mb-4">
          You are viewing an older crawl ({crawlLabel(crawl)}).{" "}
          <Link href={makeHref(project.id, null)({ tab: sp.tab })} className="font-medium text-link hover:underline">
            Back to the latest crawl
          </Link>
        </Callout>
      )}
      {crawl.details_pruned ? (
        <Callout tone="warning" className="mb-4">
          Page-level details of this older crawl were pruned (the latest 6 crawls keep full details). Totals and trends are still available.
        </Callout>
      ) : null}
      <TabsNav items={tabs} className="mb-4" />
      {tab === "issues" ? (
        <IssuesView ctx={ctx} />
      ) : tab === "pages" ? (
        <PagesView ctx={ctx} />
      ) : tab === "statistics" ? (
        <StatisticsView ctx={ctx} />
      ) : tab === "reports" ? (
        <ReportsView ctx={ctx} />
      ) : tab === "compare" ? (
        <CompareView ctx={ctx} />
      ) : (
        <OverviewView ctx={ctx} />
      )}
    </Page>
  );
}
