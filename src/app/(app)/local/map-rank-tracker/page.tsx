import { MapPinned } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { requirePageUser } from "@/lib/auth";
import { getSchedule } from "@/lib/jobs/queue";
import { listScans, scanResults, suggestedKeywords, type KeywordResult } from "@/lib/local/map-rank";
import { businessLocation, getProfile } from "@/lib/local/profile";
import { param, projectContext } from "@/lib/local/project-context";
import { dateLabel, dateTimeLabel, timeAgo } from "@/lib/format";
import { DataSourceBadge } from "@/components/seo/source-badge";
import { NeedsData } from "@/components/seo/needs-data";
import { demoAllowed } from "@/lib/data-mode";
import { liveEnabled } from "@/lib/providers/source";
import { Grid, Page, PageHeader } from "@/components/shell/page";
import { ProjectGate } from "@/components/projects/project-gate";
import { ProjectSwitcher } from "@/components/projects/project-switcher";
import { BarChart } from "@/components/charts/bar-chart";
import { TrendChart } from "@/components/charts/trend-chart";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Callout, EmptyState } from "@/components/ui/feedback";
import { Metric, MetricStrip } from "@/components/ui/metric";
import { MiniTable } from "@/components/ui/mini-table";
import { Bar } from "@/components/ui/progress";
import { TabsNav } from "@/components/ui/tabs";
import { JobProgress } from "@/components/local/job-progress";
import { CompareGrids, HeatmapPanel, NewScanButton, ScanForm, ScanHistory, ScheduleToggle } from "@/components/local/map-rank-ui";

export const metadata: Metadata = { title: "Map Rank Tracker" };

const BREADCRUMBS = [{ label: "Local SEO" }, { label: "Map Rank Tracker", href: "/local/map-rank-tracker" }];

function pctDelta(cur: number | null, prev: number | null) {
  if (cur == null || prev == null || prev === 0) return null;
  return ((cur - prev) / prev) * 100;
}

