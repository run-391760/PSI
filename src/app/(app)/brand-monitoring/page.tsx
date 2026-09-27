import { MessageSquareQuote } from "lucide-react";
import type { Metadata } from "next";
import { requirePageUser } from "@/lib/auth";
import { demoAllowed } from "@/lib/data-mode";
import { database } from "@/lib/domain";
import { compact, dateTimeLabel, timeAgo } from "@/lib/format";
import { getSchedule, latestJob } from "@/lib/jobs/queue";
import { param, projectContext } from "@/lib/local/project-context";
import { CHANNELS, defaultCompetitorTerms, getBrandSettings, mentionStats, ownMentions, shareOfVoice, trackedTerms } from "@/lib/monitoring/brand";
import { SENTIMENT_META } from "@/lib/monitoring/sentiment";
import { newsEnabled } from "@/lib/providers/news";
import { DomainAvatar } from "@/components/seo/badges";
import { DataSourceBadge, DemoNotice } from "@/components/seo/source-badge";
import { Grid, Page, PageHeader } from "@/components/shell/page";
import { ProjectGate } from "@/components/projects/project-gate";
import { ProjectSwitcher } from "@/components/projects/project-switcher";
import { BarChart } from "@/components/charts/bar-chart";
import { DonutChart } from "@/components/charts/donut-chart";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Callout, EmptyState } from "@/components/ui/feedback";
import { Metric, MetricStrip } from "@/components/ui/metric";
import { MiniTable } from "@/components/ui/mini-table";
import { JobProgress } from "@/components/local/job-progress";
import { BrandSettingsButton, BrandSettingsForm, FetchNowButton, MentionsChart, MentionsTable } from "@/components/brand/brand-ui";

export const metadata: Metadata = { title: "Brand Monitoring" };

const BREADCRUMBS = [{ label: "Content marketing" }, { label: "Brand Monitoring", href: "/brand-monitoring" }];

