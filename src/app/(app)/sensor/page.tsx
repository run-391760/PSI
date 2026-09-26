import { ArrowDownRight, ArrowUpRight, Target } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { requirePageUser } from "@/lib/auth";
import { database } from "@/lib/domain";
import { dateLabel } from "@/lib/format";
import { listProjects } from "@/lib/projects";
import { BANDS, bandFor, CHART_FEATURES, GOOGLE_UPDATES, SENSOR_CATEGORIES, TRACKED_FEATURES, UPDATES_NOTE, sensorOverview, validCategory } from "@/lib/sensor/engine";
import { personalVolatility } from "@/lib/sensor/personal";
import { cn } from "@/lib/utils";
import { TrendChart } from "@/components/charts/trend-chart";
import { DomainLink, FeatureIcon, featureLabel, Sparkline } from "@/components/seo/badges";
import { DataSourceBadge, DemoNotice } from "@/components/seo/source-badge";
import { SensorChart } from "@/components/sensor/sensor-chart";
import { SensorFilters } from "@/components/sensor/sensor-filters";
import { VolatilityStrip } from "@/components/sensor/volatility-strip";
import { Grid, Page, PageHeader } from "@/components/shell/page";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardBody, CardFooter, CardHeader } from "@/components/ui/card";
import { MiniTable } from "@/components/ui/mini-table";
import { Gauge } from "@/components/ui/progress";

export const metadata: Metadata = { title: "SERP Sensor" };

function Change({ value, suffix = "" }: { value: number; suffix?: string }) {
  if (value === 0) return <span className="text-text-3">0{suffix}</span>;
  // More volatility is "worse" news for rankings: use serious ink for rises, good ink for calming.
  return (
    <span className={cn("tabular inline-flex items-center text-[12.5px] font-medium", value > 0 ? "text-serious-ink" : "text-good-ink")}>
      {value > 0 ? <ArrowUpRight className="h-3.5 w-3.5" /> : <ArrowDownRight className="h-3.5 w-3.5" />}
      {Math.abs(value).toFixed(1)}
      {suffix}
    </span>
  );
}

function ScoreChip({ score }: { score: number }) {
  const b = bandFor(score);
  return (
    <span className="tabular inline-flex items-center gap-1.5 font-medium text-text" title={`${b.label} volatility`}>
      <span className="h-2 w-2 rounded-full" style={{ background: b.color }} aria-hidden />
      {score.toFixed(1)}
    </span>
  );
}

