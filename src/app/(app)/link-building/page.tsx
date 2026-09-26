import { ArrowRight, Crosshair, Link2, Mail, Search } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { requirePageUser } from "@/lib/auth";
import { getLbSettings, listLinks, listPipeline, projectProspects, VERIFY_JOB, verifySchedule } from "@/lib/backlinks/link-building";
import { DEFAULT_TEMPLATE, OUTREACH_LABELS, OUTREACH_STATUSES } from "@/lib/backlinks/types";
import { query } from "@/lib/db";
import { database } from "@/lib/domain";
import { compact, displayUrl, timeAgo } from "@/lib/format";
import { latestJob } from "@/lib/jobs/queue";
import { findProject, listProjects } from "@/lib/projects";
import { domainCompetitors, domainKeywords } from "@/lib/seo/engine";
import { BarChart } from "@/components/charts/bar-chart";
import { ProjectGate } from "@/components/projects/project-gate";
import { ProjectSwitcher } from "@/components/projects/project-switcher";
import { AsBadge, DomainLink } from "@/components/seo/badges";
import { DataSourceBadge, DemoNotice } from "@/components/seo/source-badge";
import { Grid, Page, PageHeader } from "@/components/shell/page";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardBody, CardFooter, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/feedback";
import { Metric, MetricStrip } from "@/components/ui/metric";
import { MiniTable } from "@/components/ui/mini-table";
import { DistributionBar } from "@/components/ui/progress";
import { TabsNav } from "@/components/ui/tabs";
import { ShareList, Stars } from "@/components/backlinks/bits";
import { JobProgress } from "@/components/backlinks/job-progress";
import { LinkStatusBadge, MonitorTable, MonitorToolbar } from "@/components/backlinks/lb-monitor";
import { PipelineTable, TemplateEditor } from "@/components/backlinks/lb-pipeline";
import { ProspectsTable } from "@/components/backlinks/lb-prospects";
import { LbSettingsButton, LbSetupForm } from "@/components/backlinks/lb-setup";

export const metadata: Metadata = { title: "Link Building Tool" };

const BREADCRUMBS = [{ label: "Link building" }, { label: "Link Building Tool", href: "/link-building" }];
const TABS = ["overview", "prospects", "in-progress", "monitor"] as const;
type Tab = (typeof TABS)[number];

function timeUntil(date: string) {
  const ms = new Date(date).getTime() - Date.now();
  if (ms <= 60_000) return "soon";
  const h = Math.round(ms / 3_600_000);
  return h < 24 ? `in ${Math.max(1, h)}h` : `in ${Math.round(h / 24)}d`;
}

