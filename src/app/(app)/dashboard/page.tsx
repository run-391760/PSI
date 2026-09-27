import { FolderKanban, Plus } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { requirePageUser } from "@/lib/auth";
import { database } from "@/lib/domain";
import { money } from "@/lib/format";
import { listProjects } from "@/lib/projects";
import { projectSummaries } from "@/lib/projects/summaries";
import { monthlySpend } from "@/lib/providers/dataforseo";
import { liveEnabled } from "@/lib/providers/source";
import { dataSources, getPrefs, linkedGoogleProjects, listJobRows, maxMonthlyUsd, onboardingSteps } from "@/lib/reports/platform";
import { marketOverview } from "@/lib/sensor/market";
import { personalVolatility } from "@/lib/sensor/personal";
import { DataSourcesCard } from "@/components/dashboard/google-snapshot";
import { AutoRefresh } from "@/components/dashboard/auto-refresh";
import { DismissOnboarding } from "@/components/dashboard/dismiss-onboarding";
import { HeroSearch } from "@/components/dashboard/hero-search";
import { OnboardingCard, ProjectCard, QuickToolsGrid, RecentJobsCard, SensorMiniCard, type SensorMini, WelcomeBanner } from "@/components/dashboard/home-widgets";
import { NewProjectButton } from "@/components/projects/project-form";
import { Page } from "@/components/shell/page";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/feedback";
import { Bar } from "@/components/ui/progress";

export const metadata: Metadata = { title: "Home" };

const HOME_PROJECTS = 6;

