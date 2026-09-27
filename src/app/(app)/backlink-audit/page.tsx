import { ArrowRight, Ban, Download, MailX, ShieldAlert, ShieldCheck } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { requirePageUser } from "@/lib/auth";
import { AUDIT_JOB, auditAvailable, auditSchedule, disavowText, effectiveStats, getAuditSettings, latestDomainsAreDemo, latestRunsByProject, listAllListEntries, listAuditDomains, listAuditRuns, listOrphanListEntries } from "@/lib/backlinks/audit";
import { LIVE_MARKERS } from "@/lib/backlinks/map";
import { demoAllowed } from "@/lib/data-mode";
import { liveEnabled } from "@/lib/providers/source";
import { NeedsData } from "@/components/seo/needs-data";
import { MARKER_INFO, POTENTIAL_MIN, TOXIC_MIN, type AuditDomainRow } from "@/lib/backlinks/types";
import { database } from "@/lib/domain";
import { compact, dateTimeLabel, timeAgo } from "@/lib/format";
import { latestJob } from "@/lib/jobs/queue";
import { findProject, listProjects } from "@/lib/projects";
import type { DataSource } from "@/lib/providers/labels";
import { BarChart } from "@/components/charts/bar-chart";
import { TrendChart } from "@/components/charts/trend-chart";
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
import { DistributionBar, Gauge } from "@/components/ui/progress";
import { TabsNav } from "@/components/ui/tabs";
import { InfoTip } from "@/components/ui/tooltip";
import { AuditSettingsButton, AuditSetupForm, RunAuditButton } from "@/components/backlinks/audit-controls";
import { DisavowPanel, RemoveTable } from "@/components/backlinks/audit-lists";
import { AuditTable } from "@/components/backlinks/audit-table";
import { JobProgress } from "@/components/backlinks/job-progress";
import { LEVEL_META, MarkerChips, ToxicityScore } from "@/components/backlinks/toxicity";

export const metadata: Metadata = { title: "Backlink Audit" };

const BREADCRUMBS = [{ label: "Link building" }, { label: "Backlink Audit", href: "/backlink-audit" }];
const TABS = ["overview", "audit", "remove", "disavow", "history"] as const;
type Tab = (typeof TABS)[number];

function timeUntil(date: string) {
  const ms = new Date(date).getTime() - Date.now();
  if (ms <= 60_000) return "soon";
  const h = Math.round(ms / 3_600_000);
  return h < 24 ? `in ${Math.max(1, h)}h` : `in ${Math.round(h / 24)}d`;
}

/** Gauge position by level so Low/Medium/High read as thirds of the dial. */
function gaugePosition(score: number) {
  if (score < 6) return (score / 6) * 33;
  if (score < 20) return 33 + ((score - 6) / 14) * 33;
  return Math.min(100, 66 + ((score - 20) / 40) * 34);
}

const BUCKETS: { label: string; min: number; max: number }[] = [
  { label: "0–9", min: 0, max: 9 },
  { label: "10–19", min: 10, max: 19 },
  { label: "20–29", min: 20, max: 29 },
  { label: "30–39", min: 30, max: 39 },
  { label: "40–44", min: 40, max: 44 },
  { label: "45–49", min: 45, max: 49 },
  { label: "50–59", min: 50, max: 59 },
  { label: "60–69", min: 60, max: 69 },
  { label: "70–79", min: 70, max: 79 },
  { label: "80–89", min: 80, max: 89 },
  { label: "90–100", min: 90, max: 100 },
];

