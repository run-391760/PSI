import { ArrowDownRight, ArrowUpRight, Hourglass, Target } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { requirePageUser } from "@/lib/auth";
import { database } from "@/lib/domain";
import { dateLabel } from "@/lib/format";
import { listProjects } from "@/lib/projects";
import { liveEnabled } from "@/lib/providers/source";
import { BANDS, bandFor, GOOGLE_UPDATES, UPDATES_NOTE } from "@/lib/sensor/bands";
import { lastDays } from "@/lib/sensor/days";
import { ensureTodaySnapshot, marketOverview, SENSOR_PANEL } from "@/lib/sensor/market";
import { personalVolatility } from "@/lib/sensor/personal";
import type { SerpFeature } from "@/lib/seo/types";
import { cn } from "@/lib/utils";
import { TrendChart } from "@/components/charts/trend-chart";
import { DomainLink, FeatureIcon, featureLabel, Sparkline } from "@/components/seo/badges";
import { NeedsData } from "@/components/seo/needs-data";
import { DataSourceBadge } from "@/components/seo/source-badge";
import { SensorChart } from "@/components/sensor/sensor-chart";
import { SensorFilters } from "@/components/sensor/sensor-filters";
import { Grid, Page, PageHeader } from "@/components/shell/page";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardBody, CardFooter, CardHeader } from "@/components/ui/card";
import { MiniTable } from "@/components/ui/mini-table";
import { Gauge } from "@/components/ui/progress";

export const metadata: Metadata = { title: "SERP Sensor" };

const SENSOR_RANGES = [
  { id: "30d", label: "30D", points: 30 },
  { id: "90d", label: "90D", points: 90 },
];

function Change({ value, suffix = "" }: { value: number | null; suffix?: string }) {
  if (value == null) return <span className="text-text-3">n/a</span>;
  if (value === 0) return <span className="text-text-3">0{suffix}</span>;
  // More volatility is "worse" news for rankings: serious ink for rises, good ink for calming.
  return (
    <span className={cn("tabular inline-flex items-center text-[12.5px] font-medium", value > 0 ? "text-serious-ink" : "text-good-ink")}>
      {value > 0 ? <ArrowUpRight className="h-3.5 w-3.5" /> : <ArrowDownRight className="h-3.5 w-3.5" />}
      {Math.abs(value).toFixed(1)}
      {suffix}
    </span>
  );
}