export default async function DashboardPage({ searchParams }: PageProps<"/dashboard">) {
  const user = await requirePageUser();
  const sp = await searchParams;
  const welcome = sp.welcome === "1";
  const projects = await listProjects(user.id);
  const shown = projects.slice(0, HOME_PROJECTS);
  const primary = projects[0];
  const sensorDb = primary ? database(primary.country).code : "US";
  const sensorDevice = primary?.device === "mobile" ? "mobile" : "desktop";
  const [summaries, jobs, prefs, spend, linked, personal, market] = await Promise.all([
    Promise.all(projects.map((p) => projectSummaries(p))),
    listJobRows(user.id, { limit: 6 }),
    getPrefs(user.id),
    monthlySpend(user.id),
    linkedGoogleProjects(user.id),
    personalVolatility(user.id).catch(() => null),
    liveEnabled() ? marketOverview(sensorDb, sensorDevice).catch(() => null) : Promise.resolve(null),
  ]);
  const sensor: SensorMini = {
    db: sensorDb,
    device: sensorDevice,
    marketAvailable: liveEnabled(),
    market: market?.today ? { score: market.today.score, change: market.yesterday ? Math.round((market.today.score - market.yesterday.score) * 10) / 10 : null, series: market.series.slice(-30).map((d) => d.score), fetchedAt: market.fetchedAt } : null,
    personal: personal ? { score: personal.today, change: personal.change, series: personal.series.slice(-30).map((d) => d.score), keywords: personal.keywords, source: personal.source } : null,
    ptHref: primary ? `/position-tracking?project=${primary.id}` : "/position-tracking",
  };
  const steps = await onboardingSteps(user.id, projects, summaries);
  const allDone = steps.every((s) => s.done);
  const hidden = prefs.onboardingHidden === true;
  const budget = Math.min(Number(user.monthly_budget_micros) / 1e6, maxMonthlyUsd());
  const active = jobs.some((j) => j.status === "queued" || j.status === "running") || summaries.flat().some((s) => s.state === "running");
  const first = user.name.trim().split(/\s+/)[0];

  return (
    <Page>
      <AutoRefresh active={active} interval={4000} />
      {welcome && <WelcomeBanner name={user.name} />}

      <Card className="mb-4 overflow-hidden">
        <div className="relative px-5 pt-5 pb-4 sm:px-6">
          <div className="pointer-events-none absolute -top-24 -right-16 h-56 w-56 rounded-full bg-brand-soft opacity-70 blur-2xl" aria-hidden />
          <div className="relative">
            <p className="text-[12.5px] font-medium text-text-3">
              {welcome ? "Let's get started" : first ? `Welcome back, ${first}` : "Welcome back"}
            </p>
            <h1 className="mt-0.5 text-[22px] font-semibold tracking-tight text-text">What do you want to analyze today?</h1>
            <p className="mt-1 mb-4 text-[13px] text-text-2">Enter a domain or URL for Domain Overview, or a keyword for Keyword Overview.</p>
            <HeroSearch defaultDb={sensorDb} />
          </div>
        </div>
      </Card>

      {!allDone && !hidden && <OnboardingCard steps={steps} />}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
        <section className="min-w-0 space-y-4" aria-labelledby="my-projects">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 id="my-projects" className="flex items-center gap-2 text-[16px] font-semibold text-text">
              My projects
              {projects.length > 0 && <Badge>{projects.length}</Badge>}
            </h2>
            <div className="flex items-center gap-2">
              {projects.length > 0 && (
                <ButtonLink href="/projects" size="sm" variant="ghost">
                  All projects
                </ButtonLink>
              )}
              {projects.length > 0 && <NewProjectButton variant="secondary" label="New project" />}
            </div>
          </div>

          {projects.length === 0 ? (
            <Card>
              <EmptyState
                icon={<FolderKanban className="h-5 w-5" />}
                title="Create your first project"
                description="Projects monitor one website: Site Audit, Position Tracking, backlink and brand monitoring. You can still analyze any domain or keyword without one."
                action={<NewProjectButton />}
              />
            </Card>
          ) : (
            <>
              {shown.map((p) => (
                <ProjectCard key={p.id} project={p} summaries={summaries[projects.indexOf(p)]} />
              ))}
              {projects.length > HOME_PROJECTS && (
                <Link href="/projects" className="flex items-center justify-center gap-1.5 rounded-lg border border-dashed border-border-strong py-3 text-[13px] text-link hover:bg-surface">
                  View all {projects.length} projects →
                </Link>
              )}
              {projects.length <= HOME_PROJECTS && projects.length < 3 && (
                <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border-strong px-4 py-5 text-center sm:flex-row sm:gap-4">
                  <span className="inline-flex items-center gap-1.5 text-[13px] text-text-2">
                    <Plus className="h-4 w-4 text-text-3" /> Track a competitor or another site you manage
                  </span>
                  <NewProjectButton variant="secondary" label="Add project" />
                </div>
              )}
            </>
          )}
        </section>

        <aside className="min-w-0 space-y-4">
          <DataSourcesCard rows={dataSources(linked)} />
          <SensorMiniCard data={sensor} />
          <RecentJobsCard jobs={jobs} />
          <Card>
            <CardHeader title="Data usage" description="Paid API spend this month" href="/activity?tab=usage" />
            <CardBody>
              {liveEnabled() ? (
                <>
                  <div className="flex items-baseline justify-between text-[13px]">
                    <span className="text-[20px] font-semibold text-text">{money(spend)}</span>
                    <span className="text-text-3">of {money(budget)} budget</span>
                  </div>
                  <Bar value={spend} max={budget || 1} className="mt-2" color={spend / (budget || 1) > 0.9 ? "var(--critical)" : spend / (budget || 1) > 0.7 ? "var(--warning)" : "var(--brand)"} />
                </>
              ) : (
                <p className="text-[12.5px] text-text-2">
                  No paid provider connected, so nothing is charged. Reports that need web-scale index data show what to connect.{" "}
                  <Link href="/settings?tab=integrations" className="text-link hover:underline">
                    Connect DataForSEO
                  </Link>
                </p>
              )}
            </CardBody>
          </Card>
          {!allDone && hidden && (
            <div className="text-center">
              <DismissOnboarding show />
            </div>
          )}
        </aside>
      </div>

      <div className="mt-4">
        <QuickToolsGrid />
      </div>
    </Page>
  );
}
