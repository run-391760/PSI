import { ArrowRight, CircleCheck, Globe, Monitor, PartyPopper, Radar, Search, Smartphone, X } from "lucide-react";
import Link from "next/link";
import { database } from "@/lib/domain";
import { timeAgo } from "@/lib/format";
import type { Project } from "@/lib/projects";
import type { ToolSummary } from "@/lib/projects/summary-types";
import { jobKindLabel, type JobListRow } from "@/lib/reports/kinds";
import type { OnboardingStep } from "@/lib/reports/platform";
import { bandFor } from "@/lib/sensor/bands";
import type { DataSource } from "@/lib/providers/labels";
import { cn } from "@/lib/utils";
import { NAV } from "@/components/shell/nav";
import { DomainAvatar } from "@/components/seo/badges";
import { DataSourceBadge } from "@/components/seo/source-badge";
import { NewProjectButton } from "@/components/projects/project-form";
import { VolatilityStrip } from "@/components/sensor/volatility-strip";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardBody, CardFooter, CardHeader } from "@/components/ui/card";
import { Gauge } from "@/components/ui/progress";
import { DismissOnboarding } from "./dismiss-onboarding";
import { JobStatusBadge } from "./job-status";
import { ToolWidget, widgetTool } from "./tool-widget";

// ------------------------------------------------------------------------------------ welcome

export function WelcomeBanner({ name }: { name: string }) {
  const first = name.trim().split(/\s+/)[0] || "there";
  const actions = [
    { icon: Globe, title: "Analyze a domain", text: "Traffic, keywords and backlinks of any site.", href: "/domain-overview" },
    { icon: Search, title: "Research keywords", text: "Volume, difficulty and intent for any topic.", href: "/keyword-magic-tool" },
    { icon: Radar, title: "Check SERP volatility", text: "See how much Google results moved today.", href: "/sensor" },
  ];
  return (
    <Card className="relative mb-4 overflow-hidden border-brand/30">
      <div className="absolute inset-y-0 left-0 w-1 bg-brand" aria-hidden />
      <Link href="/dashboard" className="absolute top-3 right-3 rounded p-1 text-text-3 hover:bg-surface-3 hover:text-text" aria-label="Dismiss welcome message">
        <X className="h-4 w-4" />
      </Link>
      <div className="grid gap-4 p-5 lg:grid-cols-[1.1fr_2fr] lg:items-center">
        <div className="flex items-start gap-3 pr-6">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand-soft text-brand-ink">
            <PartyPopper className="h-5 w-5" />
          </span>
          <div>
            <h2 className="text-[17px] font-semibold text-text">Welcome to SynapseSEO, {first}!</h2>
            <p className="mt-1 text-[13px] text-text-2">Your account is ready. Create a project for your website to unlock audits, rank tracking and monitoring, or jump straight into research.</p>
            <div className="mt-3">
              <NewProjectButton label="Create your first project" />
            </div>
          </div>
        </div>
        <div className="grid gap-2 sm:grid-cols-3">
          {actions.map((a) => (
            <Link key={a.href} href={a.href} className="group rounded-lg border border-border bg-surface-2 p-3 hover:border-brand/40 hover:bg-surface">
              <a.icon className="h-4 w-4 text-brand-ink" />
              <div className="mt-1.5 flex items-center gap-1 text-[13px] font-semibold text-text group-hover:text-link">
                {a.title} <ArrowRight className="h-3.5 w-3.5 opacity-0 transition-opacity group-hover:opacity-100" />
              </div>
              <p className="mt-0.5 text-[12px] text-text-3">{a.text}</p>
            </Link>
          ))}
        </div>
      </div>
    </Card>
  );
}

// --------------------------------------------------------------------------------- onboarding

export function OnboardingCard({ steps }: { steps: OnboardingStep[] }) {
  const done = steps.filter((s) => s.done).length;
  const next = steps.find((s) => !s.done);
  return (
    <Card className="mb-4">
      <CardHeader
        title="Get started checklist"
        description={`${done} of ${steps.length} steps complete`}
        actions={<DismissOnboarding />}
      />
      <div className="px-4">
        <div className="h-1.5 overflow-hidden rounded-full bg-surface-3" role="progressbar" aria-valuenow={done} aria-valuemin={0} aria-valuemax={steps.length} aria-label="Setup progress">
          <div className="h-full rounded-full bg-good transition-[width]" style={{ width: `${(done / steps.length) * 100}%` }} />
        </div>
      </div>
      <ol className="mt-2 divide-y divide-border">
        {steps.map((s, i) => (
          <li key={s.id} className={cn("flex items-center gap-3 px-4 py-2.5", s.id === next?.id && "bg-surface-2")}>
            {s.done ? (
              <CircleCheck className="h-5 w-5 shrink-0 text-good" aria-label="Done" />
            ) : (
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 border-border-strong text-[10.5px] font-semibold text-text-3">{i + 1}</span>
            )}
            <div className="min-w-0 flex-1">
              <div className={cn("text-[13px] font-medium", s.done ? "text-text-3 line-through decoration-text-3/50" : "text-text")}>{s.label}</div>
              {!s.done && <div className="text-[12px] text-text-3">{s.description}</div>}
            </div>
            {!s.done &&
              (s.id === "project" ? (
                <NewProjectButton variant={s.id === next?.id ? "primary" : "secondary"} label={s.cta} />
              ) : (
                <ButtonLink href={s.href ?? "/projects"} size="sm" variant={s.id === next?.id ? "primary" : "secondary"}>
                  {/* span: globals.css `a { color: inherit }` overrides text utilities on <a> */}
                  <span className={s.id === next?.id ? "text-white" : undefined}>{s.cta}</span>
                </ButtonLink>
              ))}
          </li>
        ))}
      </ol>
    </Card>
  );
}

