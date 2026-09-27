import { CalendarClock, MapPin, Monitor, MonitorSmartphone, Smartphone, Target } from "lucide-react";
import type { Metadata } from "next";
import { requirePageUser } from "@/lib/auth";
import { database } from "@/lib/domain";
import { timeAgo } from "@/lib/format";
import { findProject, listProjects } from "@/lib/projects";
import { demoAllowed } from "@/lib/data-mode";
import { domainCompetitors, domainKeywords } from "@/lib/seo/engine";
import { gscSuggestions, linkedGscSite } from "@/lib/position-tracking/gsc";
import { loadContext } from "@/lib/position-tracking/reports";
import { activeCheck, checkSchedule, lastCheck } from "@/lib/position-tracking/run";
import { availableSources, campaignsByOwner, getCampaign, listKeywords, listTags } from "@/lib/position-tracking/store";
import { MAX_KEYWORDS, type CampaignSource } from "@/lib/position-tracking/types";
import type { Suggestion } from "@/components/position-tracking/keyword-input";
import { SwitchSourceButtons } from "@/components/position-tracking/settings-panel";
import { NeedsData } from "@/components/seo/needs-data";
import { ButtonLink } from "@/components/ui/button";
import { DataSourceBadge, DemoNotice } from "@/components/seo/source-badge";
import { Page, PageHeader } from "@/components/shell/page";
import { ProjectSwitcher } from "@/components/projects/project-switcher";
import { AddKeywordsButton } from "@/components/position-tracking/add-keywords";
import { CheckProgress, UpdateNowButton } from "@/components/position-tracking/check-progress";
import { ProjectPicker } from "@/components/position-tracking/project-picker";
import { ReportToolbar } from "@/components/position-tracking/report-toolbar";
import { SetupWizard } from "@/components/position-tracking/setup-wizard";
import { CannibalizationTab } from "@/components/position-tracking/tabs/cannibalization";
import { CompetitorsTab } from "@/components/position-tracking/tabs/competitors";
import { DevicesTab } from "@/components/position-tracking/tabs/devices";
import { FeaturesTab } from "@/components/position-tracking/tabs/features";
import { LandscapeTab } from "@/components/position-tracking/tabs/landscape";
import { OverviewTab } from "@/components/position-tracking/tabs/overview";
import { PagesTab } from "@/components/position-tracking/tabs/pages";
import { SettingsTab } from "@/components/position-tracking/tabs/settings";
import { TagsTab } from "@/components/position-tracking/tabs/tags";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Callout, EmptyState } from "@/components/ui/feedback";
import { TabsNav } from "@/components/ui/tabs";

export const metadata: Metadata = { title: "Position Tracking" };

const TABS = [
  { id: "landscape", label: "Landscape" },
  { id: "overview", label: "Overview" },
  { id: "competitors", label: "Competitors discovery" },
  { id: "pages", label: "Pages" },
  { id: "cannibalization", label: "Cannibalization" },
  { id: "features", label: "Featured snippets" },
  { id: "devices", label: "Devices & locations" },
  { id: "tags", label: "Tags" },
  { id: "settings", label: "Settings" },
] as const;
type TabId = (typeof TABS)[number]["id"];

const DEVICE_META = {
  desktop: { label: "Desktop", icon: Monitor },
  mobile: { label: "Mobile", icon: Smartphone },
  both: { label: "Desktop & mobile", icon: MonitorSmartphone },
};

function parseImport(v: string | undefined) {
  if (!v) return [];
  return [...new Set(v.split(/[,\n]/).map((s) => s.trim().toLowerCase().replace(/\s+/g, " ")).filter((s) => s && s.length <= 255))].slice(0, MAX_KEYWORDS);
}