export default async function BacklinkAuditPage({ searchParams }: PageProps<"/backlink-audit">) {
  const user = await requirePageUser();
  const sp = await searchParams;
  const projects = await listProjects(user.id);
  const project = await findProject(user.id, typeof sp.project === "string" ? sp.project : null);

  if (!project) {
    const runs = await latestRunsByProject(projects.map((p) => p.id));
    const status = Object.fromEntries(
      [...runs.entries()].map(([id, r]) => [
        id,
        <span key={id} className="inline-flex items-center gap-2">
          <span className={LEVEL_META[r.level].ink}>{LEVEL_META[r.level].label} toxic score</span>
          <span className="text-text-3">· {r.toxic} toxic · {timeAgo(r.createdAt)}</span>
        </span>,
      ]),
    );
    return (
      <Page className="overflow-x-clip">
        <PageHeader breadcrumbs={BREADCRUMBS} title="Backlink Audit" description="Find toxic backlinks, reach out to site owners to remove them, and build a disavow file for Google." />
        <ProjectGate projects={projects} basePath="/backlink-audit" title="Backlink Audit" description="Pick the project whose backlink profile you want to audit." status={status} />
      </Page>
    );
  }

  const tabParam = typeof sp.tab === "string" ? sp.tab : "overview";
  const tab: Tab = (TABS as readonly string[]).includes(tabParam) ? (tabParam as Tab) : "overview";
  const [settings, job, allRuns, schedule, domainsDemo] = await Promise.all([getAuditSettings(project.id), latestJob(project.id, AUDIT_JOB), listAuditRuns(project.id), auditSchedule(project.id), latestDomainsAreDemo(project.id)]);
  const available = auditAvailable();
  const running = available && !!job && (job.status === "queued" || job.status === "running");
  // The stored domains belong to the most recent run; if that run used (hidden) demo data, show no results.
  const runs = domainsDemo ? [] : allRuns;
  const latest = runs[0] ?? null;
  const source: DataSource = (latest?.source as DataSource) ?? (liveEnabled() ? "dataforseo" : "demo");
  const markerNames = liveEnabled() || !demoAllowed() ? [...LIVE_MARKERS] : Object.keys(MARKER_INFO).filter((m) => m !== "Not in latest audit");
  const setupValues = { brandTerms: settings?.brandTerms ?? project.brand_terms ?? [], country: settings?.country ?? project.country, weekly: settings?.weekly ?? true };
  const switcher = <ProjectSwitcher projects={projects.map((p) => ({ id: p.id, name: p.name, domain: p.domain }))} current={project.id} />;

  const header = (
    <PageHeader
      breadcrumbs={BREADCRUMBS}
      title="Backlink Audit:"
      subject={project.domain}
      meta={
        <>
          {latest && <DataSourceBadge source={source} fetchedAt={latest.createdAt} />}
          {latest && <Badge>Last audit {timeAgo(latest.createdAt)}</Badge>}
          {settings && available && (schedule?.enabled ? <Badge tone="info">Weekly re-audit · next {timeUntil(schedule.next_run_at)}</Badge> : <Badge>Schedule off</Badge>)}
          {settings && (
            <Badge>
              {database(settings.country).flag} {database(settings.country).name}
            </Badge>
          )}
        </>
      }
      actions={
        <>
          {switcher}
          {settings && available && <AuditSettingsButton projectId={project.id} initial={setupValues} />}
          {(settings || latest) && available && <RunAuditButton projectId={project.id} disabled={running} />}
        </>
      }
    />
  );

  if (!available && !latest) {
    const entries = await listAllListEntries(project.id);
    const lists = { remove: entries.filter((r) => r.list === "remove"), disavow: entries.filter((r) => r.list === "disavow") };
    const listTab = sp.tab === "disavow" ? "disavow" : "remove";
    return (
      <Page className="overflow-x-clip">
        {header}
        <NeedsData
          className="mb-4"
          providers={["dataforseo"]}
          title="Connect DataForSEO to audit your backlinks"
          shows={[
            `Every referring domain of ${project.domain} with a 0–100 toxicity score`,
            "DataForSEO spam score plus markers from the real link data",
            "Spammy domain names, suspicious TLDs, low authority, sitewide links",
            "Keyword-rich anchors and link networks on shared IP subnets",
            "Weekly re-audits with alerts for new toxic domains",
            "Toxic-score history per audit",
          ]}
        >
          <p className="mt-3 text-[12.5px] text-text-2">Your Remove and Disavow lists stay available below, and disavow.txt can still be downloaded.</p>
        </NeedsData>
        <TabsNav
          className="mb-4"
          items={[
            { href: "/backlink-audit?tab=remove", label: "Remove", count: lists.remove.length },
            { href: "/backlink-audit?tab=disavow", label: "Disavow", count: lists.disavow.length },
          ]}
        />
        {listTab === "remove" ? (
          <Card>
            <CardHeader title="Remove list" description="Track outreach to site owners asking them to remove links. Emails are copied, never sent automatically." />
            <RemoveTable projectId={project.id} rows={lists.remove} site={{ domain: project.domain, name: project.name }} />
          </Card>
        ) : (
          <DisavowPanel projectId={project.id} rows={lists.disavow} fileText={(await disavowText(project)).text} domain={project.domain} />
        )}
      </Page>
    );
  }

  if (!settings && !latest && !running)
    return (
      <Page className="overflow-x-clip">
        {header}
        <Grid cols={2} className="lg:grid-cols-[1.5fr_1fr]">
          <Card>
            <CardHeader title="Set up Backlink Audit" description={`We'll analyze every domain linking to ${project.domain}, score its toxicity and help you clean up.`} />
            <CardBody>
              <AuditSetupForm projectId={project.id} initial={setupValues} />
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="What the audit checks" description="Each referring domain gets a 0–100 toxicity score from these markers" />
            <CardBody>
              <ul className="space-y-1.5 text-[13px]">
                {markerNames.map((m) => (
                  <li key={m} className="flex items-center gap-1.5 text-text-2">
                    <ShieldAlert className="h-3.5 w-3.5 shrink-0 text-text-3" /> {m} <InfoTip text={MARKER_INFO[m] ?? m} />
                  </li>
                ))}
              </ul>
            </CardBody>
          </Card>
        </Grid>
      </Page>
    );

  if (!latest)
    return (
      <Page className="overflow-x-clip">
        {header}
        {job && <JobProgress jobId={job.id} title="Auditing your backlink profile" initial={{ status: job.status, progress: job.progress, total: job.total, message: job.message }} className="mb-4" />}
        {!running && (
          <Card>
            <EmptyState title="No audit results yet" description={domainsDemo ? "Earlier results used demo data and are hidden. Run a new audit with live data." : "The last audit did not finish. Run it again."} action={<RunAuditButton projectId={project.id} />} />
          </Card>
        )}
      </Page>
    );

  const rows = await listAuditDomains(project.id, runs.length > 1 ? latest.id : null);
  const stats = effectiveStats(rows);
  const listed = [...rows, ...(await listOrphanListEntries(project.id))];
  const byList = { remove: listed.filter((r) => r.list === "remove"), disavow: listed.filter((r) => r.list === "disavow"), whitelist: listed.filter((r) => r.list === "whitelist") };
  const review = rows.filter((r) => !r.list && r.toxicity >= POTENTIAL_MIN);
  const base = `/backlink-audit?project=${project.id}`;

  return (
    <Page className="overflow-x-clip">
      {header}
      {running && job && <JobProgress jobId={job.id} title="Re-auditing your backlink profile" initial={{ status: job.status, progress: job.progress, total: job.total, message: job.message }} className="mb-4" />}

      <Card className="mb-4">
        <div className="grid lg:grid-cols-[260px_1fr]">
          <div className="flex flex-col items-center justify-center gap-1 border-b border-border px-4 py-4 lg:border-r lg:border-b-0">
            <div className="flex items-center gap-1 text-[12.5px] text-text-2">
              Overall toxic score <InfoTip text="Share of toxic (weighted ×3) and potentially toxic referring domains, excluding whitelisted and disavowed ones. Low < 6, Medium 6–19, High ≥ 20." />
            </div>
            <Gauge value={gaugePosition(stats.score)} color={LEVEL_META[stats.level].color} size={150} label={String(stats.score)} sub="of 100" />
            <div className={`text-[15px] font-semibold ${LEVEL_META[stats.level].ink}`}>{LEVEL_META[stats.level].label}</div>
          </div>
          <MetricStrip className="sm:grid-flow-row sm:grid-cols-3 lg:grid-flow-col lg:grid-cols-none">
            <Metric label="Domains analyzed" value={compact(latest.analyzed)} sub={`${compact(latest.backlinks)} backlinks`} />
            <Metric label="Toxic" value={<span className="text-critical-ink">{stats.toxic}</span>} delta={runs[1] && runs[1].toxic ? Math.round(((stats.toxic - runs[1].toxic) / runs[1].toxic) * 1000) / 10 : null} upIsGood={false} deltaLabel="vs previous audit" sub={`Score ≥ ${TOXIC_MIN}`} href={`${base}&tab=audit&class=toxic`} />
            <Metric label="Potentially toxic" value={<span className="text-warning-ink">{stats.potentially}</span>} sub={`Score ${POTENTIAL_MIN}–${TOXIC_MIN - 1}`} href={`${base}&tab=audit&class=potentially`} />
            <Metric label="Non-toxic" value={<span className="text-good-ink">{stats.nonToxic}</span>} sub={`${byList.whitelist.length} whitelisted · ${byList.disavow.length} disavowed`} />
            {runs.length > 1 ? (
              <Metric label="New since previous audit" value={rows.filter((r) => r.isNew).length} sub={latest.newToxic ? `${latest.newToxic} new toxic` : "No new toxic domains"} />
            ) : (
              <Metric label="Audits run" value={runs.length} sub="New domains are flagged from the next audit" />
            )}
          </MetricStrip>
        </div>
      </Card>

      <TabsNav
        className="mb-4"
        items={[
          { href: "/backlink-audit", label: "Overview" },
          { href: "/backlink-audit?tab=audit", label: "Audit", count: review.length || undefined },
          { href: "/backlink-audit?tab=remove", label: "Remove", count: byList.remove.length },
          { href: "/backlink-audit?tab=disavow", label: "Disavow", count: byList.disavow.length },
          { href: "/backlink-audit?tab=history", label: "History", count: runs.length },
        ]}
      />

      {tab === "overview" && <Overview rows={rows} stats={stats} runs={runs} base={base} byList={byList} review={review} projectId={project.id} />}
      {tab === "audit" && (
        <Card>
          <CardHeader title="Referring domains" description="Review each domain: whitelist safe links, ask owners to remove bad ones, or disavow them." />
          <AuditTable projectId={project.id} rows={rows} domain={project.domain} initialClass={sp.class === "toxic" || sp.class === "potentially" || sp.class === "non" ? sp.class : "all"} />
        </Card>
      )}
      {tab === "remove" && (
        <Card>
          <CardHeader title="Remove list" description="Track outreach to site owners asking them to remove links. Emails are copied, never sent automatically." />
          <RemoveTable projectId={project.id} rows={byList.remove} site={{ domain: project.domain, name: project.name }} />
        </Card>
      )}
      {tab === "disavow" && <DisavowPanel projectId={project.id} rows={byList.disavow} fileText={(await disavowText(project)).text} domain={project.domain} />}
      {tab === "history" && <History runs={runs} />}
      {source === "demo" && <DemoNotice className="mt-6" />}
    </Page>
  );
}

