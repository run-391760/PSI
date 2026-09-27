import { BarChart3, Globe, Settings2 } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { currentUser, requirePageUser } from "@/lib/auth";
import { database } from "@/lib/domain";
import { compact, dateLabel } from "@/lib/format";
import { demoAllowed } from "@/lib/data-mode";
import { projectGoogle } from "@/lib/reports/google-project";
import { dataSources, linkedGoogleProjects } from "@/lib/reports/platform";
import { findProject, listProjects } from "@/lib/projects";
import { projectSummaries } from "@/lib/projects/summaries";
import { listJobRows, projectSchedules } from "@/lib/reports/platform";
import { jobKindLabel } from "@/lib/reports/kinds";
import { domainCompetitors } from "@/lib/seo/engine";
import { DataSourcesCard, GoogleSnapshotCard } from "@/components/dashboard/google-snapshot";
import { AutoRefresh } from "@/components/dashboard/auto-refresh";
import { ProjectMeta, RecentJobsCard } from "@/components/dashboard/home-widgets";
import { JobsTable } from "@/components/dashboard/jobs-table";
import { ToolWidget } from "@/components/dashboard/tool-widget";
import { DomainAvatar, DomainLink } from "@/components/seo/badges";
import { Grid, Page, PageHeader } from "@/components/shell/page";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardBody, CardFooter, CardHeader } from "@/components/ui/card";
import { TabsNav } from "@/components/ui/tabs";
import { AddCompetitorButton } from "./add-competitor";
import { ProjectJump } from "./project-jump";
import { ProjectSettings } from "./project-settings";
import { SchedulesTable } from "./schedules-table";

export async function generateMetadata({ params }: PageProps<"/projects/[id]">): Promise<Metadata> {
  const user = await currentUser();
  const { id } = await params;
  const project = user ? await findProject(user.id, id) : null;
  return { title: project ? `${project.name} · Project` : "Project" };
}

export default async function ProjectPage({ params, searchParams }: PageProps<"/projects/[id]">) {
  const user = await requirePageUser();
  const { id } = await params;
  const sp = await searchParams;
  const tab = sp.tab === "settings" || sp.tab === "schedules" ? sp.tab : "overview";
  const project = await findProject(user.id, id);
  if (!project) notFound();

  const info = database(project.country);
  const [projects, summaries, jobs, schedules] = await Promise.all([
    listProjects(user.id),
    tab === "overview" ? projectSummaries(project) : Promise.resolve([]),
    listJobRows(user.id, { projectId: project.id, limit: tab === "schedules" ? 100 : 6 }),
    projectSchedules(user.id, project.id),
  ]);
  const active = jobs.some((j) => j.status === "queued" || j.status === "running") || summaries.some((s) => s.state === "running");
  const base = `/projects/${project.id}`;
  const doLink = `/domain-overview?q=${encodeURIComponent(project.domain)}&db=${project.country}`;

  return (
    <Page>
      <AutoRefresh active={active && tab === "overview"} interval={4000} />
      <PageHeader
        breadcrumbs={[{ label: "Projects", href: "/projects" }, { label: project.name }]}
        title={
          <span className="inline-flex items-center gap-2.5">
            <DomainAvatar domain={project.domain} size={28} />
            {project.name}
          </span>
        }
        meta={
          <>
            <ProjectMeta project={project} className="text-[12.5px]" />
            <Badge tone="brand">{project.competitors.length} competitors</Badge>
            <span className="text-[12px] text-text-3">Created {dateLabel(project.created_at)}</span>
          </>
        }
        actions={
          <>
            {projects.length > 1 && <ProjectJump projects={projects.map((p) => ({ id: p.id, name: p.name, domain: p.domain }))} current={project.id} tab={tab} />}
            <ButtonLink href={doLink}>
              <Globe className="h-4 w-4" /> Domain Overview
            </ButtonLink>
            <ButtonLink href={`/reports/new?template=project&project=${project.id}`}>
              <BarChart3 className="h-4 w-4" /> Create report
            </ButtonLink>
            <ButtonLink href={`${base}?tab=settings`} variant="ghost" size="icon" aria-label="Project settings">
              <Settings2 className="h-4 w-4" />
            </ButtonLink>
          </>
        }
      />
      <TabsNav
        className="mb-4"
        items={[
          { href: base, label: "Overview" },
          { href: `${base}?tab=schedules`, label: "Schedules & jobs", count: schedules.length || undefined },
          { href: `${base}?tab=settings`, label: "Settings" },
        ]}
      />

      {tab === "overview" && <Overview project={project} summaries={summaries} jobs={jobs} schedules={schedules} doLink={doLink} />}

      {tab === "schedules" && (
        <div className="space-y-4">
          <Card>
            <CardHeader title="Recurring schedules" description="The background worker checks for due schedules every minute." />
            <SchedulesTable projectId={project.id} schedules={schedules.map((s) => ({ kind: s.kind, cadence: s.cadence, enabled: s.enabled, last_run_at: s.last_run_at, next_run_at: s.next_run_at }))} />
          </Card>
          <Card className="pt-3">
            <CardHeader title="Jobs for this project" description="Last 100 background jobs" className="pt-0" />
            <JobsTable rows={jobs} showProject={false} exportName={`${project.domain}-jobs`} emptyText="No jobs have run for this project yet." />
          </Card>
        </div>
      )}

      {tab === "settings" && (
        <ProjectSettings
          project={{ id: project.id, name: project.name, domain: project.domain, country: info.code, device: project.device, location: project.location, competitors: project.competitors, brand_terms: project.brand_terms }}
        />
      )}
    </Page>
  );
}