export default async function SensorPage({ searchParams }: PageProps<"/sensor">) {
  const user = await requirePageUser();
  const sp = await searchParams;
  const db = database(typeof sp.db === "string" ? sp.db : "US").code;
  const device = sp.device === "mobile" ? "mobile" : "desktop";
  const category = validCategory(typeof sp.category === "string" ? sp.category : "all");
  const o = sensorOverview(db, device, category);
  const [personal, projects] = await Promise.all([personalVolatility(user.id), listProjects(user.id)]);
  const band = bandFor(o.today.score);
  const info = database(db);
  const personalByDate = new Map(personal?.series.map((p) => [p.date, p.score]) ?? []);
  const chartData = o.history.map((h) => ({ ...h, personal: personalByDate.get(h.date) ?? null }));
  const featureFirst = o.features[0];
  const featureLast = o.features[o.features.length - 1];
  const link = (params: Record<string, string>) => `/sensor?${new URLSearchParams({ db, device, category, ...params }).toString()}`;
  const maxCountry = Math.max(...o.countries.map((c) => c.score), 1);

  return (
    <Page>
      <PageHeader
        breadcrumbs={[{ label: "Monitoring & reports" }, { label: "SERP Sensor", href: "/sensor" }]}
        title="SERP Sensor:"
        subject={o.categoryName}
        description="How much Google search results changed day to day. Scores run from 0 (calm) to 10 (heavy turbulence, typical of a core update)."
        meta={
          <>
            <DataSourceBadge source="demo" />
            <Badge>
              {info.flag} {info.name}
            </Badge>
            <Badge>{device === "mobile" ? "Mobile" : "Desktop"}</Badge>
          </>
        }
      >
        <SensorFilters categories={SENSOR_CATEGORIES} db={db} device={device} category={category} />
      </PageHeader>

      <Grid cols={2} className="mb-4 lg:grid-cols-[330px_1fr]">
        <Card>
          <CardHeader title="Today's volatility" description={`${dateLabel(o.today.date)} (UTC day)`} info="Average rank movement of the tracked keyword sample versus the previous day, scaled to 0–10." />
          <CardBody>
            <div className="flex flex-col items-center">
              <Gauge value={o.today.score * 10} color={band.color} size={190} label={o.today.score.toFixed(1)} sub="out of 10" />
              <Badge tone={band.tone} className="mt-3 h-6 px-2.5 text-[12.5px]">
                {band.label} volatility
              </Badge>
              <p className="mt-1.5 text-center text-[12.5px] text-text-2">{band.note}</p>
            </div>
            <dl className="mt-4 grid grid-cols-3 gap-2 border-t border-border pt-3 text-center text-[12px]">
              <div>
                <dt className="text-text-3">vs yesterday</dt>
                <dd className="mt-0.5">
                  <Change value={o.change} />
                </dd>
              </div>
              <div>
                <dt className="text-text-3">30-day avg</dt>
                <dd className="mt-0.5 font-medium text-text">
                  <ScoreChip score={o.avg30} />
                </dd>
              </div>
              <div>
                <dt className="text-text-3">{o.otherDevice.device === "mobile" ? "Mobile" : "Desktop"}</dt>
                <dd className="mt-0.5">
                  <Link href={link({ device: o.otherDevice.device })} className="hover:underline">
                    <ScoreChip score={o.otherDevice.score} />
                  </Link>
                </dd>
              </div>
            </dl>
            <ul className="mt-4 space-y-1.5 border-t border-border pt-3 text-[12px]">
              {o.bandDays.map((b) => (
                <li key={b.id} className="flex items-center gap-2">
                  <span className="h-2.5 w-2.5 rounded-sm" style={{ background: b.color }} aria-hidden />
                  <span className="flex-1 text-text-2">
                    {b.label} <span className="text-text-3">
                      ({b.min}–{b.max})
                    </span>
                  </span>
                  <span className="tabular text-text">{b.days} days</span>
                </li>
              ))}
              <li className="pt-0.5 text-[11.5px] text-text-3">Days in each band over the last 30 days. Peak: {o.peak30.score.toFixed(1)} on {dateLabel(o.peak30.date)}.</li>
            </ul>
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Volatility trend" description={`${o.categoryName} · ${info.flag} ${info.code} · ${device}`} />
          <CardBody>
            <SensorChart data={chartData} height={330} personalLabel="Personal score (your keywords)" />
          </CardBody>
        </Card>
      </Grid>

      <Grid cols={2} className="mb-4 lg:grid-cols-[1.45fr_1fr]">
        <Card>
          <CardHeader title="Volatility by category" description="Today's score, change vs yesterday and the last 30 days" />
          <CardBody>
            <MiniTable
              columns={[{ header: "Category" }, { header: "Today", align: "right" }, { header: "Change", align: "right" }, { header: "30-day avg", align: "right" }, { header: "Last 30 days", align: "right", className: "hidden sm:table-cell" }]}
              rows={o.categories.map((c) => [
                <Link key="n" href={link({ category: c.id })} className={cn("hover:underline", c.id === category ? "font-semibold text-text" : "text-link")}>
                  {c.name}
                </Link>,
                <ScoreChip key="t" score={c.today} />,
                <Change key="c" value={c.change} />,
                <span key="a" className="text-text-2">
                  {c.avg30.toFixed(1)}
                </span>,
                <span key="s" className="hidden justify-end sm:flex">
                  <VolatilityStrip values={c.spark} width={120} height={20} />
                </span>,
              ])}
            />
          </CardBody>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader title="Personal score" description="Volatility of your own tracked keywords" info="Average daily position change of the keywords tracked in your projects' Position Tracking, on the same 0–10 scale." />
            <CardBody>
              {personal ? (
                <>
                  <div className="flex items-center gap-4">
                    <Gauge value={personal.today * 10} color={bandFor(personal.today).color} size={120} label={personal.today.toFixed(1)} sub="today" />
                    <div className="min-w-0 text-[12.5px]">
                      <Badge tone={bandFor(personal.today).tone}>{bandFor(personal.today).label}</Badge>
                      <div className="mt-1.5 text-text-3">
                        <Change value={personal.change} /> vs yesterday
                      </div>
                      <div className="mt-0.5 text-text-3">
                        30-day avg <span className="font-medium text-text">{personal.avg30.toFixed(1)}</span> vs market <span className="font-medium text-text">{o.avg30.toFixed(1)}</span>
                      </div>
                      <div className="mt-0.5 text-text-3">
                        {personal.keywords} keywords · {personal.projects.length} project{personal.projects.length === 1 ? "" : "s"}
                      </div>
                    </div>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-[11.5px] text-text-3">
                    <DataSourceBadge source={personal.source} note={personal.basis === "rankings" ? "Position Tracking daily rankings" : "tracked keywords, demo positions"} />
                    {personal.basis === "rankings" ? "From Position Tracking's daily rankings" : "Tracked keywords with demo positions"}
                  </div>
                  {personal.movers.length > 0 && (
                    <div className="mt-3 border-t border-border pt-2.5">
                      <div className="mb-1.5 text-[12px] font-medium text-text-2">Biggest moves today</div>
                      <ul className="space-y-1 text-[12.5px]">
                        {personal.movers.map((m) => (
                          <li key={`${m.domain}:${m.keyword}`} className="flex items-center justify-between gap-2">
                            <span className="truncate text-text-2" title={m.domain}>
                              {m.keyword}
                            </span>
                            <span className="tabular shrink-0 text-text-3">
                              {m.from ?? "–"} → <span className="font-medium text-text">{m.to ?? "out"}</span>
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
                  <p className="mt-0.5 max-w-xs text-[12.5px] text-text-3">Track keywords in Position Tracking and compare their daily volatility with the market.</p>
                  <ButtonLink href={projects[0] ? `/position-tracking?project=${projects[0].id}` : "/position-tracking"} variant="primary" size="sm" className="mt-3">
                    <span className="inline-flex items-center gap-1.5 text-white">Set up Position Tracking</span>
                  </ButtonLink>
                </div>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Winners & losers" description="Largest visibility share change vs yesterday" info="Share of the category's SERP visibility (top 20) captured by each domain; change in percentage points." />
            <CardBody className="grid gap-4 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
              {(["winners", "losers"] as const).map((k) => (
                <div key={k} className="min-w-0">
                  <div className="mb-1.5 text-[12px] font-medium text-text-2">{k === "winners" ? "Winners" : "Losers"}</div>
                  <ul className="space-y-1.5">
                    {o.movers[k].map((m) => (
                      <li key={m.domain} className="flex items-center justify-between gap-2 text-[12.5px]">
                        <DomainLink domain={m.domain} db={db} className="min-w-0" />
                        <span className="flex shrink-0 items-center gap-2">
                          <span className="tabular text-text-3">{m.visibility.toFixed(2)}%</span>
                          <span className={cn("tabular w-12 text-right font-medium", m.change > 0 ? "text-good-ink" : "text-critical-ink")}>
                            {m.change > 0 ? "+" : "−"}
                            {Math.abs(m.change).toFixed(2)}
                          </span>
                        </span>
                      </li>
                    ))}
                    {o.movers[k].length === 0 && <li className="text-[12.5px] text-text-3">No significant moves.</li>}
                  </ul>
                </div>
              ))}
            </CardBody>
          </Card>
        </div>
      </Grid>

      <Card className="mb-4">
        <CardHeader title="SERP features occurrence" description="Share of tracked SERPs that show each feature, last 30 days" />
        <CardBody className="grid gap-5 lg:grid-cols-[1.5fr_1fr]">
          <TrendChart
            data={o.features}
            xKey="date"
            xFormat="day"
            yFormat="percent"
            series={CHART_FEATURES.map((f) => ({ key: f, label: featureLabel(f) }))}
            height={280}
          />
          <MiniTable
            columns={[{ header: "Feature" }, { header: "Today", align: "right" }, { header: "30 days", align: "right" }, { header: "Trend", align: "right", className: "hidden sm:table-cell" }]}
            rows={TRACKED_FEATURES.map((f) => {
              const now = Number(featureLast[f]);
              const d = Math.round((now - Number(featureFirst[f])) * 10) / 10;
              return [
                <span key="f" className="inline-flex items-center gap-2 text-text-2">
                  <span className="text-text-3">
                    <FeatureIcon feature={f} />
                  </span>
                  {featureLabel(f)}
                </span>,
                <span key="t" className="font-medium">
                  {now.toFixed(1)}%
                </span>,
                <span key="d" className={cn("text-[12.5px]", d > 0 ? "text-text" : d < 0 ? "text-text-2" : "text-text-3")}>
                  {d > 0 ? "+" : d < 0 ? "−" : ""}
                  {Math.abs(d).toFixed(1)} pp
                </span>,
                <span key="s" className="hidden justify-end sm:flex">
                  <Sparkline values={o.features.map((r) => Number(r[f]))} width={72} height={20} />
                </span>,
              ];
            })}
          />
        </CardBody>
      </Card>

      <Grid cols={2} className="mb-4">
        <Card>
          <CardHeader title="Volatility by country" description={`${o.categoryName} · ${device} · today`} />
          <CardBody>
            <ul className="grid gap-x-6 gap-y-1.5 sm:grid-cols-2">
              {[...o.countries]
                .sort((a, b) => b.score - a.score)
                .map((c) => (
                  <li key={c.db} className="grid grid-cols-[1fr_80px_34px] items-center gap-2 text-[12.5px]">
                    <Link href={link({ db: c.db })} className={cn("truncate hover:underline", c.db === db ? "font-semibold text-text" : "text-link")}>
                      {c.flag} {c.name}
                    </Link>
                    <span className="h-1.5 overflow-hidden rounded-full bg-surface-3">
                      <span className="block h-full rounded-full" style={{ width: `${(c.score / maxCountry) * 100}%`, background: bandFor(c.score).color }} />
                    </span>
                    <span className="tabular text-right font-medium text-text">{c.score.toFixed(1)}</span>
                  </li>
                ))}
            </ul>
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Google algorithm updates" description="Curated reference list · shaded on the trend chart" info={UPDATES_NOTE} />
          <CardBody>
            <MiniTable
              columns={[{ header: "Update" }, { header: "Type" }, { header: "Rollout", align: "right" }]}
              rows={[...GOOGLE_UPDATES].reverse().map((u) => [
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
      </Grid>

      <p className="text-[12px] text-text-3">
        Bands: {BANDS.map((b) => `${b.label} ${b.min}–${b.max}`).join(" · ")}. Volatility, SERP features and winners/losers are generated by the demo engine for this database, device and category.
      </p>
      <DemoNotice className="mt-2" />
    </Page>
  );
}
