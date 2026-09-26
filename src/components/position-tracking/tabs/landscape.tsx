import Link from "next/link";
import { compact, dayLabel, displayUrl, num, pct } from "@/lib/format";
import { landscape, type Ctx } from "@/lib/position-tracking/reports";
import { FeatureIcon, featureLabel, PositionChange } from "@/components/seo/badges";
import { Grid } from "@/components/shell/page";
import { BarChart } from "@/components/charts/bar-chart";
import { TrendChart } from "@/components/charts/trend-chart";
import { Card, CardBody, CardFooter, CardHeader } from "@/components/ui/card";
import { Metric, MetricStrip } from "@/components/ui/metric";
import { MiniTable } from "@/components/ui/mini-table";
import { Bar } from "@/components/ui/progress";
import { InfoTip } from "@/components/ui/tooltip";
import { ExportButton } from "../export-button";
import { SovBars } from "../sov-bars";
import { Delta, Pos, Stat, domainColor, domainDashed } from "../ui";

export async function LandscapeTab({ ctx, base }: { ctx: Ctx; base: string }) {
  const d = await landscape(ctx);
  const own = ctx.project.domain;
  const ownRow = d.perDomain[0];
  const s = ownRow?.start;
  const e = ownRow?.end;
  const keys = ctx.domains.map((_, i) => `d${i}`);
  const byDay = new Map<string, Record<string, unknown>>();
  const trafficByDay = new Map<string, Record<string, unknown>>();
  for (const a of d.daily) {
    const i = ctx.domains.indexOf(a.domain);
    if (i < 0) continue;
    const row = byDay.get(a.day) ?? { day: a.day };
    row[keys[i]] = Math.round(a.visibility * 100) / 100;
    byDay.set(a.day, row);
    const t = trafficByDay.get(a.day) ?? { day: a.day };
    t[keys[i]] = Math.round(a.traffic);
    trafficByDay.set(a.day, t);
  }
  const visData = [...byDay.values()];
  const trafficData = [...trafficByDay.values()];
  const series = ctx.domains.map((dm, i) => ({ key: keys[i], label: dm, color: domainColor(i), dashed: domainDashed(i) }));
  const distData = d.daily
    .filter((a) => a.domain === own)
    .map((a) => ({ day: a.day, top3: a.top3, top4_10: a.top10 - a.top3, top11_20: a.top20 - a.top10, top21_100: a.top100 - a.top20 }));
  const bandData = [
    { band: "Top 3", start: d.bandsStart.top3, end: d.bandsEnd.top3 },
    { band: "4–10", start: d.bandsStart.top10, end: d.bandsEnd.top10 },
    { band: "11–20", start: d.bandsStart.top20, end: d.bandsEnd.top20 },
    { band: "21–100", start: d.bandsStart.top100, end: d.bandsEnd.top100 },
    { band: "Not ranking", start: d.bandsStart.none, end: d.bandsEnd.none },
  ];
  const trafficDelta = s && e && s.traffic > 0 ? ((e.traffic - s.traffic) / s.traffic) * 100 : null;
  const exportRows: (string | number | null)[][] = [
    ["Date", "Domain", "Visibility %", "Estimated traffic", "Average position", "Top 3", "Top 10", "Top 20", "Top 100", "Keywords"],
    ...d.daily.map((a) => [a.day, a.domain, a.visibility.toFixed(2), Math.round(a.traffic), a.avgPosition?.toFixed(1) ?? null, a.top3, a.top10, a.top20, a.top100, a.keywords]),
  ];
  const link = (tab: string, extra = "") => `${base}&tab=${tab}${extra}`;
  const kwLink = (id: string) => link("overview", `&kw=${id}`);

  return (
    <>
      <Card className="mb-4">
        <MetricStrip>
          <Stat
            label="Visibility"
            info={<InfoTip text="Σ CTR(position) ÷ (keywords × CTR(#1)) × 100. 100% means every tracked keyword ranks #1." />}
            value={e ? pct(e.visibility, 2) : "n/a"}
            delta={<Delta value={e && s ? e.visibility - s.visibility : null} digits={2} suffix="%" />}
            sub={s && ctx.startDay !== ctx.endDay ? `${pct(s.visibility, 2)} at start of range` : undefined}
          />
          <Metric label="Estimated traffic" info="Search volume × CTR at the current position, summed over tracked keywords (monthly)." value={e ? compact(e.traffic) : "n/a"} delta={trafficDelta == null ? null : Number(trafficDelta.toFixed(1))} sub="visits / month" />
          <Stat
            label="Average position"
            info={<InfoTip text="Mean position of all tracked keywords; keywords outside the top 100 count as 100." />}
            value={e?.avgPosition != null ? num(e.avgPosition, 1) : "n/a"}
            delta={<Delta value={s?.avgPosition != null && e?.avgPosition != null ? s.avgPosition - e.avgPosition : null} />}
            sub="lower is better"
          />
          <Stat label="Keywords in top 3" value={e ? e.top3 : "n/a"} delta={<Delta value={e && s ? e.top3 - s.top3 : null} digits={0} hideZero />} sub={e ? `of ${e.keywords} tracked` : undefined} />
          <Stat label="Keywords in top 10" value={e ? e.top10 : "n/a"} delta={<Delta value={e && s ? e.top10 - s.top10 : null} digits={0} hideZero />} sub={e ? `${e.ranked} in top 100` : undefined} />
        </MetricStrip>
      </Card>

      <Grid cols={2} className="mb-4 lg:grid-cols-[1.65fr_1fr]">
        <Card>
          <CardHeader title="Visibility trend" description="Your domain vs competitors, daily" info="Click a legend item to hide a domain." actions={<ExportButton name={`visibility-${own}`} rows={exportRows} />} />
          <CardBody>
            {visData.length > 1 ? (
              <TrendChart data={visData} xKey="day" xFormat="day" yFormat="percent" series={series} height={280} />
            ) : (
              <p className="py-16 text-center text-[13px] text-text-3">The trend appears after the second daily check.</p>
            )}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Competitors" description="Visibility on the end date" href={link("competitors")} />
          <CardBody>
            <MiniTable
              columns={[{ header: "Domain" }, { header: "Visibility", align: "right" }, { header: "Change", align: "right" }, { header: "Avg. pos.", align: "right" }]}
              rows={[...d.perDomain]
                .map((p, i) => ({ ...p, i }))
                .sort((a, b) => (b.end?.visibility ?? 0) - (a.end?.visibility ?? 0))
                .map((p) => [
                  <span key="d" className="flex min-w-0 items-center gap-2">
                    <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: domainColor(p.i) }} aria-hidden />
                    <span className={p.i === 0 ? "truncate font-semibold text-text" : "truncate text-text-2"} title={p.domain}>
                      {p.domain}
                    </span>
                    {p.i === 0 && <span className="shrink-0 text-[11px] text-text-3">you</span>}
                  </span>,
                  p.end ? pct(p.end.visibility, 2) : "n/a",
                  <Delta key="c" value={p.end && p.start ? p.end.visibility - p.start.visibility : null} digits={2} />,
                  p.end?.avgPosition != null ? num(p.end.avgPosition, 1) : "n/a",
                ])}
            />
            <div className="mt-4 border-t border-border pt-3">
              <div className="mb-2 flex items-center gap-1 text-[12.5px] font-medium text-text-2">
                Share of voice <InfoTip text="Σ(volume × CTR at the domain's position) ÷ total search volume of tracked keywords." />
              </div>
              <SovBars rows={d.perDomain.map((p, i) => ({ domain: p.domain, index: i, sov: d.totalVolume && p.end ? (p.end.traffic / d.totalVolume) * 100 : null }))} limit={6} />
            </div>
          </CardBody>
          <CardFooter>
            <Link href={link("competitors")} className="text-link hover:underline">
              Discover more competitors in your SERPs →
            </Link>
          </CardFooter>
        </Card>
      </Grid>

      <Grid cols={2} className="mb-4">
        <Card>
          <CardHeader title="Rankings distribution" description={`${own} — keywords per position band`} />
          <CardBody>
            {distData.length > 1 ? (
              <TrendChart
                data={distData}
                xKey="day"
                xFormat="day"
                type="stacked"
                yFormat="number"
                series={[
                  { key: "top3", label: "Top 3" },
                  { key: "top4_10", label: "4–10" },
                  { key: "top11_20", label: "11–20" },
                  { key: "top21_100", label: "21–100" },
                ]}
                height={240}
              />
            ) : (
              <p className="py-16 text-center text-[13px] text-text-3">Not enough history yet.</p>
            )}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Estimated traffic" description="Monthly visits from tracked keywords, per domain" />
          <CardBody>
            {trafficData.length > 1 ? <TrendChart data={trafficData} xKey="day" xFormat="day" yFormat="compact" series={series} height={240} /> : <p className="py-16 text-center text-[13px] text-text-3">Not enough history yet.</p>}
          </CardBody>
        </Card>
      </Grid>

      <Grid cols={3} className="mb-4">
        <Card>
          <CardHeader title="Top keywords" description="By estimated traffic" href={link("overview")} />
          <CardBody>
            <MiniTable
              empty="No keywords rank in the top 100 yet."
              columns={[{ header: "Keyword" }, { header: "Pos.", align: "right" }, { header: "Diff", align: "right" }, { header: "Traffic", align: "right" }]}
              rows={d.topKeywords.map((k) => [
                <Link key="k" href={kwLink(k.id)} scroll={false} className="block max-w-[180px] truncate text-link hover:underline" title={k.url ? `${k.keyword} → ${displayUrl(k.url)}` : k.keyword}>
                  {k.keyword}
                </Link>,
                <Pos key="p" value={k.position} strong />,
                <PositionChange key="c" previous={k.start} current={k.position} />,
                compact(k.traffic),
              ])}
            />
          </CardBody>
        </Card>
        <ImpactCard title="Positive impact" description="Biggest visibility gains in the range" rows={d.positive} kwLink={kwLink} empty="No keywords improved in this range." />
        <ImpactCard title="Negative impact" description="Biggest visibility losses in the range" rows={d.negative} kwLink={kwLink} empty="No keywords declined in this range." />
      </Grid>

      <Grid cols={2} className="mb-4">
        <Card>
          <CardHeader title="SERP features" description="Present in your keywords' SERPs vs. owned by your domain" href={link("features")} />
          <CardBody>
            {d.features.length ? (
              <ul className="space-y-2.5">
                {d.features.slice(0, 9).map((f) => (
                  <li key={f.feature} className="grid grid-cols-[18px_minmax(0,1fr)_minmax(60px,110px)_76px] items-center gap-2 text-[13px] sm:grid-cols-[18px_minmax(0,1fr)_140px_90px]">
                    <span className="text-text-3">
                      <FeatureIcon feature={f.feature} />
                    </span>
                    <span className="truncate text-text-2">{featureLabel(f.feature)}</span>
                    <div className="relative">
                      <Bar value={f.present} max={d.keywordCount || 1} color="var(--seq-200)" />
                      <Bar value={f.owned} max={d.keywordCount || 1} className="absolute inset-0 bg-transparent" track={false} />
                    </div>
                    <span className="tabular text-right text-[12.5px] text-text">
                      <span className="font-semibold">{f.owned}</span>
                      <span className="text-text-3"> / {f.present}</span>
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="py-6 text-center text-[13px] text-text-3">No SERP feature data.</p>
            )}
            <div className="mt-3 flex items-center gap-4 text-[11.5px] text-text-3">
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-sm bg-[var(--series-1)]" /> Owned by you
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-sm bg-[var(--seq-200)]" /> Present in SERP
              </span>
            </div>
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Rankings overview" description="Keywords per position band: start vs end of range" />
          <CardBody>
            <BarChart
              data={bandData}
              xKey="band"
              series={[
                { key: "start", label: ctx.startDay ? dayLabel(ctx.startDay) : "Start", color: "var(--seq-200)" },
                { key: "end", label: ctx.endDay ? dayLabel(ctx.endDay) : "End", color: "var(--series-1)" },
              ]}
              yFormat="number"
              height={240}
            />
          </CardBody>
        </Card>
      </Grid>
    </>
  );
}

function ImpactCard({ title, description, rows, kwLink, empty }: { title: string; description: string; rows: { id: string; keyword: string; start: number | null; end: number | null; impact: number }[]; kwLink: (id: string) => string; empty: string }) {
  return (
    <Card>
      <CardHeader title={title} description={description} info="Change in the domain's total visibility caused by this keyword's movement (percentage points)." />
      <CardBody>
        <MiniTable
          empty={empty}
          columns={[{ header: "Keyword" }, { header: "Position", align: "right" }, { header: "Visibility", align: "right" }]}
          rows={rows.map((r) => [
            <Link key="k" href={kwLink(r.id)} scroll={false} className="block max-w-[170px] truncate text-link hover:underline" title={r.keyword}>
              {r.keyword}
            </Link>,
            <span key="p" className="tabular inline-flex items-center gap-1 whitespace-nowrap text-text-2">
              <Pos value={r.start} /> → <Pos value={r.end} strong />
            </span>,
            <Delta key="i" value={r.impact} digits={2} suffix="%" />,
          ])}
        />
      </CardBody>
    </Card>
  );
}