// ------------------------------------------------------------------------------------- sensor

export type SensorMini = {
  db: string;
  device: "desktop" | "mobile";
  market: { score: number; change: number | null; series: number[]; fetchedAt: string | null } | null;
  marketAvailable: boolean;
  personal: { score: number; change: number; series: number[]; keywords: number; source: DataSource } | null;
  ptHref: string;
};

export function SensorMiniCard({ data }: { data: SensorMini }) {
  const info = database(data.db);
  const main = data.market ?? data.personal;
  const band = main ? bandFor(main.score) : null;
  const href = `/sensor?db=${data.db}&device=${data.device}`;
  return (
    <Card>
      <CardHeader title="SERP Sensor" description={`${data.market ? "Google volatility" : "Your rankings' volatility"} · ${info.flag} ${info.code} · ${data.device === "mobile" ? "Mobile" : "Desktop"}`} href={href} />
      <CardBody>
        {main && band ? (
          <div className="flex items-center gap-4">
            <Gauge value={main.score * 10} color={band.color} size={116} label={main.score.toFixed(1)} sub="of 10" />
            <div className="min-w-0 flex-1">
              <Badge tone={band.tone}>{band.label} volatility</Badge>
              {main.change != null && (
                <div className="mt-1.5 text-[12px] text-text-3">
                  <span className={cn("font-medium", main.change === 0 ? "text-text-2" : main.change > 0 ? "text-serious-ink" : "text-good-ink")}>
                    {main.change > 0 ? "+" : ""}
                    {main.change.toFixed(1)}
                  </span>{" "}
                  vs previous day
                </div>
              )}
              <VolatilityStrip values={main.series} width={150} height={26} className="mt-2" />
              <div className="text-[11px] text-text-3">{data.market ? "Market panel" : `${data.personal?.keywords ?? 0} tracked keywords`}</div>
            </div>
          </div>
        ) : (
          <p className="py-3 text-[12.5px] text-text-2">
            {data.marketAvailable ? "The market score appears after two daily snapshots. " : "Market volatility needs DataForSEO. "}
            <Link href={data.ptHref} className="text-link hover:underline">
              Track keywords
            </Link>{" "}
            to see how your own rankings move.
          </p>
        )}
      </CardBody>
      <CardFooter className="flex items-center justify-between gap-2">
        {data.market ? <DataSourceBadge source="dataforseo" fetchedAt={data.market.fetchedAt ?? undefined} /> : data.personal ? <DataSourceBadge source={data.personal.source} /> : <span className="text-text-3">No data yet</span>}
        <Link href={href} className="text-link hover:underline">
          Open Sensor →
        </Link>
      </CardFooter>
    </Card>
  );
}

// ---------------------------------------------------------------------------------------- jobs

export function RecentJobsCard({ jobs, title = "Recent jobs", showProject = true, className }: { jobs: JobListRow[]; title?: string; showProject?: boolean; className?: string }) {
  return (
    <Card className={className}>
      <CardHeader title={title} description="Background audits, rank checks and exports" href="/activity" />
      {jobs.length === 0 ? (
        <CardBody>
          <p className="py-5 text-center text-[12.5px] text-text-3">No background jobs yet. They appear here when you run a Site Audit, a rank check or another long task.</p>
        </CardBody>
      ) : (
        <ul className="divide-y divide-border border-t border-border">
          {jobs.map((j) => {
            const k = jobKindLabel(j.kind);
            return (
              <li key={j.id} className="flex items-center gap-3 px-4 py-2">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px] text-text">
                    <span className="font-medium">{k.tool}</span> <span className="text-text-2">· {k.action}</span>
                  </div>
                  <div className="truncate text-[11.5px] text-text-3">
                    {showProject && j.project_domain ? `${j.project_domain} · ` : ""}
                    {timeAgo(j.created_at)}
                    {j.status === "running" && j.message ? ` · ${j.message}` : ""}
                  </div>
                </div>
                <JobStatusBadge status={j.status} />
              </li>
            );
          })}
        </ul>
      )}
      <CardFooter>
        <Link href="/activity" className="text-link hover:underline">
          View all activity →
        </Link>
      </CardFooter>
    </Card>
  );
}