async function Overview({
  project,
  summaries,
  jobs,
  schedules,
  doLink,
}: {
  project: NonNullable<Awaited<ReturnType<typeof findProject>>>;
  summaries: Awaited<ReturnType<typeof projectSummaries>>;
  jobs: Awaited<ReturnType<typeof listJobRows>>;
  schedules: Awaited<ReturnType<typeof projectSchedules>>;
  doLink: string;
}) {
  const db = database(project.country).code;
  const [google, linked] = await Promise.all([projectGoogle(project), linkedGoogleProjects(project.owner_id)]);
  // Competitor suggestions come from the demo engine: only in local development (DEMO_DATA=true).
  const suggestions = demoAllowed() && project.competitors.length < 10 ? domainCompetitors(project.domain, db, 8).filter((c) => !project.competitors.includes(c.domain)).slice(0, 3) : [];
  const ready = summaries.filter((s) => s.state !== "empty").length;

  return (
    <>
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <h2 className="text-[15px] font-semibold text-text">Tools</h2>
        <span className="text-[12.5px] text-text-3">
          {ready} of {summaries.length} set up
        </span>
      </div>
      <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {summaries.map((s, i) => (
          <ToolWidget key={`${s.tool}-${i}`} summary={s} />
        ))}
      </div>

      <Grid cols={2} className="mb-4 lg:grid-cols-[1.55fr_1fr]">
        <GoogleSnapshotCard state={google} projectId={project.id} domain={project.domain} />

        <Card>
          <CardHeader title="Competitors" description={project.competitors.length ? `${project.competitors.length} tracked competitors` : "No competitors added yet"} href={`/projects/${project.id}?tab=settings`} />
          <CardBody>
            {project.competitors.length > 0 ? (
              <ul className="divide-y divide-border">
                {[project.domain, ...project.competitors].map((d) => (
                  <li key={d} className="flex items-center justify-between gap-2 py-1.5 text-[13px]">
                    <span className="inline-flex min-w-0 items-center gap-1.5">
                      <DomainLink domain={d} db={db} className={d === project.domain ? "font-semibold" : ""} />
                      {d === project.domain && <Badge tone="brand" className="h-4 px-1 text-[10px]">You</Badge>}
                    </span>
                    <Link href={`/domain-overview?q=${encodeURIComponent(d)}&db=${db}`} className="shrink-0 text-[12px] text-link hover:underline">
                      Overview
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="py-3 text-[12.5px] text-text-3">Add the domains you compete with in the project settings. They are used by Position Tracking, Keyword Gap, AI Visibility and reports.</p>
            )}
            {suggestions.length > 0 && (
              <div className={project.competitors.length ? "mt-4 border-t border-border pt-3" : ""}>
                <div className="mb-2 text-[12.5px] font-medium text-text-2">Suggested competitors</div>
                <ul className="space-y-2">
                  {suggestions.map((c) => (
                    <li key={c.domain} className="flex items-center justify-between gap-2 text-[13px]">
                      <div className="min-w-0">
                        <DomainLink domain={c.domain} db={db} />
                        <div className="text-[11.5px] text-text-3">{compact(c.commonKeywords)} common keywords · demo engine</div>
                      </div>
                      <AddCompetitorButton projectId={project.id} domain={c.domain} />
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </CardBody>
          <CardFooter>
            <Link href={`/keyword-gap?q=${[project.domain, ...project.competitors.slice(0, 4)].join(",")}&db=${db}`} className="text-link hover:underline">
              Compare keywords in Keyword Gap →
            </Link>
          </CardFooter>
        </Card>
      </Grid>

      <Grid cols={3} className="mb-4">
        <DataSourcesCard rows={dataSources(linked)} />
        <RecentJobsCard jobs={jobs} title="Recent jobs" showProject={false} />
        <Card>
          <CardHeader title="Schedules" description="Recurring checks for this project" href={`/projects/${project.id}?tab=schedules`} />
          {schedules.length === 0 ? (
            <CardBody>
              <p className="py-5 text-center text-[12.5px] text-text-3">No recurring schedules yet. Set up Site Audit or Position Tracking to monitor this site automatically.</p>
            </CardBody>
          ) : (
            <ul className="divide-y divide-border border-t border-border">
              {schedules.slice(0, 6).map((s) => {
                const k = jobKindLabel(s.kind);
                return (
                  <li key={s.kind} className="flex items-center gap-3 px-4 py-2 text-[13px]">
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium text-text">{k.tool}</div>
                      <div className="truncate text-[11.5px] text-text-3">
                        {k.action} · {s.cadence}
                      </div>
                    </div>
                    <Badge tone={s.enabled ? "good" : "neutral"}>{s.enabled ? "On" : "Paused"}</Badge>
                  </li>
                );
              })}
            </ul>
          )}
          <CardFooter>
            <Link href={`/projects/${project.id}?tab=schedules`} className="text-link hover:underline">
              Manage schedules →
            </Link>
          </CardFooter>
        </Card>
      </Grid>
    </>
  );
}