export default async function SensorPage({ searchParams }: PageProps<"/sensor">) {
  const user = await requirePageUser();
  const sp = await searchParams;
  const db = database(typeof sp.db === "string" ? sp.db : "US").code;
  const device = sp.device === "mobile" ? "mobile" : "desktop";
  const info = database(db);
  const live = liveEnabled();
  const [personal, projects, collecting] = await Promise.all([personalVolatility(user.id, 90), listProjects(user.id), ensureTodaySnapshot(user.id, db, device).catch(() => null)]);
  const m = live ? await marketOverview(db, device) : null;
  const hasMarket = !!m?.today;
  const collectingNow = !!collecting && (collecting.status === "queued" || collecting.status === "running");

  const days = lastDays(90);
  const marketBy = new Map(m?.series.map((d) => [d.date, d.score]) ?? []);
  const personalBy = new Map(personal?.series.map((p) => [p.date, p.score]) ?? []);
  const firstData = days.findIndex((d) => marketBy.has(d) || personalBy.has(d));
  const chartData = firstData < 0 ? [] : days.slice(Math.min(firstData, 60)).map((date) => ({ date, score: marketBy.get(date) ?? null, personal: personalBy.get(date) ?? null }));
  const band = m?.today ? bandFor(m.today.score) : null;
  const featureRows = m?.features.rows ?? [];
  const featureLast = featureRows[featureRows.length - 1];
  const featureFirst = featureRows[0];
  const ptHref = projects[0] ? `/position-tracking?project=${projects[0].id}` : "/position-tracking";

  return (
    <Page>
      <PageHeader
        breadcrumbs={[{ label: "Monitoring & reports" }, { label: "SERP Sensor", href: "/sensor" }]}
        title="SERP Sensor"
        description="How much Google results changed day to day, from real SERP snapshots: a market panel (DataForSEO) and your own tracked keywords (Position Tracking). 0 is calm, 10 is heavy turbulence."
        meta={
          <>
            {hasMarket && <DataSourceBadge source="dataforseo" fetchedAt={m?.fetchedAt ?? undefined} note={`${SENSOR_PANEL.length}-keyword panel`} />}
            {personal && <DataSourceBadge source={personal.source} note="Position Tracking daily rankings" />}
            <Badge>
              {info.flag} {info.name}
            </Badge>
            <Badge>{device === "mobile" ? "Mobile" : "Desktop"}</Badge>
          </>
        }
      >
        <SensorFilters db={db} device={device} />
      </PageHeader>

      <Grid cols={2} className="mb-4 lg:grid-cols-[330px_1fr]">
        {!live ? (
          <NeedsData
            compact
            providers={["dataforseo"]}
            title="Market volatility needs DataForSEO"
            shows={["Daily volatility score for Google in this market", "Winners & losers by visibility share", "SERP feature occurrence (AI Overviews, snippets…)"]}
          />
        ) : (
          <Card>
            <CardHeader title="Market volatility" description={m?.today ? `${dateLabel(m.today.date)} · ${m.today.keywords} panel keywords` : "Google top-10 changes across the keyword panel"} info={`Mean absolute top-10 rank change of ${SENSOR_PANEL.length} broad keywords versus the previous day's snapshot (a URL entering or leaving the top 10 counts as position 11), ×2, capped at 10.`} />
            <CardBody>
              {m?.today && band ? (
                <>
                  <div className="flex flex-col items-center">
                    <Gauge value={m.today.score * 10} color={band.color} size={180} label={m.today.score.toFixed(1)} sub="out of 10" />
                    <Badge tone={band.tone} className="mt-3 h-6 px-2.5 text-[12.5px]">
                      {band.label} volatility
                    </Badge>
                    <p className="mt-1.5 text-center text-[12.5px] text-text-2">{band.note}</p>
                  </div>
                  <dl className="mt-4 grid grid-cols-2 gap-2 border-t border-border pt-3 text-center text-[12px]">
                    <div>
                      <dt className="text-text-3">vs previous day</dt>
                      <dd className="mt-0.5">
                        <Change value={m.yesterday ? Math.round((m.today.score - m.yesterday.score) * 10) / 10 : null} />
                      </dd>
                    </div>
                    <div>
                      <dt className="text-text-3">Average ({m.series.length} days)</dt>
                      <dd className="mt-0.5 font-medium text-text">{m.avg30 != null ? m.avg30.toFixed(1) : "n/a"}</dd>
                    </div>
                  </dl>
                </>
              ) : (
                <div className="flex flex-col items-center py-6 text-center">
                  <span className="flex h-10 w-10 items-center justify-center rounded-full bg-surface-3 text-text-3">
                    <Hourglass className="h-5 w-5" />
                  </span>
                  <p className="mt-2 text-[13px] font-medium text-text">{collectingNow ? "Collecting today's snapshot…" : "Building history"}</p>
                  <p className="mt-0.5 max-w-xs text-[12.5px] text-text-3">
                    The first score appears after two daily snapshots of the panel for {info.name} ({device}). {m?.days ? `${m.days} day${m.days === 1 ? "" : "s"} stored so far.` : "Snapshots are collected when someone opens this page each day."}
                  </p>
                </div>
              )}
            </CardBody>
          </Card>
        )}
        <Card>
          <CardHeader title="Volatility trend" description={`${info.flag} ${info.code} · ${device}${personal ? " · with your personal score" : ""}`} />
          <CardBody>
            {chartData.length >= 2 ? (
              <SensorChart data={chartData} height={320} personalLabel="Personal score (your keywords)" ranges={SENSOR_RANGES} />
            ) : (
              <div className="flex h-[200px] flex-col items-center justify-center text-center text-[13px] text-text-3 lg:h-[320px]">
                <p>No measured volatility yet.</p>
                <p className="mt-1 max-w-sm">{live ? "The market trend fills in day by day from real snapshots." : "Connect DataForSEO for the market score,"} {personal ? "" : "and track keywords in Position Tracking for your personal score."}</p>
              </div>
            )}
          </CardBody>
        </Card>
      </Grid>

      <Grid cols={2} className="mb-4 lg:grid-cols-[1fr_1.2fr]">
        <Card>
          <CardHeader title="Personal volatility" description="How much your own tracked keywords moved" info="Average daily position change of the keywords in your projects' Position Tracking (stored real rankings), on the same 0–10 scale." />
          <CardBody>
            {personal ? (
              <>
                <div className="flex items-center gap-4">
                  <Gauge value={personal.today * 10} color={bandFor(personal.today).color} size={120} label={personal.today.toFixed(1)} sub="latest" />
                  <div className="min-w-0 text-[12.5px]">
                    <Badge tone={bandFor(personal.today).tone}>{bandFor(personal.today).label}</Badge>
                    <div className="mt-1.5 text-text-3">
                      <Change value={personal.change} /> vs previous day
                    </div>
                    <div className="mt-0.5 text-text-3">
                      Average <span className="font-medium text-text">{personal.avg30.toFixed(1)}</span>
                      {m?.avg30 != null && (
                        <>
                          {" "}
                          vs market <span className="font-medium text-text">{m.avg30.toFixed(1)}</span>
                        </>
                      )}
                    </div>
                    <div className="mt-0.5 text-text-3">
                      {personal.keywords} keywords · {personal.projects.length} project{personal.projects.length === 1 ? "" : "s"}
                    </div>
                  </div>
                </div>
                {personal.movers.length > 0 && (
                  <div className="mt-3 border-t border-border pt-2.5">
                    <div className="mb-1.5 text-[12px] font-medium text-text-2">Biggest moves (latest day)</div>
                    <ul className="space-y-1 text-[12.5px]">
                      {personal.movers.map((mv) => (
                        <li key={`${mv.domain}:${mv.keyword}`} className="flex items-center justify-between gap-2">
                          <span className="truncate text-text-2" title={mv.domain}>
                            {mv.keyword}
                          </span>
                          <span className="tabular shrink-0 text-text-3">
                            {mv.from ?? "–"} → <span className="font-medium text-text">{mv.to ?? "out"}</span>
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </>
            ) : (
              <div className="flex flex-col items-center py-4 text-center">
                <span className="flex h-10 w-10 items-center justify-center rounded-full bg-surface-3 text-text-3">
                  <Target className="h-5 w-5" />
                </span>
                <p className="mt-2 text-[13px] font-medium text-text">See how your own rankings move</p>
                <p className="mt-0.5 max-w-xs text-[12.5px] text-text-3">Track keywords in Position Tracking. After two days of real rankings, their daily volatility appears here.</p>
                <ButtonLink href={ptHref} variant="primary" size="sm" className="mt-3">
                  <span className="inline-flex items-center gap-1.5 text-white">Set up Position Tracking</span>
                </ButtonLink>
              </div>
            )}
          </CardBody>
        </Card>

        {hasMarket && m ? (
          <Card>
            <CardHeader title="Winners & losers" description="Largest change in visibility share across the panel vs the previous snapshot" info="Share of CTR-weighted top-10 visibility across the panel keywords captured by each domain; change in percentage points." />
            <CardBody className="grid gap-4 sm:grid-cols-2">
              {(["winners", "losers"] as const).map((k) => (
                <div key={k} className="min-w-0">
                  <div className="mb-1.5 text-[12px] font-medium text-text-2">{k === "winners" ? "Winners" : "Losers"}</div>
                  <ul className="space-y-1.5">
                    {m.movers[k].map((mv) => (
                      <li key={mv.domain} className="flex items-center justify-between gap-2 text-[12.5px]">
                        <DomainLink domain={mv.domain} db={db} className="min-w-0" />
                        <span className="flex shrink-0 items-center gap-2">
                          <span className="tabular text-text-3">{mv.visibility.toFixed(2)}%</span>
                          <span className={cn("tabular w-12 text-right font-medium", mv.change > 0 ? "text-good-ink" : "text-critical-ink")}>
                            {mv.change > 0 ? "+" : "−"}
                            {Math.abs(mv.change).toFixed(2)}
                          </span>
                        </span>
                      </li>
                    ))}
                    {m.movers[k].length === 0 && <li className="text-[12.5px] text-text-3">No significant moves.</li>}
                  </ul>
                </div>
              ))}
            </CardBody>
          </Card>
        ) : (
          <Card>
            <CardHeader title="Market panel" description={`${SENSOR_PANEL.length} broad Google searches checked once a day`} />
            <CardBody>
              <div className="flex flex-wrap gap-1.5">
                {SENSOR_PANEL.map((k) => (
                  <Badge key={k}>{k}</Badge>
                ))}
              </div>
              <p className="mt-3 text-[12.5px] text-text-3">
                {live
                  ? "Winners, losers and SERP feature trends appear once two daily snapshots are stored. Each snapshot costs about $0.05 of your DataForSEO budget."
                  : "With DataForSEO connected, the Sensor stores the daily top 10 for these searches and computes volatility, winners & losers and SERP feature trends from them."}
              </p>
            </CardBody>
          </Card>
        )}
      </Grid>

      {hasMarket && m && featureRows.length > 0 && featureLast && featureFirst && (
        <Card className="mb-4">
          <CardHeader title="SERP features occurrence" description={`Share of panel SERPs showing each feature, last ${featureRows.length} days`} />
          <CardBody className="grid gap-5 lg:grid-cols-[1.5fr_1fr]">
            <TrendChart data={featureRows} xKey="date" xFormat="day" yFormat="percent" series={m.features.features.slice(0, 6).map((f) => ({ key: f, label: featureLabel(f as SerpFeature) }))} height={260} />
            <MiniTable
              columns={[{ header: "Feature" }, { header: "Latest", align: "right" }, { header: "Change", align: "right" }, { header: "Trend", align: "right", className: "hidden sm:table-cell" }]}
              rows={m.features.features.map((f) => {
                const now = Number(featureLast[f] ?? 0);
                const d = Math.round((now - Number(featureFirst[f] ?? 0)) * 10) / 10;
                return [
                  <span key="f" className="inline-flex items-center gap-2 text-text-2">
                    <span className="text-text-3">
                      <FeatureIcon feature={f as SerpFeature} />
                    </span>
                    {featureLabel(f as SerpFeature)}
                  </span>,
                  <span key="t" className="font-medium">
                    {now.toFixed(0)}%
                  </span>,
                  <span key="d" className="text-[12.5px] text-text-2">
                    {d > 0 ? "+" : d < 0 ? "−" : ""}
                    {Math.abs(d).toFixed(0)} pp
                  </span>,
                  <span key="s" className="hidden justify-end sm:flex">
                    <Sparkline values={featureRows.map((r) => Number(r[f] ?? 0))} width={72} height={20} />
                  </span>,
                ];
              })}
            />
          </CardBody>
        </Card>
      )}

      <Card className="mb-4">
        <CardHeader title="Google algorithm updates" description="Curated reference list · shaded on the trend chart" info={UPDATES_NOTE} />
        <CardBody>
          <MiniTable
            columns={[{ header: "Update" }, { header: "Type" }, { header: "Rollout", align: "right" }]}
            rows={[...GOOGLE_UPDATES]
              .reverse()
              .slice(0, 6)
              .map((u) => [
                <span key="n" className="text-text">
                  {u.name}
                </span>,
                <Badge key="t" tone={u.type === "core" ? "brand" : "neutral"}>
                  {u.type === "core" ? "Core" : "Spam"}
                </Badge>,
                <span key="d" className="whitespace-nowrap text-text-2">
                  {dateLabel(u.start)} – {dateLabel(u.end)}
                </span>,
              ])}
          />
        </CardBody>
        <CardFooter className="text-text-3">
          Reference only: {UPDATES_NOTE} Check the{" "}
          <a href="https://status.search.google.com/" target="_blank" rel="noopener noreferrer" className="text-link hover:underline">
            Google Search Status Dashboard
          </a>{" "}
          for the latest.
        </CardFooter>
      </Card>

      <p className="text-[12px] text-text-3">
        Bands: {BANDS.map((b) => `${b.label} ${b.min}–${b.max}`).join(" · ")}. Market scores come from real Google top-10 snapshots of a fixed keyword panel (DataForSEO); the personal score from your{" "}
        <Link href={ptHref} className="text-link hover:underline">
          Position Tracking
        </Link>{" "}
        rankings. Days without a snapshot are left empty, never estimated.
      </p>
    </Page>
  );
}