// --------------------------------------------------------------------------------- quick tools

export function QuickToolsGrid() {
  const groups = NAV.filter((g) => g.id !== "home");
  return (
    <Card>
      <CardHeader title="All tools" description="Jump to any tool — grouped like the sidebar" />
      <CardBody className="grid gap-x-6 gap-y-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        {groups.map((g) => (
          <div key={g.id} className="min-w-0">
            <div className="mb-1.5 text-[11px] font-semibold tracking-wider text-text-3 uppercase">{g.label}</div>
            <ul className="space-y-0.5">
              {g.items.map((t) => (
                <li key={t.href}>
                  <Link href={t.href} title={t.description} className="group flex items-center gap-2 rounded-md px-1.5 py-1 text-[13px] text-text-2 hover:bg-surface-3 hover:text-text">
                    <t.icon className="h-4 w-4 shrink-0 text-text-3 group-hover:text-brand-ink" />
                    <span className="truncate">{t.label}</span>
                    {t.badge && <Badge tone="brand" className="ml-auto h-4 px-1 text-[10px]">{t.badge}</Badge>}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </CardBody>
    </Card>
  );
}

// ------------------------------------------------------------------------------------ projects

export function ProjectMeta({ project, className }: { project: Pick<Project, "domain" | "country" | "device" | "location">; className?: string }) {
  const info = database(project.country);
  const DeviceIcon = project.device === "mobile" ? Smartphone : Monitor;
  return (
    <span className={cn("inline-flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-[12px] text-text-3", className)}>
      <span className="truncate">{project.domain}</span>
      <span aria-hidden>·</span>
      <span title={info.name}>
        {info.flag} {info.code}
      </span>
      <span aria-hidden>·</span>
      <span className="inline-flex items-center gap-1 capitalize">
        <DeviceIcon className="h-3 w-3" /> {project.device}
      </span>
      {project.location && (
        <>
          <span aria-hidden>·</span>
          <span className="truncate">{project.location}</span>
        </>
      )}
    </span>
  );
}

/** Home "My projects" card: project header + its tool widgets (set-up chips for the rest). */
export function ProjectCard({ project, summaries }: { project: Project; summaries: ToolSummary[] }) {
  const active = summaries.filter((s) => s.state !== "empty");
  const empty = summaries.filter((s) => s.state === "empty");
  // Empty tools complete the 2-column grid (at least 2 tiles) on larger screens; on phones they collapse into chips.
  const fillers = empty.slice(0, active.length ? active.length % 2 : 2);
  const chips = empty.slice(fillers.length);
  return (
    <Card>
      <div className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-3">
        <DomainAvatar domain={project.domain} size={30} />
        <div className="min-w-[180px] flex-1">
          <Link href={`/projects/${project.id}`} className="block truncate text-[14.5px] font-semibold text-text hover:text-link">
            {project.name}
          </Link>
          <ProjectMeta project={project} />
        </div>
        <div className="flex items-center gap-1.5">
          <ButtonLink href={`/domain-overview?q=${encodeURIComponent(project.domain)}&db=${project.country}`} size="sm" variant="ghost" className="hidden sm:inline-flex">
            Domain Overview
          </ButtonLink>
          <ButtonLink href={`/projects/${project.id}`} size="sm">
            Open project
          </ButtonLink>
        </div>
      </div>
      <div className="grid gap-3 p-4 sm:grid-cols-2">
        {active.map((s, i) => (
          <ToolWidget key={`${s.tool}-${i}`} summary={s} />
        ))}
        {fillers.map((s, i) => (
          <ToolWidget key={`${s.tool}-f${i}`} summary={s} className="hidden sm:flex" />
        ))}
        {active.length === 0 && <p className="text-[12.5px] text-text-3 sm:hidden">No tools set up yet for this project.</p>}
      </div>
      {empty.length > 0 && (
        <div className={cn("flex flex-wrap items-center gap-2 border-t border-border px-4 py-2.5 text-[12.5px]", chips.length === 0 && "sm:hidden")}>
          <span className="text-text-3">Set up:</span>
          {empty.map((s, i) => {
            const m = widgetTool(s);
            return (
              <Link key={`${s.tool}-${i}`} href={s.href} className={cn("inline-flex items-center gap-1.5 rounded-full border border-border px-2.5 py-0.5 text-text-2 hover:border-brand/40 hover:text-link", i < fillers.length && "sm:hidden")}>
                <m.icon className="h-3.5 w-3.5 text-text-3" />
                {m.label}
              </Link>
            );
          })}
        </div>
      )}
    </Card>
  );
}