export default async function BrandMonitoringPage({ searchParams }: PageProps<"/brand-monitoring">) {
  const user = await requirePageUser();
  const sp = await searchParams;
  const { projects, project, requested, switcher } = await projectContext(user.id, sp);

  if (!project)
    return (
      <Page>
        <PageHeader breadcrumbs={BREADCRUMBS} title="Brand Monitoring" description="Track mentions of your brand and competitors in the news, with sentiment, reach and share of voice." />
        {requested && <Callout tone="warning" className="mb-4">That project was not found. Choose one of your projects below.</Callout>}
        <ProjectGate projects={projects} basePath="/brand-monitoring" title="Brand Monitoring" description="Choose the brand you want to monitor." />
      </Page>
    );

  const terms = trackedTerms(project);
  const settings = await getBrandSettings(project.id);
  const schedule = await getSchedule(project.id, "monitoring.brand");
  const job = await latestJob(project.id, "monitoring.brand");
  const running = !!job && (job.status === "queued" || job.status === "running");
  const settingsInitial = { terms, competitorTerms: settings?.competitorTerms ?? defaultCompetitorTerms(project), demoSocial: settings?.demoSocial ?? false, demoAvailable: demoAllowed(), daily: schedule ? schedule.enabled : true };
  const newsOff = !newsEnabled();

  if (!settings)
    return (
      <Page>
        <PageHeader breadcrumbs={BREADCRUMBS} title="Brand Monitoring:" subject={terms.join(", ")} meta={<DataSourceBadge source="google-news" />} actions={<ProjectSwitcher projects={switcher} current={project.id} />} />
        {newsOff && (
          <Callout tone="warning" className="mb-4" title="Google News is disabled">
            ENABLE_NEWS_MENTIONS is set to false, so no mentions can be collected until it is enabled.
          </Callout>
        )}
        <Grid cols={2} className="lg:grid-cols-[1.4fr_1fr]">
          <Card>
            <CardHeader title="Start monitoring your brand" description="We search Google News for your exact brand terms (and your competitors' names for share of voice), then keep checking daily." />
            <CardBody>
              <BrandSettingsForm projectId={project.id} initial={settingsInitial} submitLabel="Start monitoring" />
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="What you get" />
            <CardBody>
              <ul className="space-y-2.5 text-[13px] text-text-2">
                <li>
                  <span className="font-medium text-text">Real news mentions</span> from Google News RSS in the {database(project.country).name} edition, de-duplicated and stored.
                </li>
                <li>
                  <span className="font-medium text-text">Sentiment</span> from a transparent lexicon heuristic, plus auto-tags like Awards, Careers or Complaints.
                </li>
                <li>
                  <span className="font-medium text-text">Share of voice</span> against competitor brand names.
                </li>
                <li>
                  <span className="font-medium text-text">Alerts</span> for mention spikes and new negative coverage.
                </li>
                <li>
                  <span className="font-medium text-text">Triage</span>: mark mentions reviewed, archive, tag and export CSV.
                </li>
              </ul>
            </CardBody>
          </Card>
        </Grid>
      </Page>
    );

  const mentions = await ownMentions(project.id, settings.demoSocial);
  const stats = mentionStats(mentions);
  const sov = await shareOfVoice(project.id, 30);
  const ownNews30 = sov.find((r) => r.subject === "")?.mentions ?? 0;
  const sovRows = [{ name: terms[0], mentions: ownNews30, you: true }, ...settings.competitorTerms.map((t) => ({ name: t, mentions: sov.find((r) => r.subject === t)?.mentions ?? 0, you: false }))];
  const sovTotal = sovRows.reduce((s, r) => s + r.mentions, 0);
  const sovPct = sovTotal ? Math.round((ownNews30 / sovTotal) * 1000) / 10 : null;
  const delta = stats.prev30 ? ((stats.last30 - stats.prev30) / stats.prev30) * 100 : null;
  const lastRun = settings.lastRunAt;
  const hasDemo = settings.demoSocial;

  return (
    <Page>
      <PageHeader
        breadcrumbs={BREADCRUMBS}
        title="Brand Monitoring:"
        subject={terms.join(", ")}
        meta={
          <>
            <DataSourceBadge source="google-news" fetchedAt={lastRun ?? undefined} note={`${database(project.country).name} edition`} />
            {hasDemo && <DataSourceBadge source="demo" />}
            {schedule?.enabled ? <Badge tone="brand">Daily · next check {new Date(schedule.next_run_at).getTime() <= Date.now() ? "due now" : dateTimeLabel(new Date(schedule.next_run_at).toISOString())}</Badge> : <Badge>Manual fetch only</Badge>}
            {settings.competitorTerms.length > 0 && <Badge>vs {settings.competitorTerms.join(", ")}</Badge>}
          </>
        }
        actions={
          <>
            <ProjectSwitcher projects={switcher} current={project.id} />
            <BrandSettingsButton projectId={project.id} initial={settingsInitial} />
            <FetchNowButton projectId={project.id} disabled={running} />
          </>
        }
      />

      {running && job && <JobProgress jobId={job.id} endpoint="/api/brand/jobs" title="Collecting mentions" className="mb-4" />}
      {!running && job?.status === "failed" && (
        <Callout tone="critical" className="mb-4" title="The last fetch failed">
          {job.error}
        </Callout>
      )}
      {settings.lastError && !running && (
        <Callout tone="warning" className="mb-4" title="Some searches did not complete">
          {settings.lastError}
        </Callout>
      )}
      {newsOff && (
        <Callout tone="warning" className="mb-4" title="Google News is disabled">
          ENABLE_NEWS_MENTIONS is set to false; no new news mentions will be collected.
        </Callout>
      )}

      {mentions.length === 0 ? (
        <Card>
          {running ? (
            <EmptyState icon={<MessageSquareQuote className="h-5 w-5" />} title="Collecting your first mentions" description={`Searching Google News for “${terms.join("”, “")}”${settings.competitorTerms.length ? " and your competitors" : ""}. This usually takes a few seconds.`} />
          ) : (
            <EmptyState icon={<MessageSquareQuote className="h-5 w-5" />} title="No mentions found yet" description={`Google News has no recent articles containing “${terms.join("”, “")}”. Try adding brand variations in Settings.`} />
          )}
        </Card>
      ) : (
        <>
          <Card className="mb-4">
            <MetricStrip>
              <Metric label="Mentions (30 days)" value={stats.last30} delta={delta} deltaLabel="vs prior 30 days" sub={`${mentions.length} stored in total`} />
              <Metric label="Negative mentions" value={stats.negative30} sub={stats.last30 ? `${Math.round((stats.negative30 / stats.last30) * 100)}% of the last 30 days` : "Last 30 days"} />
              <Metric label="Share of voice" value={sovPct == null ? "n/a" : `${sovPct}%`} sub={settings.competitorTerms.length ? `${ownNews30} of ${sovTotal} news mentions` : "Add competitors in Settings"} info="Your share of Google News mentions among you and the competitor names, last 30 days." />
              <Metric label="Sources" value={stats.sources.length} sub="Publishers mentioning you" info="Distinct publishers in the last 30 days. Audience reach is not measured by any connected source." />
              <Metric label="To review" value={stats.unreviewed} sub="New mentions not yet reviewed" />
            </MetricStrip>
          </Card>

          <Grid cols={2} className="mb-4 lg:grid-cols-[1.6fr_1fr]">
            <Card>
              <CardHeader title="Mentions over time" description={`By publication date and sentiment${hasDemo ? " · includes demo social" : ""}`} />
              <CardBody>
                <MentionsChart days={stats.days} />
              </CardBody>
            </Card>
            <Card>
              <CardHeader title="Sentiment" description="Last 30 days" info="Lexicon-based: counts positive and negative words with negation handling. Treat it as a triage signal." />
              <CardBody>
                <DonutChart
                  size={130}
                  format="number"
                  centerValue={String(stats.last30)}
                  centerLabel="mentions"
                  data={(["positive", "neutral", "negative"] as const).map((k) => ({ label: SENTIMENT_META[k].label, value: stats.sentiment[k], color: SENTIMENT_META[k].color }))}
                />
                {stats.channels.length > 1 && (
                  <div className="mt-4 border-t border-border pt-3">
                    <div className="mb-2 text-[12.5px] font-medium text-text-2">By channel</div>
                    <ul className="grid grid-cols-2 gap-x-4 gap-y-1 text-[12.5px]">
                      {stats.channels.map((c) => (
                        <li key={c.channel} className="flex justify-between">
                          <span className="text-text-2">
                            {c.label}
                            {c.channel !== "news" && <span className="ml-1 text-[11px] text-warning-ink">demo</span>}
                          </span>
                          <span className="tabular text-text">{c.count}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </CardBody>
            </Card>
          </Grid>

          <Grid cols={2} className="mb-4">
            <Card>
              <CardHeader title="Share of voice" description="Google News mentions, last 30 days" />
              <CardBody>
                {settings.competitorTerms.length ? (
                  <BarChart data={sovRows.map((r) => ({ name: r.name, mentions: r.mentions }))} xKey="name" layout="bars" series={[{ key: "mentions", label: "Mentions" }]} yFormat="number" valueLabels highlight={terms[0]} categoryWidth={130} height={Math.max(140, sovRows.length * 42)} />
                ) : (
                  <p className="py-8 text-center text-[13px] text-text-3">Add competitor brand names in Settings to compare share of voice.</p>
                )}
              </CardBody>
            </Card>
            <Card>
              <CardHeader title="Top sources" description={stats.last30 ? "Last 30 days" : "All stored mentions"} />
              <CardBody>
                <MiniTable
                  columns={[{ header: "Source" }, { header: "Mentions", align: "right" }, { header: "Pos / neg", align: "right" }, { header: "Reach", align: "right" }]}
                  rows={stats.sources.slice(0, 8).map((s) => [
                    <span key="s" className="inline-flex min-w-0 items-center gap-2">
                      <DomainAvatar domain={s.domain ?? s.publisher} size={18} />
                      <span className="truncate">{s.publisher}</span>
                      {s.source === "demo" && <Badge tone="warning">Demo · {CHANNELS[s.channel] ?? s.channel}</Badge>}
                    </span>,
                    s.mentions,
                    <span key="t" className="tabular text-[12.5px]">
                      <span className="text-good-ink">{s.positive}</span> / <span className="text-critical-ink">{s.negative}</span>
                    </span>,
                    s.reach ? compact(s.reach) : "n/a",
                  ])}
                />
              </CardBody>
            </Card>
          </Grid>

          <Card className="mb-4">
            <CardHeader title="Mentions" description="Select mentions to mark them reviewed or archive them. Titles link to the original article." />
            <MentionsTable projectId={project.id} mentions={mentions} terms={terms} initialSentiment={param(sp, "sentiment")} />
          </Card>
        </>
      )}
      <p className="text-[12px] text-text-3">
        News mentions come from Google News RSS{lastRun ? `, last checked ${timeAgo(lastRun)}` : ""}. Reach is n/a: no connected source measures audience size{hasDemo ? "; social and forum mentions marked Demo are synthetic" : ""}.
      </p>
      {hasDemo && <DemoNotice className="mt-2" />}
    </Page>
  );
}
