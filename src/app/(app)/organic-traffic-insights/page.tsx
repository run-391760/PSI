import { KeyRound, LineChart, Plug } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { requirePageUser } from "@/lib/auth";
import { AppError, database } from "@/lib/domain";
import { compact, dateLabel, duration, pct } from "@/lib/format";
import { findProject, listProjects } from "@/lib/projects";
import { getGoogleConnection, googleConfigured, redirectUri } from "@/lib/google/oauth";
import { getProjectGoogle, listGa4Properties, listGscSites, organicInsights, suggestGscSite, type GscSite, type Ga4Property } from "@/lib/google/data";
import { DataSourceBadge } from "@/components/seo/source-badge";
import { Grid, Page, PageHeader } from "@/components/shell/page";
import { ProjectGate } from "@/components/projects/project-gate";
import { ProjectSwitcher } from "@/components/projects/project-switcher";
import { DonutChart } from "@/components/charts/donut-chart";
import { TrendChart } from "@/components/charts/trend-chart";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Callout, EmptyState } from "@/components/ui/feedback";
import { Metric, MetricStrip } from "@/components/ui/metric";
import { MiniTable } from "@/components/ui/mini-table";
import { Bar } from "@/components/ui/progress";
import { ConnectGoogleButton, DisconnectGoogleButton, LinkPropertiesForm, PagesTable, QueriesTable, RefreshGoogleButton } from "@/components/google/google-ui";

export const metadata: Metadata = { title: "Organic Traffic Insights" };

const BREADCRUMBS = [{ label: "Keyword research" }, { label: "Organic Traffic Insights", href: "/organic-traffic-insights" }];
const RANGES = [28, 90, 180] as const;
const change = (cur: number, prev: number) => (prev ? Math.round(((cur - prev) / prev) * 1000) / 10 : null);
const DESCRIPTION = "Your real Google Search Console and Google Analytics 4 data, joined by landing page: clicks, impressions, positions, queries, organic sessions and key events.";