export default async function PositionTrackingPage({ searchParams }: PageProps<"/position-tracking">) {
  const user = await requirePageUser();
  const sp = await searchParams;
  const str = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : undefined);
  const projects = await listProjects(user.id);
  const project = await findProject(user.id, str("project"));
  const imported = parseImport(str("import"));
  const crumbs = [{ label: "Keyword research" }, { label: "Position Tracking", href: "/position-tracking" }];

  if (!project) {
    const status = await campaignsByOwner(user.id);
    return (
      <Page>
        <PageHeader breadcrumbs={crumbs} title="Position Tracking" description="Track daily Google rankings for your keywords, measure visibility and share of voice against competitors, and get alerted when positions change." />
        {imported.length > 0 && (
          <div className="mb-4 rounded-lg border border-link/25 bg-info-soft px-4 py-3 text-[13px] text-text-2">
            <span className="font-semibold text-text">
              {imported.length} keyword{imported.length === 1 ? "" : "s"} ready to track.
            </span>{" "}
            Choose the project to add {imported.length === 1 ? "it" : "them"} to.
          </div>
        )}
        <ProjectPicker projects={projects} status={status} extra={imported.length ? `&import=${encodeURIComponent(imported.join(","))}` : ""} />
      </Page>
    );
  }

  const switcher = <ProjectSwitcher projects={projects.map((p) => ({ id: p.id, name: p.name, domain: p.domain }))} current={project.id} />;
  const campaign = await getCampaign(project.id);

  if (!campaign) {
    const sources = await availableSources(project.id);
    if (!sources.length)
      return (
        <Page>
          <PageHeader breadcrumbs={[...crumbs, { label: project.name }]} title="Set up Position Tracking:" subject={project.domain} description="Track daily Google rankings for your keywords." actions={switcher} />
          <NeedsData
            providers={["google", "dataforseo"]}
            title="Link Search Console or connect DataForSEO to track rankings"
            shows={["Daily position of every tracked keyword, per device", "Real clicks, impressions and CTR (Search Console)", "Ranking pages and cannibalization", "Competitors, SERP features and search volume (DataForSEO)", "Alerts when positions change"]}
          >
            <div className="mt-3">
              <ButtonLink href={`/organic-traffic-insights?project=${project.id}`} size="sm" variant="primary">
                Link Search Console for {project.domain}
              </ButtonLink>
            </div>
          </NeedsData>
        </Page>
      );
    const site = sources[0] === "search-console" ? await linkedGscSite(project.id) : null;
    const suggestions: Suggestion[] = site
      ? await gscSuggestions(user.id, site, project.country).catch(() => [])
      : sources[0] === "demo"
        ? domainKeywords(project.domain, project.country)
            .slice(0, 150)
            .map((k) => ({ keyword: k.keyword, position: k.position, volume: k.metrics.volume, kd: k.metrics.kd }))
        : [];
    const suggestedCompetitors = sources[0] === "demo" ? domainCompetitors(project.domain, project.country, 8).map((c) => c.domain) : [];
    return (
      <Page>
        <PageHeader
          breadcrumbs={[...crumbs, { label: project.name }]}
          title="Set up Position Tracking:"
          subject={project.domain}
          description="Choose where to track, who to compare against and which keywords matter. Rankings are then checked every day."
          meta={<DataSourceBadge source={sources[0]} />}
          actions={switcher}
        />
        <SetupWizard
          project={{ id: project.id, name: project.name, domain: project.domain, country: project.country, device: project.device, location: project.location }}
          projectCompetitors={project.competitors}
          suggestedCompetitors={suggestedCompetitors}
          suggestions={suggestions}
          prefill={imported}
          sources={sources}
        />
        {sources[0] === "demo" && <DemoNotice className="mt-6" />}
      </Page>
    );
  }

  // Demo campaigns are hidden unless DEMO_DATA=true: offer to re-collect from a real source instead.
  if (campaign.source === "demo" && !demoAllowed()) {
    const targets = (await availableSources(project.id)).filter((s): s is Exclude<CampaignSource, "demo"> => s !== "demo");
    return (
      <Page>
        <PageHeader breadcrumbs={[...crumbs, { label: project.name }]} title="Position Tracking:" subject={project.domain} actions={switcher} />
        {targets.length ? (
          <Card className="p-5">
            <h2 className="text-[15px] font-semibold text-text">This campaign contains demo data</h2>
            <p className="mt-1 max-w-2xl text-[13px] text-text-2">
              It was created with synthetic rankings, which are no longer shown. Your keywords, tags and alert rules are kept. Switch to a real source to re-collect the history
              {targets[0] === "search-console" ? " (the last 90 days from Search Console)" : ""}.
            </p>
            <SwitchSourceButtons projectId={project.id} targets={targets} />
          </Card>
        ) : (
          <NeedsData providers={["google", "dataforseo"]} title="This campaign contains demo data — link a real source to see rankings" shows={["Your keywords, tags and alert rules are kept", "Search Console backfills 90 days of real positions, clicks and impressions", "DataForSEO tracks live SERPs, competitors and SERP features"]}>
            <div className="mt-3">
              <ButtonLink href={`/organic-traffic-insights?project=${project.id}`} size="sm" variant="primary">
                Link Search Console for {project.domain}
              </ButtonLink>
            </div>
          </NeedsData>
        )}
      </Page>
    );
  }

  const [keywords, tags, job, schedule, last] = await Promise.all([listKeywords(project.id), listTags(project.id), activeCheck(project.id), checkSchedule(project.id), lastCheck(project.id)]);
  const tab: TabId = TABS.some((t) => t.id === str("tab")) ? (str("tab") as TabId) : "landscape";
  const ctx = await loadContext({ id: project.id, name: project.name, domain: project.domain }, campaign, keywords, tags, {
    device: str("device"),
    range: str("range"),
    tags: str("tags")?.split(",").filter(Boolean),
  });
  const db = database(campaign.db);
  const dev = DEVICE_META[campaign.device];
  const params = new URLSearchParams({ project: project.id });
  if (str("range")) params.set("range", str("range")!);
  if (str("device")) params.set("device", str("device")!);
  if (str("tags")) params.set("tags", str("tags")!);
  const base = `/position-tracking?${params.toString()}`;
  const gscSite = campaign.source === "search-console" ? await linkedGscSite(project.id) : null;
  const addSuggestions: Suggestion[] = gscSite
    ? await gscSuggestions(user.id, gscSite, campaign.db).catch(() => [])
    : campaign.source === "demo"
      ? domainKeywords(project.domain, campaign.db)
          .slice(0, 150)
          .map((k) => ({ keyword: k.keyword, position: k.position, volume: k.metrics.volume, kd: k.metrics.kd }))
      : [];
  const hasData = ctx.days.length > 0;
  const reportTab = !["tags", "settings"].includes(tab);

  return (
    <Page>
      <PageHeader
        breadcrumbs={[...crumbs, { label: project.name }]}
        title="Position Tracking:"
        subject={project.domain}
        meta={
          <>
            <DataSourceBadge source={campaign.source} fetchedAt={campaign.lastCheckAt ?? undefined} note={ctx.measured ? "average positions of your own site" : undefined} />
            <Badge>
              {db.flag} {db.name} · Google
            </Badge>
            {campaign.location && (
              <Badge>
                <MapPin className="h-3 w-3" /> {campaign.location}
              </Badge>
            )}
            <Badge>
              <dev.icon className="h-3 w-3" /> {dev.label}
            </Badge>
            <Badge tone="brand">
              <Target className="h-3 w-3" /> {keywords.length.toLocaleString()} keyword{keywords.length === 1 ? "" : "s"}
            </Badge>
            <span className="inline-flex items-center gap-1 text-[12px] text-text-3">
              <CalendarClock className="h-3.5 w-3.5" />
              {campaign.lastCheckAt ? `Updated ${timeAgo(campaign.lastCheckAt)}` : "Not checked yet"}
              {schedule?.enabled ? ` · ${schedule.cadence} updates` : " · automatic updates off"}
            </span>
          </>
        }
        actions={
          <>
            {switcher}
            <UpdateNowButton projectId={project.id} disabled={Boolean(job)} />
            <AddKeywordsButton
              projectId={project.id}
              existing={keywords.map((k) => k.keyword)}
              remaining={Math.max(0, MAX_KEYWORDS - keywords.length)}
              suggestions={addSuggestions}
              tagNames={tags.map((t) => t.name)}
              prefill={imported}
            />
          </>
        }
      />

      {ctx.measured && (
        <p className="-mt-2 mb-3 text-[12.5px] text-text-3">
          Positions are Search Console daily averages for {project.domain}{gscSite ? ` (${gscSite})` : ""}, {database(campaign.db).name} searches only; “–” means no impressions that day. Latest data: {campaign.lastDay ?? "pending"} (Search Console lags 2–3 days).
        </p>
      )}
      {job && <CheckProgress projectId={project.id} job={{ id: job.id, status: job.status, progress: job.progress, total: job.total, message: job.message }} />}
      {!job && last?.status === "failed" && (
        <Callout tone="critical" className="mb-4" title="The last rank check failed" action={<UpdateNowButton projectId={project.id} />}>
          {last.error ?? "Unknown error."} {last.finished_at ? `(${timeAgo(new Date(last.finished_at).toISOString())})` : ""}
        </Callout>
      )}

      <TabsNav className="mb-4" items={TABS.map((t) => ({ href: `/position-tracking?tab=${t.id}`, label: t.label, count: t.id === "tags" ? tags.length || undefined : undefined }))} />

      {reportTab && (
        <ReportToolbar
          range={ctx.range}
          device={ctx.device}
          devices={ctx.devices}
          tags={tags.map((t) => ({ id: t.id, name: t.name }))}
          selectedTags={ctx.tagIds}
          startDay={ctx.startDay}
          endDay={ctx.endDay}
          showDevice={tab !== "devices"}
        />
      )}
      {tab === "tags" && <ReportToolbar range={ctx.range} device={ctx.device} devices={ctx.devices} tags={[]} selectedTags={[]} startDay={ctx.startDay} endDay={ctx.endDay} showTags={false} />}

      {reportTab && !hasData ? (
        <Card>
          <EmptyState
            icon={<Target className="h-5 w-5" />}
            title={job ? "Collecting your first rankings…" : "No rankings collected yet"}
            description={job ? "This usually takes a few seconds. The reports appear as soon as the check completes." : "Run a check to collect today's rankings for your keywords and competitors."}
            action={job ? undefined : <UpdateNowButton projectId={project.id} />}
          />
        </Card>
      ) : (
        <>
          {tab === "landscape" && <LandscapeTab ctx={ctx} base={base} />}
          {tab === "overview" && <OverviewTab ctx={ctx} initialKeyword={str("kw") ?? null} filter={str("filter") ?? null} />}
          {tab === "competitors" && <CompetitorsTab ctx={ctx} />}
          {tab === "pages" && <PagesTab ctx={ctx} domain={str("domain") ?? null} />}
          {tab === "cannibalization" && <CannibalizationTab ctx={ctx} />}
          {tab === "features" && <FeaturesTab ctx={ctx} base={base} />}
          {tab === "devices" && <DevicesTab ctx={ctx} />}
          {tab === "tags" && <TagsTab ctx={ctx} base={base} />}
          {tab === "settings" && <SettingsTab ctx={ctx} ownerId={user.id} schedule={schedule ? { cadence: schedule.cadence, enabled: schedule.enabled, nextRunAt: new Date(schedule.next_run_at).toISOString() } : null} />}
        </>
      )}
      {campaign.source === "demo" && <DemoNotice className="mt-6" />}
    </Page>
  );
}