function Overview({
  rows,
  stats,
  runs,
  base,
  byList,
  review,
  projectId,
}: {
  rows: AuditDomainRow[];
  stats: ReturnType<typeof effectiveStats>;
  runs: Awaited<ReturnType<typeof listAuditRuns>>;
  base: string;
  byList: Record<"remove" | "disavow" | "whitelist", AuditDomainRow[]>;
  review: AuditDomainRow[];
  projectId: string;
}) {
  const dist = BUCKETS.map((b) => {
    const n = rows.filter((r) => r.toxicity >= b.min && r.toxicity <= b.max).length;
    const cls = b.min >= TOXIC_MIN ? "toxic" : b.min >= POTENTIAL_MIN ? "potentially" : "non";
    return { label: b.label, non: cls === "non" ? n : 0, potentially: cls === "potentially" ? n : 0, toxic: cls === "toxic" ? n : 0 };
  });
  const markerCounts = new Map<string, number>();
  for (const r of rows) for (const m of r.markers) markerCounts.set(m, (markerCounts.get(m) ?? 0) + 1);
  const markers = [...markerCounts.entries()].sort((a, b) => b[1] - a[1]);
  const maxMarker = markers[0]?.[1] ?? 1;
  const removed = byList.remove.filter((r) => r.status === "removed").length;
  const trend = [...runs].reverse().map((r) => ({ label: dateTimeLabel(r.createdAt), toxic: r.toxic, potentially: r.potentiallyToxic }));
  const toxicToReview = review.filter((r) => r.toxicity >= TOXIC_MIN).length;
  return (
    <>
      <Grid cols={2} className="mb-4 lg:grid-cols-[1.5fr_1fr]">
        <Card>
          <CardHeader title="Toxicity score distribution" description="Referring domains by toxicity score" info={`Toxic ≥ ${TOXIC_MIN}; potentially toxic ${POTENTIAL_MIN}–${TOXIC_MIN - 1}; non-toxic below ${POTENTIAL_MIN}.`} />
          <CardBody>
            <BarChart
              data={dist}
              xKey="label"
              stacked
              series={[
                { key: "non", label: "Non-toxic", color: "var(--good)" },
                { key: "potentially", label: "Potentially toxic", color: "var(--warning)" },
                { key: "toxic", label: "Toxic", color: "var(--critical)" },
              ]}
              height={250}
            />
            <DistributionBar
              className="mt-4"
              segments={[
                { label: "Non-toxic", value: stats.nonToxic, color: "var(--good)" },
                { label: "Potentially toxic", value: stats.potentially, color: "var(--warning)" },
                { label: "Toxic", value: stats.toxic, color: "var(--critical)" },
              ]}
              showLegend={false}
            />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Next steps" description="Clean-up workflow" />
          <CardBody className="space-y-2.5">
            <Step icon={<ShieldAlert className="h-4 w-4" />} tone="critical" title={`${review.length} domains to review`} text={`${toxicToReview} toxic and ${review.length - toxicToReview} potentially toxic domains are not reviewed yet.`} href={`${base}&tab=audit&class=${toxicToReview ? "toxic" : "potentially"}`} cta="Review" />
            <Step icon={<MailX className="h-4 w-4" />} tone="warning" title={`${byList.remove.length} in Remove list`} text={byList.remove.length ? `${removed} removed so far. Contact site owners before disavowing.` : "Ask site owners to take down links you can't vouch for."} href={`${base}&tab=remove`} cta="Open" />
            <Step icon={<Ban className="h-4 w-4" />} tone="neutral" title={`${byList.disavow.length} in Disavow list`} text="Download disavow.txt and upload it to Google Search Console." href={`${base}&tab=disavow`} cta="Open" />
            <Step icon={<ShieldCheck className="h-4 w-4" />} tone="good" title={`${byList.whitelist.length} whitelisted`} text="Whitelisted domains are excluded from the toxic score." href={`${base}&tab=audit`} cta="View" />
            {byList.disavow.length > 0 && (
              <a href={`/api/backlinks/disavow?project=${projectId}`} className="inline-flex items-center gap-1.5 text-[12.5px] text-link hover:underline">
                <Download className="h-3.5 w-3.5" /> Download disavow.txt
              </a>
            )}
          </CardBody>
        </Card>
      </Grid>

      <Grid cols={2} className="mb-4">
        <Card>
          <CardHeader title="Top toxic markers" description="Why domains were flagged (hover for details)" />
          <CardBody>
            {markers.length ? (
              <ul className="space-y-2">
                {markers.slice(0, 10).map(([m, n]) => (
                  <li key={m} className="grid grid-cols-[minmax(0,1fr)_110px_40px] items-center gap-2.5 text-[13px] sm:grid-cols-[210px_1fr_48px]">
                    <span className="flex min-w-0 items-center gap-1 text-text-2">
                      <span className="truncate">{m}</span> <InfoTip text={MARKER_INFO[m] ?? m} />
                    </span>
                    <span className="h-1.5 overflow-hidden rounded-full bg-surface-3">
                      <span className="block h-full rounded-full bg-serious" style={{ width: `${(n / maxMarker) * 100}%` }} />
                    </span>
                    <span className="tabular text-right font-medium">{n}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="py-6 text-center text-[13px] text-text-3">No toxic markers found.</p>
            )}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Toxic domains trend" description="Per audit run" href={`${base}&tab=history`} />
          <CardBody>
            {trend.length >= 2 ? (
              <TrendChart
                data={trend}
                xKey="label"
                xFormat="raw"
                series={[
                  { key: "toxic", label: "Toxic", color: "var(--critical)" },
                  { key: "potentially", label: "Potentially toxic", color: "var(--warning)" },
                ]}
                height={230}
              />
            ) : (
              <EmptyState title="Trend builds up over time" description="Each audit adds a point. Re-run the audit after cleaning up, or let the weekly schedule run." className="py-8" />
            )}
          </CardBody>
        </Card>
      </Grid>

      <Card>
        <CardHeader title="Most toxic domains not yet reviewed" href={`${base}&tab=audit&class=toxic`} />
        <CardBody>
          <MiniTable
            empty="Nothing left to review. Nice work."
            columns={[{ header: "Domain" }, { header: "Toxicity" }, { header: "Markers" }, { header: "AS", align: "right" }, { header: "Backlinks", align: "right" }]}
            rows={review.slice(0, 8).map((r) => [
              <DomainLink key="d" domain={r.domain} className="max-w-[220px]" />,
              <ToxicityScore key="t" score={r.toxicity} />,
              <MarkerChips key="m" markers={r.markers} max={2} />,
              <AsBadge key="a" score={r.authorityScore} />,
              compact(r.backlinks),
            ])}
          />
        </CardBody>
        <CardFooter>
          <Link href={`${base}&tab=audit`} className="text-link hover:underline">
            Review all referring domains →
          </Link>
        </CardFooter>
      </Card>
    </>
  );
}

function Step({ icon, tone, title, text, href, cta }: { icon: ReactNode; tone: "critical" | "warning" | "neutral" | "good"; title: string; text: string; href: string; cta: string }) {
  const toneCls = { critical: "bg-critical-soft text-critical-ink", warning: "bg-warning-soft text-warning-ink", neutral: "bg-surface-3 text-text-2", good: "bg-good-soft text-good-ink" }[tone];
  return (
    <div className="flex items-start gap-3 rounded-md border border-border p-2.5">
      <span className={`mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md ${toneCls}`}>{icon}</span>
      <div className="min-w-0 flex-1">
        <div className="text-[13px] font-medium text-text">{title}</div>
        <div className="text-[12.5px] text-text-3">{text}</div>
      </div>
      <ButtonLink href={href} size="sm" variant="ghost">
        {cta} <ArrowRight className="h-3.5 w-3.5" />
      </ButtonLink>
    </div>
  );
}

function History({ runs }: { runs: Awaited<ReturnType<typeof listAuditRuns>> }) {
  const trend = [...runs].reverse().map((r) => ({ label: dateTimeLabel(r.createdAt), score: r.toxicScore, toxic: r.toxic, potentially: r.potentiallyToxic }));
  return (
    <>
      <Grid cols={2} className="mb-4">
        <Card>
          <CardHeader title="Overall toxic score" description="0–100, per audit" />
          <CardBody>
            {trend.length >= 2 ? <TrendChart data={trend} xKey="label" xFormat="raw" series={[{ key: "score", label: "Toxic score" }]} height={220} /> : <p className="py-10 text-center text-[13px] text-text-3">The trend appears after the second audit.</p>}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Toxic domains" description="Per audit" />
          <CardBody>
            {trend.length >= 2 ? (
              <TrendChart
                data={trend}
                xKey="label"
                xFormat="raw"
                series={[
                  { key: "toxic", label: "Toxic", color: "var(--critical)" },
                  { key: "potentially", label: "Potentially toxic", color: "var(--warning)" },
                ]}
                height={220}
              />
            ) : (
              <p className="py-10 text-center text-[13px] text-text-3">The trend appears after the second audit.</p>
            )}
          </CardBody>
        </Card>
      </Grid>
      <Card>
        <CardHeader title="Audit history" description={`${runs.length} audit${runs.length === 1 ? "" : "s"}`} />
        <CardBody>
          <MiniTable
            columns={[{ header: "Date" }, { header: "Trigger" }, { header: "Domains", align: "right" }, { header: "Toxic", align: "right" }, { header: "Potentially", align: "right" }, { header: "New toxic", align: "right" }, { header: "Toxic score", align: "right" }]}
            rows={runs.map((r) => [
              <span key="d" className="whitespace-nowrap">
                {dateTimeLabel(r.createdAt)}
              </span>,
              <Badge key="t" tone={r.trigger === "scheduled" ? "info" : "neutral"}>
                {r.trigger === "scheduled" ? "Weekly schedule" : r.trigger === "setup" ? "Setup" : "Manual"}
              </Badge>,
              compact(r.analyzed),
              <span key="x" className="text-critical-ink">
                {r.toxic}
              </span>,
              <span key="p" className="text-warning-ink">
                {r.potentiallyToxic}
              </span>,
              r.newToxic ? <Badge key="n" tone="critical">+{r.newToxic}</Badge> : "0",
              <span key="s" className={`font-medium ${LEVEL_META[r.level].ink}`}>
                {r.toxicScore} · {LEVEL_META[r.level].label}
              </span>,
            ])}
          />
        </CardBody>
      </Card>
    </>
  );
}