export default async function OrganicTrafficInsightsPage({ searchParams }: PageProps<"/organic-traffic-insights">) {
  const user = await requirePageUser();
  const sp = await searchParams;
  const one = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : undefined);
  const projects = await listProjects(user.id);
  const project = await findProject(user.id, one("project"));
  const googleError = one("google_error");

  if (!project)
    return (
      <Page>
        <PageHeader breadcrumbs={BREADCRUMBS} title="Organic Traffic Insights" description={DESCRIPTION} />
        {googleError && <Callout tone="critical" className="mb-4">{googleError}</Callout>}
        <ProjectGate projects={projects} basePath="/organic-traffic-insights" title="Organic Traffic Insights" description="Choose the site whose Search Console and Analytics data you want to see." />
      </Page>
    );

  const returnTo = `/organic-traffic-insights?project=${project.id}`;
  const [connection, link] = await Promise.all([getGoogleConnection(user.id), getProjectGoogle(project.id)]);
  const days = RANGES.includes(Number(one("days")) as (typeof RANGES)[number]) ? Number(one("days")) : 28;
  const editing = one("edit") === "1";

  const header = (meta?: React.ReactNode, actions?: React.ReactNode) => (
    <PageHeader
      breadcrumbs={BREADCRUMBS}
      title="Organic Traffic Insights:"
      subject={project.domain}
      description={DESCRIPTION}
      meta={meta}
      actions={
        <>
          <ProjectSwitcher projects={projects.map((p) => ({ id: p.id, name: p.name, domain: p.domain }))} current={project.id} />
          {actions}
        </>
      }
    />
  );
  const banners = (
    <>
      {googleError && <Callout tone="critical" className="mb-4" title="Google connection problem">{googleError}</Callout>}
      {one("google") === "connected" && connection && <Callout tone="good" className="mb-4">Connected to Google as {connection.email || "your account"}.</Callout>}
    </>
  );

  // 1) Server not configured for Google OAuth
  if (!googleConfigured())
    return (
      <Page>
        {header()}
        {banners}
        <Card>
          <CardHeader title="Set up Google access (one time, by the server admin)" description="SynapseSEO reads Search Console and Analytics with your permission through Google OAuth. Access is read-only." />
          <CardBody>
            <ol className="list-decimal space-y-2 pl-5 text-[13.5px] text-text-2">
              <li>
                In <a className="text-link hover:underline" href="https://console.cloud.google.com/apis/library" target="_blank" rel="noopener noreferrer">Google Cloud Console</a>, create or pick a project and enable the <b>Google Search Console API</b>, <b>Google Analytics Data API</b> and <b>Google Analytics Admin API</b>.
              </li>
              <li>Configure the OAuth consent screen (External or Internal) and add yourself as a test user while the app is in testing.</li>
              <li>
                Create an OAuth client of type <b>Web application</b> with this authorized redirect URI: <code className="rounded bg-surface-3 px-1.5 py-0.5 text-[12.5px] text-text">{redirectUri()}</code>
              </li>
              <li>
                Add to <code className="rounded bg-surface-3 px-1">.env.local</code> and restart:
                <pre className="mt-2 overflow-x-auto rounded-md border border-border bg-surface-2 p-3 text-[12.5px] text-text">{`GOOGLE_CLIENT_ID=…apps.googleusercontent.com\nGOOGLE_CLIENT_SECRET=…\nAPP_ORIGIN=${redirectUri().replace("/api/integrations/google/callback", "")}\nAPP_SECRET=<long random string>   # encrypts stored Google tokens`}</pre>
              </li>
              <li>Open SynapseSEO at exactly the APP_ORIGIN address (for example localhost, not 127.0.0.1) so your sign-in session survives the round trip to Google.</li>
            </ol>
          </CardBody>
        </Card>
      </Page>
    );

  // 2) User has not connected Google
  if (!connection)
    return (
      <Page>
        {header()}
        {banners}
        <Card>
          <EmptyState
            icon={<Plug className="h-5 w-5" />}
            title="Connect your Google account"
            description="Grant read-only access to Search Console and Google Analytics. You can disconnect at any time; SynapseSEO stores an encrypted refresh token and never writes to your Google properties."
            action={<ConnectGoogleButton returnTo={returnTo} />}
          />
        </Card>
      </Page>
    );

  const accountBadge = (
    <Badge>
      Google: {connection.email || "connected"}
    </Badge>
  );

  // 3) Link properties (first time or editing)
  if ((!link.gscSite && !link.ga4Property) || editing) {
    let sites: GscSite[] = [];
    let properties: Ga4Property[] = [];
    const errors: string[] = [];
    await Promise.all([
      listGscSites(user.id).then((s) => (sites = s)).catch((e) => errors.push(`Search Console: ${e instanceof Error ? e.message : e}`)),
      listGa4Properties(user.id).then((p) => (properties = p)).catch((e) => errors.push(`Google Analytics: ${e instanceof Error ? e.message : e}`)),
    ]);
    return (
      <Page>
        {header(accountBadge, <DisconnectGoogleButton />)}
        {banners}
        {errors.map((e) => (
          <Callout key={e} tone="warning" className="mb-3">{e}</Callout>
        ))}
        <Card>
          <CardHeader title={`Link ${project.domain} to your Google properties`} description="Pick the Search Console property and GA4 property that measure this site." />
          <CardBody>
            <LinkPropertiesForm projectId={project.id} sites={sites} properties={properties} current={link} suggestedSite={suggestGscSite(project.domain, sites)} />
          </CardBody>
        </Card>
      </Page>
    );
  }

  // 4) Data
  let insights: Awaited<ReturnType<typeof organicInsights>>["data"] | null = null;
  let fetchedAt: string | undefined;
  let loadError: string | null = null;
  try {
    const result = await organicInsights(user.id, link, days);
    insights = result.data;
    fetchedAt = result.fetchedAt;
  } catch (e) {
    loadError = e instanceof AppError || e instanceof Error ? e.message : "Google data could not be loaded.";
  }
  const actions = (
    <>
      <RefreshGoogleButton />
      <ButtonLink href={`${returnTo}&edit=1`}>Change properties</ButtonLink>
      <DisconnectGoogleButton />
    </>
  );
  const rangeLinks = (
    <div className="inline-flex rounded-md border border-border-strong bg-surface p-0.5">
      {RANGES.map((d) => (
        <Link key={d} href={`${returnTo}&days=${d}`} className={`rounded px-2.5 py-1 text-[12px] font-medium ${d === days ? "bg-brand-soft text-brand-ink" : "text-text-2 hover:text-text"}`}>
          {d} days
        </Link>
      ))}
    </div>
  );

  if (!insights)
    return (
      <Page>
        {header(accountBadge, actions)}
        {banners}
        <Callout tone="critical" title="Google data could not be loaded">
          {loadError}
        </Callout>
      </Page>
    );

  const { gsc, ga4, range } = insights;
  const meta = (
    <>
      {gsc && <DataSourceBadge source="search-console" fetchedAt={fetchedAt} note={gsc.site} />}
      {ga4 && <DataSourceBadge source="google-analytics" fetchedAt={fetchedAt} note={link.ga4PropertyName ?? ga4.property} />}
      {accountBadge}
      <Badge>
        {dateLabel(range.start)} – {dateLabel(range.end)}
      </Badge>
    </>
  );
  const db = database(project.country).code;
  const daily = (() => {
    const map = new Map<string, Record<string, string | number>>();
    for (const d of gsc?.daily ?? []) map.set(d.date, { date: d.date, clicks: d.clicks, impressions: d.impressions, position: Math.round(d.position * 10) / 10 });
    for (const d of ga4?.daily ?? []) map.set(d.date, { ...(map.get(d.date) ?? { date: d.date }), sessions: d.sessions, organic: d.organic });
    return [...map.values()].sort((a, b) => String(a.date).localeCompare(String(b.date)));
  })();

  return (
    <Page>
      {header(meta, actions)}
      {banners}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        {rangeLinks}
        <span className="text-[12px] text-text-3">Search Console data arrives with a 2–3 day delay; both sources use the same dates. Cached for 6 hours.</span>
      </div>
      {insights.gscError && <Callout tone="warning" className="mb-3" title="Search Console">{insights.gscError}</Callout>}
      {insights.ga4Error && <Callout tone="warning" className="mb-3" title="Google Analytics">{insights.ga4Error}</Callout>}

      {gsc && (
        <Card className="mb-4">
          <MetricStrip>
            <Metric label="Clicks" value={compact(gsc.totals.clicks)} delta={change(gsc.totals.clicks, gsc.previous.clicks)} deltaLabel={`vs previous ${days} days`} />
            <Metric label="Impressions" value={compact(gsc.totals.impressions)} delta={change(gsc.totals.impressions, gsc.previous.impressions)} />
            <Metric label="CTR" value={pct(gsc.totals.ctr * 100, 2)} sub={`was ${pct(gsc.previous.ctr * 100, 2)}`} />
            <Metric label="Average position" value={gsc.totals.position ? gsc.totals.position.toFixed(1) : "n/a"} delta={gsc.previous.position ? change(gsc.totals.position, gsc.previous.position) : null} upIsGood={false} />
            <Metric label="Queries" value={compact(gsc.queries.length)} sub={gsc.queries.length >= 1000 ? "top 1,000 shown" : "with clicks or impressions"} />
          </MetricStrip>
        </Card>
      )}
      {ga4 && (
        <Card className="mb-4">
          <MetricStrip>
            <Metric label="Organic sessions" value={compact(ga4.organic.sessions)} delta={change(ga4.organic.sessions, ga4.organicPrevious.sessions)} sub={ga4.totals.sessions ? `${pct((ga4.organic.sessions / ga4.totals.sessions) * 100, 0)} of all sessions` : undefined} />
            <Metric label="Organic users" value={compact(ga4.organic.users)} delta={change(ga4.organic.users, ga4.organicPrevious.users)} />
            <Metric label="Engagement rate" value={pct(ga4.organic.engagementRate * 100)} sub={`avg. ${duration(ga4.organic.avgDuration)} per session`} />
            <Metric label="Organic key events" value={compact(ga4.organic.keyEvents)} delta={change(ga4.organic.keyEvents, ga4.organicPrevious.keyEvents)} />
            <Metric label="All sessions" value={compact(ga4.totals.sessions)} delta={change(ga4.totals.sessions, ga4.previous.sessions)} />
          </MetricStrip>
        </Card>
      )}

      <Grid cols={gsc && ga4 ? 3 : 2} className="mb-4">
        {gsc && (
          <Card>
            <CardHeader title="Clicks" description="Daily clicks from Google Search" />
            <CardBody>
              <TrendChart data={daily} xKey="date" xFormat="day" series={[{ key: "clicks", label: "Clicks" }]} type="area" height={200} />
            </CardBody>
          </Card>
        )}
        {gsc && (
          <Card>
            <CardHeader title="Impressions" description="Daily impressions in Google Search" />
            <CardBody>
              <TrendChart data={daily} xKey="date" xFormat="day" series={[{ key: "impressions", label: "Impressions", color: "var(--series-7)" }]} type="area" height={200} />
            </CardBody>
          </Card>
        )}
        {ga4 && (
          <Card>
            <CardHeader title="Sessions" description="All sessions vs organic search sessions (GA4)" />
            <CardBody>
              <TrendChart data={daily} xKey="date" xFormat="day" series={[{ key: "sessions", label: "All sessions" }, { key: "organic", label: "Organic search" }]} height={200} />
            </CardBody>
          </Card>
        )}
      </Grid>

      <Card className="mb-4">
        <CardHeader title="Landing pages" description="Search Console clicks and positions joined with GA4 organic sessions, engagement and key events by URL path." />
        <PagesTable rows={insights.pages} />
      </Card>

      {gsc && (
        <Card className="mb-4">
          <CardHeader title="Queries" description="Real search queries that led to impressions and clicks. Select queries to track them daily." />
          <QueriesTable rows={gsc.queries} db={db} />
        </Card>
      )}

      <Grid cols={3} className="mb-4">
        {ga4 && (
          <Card>
            <CardHeader title="Channels" description="Sessions by default channel group" />
            <CardBody>
              <DonutChart data={ga4.channels.slice(0, 8).map((c) => ({ label: c.channel, value: c.sessions }))} centerValue={compact(ga4.totals.sessions)} centerLabel="sessions" size={130} legend="bottom" />
            </CardBody>
          </Card>
        )}
        {gsc && (
          <Card>
            <CardHeader title="Countries" description="Search Console clicks" />
            <CardBody>
              <MiniTable
                columns={[{ header: "Country" }, { header: "Share", className: "w-24" }, { header: "Clicks", align: "right" }, { header: "Pos.", align: "right" }]}
                rows={gsc.countries.slice(0, 8).map((c) => [
                  c.country,
                  <Bar key="b" value={c.clicks} max={gsc.countries[0]?.clicks || 1} className="w-20" />,
                  compact(c.clicks),
                  c.position.toFixed(1),
                ])}
              />
            </CardBody>
          </Card>
        )}
        {gsc && (
          <Card>
            <CardHeader title="Devices" description="Search Console" />
            <CardBody>
              <MiniTable
                columns={[{ header: "Device" }, { header: "Clicks", align: "right" }, { header: "Impressions", align: "right" }, { header: "CTR", align: "right" }, { header: "Pos.", align: "right" }]}
                rows={gsc.devices.map((d) => [d.device[0]?.toUpperCase() + d.device.slice(1), compact(d.clicks), compact(d.impressions), pct(d.ctr * 100), d.position.toFixed(1)])}
              />
            </CardBody>
          </Card>
        )}
      </Grid>
      {!gsc && !ga4 && (
        <Card>
          <EmptyState icon={<LineChart className="h-5 w-5" />} title="No data for this range" description="Google returned no rows. New properties can take a few days to collect data." />
        </Card>
      )}
      <p className="mt-2 flex items-center gap-1.5 text-[12px] text-text-3">
        <KeyRound className="h-3.5 w-3.5" /> Read-only access via Google OAuth. Data comes directly from your Google properties; nothing on this page is estimated.
      </p>
    </Page>
  );
}