export default async function LinkBuildingPage({ searchParams }: PageProps<"/link-building">) {
  const user = await requirePageUser();
  const sp = await searchParams;
  const projects = await listProjects(user.id);
  const project = await findProject(user.id, typeof sp.project === "string" ? sp.project : null);

  if (!project) {
    const counts = projects.length
      ? await query<{ project_id: string; in_progress: number; acquired: number; links: number }>(
          `SELECT p.id AS project_id,
             (SELECT count(*)::int FROM bl_lb_prospects x WHERE x.project_id=p.id AND x.state='in_progress') AS in_progress,
             (SELECT count(*)::int FROM bl_lb_prospects x WHERE x.project_id=p.id AND x.status='acquired') AS acquired,
             (SELECT count(*)::int FROM bl_lb_links l WHERE l.project_id=p.id AND l.status='active') AS links
           FROM projects p WHERE p.owner_id=$1 AND EXISTS (SELECT 1 FROM bl_lb_settings s WHERE s.project_id=p.id)`,
          [user.id],
        )
      : [];
    const status = Object.fromEntries(counts.map((c) => [c.project_id, <span key={c.project_id} className="text-text-2">{c.in_progress} in progress · {c.links} active links</span>]));
    return (
      <Page className="overflow-x-clip">
        <PageHeader breadcrumbs={BREADCRUMBS} title="Link Building Tool" description="Find link prospects from your competitors' backlinks and your target keywords, run outreach and monitor the links you earn." />
        <ProjectGate projects={projects} basePath="/link-building" title="the Link Building Tool" description="Pick the project you want to build links for." status={status} />
      </Page>
    );
  }

  const db = database(project.country).code;
  const tabParam = typeof sp.tab === "string" ? sp.tab : "overview";
  const tab: Tab = (TABS as readonly string[]).includes(tabParam) ? (tabParam as Tab) : "overview";
  const settings = await getLbSettings(project.id);
  const switcher = <ProjectSwitcher projects={projects.map((p) => ({ id: p.id, name: p.name, domain: p.domain }))} current={project.id} />;

  const suggested = domainCompetitors(project.domain, db, 8).map((c) => c.domain);
  const competitorOptions = [
    ...project.competitors.map((d) => ({ domain: d, note: "Project competitor" })),
    ...suggested.filter((d) => !project.competitors.includes(d)).map((d) => ({ domain: d, note: "Organic competitor" })),
  ];
  const keywordSuggestions = domainKeywords(project.domain, db)
    .filter((k) => !k.branded)
    .slice(0, 12)
    .map((k) => k.keyword);
  const setupProps = {
    projectId: project.id,
    initialKeywords: settings?.keywords ?? [],
    initialCompetitors: settings?.competitors ?? project.competitors.slice(0, 10),
    competitorOptions,
    keywordSuggestions,
  };

  if (!settings)
    return (
      <Page className="overflow-x-clip">
        <PageHeader breadcrumbs={BREADCRUMBS} title="Link Building Tool:" subject={project.domain} meta={<DataSourceBadge source="demo" />} actions={switcher} />
        <Grid cols={2} className="lg:grid-cols-[1.6fr_1fr]">
          <Card>
            <CardHeader title="Set up link building" description="Tell us what you want to rank for and who you compete with. We'll find sites likely to link to you." />
            <CardBody>
              <LbSetupForm {...setupProps} />
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="How it works" />
            <CardBody>
              <ol className="space-y-3 text-[13px]">
                <HowStep icon={<Search className="h-4 w-4" />} title="Find prospects" text="Sites that link to your competitors but not to you, and sites ranking for your keywords — rated 1–5 stars." />
                <HowStep icon={<Mail className="h-4 w-4" />} title="Run outreach" text="Move good prospects to In progress, write a template with merge fields and copy personalized emails." />
                <HowStep icon={<Link2 className="h-4 w-4" />} title="Monitor links" text="Add the URLs of links you earn. We crawl each page daily and alert you if a link disappears." />
              </ol>
            </CardBody>
          </Card>
        </Grid>
        <DemoNotice className="mt-6" />
      </Page>
    );

  const [pipeline, links, job, schedule] = await Promise.all([listPipeline(project.id), listLinks(project.id), latestJob(project.id, VERIFY_JOB), verifySchedule(project.id)]);
  const acted = new Set(pipeline.map((p) => p.domain));
  const allProspects = projectProspects(project, settings);
  const prospects = allProspects.filter((p) => !acted.has(p.domain));
  const inProgress = pipeline.filter((p) => p.state === "in_progress");
  const rejected = pipeline.filter((p) => p.state === "rejected");
  const running = !!job && (job.status === "queued" || job.status === "running");
  const byStatus = Object.fromEntries(OUTREACH_STATUSES.map((s) => [s, inProgress.filter((p) => p.status === s).length])) as Record<(typeof OUTREACH_STATUSES)[number], number>;
  const linkCounts = { active: links.filter((l) => l.status === "active").length, lost: links.filter((l) => l.status === "lost").length, unknown: links.filter((l) => l.status === "unknown").length };
  const lastCheck = links.reduce<string | null>((m, l) => (l.lastCheckedAt && (!m || l.lastCheckedAt > m) ? l.lastCheckedAt : m), null);
  const base = `/link-building?project=${project.id}`;

  return (
    <Page className="overflow-x-clip">
      <PageHeader
        breadcrumbs={BREADCRUMBS}
        title="Link Building Tool:"
        subject={project.domain}
        meta={
          <>
            {tab === "monitor" ? <DataSourceBadge source="crawler" fetchedAt={lastCheck ?? undefined} note="Links verified by crawling the source pages" /> : <DataSourceBadge source="demo" />}
            <Badge>
              {settings.keywords.length} keyword{settings.keywords.length === 1 ? "" : "s"}
            </Badge>
            <Badge>
              {settings.competitors.length} competitor{settings.competitors.length === 1 ? "" : "s"}
            </Badge>
            {schedule?.enabled && <Badge tone="info">Daily link checks · next {timeUntil(schedule.next_run_at)}</Badge>}
          </>
        }
        actions={
          <>
            {switcher}
            <LbSettingsButton {...setupProps} />
          </>
        }
      />

      <Card className="mb-4">
        <MetricStrip className="sm:grid-flow-row sm:grid-cols-3 lg:grid-flow-col lg:grid-cols-none">
          <Metric label="Prospects" value={compact(prospects.length)} sub={`${prospects.filter((p) => p.rating >= 4).length} rated 4★ or more`} href={`${base}&tab=prospects`} />
          <Metric label="In progress" value={inProgress.length} sub={`${byStatus.to_contact} to contact`} href={`${base}&tab=in-progress`} />
          <Metric label="Emails sent" value={byStatus.sent + byStatus.replied + byStatus.acquired} sub={`${byStatus.replied + byStatus.acquired} replied`} />
          <Metric label="Links acquired" value={<span className="text-good-ink">{byStatus.acquired}</span>} sub={`${byStatus.rejected} declined`} />
          <Metric label="Active links" value={linkCounts.active} sub={lastCheck ? `Verified ${timeAgo(lastCheck)}` : "Not checked yet"} href={`${base}&tab=monitor`} />
          <Metric label="Lost links" value={<span className={linkCounts.lost ? "text-critical-ink" : undefined}>{linkCounts.lost}</span>} sub={`${linkCounts.unknown} unknown`} href={`${base}&tab=monitor`} />
        </MetricStrip>
      </Card>

      <TabsNav
        className="mb-4"
        items={[
          { href: "/link-building", label: "Overview" },
          { href: "/link-building?tab=prospects", label: "Prospects", count: prospects.length },
          { href: "/link-building?tab=in-progress", label: "In progress", count: inProgress.length },
          { href: "/link-building?tab=monitor", label: "Monitor", count: links.length },
        ]}
      />

      {tab === "overview" && (
        <>
          <Grid cols={2} className="mb-4">
            <Card>
              <CardHeader title="Outreach pipeline" description="Prospects in progress by status" href={`${base}&tab=in-progress`} />
              <CardBody>
                {inProgress.length ? (
                  <ShareList items={OUTREACH_STATUSES.map((st) => ({ key: st, label: OUTREACH_LABELS[st], value: byStatus[st], share: (byStatus[st] / inProgress.length) * 100 }))} format={compact} labelWidth="w-28" />
                ) : (
                  <EmptyState icon={<Crosshair className="h-5 w-5" />} title="No outreach yet" description="Move your best prospects to In progress to start building the pipeline." action={<ButtonLink href={`${base}&tab=prospects`} size="sm" variant="primary">Browse prospects</ButtonLink>} className="py-6" />
                )}
              </CardBody>
            </Card>
            <Card>
              <CardHeader title="Prospects by rating" description={`${compact(prospects.length)} prospects not yet reviewed`} href={`${base}&tab=prospects`} />
              <CardBody>
                <BarChart data={[5, 4, 3, 2, 1].map((r) => ({ rating: `${r}★`, prospects: prospects.filter((p) => p.rating === r).length }))} xKey="rating" valueLabels series={[{ key: "prospects", label: "Prospects", color: "var(--series-4)" }]} height={210} />
              </CardBody>
            </Card>
          </Grid>
          <Grid cols={2} className="mb-4 lg:grid-cols-[1.5fr_1fr]">
            <Card>
              <CardHeader title="Top prospects" description="Highest rated sites to contact next" href={`${base}&tab=prospects`} />
              <CardBody>
                <MiniTable
                  empty="No prospects found. Add more keywords or competitors in Settings."
                  columns={[{ header: "Prospect" }, { header: "Rating" }, { header: "AS", align: "right" }, { header: "Why" }]}
                  rows={prospects.slice(0, 8).map((p) => [
                    <DomainLink key="d" domain={p.domain} db={db} className="max-w-[200px]" />,
                    <Stars key="s" value={p.rating} reason={p.reason} size={12} />,
                    <AsBadge key="a" score={p.authorityScore} />,
                    <span key="w" className="block max-w-[320px] truncate text-[12px] text-text-3" title={p.reason}>
                      {p.reason}
                    </span>,
                  ])}
                />
              </CardBody>
              <CardFooter>
                <Link href={`${base}&tab=prospects`} className="text-link hover:underline">
                  View all prospects →
                </Link>
              </CardFooter>
            </Card>
            <Card>
              <CardHeader title="Where prospects come from" info="Prospects can link to several competitors and rank for your keywords at the same time." />
              <CardBody>
                <DistributionBar
                  segments={[
                    { label: "Link to competitors", value: prospects.filter((p) => p.source === "competitors").length, color: "var(--series-1)" },
                    { label: "Rank for your keywords", value: prospects.filter((p) => p.source === "keywords").length, color: "var(--series-2)" },
                    { label: "Both", value: prospects.filter((p) => p.source === "both").length, color: "var(--series-3)" },
                  ]}
                  format={(v) => compact(v)}
                />
                {settings.competitors.length > 0 && (
                  <div className="mt-4 border-t border-border pt-3">
                    <div className="mb-2 text-[12.5px] font-medium text-text-2">Prospects linking to each competitor</div>
                    <ShareList
                      items={settings.competitors.map((c) => {
                        const n = prospects.filter((p) => p.competitors.includes(c)).length;
                        return { key: c, label: c, value: n, share: prospects.length ? (n / prospects.length) * 100 : 0 };
                      })}
                      format={compact}
                      labelWidth="w-36"
                    />
                  </div>
                )}
              </CardBody>
            </Card>
          </Grid>
          <Card>
            <CardHeader title="Monitored links" description="Latest verification results (live crawl)" href={`${base}&tab=monitor`} actions={<ButtonLink href={`${base}&tab=monitor`} size="sm" variant="ghost">Monitor <ArrowRight className="h-3.5 w-3.5" /></ButtonLink>} />
            <CardBody>
              <MiniTable
                empty="No monitored links yet. When you acquire a link, add its page URL in the Monitor tab."
                columns={[{ header: "Status" }, { header: "Source page" }, { header: "Anchor" }, { header: "Last checked", align: "right" }]}
                rows={links.slice(0, 6).map((l) => [
                  <LinkStatusBadge key="s" status={l.status} />,
                  <a key="u" href={l.sourceUrl} target="_blank" rel="noopener noreferrer nofollow" className="block max-w-[360px] truncate text-link hover:underline">
                    {displayUrl(l.sourceUrl)}
                  </a>,
                  <span key="a" className="block max-w-[220px] truncate text-text-2">
                    {l.anchor || "–"}
                  </span>,
                  l.lastCheckedAt ? timeAgo(l.lastCheckedAt) : "Pending",
                ])}
              />
            </CardBody>
          </Card>
        </>
      )}

      {tab === "prospects" && (
        <Card>
          <CardHeader title="Prospects" description={`From ${settings.competitors.length} competitors' referring domains and the top 30 results for ${settings.keywords.length} keywords; excludes sites already linking to ${project.domain}.`} />
          <ProspectsTable projectId={project.id} prospects={prospects} rejected={rejected} competitorCount={settings.competitors.length} db={db} domain={project.domain} />
        </Card>
      )}

      {tab === "in-progress" && (
        <>
          <Card className="mb-4">
            <CardHeader title="Outreach" description="Track each prospect from first contact to acquired link. Emails are composed here and sent from your own mail app." />
            <PipelineTable projectId={project.id} rows={inProgress} template={{ subject: settings.templateSubject || DEFAULT_TEMPLATE.subject, body: settings.templateBody || DEFAULT_TEMPLATE.body, senderName: settings.senderName }} ourSite={project.domain} monitored={links.map((l) => l.prospectDomain ?? "").filter(Boolean)} />
          </Card>
          <TemplateEditor projectId={project.id} initial={{ subject: settings.templateSubject, body: settings.templateBody, senderName: settings.senderName }} ourSite={project.domain} />
        </>
      )}

      {tab === "monitor" && (
        <>
          {running && job && <JobProgress jobId={job.id} title="Verifying links" initial={{ status: job.status, progress: job.progress, total: job.total, message: job.message }} className="mb-4" />}
          <Card>
            <CardHeader
              title="Monitored links"
              description={`Each source page is crawled (robots.txt respected) to confirm it still links to ${project.domain}.${schedule?.enabled ? ` Checked daily — next ${timeUntil(schedule.next_run_at)}.` : ""}`}
              actions={<MonitorToolbar projectId={project.id} prospects={inProgress.map((p) => p.domain)} running={running} count={links.length} />}
            />
            <MonitorTable projectId={project.id} rows={links} domain={project.domain} running={running} />
          </Card>
        </>
      )}
      {tab !== "monitor" && <DemoNotice className="mt-6" />}
    </Page>
  );
}

function HowStep({ icon, title, text }: { icon: ReactNode; title: string; text: string }) {
  return (
    <li className="flex gap-3">
      <span className="mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-brand-soft text-brand-ink">{icon}</span>
      <span>
        <span className="block font-medium text-text">{title}</span>
        <span className="text-text-2">{text}</span>
      </span>
    </li>
  );
}
