import { FolderKanban } from "lucide-react";
import type { Metadata } from "next";
import { requirePageUser } from "@/lib/auth";
import { listProjects } from "@/lib/projects";
import { projectSummaries } from "@/lib/projects/summaries";
import { jobCounts, scheduleCounts } from "@/lib/reports/platform";
import { widgetTool } from "@/components/dashboard/tool-widget";
import { AutoRefresh } from "@/components/dashboard/auto-refresh";
import { NewProjectButton } from "@/components/projects/project-form";
import { Page, PageHeader } from "@/components/shell/page";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/feedback";
import { Metric, MetricStrip } from "@/components/ui/metric";
import { ProjectsTable, type ProjectRow } from "./projects-table";

export const metadata: Metadata = { title: "Projects" };

export default async function ProjectsPage() {
  const user = await requirePageUser();
  const projects = await listProjects(user.id);
  const [summaries, jobs, schedules] = await Promise.all([Promise.all(projects.map((p) => projectSummaries(p))), jobCounts(user.id), scheduleCounts(user.id)]);

  // One column per tool widget. Providers return widgets in a fixed order, so columns are by index.
  const width = Math.max(0, ...summaries.map((s) => s.length));
  const tools = Array.from({ length: width }, (_, index) => {
    const sample = summaries.map((s) => s[index]).find((s) => s && s.state !== "error");
    return { index, label: sample ? widgetTool(sample).label : "Tool" };
  });
  const rows: ProjectRow[] = projects.map((p, i) => ({
    id: p.id,
    name: p.name,
    domain: p.domain,
    country: p.country,
    device: p.device,
    location: p.location,
    competitors: p.competitors.length,
    created_at: typeof p.created_at === "string" ? p.created_at : new Date(p.created_at).toISOString(),
    summaries: summaries[i],
  }));
  const all = summaries.flat();
  const configured = all.filter((s) => s.state !== "empty").length;
  const running = all.some((s) => s.state === "running") || jobs.running + jobs.queued > 0;

  return (
    <Page>
      <AutoRefresh active={running} interval={5000} />
      <PageHeader
        breadcrumbs={[{ label: "Home", href: "/dashboard" }, { label: "Projects" }]}
        title="Projects"
        description="Every website you monitor, with the status of each tool at a glance."
        actions={<NewProjectButton />}
      />
      {projects.length === 0 ? (
        <Card>
          <EmptyState
            icon={<FolderKanban className="h-5 w-5" />}
            title="No projects yet"
            description="Create a project for your website to run Site Audit, Position Tracking, Backlink Audit, Brand Monitoring and more — all from one dashboard."
            action={<NewProjectButton />}
          />
        </Card>
      ) : (
        <>
          <Card className="mb-4">
            <MetricStrip>
              <Metric label="Projects" value={projects.length} sub={`${projects.reduce((s, p) => s + p.competitors.length, 0)} competitors tracked`} />
              <Metric label="Tools set up" value={`${configured} / ${all.length}`} sub="Across all projects" info="Tool widgets that are configured (ready, running or with an error)." />
              <Metric label="Jobs running" value={jobs.running + jobs.queued} sub={`${jobs.done24h} finished · ${jobs.failed24h} failed in 24h`} href="/activity" />
              <Metric label="Active schedules" value={schedules.enabled} sub={`${schedules.total} schedule${schedules.total === 1 ? "" : "s"} in total`} />
            </MetricStrip>
          </Card>
          <Card className="pt-3">
            <ProjectsTable rows={rows} tools={tools} />
          </Card>
        </>
      )}
    </Page>
  );
}