export default async function MapRankTrackerPage({ searchParams }: PageProps<"/local/map-rank-tracker">) {
  const user = await requirePageUser();
  const sp = await searchParams;
  const { projects, project, requested, switcher } = await projectContext(user.id, sp);

  if (!project)
    return (
      <Page>
        <PageHeader breadcrumbs={BREADCRUMBS} title="Map Rank Tracker" description="See where your business ranks in the Google Maps local pack from every point of a geo-grid around your location." />
        {requested && <Callout tone="warning" className="mb-4">That project was not found. Choose one of your projects below.</Callout>}
        <ProjectGate projects={projects} basePath="/local/map-rank-tracker" title="Map Rank Tracker" description="Choose the business to track on the map." />
      </Page>
    );

  const stored = await getProfile(project.id);
  if (!stored)
    return (
      <Page>
        <PageHeader breadcrumbs={BREADCRUMBS} title="Map Rank Tracker:" subject={project.domain} actions={<ProjectSwitcher projects={switcher} current={project.id} />} />
        <Card>
          <EmptyState
            icon={<MapPinned className="h-5 w-5" />}
            title="Add your business profile first"
            description="Grid scans are centred on your business location and use your primary category to find local-pack competitors. Set up the profile in Listing Management."
            action={
              <ButtonLink href={`/local/listings?project=${project.id}`} variant="primary">
                Set up business profile
              </ButtonLink>
            }
          />
        </Card>
      </Page>
    );

  const profile = stored.profile;
  const canScan = liveEnabled() || demoAllowed();
  const location = businessLocation(profile, project.country);
  const scans = await listScans(project.id, 40);
  const running = scans.find((s) => s.status === "queued" || s.status === "running");
  const done = scans.filter((s) => s.status === "done");
  const scanParam = param(sp, "scan");
  const current = (scanParam && scans.find((s) => s.id === scanParam && s.status === "done")) || done[0] || null;
  const results = current ? await scanResults(current.id) : [];
  const orderedResults = current ? (current.keywords.map((k) => results.find((r) => r.keyword === k)).filter(Boolean) as KeywordResult[]) : [];
  const kwParam = param(sp, "kw");
  const result = orderedResults.find((r) => r.keyword === kwParam) ?? orderedResults[0] ?? null;

  // Comparison: explicit ?compare=, else the previous completed scan containing this keyword.
  const compareParam = param(sp, "compare");
  const compareScan = current && result ? ((compareParam && done.find((s) => s.id === compareParam && s.id !== current.id)) || done.find((s) => s.created_at < current.created_at && s.keywords.includes(result.keyword)) || null) : null;
  const compareResult = compareScan && result ? ((await scanResults(compareScan.id)).find((r) => r.keyword === result.keyword) ?? null) : null;
  const comparable = !!(compareResult && compareScan && compareScan.grid_size === current!.grid_size && compareScan.radius_km === current!.radius_km);

  // Trend across scans for this keyword (same grid settings not required: metrics are shares).
  const trend = result
    ? (
        await Promise.all(
          done
            .filter((s) => s.keywords.includes(result.keyword))
            .slice(0, 12)
            .reverse()
            .map(async (s) => {
              const r = (await scanResults(s.id)).find((x) => x.keyword === result.keyword);
              return r ? { scan: dateTimeLabel(s.created_at), solv: r.metrics.solv, top3: r.metrics.top3Pct, found: r.metrics.foundPct } : null;
            }),
        )
      ).filter((x): x is NonNullable<typeof x> => !!x)
    : [];

  const schedule = await getSchedule(project.id, "local.map-scan");
  const suggestions = suggestedKeywords(profile);
  const lastSettings = current ? { keywords: current.keywords, grid: current.grid_size, radiusKm: current.radius_km } : null;
  const base = `/local/map-rank-tracker?project=${project.id}`;
  const m = result?.metrics;
  const pm = comparable ? compareResult!.metrics : null;
  const seed = current ? `${current.center.lat},${current.center.lng}` : `${location.lat},${location.lng}`;

  return (
    <Page>
      <PageHeader
        breadcrumbs={BREADCRUMBS}
        title="Map Rank Tracker:"
        subject={profile.name}
        meta={
          <>
            {current && <DataSourceBadge source={current.source === "demo" ? "demo" : "dataforseo"} fetchedAt={current.finished_at ?? undefined} note="Google Maps results" />}
            <Badge title={`${location.lat.toFixed(4)}, ${location.lng.toFixed(4)}`}>
              📍 {location.basis}
              {location.approximate ? " · approx." : ""}
            </Badge>
            <Badge>{profile.primaryCategory}</Badge>
            {schedule?.enabled && <Badge tone="brand">Weekly rescan · next {dateLabel(new Date(schedule.next_run_at).toISOString())}</Badge>}
          </>
        }
        actions={
          <>
            <ProjectSwitcher projects={switcher} current={project.id} />
            {canScan && <ScheduleToggle projectId={project.id} enabled={!!schedule?.enabled} settings={lastSettings} />}
            {canScan && <NewScanButton projectId={project.id} suggestions={suggestions} defaults={lastSettings ?? undefined} disabled={!!running} />}
          </>
        }
      />

      {running?.job_id && <JobProgress jobId={running.job_id} endpoint="/api/local/jobs" title={`Scanning ${running.keywords.length} keyword${running.keywords.length > 1 ? "s" : ""} on a ${running.grid_size}×${running.grid_size} grid`} className="mb-4" />}
      {scans[0]?.status === "failed" && (
        <Callout tone="critical" className="mb-4" title="The last scan failed">
          {scans[0].error ?? "Unknown error."}
        </Callout>
      )}

      {!current && !canScan ? (
        <NeedsData
          providers={["dataforseo", "business-profile"]}
          title="Map rankings need Google Maps data (DataForSEO)"
          shows={["Your Google Maps local-pack rank at every point of a geo-grid", "Share of local voice and average rank per keyword", "Competitors that take the 3-pack where you don't", "Weekly rescans and scan-to-scan comparison"]}
        />
      ) : !current ? (
        !running && (
          <Grid cols={2} className="lg:grid-cols-[1.4fr_1fr]">
            <Card>
              <CardHeader title="Run your first grid scan" description="Pick up to 5 keywords, a grid size and a radius around your business." />
              <CardBody>
                <ScanForm projectId={project.id} suggestions={suggestions} />
              </CardBody>
            </Card>
            <Card>
              <CardHeader title="What you will see" />
              <CardBody className="space-y-2 text-[13px] text-text-2">
                <p>A heatmap of your local-pack rank at every grid point, from 1 (top of the map pack) to 20+ (not found).</p>
                <p>
                  <span className="font-medium text-text">Share of local voice</span> — your weighted share of the 3-pack across the grid — and the competitors who take the pack where you don&apos;t.
                </p>
                <p>Rescan weekly to compare grids over time.</p>
                <p className="mt-3 text-[12.5px] text-text-3">Each grid point is one Google Maps query via DataForSEO (about $0.002). A 5×5 grid with 3 keywords costs about $0.15.</p>
              </CardBody>
            </Card>
          </Grid>
        )
      ) : (
        <>
          {orderedResults.length > 1 && <TabsNav param="kw" className="mb-4" items={orderedResults.map((r) => ({ href: `/local/map-rank-tracker?kw=${encodeURIComponent(r.keyword)}`, label: r.keyword, count: `avg ${r.metrics.avgRank == null ? "20+" : r.metrics.avgRank.toFixed(1)}` }))} />}
          {result && m && (
            <>
              <p className="mb-3 text-[12.5px] text-text-3">
                Scan of {dateTimeLabel(current.created_at)} · “{result.keyword}” · {current.grid_size}×{current.grid_size} grid ({m.cells} points) · {current.radius_km} km radius
                {comparable && compareScan && <> · compared with {dateTimeLabel(compareScan.created_at)}</>}
              </p>
              <Card className="mb-4">
                <MetricStrip>
                  <Metric label="Average rank" value={m.avgRank == null ? "20+" : m.avgRank.toFixed(1)} delta={pm ? pctDelta(m.avgRank, pm.avgRank) : null} upIsGood={false} deltaLabel="vs before" sub={`Where found · ATRP ${m.atrp.toFixed(1)}`} info="Mean rank across grid points where you appear in the top 20. ATRP (average total rank position) counts 20+ as 21." />
                  <Metric label="Share of local voice" value={`${m.solv}%`} delta={pm ? pctDelta(m.solv, pm.solv) : null} deltaLabel="vs before" sub="Weighted 3-pack share" info="Your share of local-pack visibility across the grid: #1 = 50%, #2 = 30%, #3 = 20% of a point's pack." />
                  <Metric label="Found in top 3" value={`${m.top3Pct}%`} sub={`${m.top3} of ${m.cells} points`} delta={pm ? pctDelta(m.top3Pct, pm.top3Pct) : null} />
                  <Metric label="Found in top 10" value={`${Math.round((m.top10 / m.cells) * 100)}%`} sub={`${m.top10} of ${m.cells} points`} />
                  <Metric label="Not in top 20" value={m.buckets.notFound} sub={`of ${m.cells} points`} />
                </MetricStrip>
              </Card>

              <Grid cols={2} className="mb-4 lg:grid-cols-[1.35fr_1fr]">
                <Card>
                  <CardHeader title="Geo-grid heatmap" description={`Your local-pack rank for “${result.keyword}” at each point`} info="Stylised map for orientation; points are spaced evenly around your business location." />
                  <CardBody>
                    <HeatmapPanel key={`${current.id}:${result.keyword}`} cells={result.cells} grid={current.grid_size} seed={seed} businessName={profile.name} />
                  </CardBody>
                </Card>
                <Card>
                  <CardHeader title="Local pack competitors" description="Businesses appearing in the 3-pack across this grid" />
                  <CardBody>
                    <MiniTable
                      columns={[{ header: "Business" }, { header: "SoLV", className: "w-32" }, { header: "Avg. rank", align: "right" }, { header: "Top 3", align: "right" }, { header: "Rating", align: "right" }]}
                      rows={result.competitors.slice(0, 10).map((c) => [
                        <span key="n" className={c.you ? "font-semibold text-text" : "text-text"}>
                          {c.name}
                          {c.you && <Badge tone="brand" className="ml-1.5">You</Badge>}
                        </span>,
                        <div key="s" className="flex items-center gap-2">
                          <Bar value={c.solv} max={Math.max(...result.competitors.map((x) => x.solv), 1)} className="w-14" color={c.you ? "var(--series-1)" : "var(--text-3)"} />
                          <span className="tabular text-[12px] text-text-2">{c.solv}%</span>
                        </div>,
                        c.avgRank == null ? "20+" : c.avgRank.toFixed(1),
                        `${c.top3}/${m.cells}`,
                        c.rating == null ? <span key="r" className="text-text-3">n/a</span> : `${c.rating.toFixed(1)} ★`,
                      ])}
                    />
                  </CardBody>
                </Card>
              </Grid>

              {comparable && compareResult && compareScan && pm && (
                <Card className="mb-4">
                  <CardHeader
                    title="Scan comparison"
                    description={`${dateTimeLabel(compareScan.created_at)} → ${dateTimeLabel(current.created_at)} · Avg. rank ${pm.avgRank?.toFixed(1) ?? "20+"} → ${m.avgRank?.toFixed(1) ?? "20+"} · SoLV ${pm.solv}% → ${m.solv}%`}
                    actions={
                      <ButtonLink href={`${base}&scan=${current.id}&kw=${encodeURIComponent(result.keyword)}`} size="sm" variant="ghost">
                        Reset
                      </ButtonLink>
                    }
                  />
                  <CardBody>
                    <CompareGrids current={result.cells} previous={compareResult.cells} grid={current.grid_size} seed={seed} currentLabel={dateTimeLabel(current.created_at)} previousLabel={dateTimeLabel(compareScan.created_at)} />
                  </CardBody>
                </Card>
              )}
              {compareResult && compareScan && !comparable && (
                <Callout tone="info" className="mb-4">
                  The previous scan of “{result.keyword}” ({dateTimeLabel(compareScan.created_at)}) used a different grid or radius, so a point-by-point comparison is not available.
                </Callout>
              )}

              <Grid cols={2} className="mb-4">
                <Card>
                  <CardHeader title="Rank distribution" description={`${m.cells} grid points by rank band`} />
                  <CardBody>
                    <BarChart
                      data={[
                        { band: "1–3", points: m.buckets.top3 },
                        { band: "4–10", points: m.buckets.top4_10 },
                        { band: "11–20", points: m.buckets.top11_20 },
                        { band: "20+", points: m.buckets.notFound },
                      ]}
                      xKey="band"
                      series={[{ key: "points", label: "Grid points" }]}
                      yFormat="number"
                      valueLabels
                      height={220}
                    />
                  </CardBody>
                </Card>
                <Card>
                  <CardHeader title="Visibility over time" description={`“${result.keyword}” across ${trend.length} scan${trend.length === 1 ? "" : "s"}`} />
                  <CardBody>
                    {trend.length >= 2 ? (
                      <TrendChart
                        data={trend}
                        xKey="scan"
                        xFormat="raw"
                        yFormat="percent"
                        series={[
                          { key: "solv", label: "Share of local voice" },
                          { key: "top3", label: "Top-3 points" },
                          { key: "found", label: "Top-20 points" },
                        ]}
                        height={220}
                      />
                    ) : (
                      <div className="flex h-[220px] flex-col items-center justify-center text-center text-[13px] text-text-3">
                        <p>Run this keyword again to see how your visibility changes.</p>
                        <p className="mt-1">Turn on “Rescan weekly” to build history automatically.</p>
                      </div>
                    )}
                  </CardBody>
                </Card>
              </Grid>
            </>
          )}
        </>
      )}

      {scans.length > 0 && (
        <Card className="mb-4">
          <CardHeader title="Scan history" description={`${scans.length} scan${scans.length === 1 ? "" : "s"} · last ${timeAgo(scans[0].created_at)}`} />
          <ScanHistory
            projectId={project.id}
            currentId={current?.id ?? null}
            compareId={comparable ? (compareScan?.id ?? null) : null}
            rows={scans.map((s) => ({ id: s.id, createdAt: s.created_at, keywords: s.keywords, grid: s.grid_size, radiusKm: s.radius_km, status: s.status, avgRank: s.avgRank, solv: s.solv, top3Pct: s.top3Pct }))}
          />
        </Card>
      )}

      <p className="text-[12px] text-text-3">
        Rankings are Google Maps results fetched from DataForSEO at each grid point{current?.source === "demo" ? " (this scan is a demo simulation)" : ""}. Grid points that failed are shown as not found. Keep your{" "}
        <Link href={`/local/listings?project=${project.id}`} className="text-link hover:underline">
          listing
        </Link>{" "}
        and{" "}
        <Link href={`/local/reviews?project=${project.id}`} className="text-link hover:underline">
          reviews
        </Link>{" "}
        healthy to improve prominence.
      </p>
    </Page>
  );
}
