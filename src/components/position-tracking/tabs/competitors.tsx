import { dayLabel, pct } from "@/lib/format";
import { competitors, type Ctx } from "@/lib/position-tracking/reports";
import { MAX_COMPETITORS } from "@/lib/position-tracking/types";
import { Grid } from "@/components/shell/page";
import { BubbleChart } from "@/components/charts/bubble-chart";
import { TrendChart } from "@/components/charts/trend-chart";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { CompetitorsTable, DiscoveredTable } from "../competitor-tables";
import { SovBars } from "../sov-bars";
import { Delta, domainColor, domainDashed } from "../ui";

export async function CompetitorsTab({ ctx }: { ctx: Ctx }) {
  const d = await competitors(ctx);
  const keys = ctx.domains.map((_, i) => `d${i}`);
  const series = ctx.domains.map((dm, i) => ({ key: keys[i], label: dm, color: domainColor(i), dashed: domainDashed(i) }));
  const sovByDay = new Map<string, Record<string, unknown>>();
  const posByDay = new Map<string, Record<string, unknown>>();
  for (const a of d.daily) {
    const i = ctx.domains.indexOf(a.domain);
    if (i < 0) continue;
    const s = sovByDay.get(a.day) ?? { day: a.day };
    s[keys[i]] = d.totalVolume ? Math.round((a.traffic / d.totalVolume) * 10000) / 100 : null;
    sovByDay.set(a.day, s);
    const p = posByDay.get(a.day) ?? { day: a.day };
    p[keys[i]] = a.avgPosition == null ? null : Math.round(a.avgPosition * 10) / 10;
    posByDay.set(a.day, p);
  }
  const unclaimed = Math.max(0, 100 - d.rows.reduce((s, r) => s + (r.sov ?? 0), 0));
  const own = d.rows[0];

  return (
    <>
      <Grid cols={2} className="mb-4 lg:grid-cols-[1.5fr_1fr]">
        <Card>
          <CardHeader title="Visibility vs. keywords" description="Bubble size is estimated traffic · your domain is highlighted" />
          <CardBody className="pr-12 [&_.recharts-surface]:overflow-visible">
            <BubbleChart
              xLabel="Keywords in top 100"
              yLabel="Visibility %"
              zLabel="Est. traffic"
              yFormat="percent"
              points={d.rows.map((r) => ({ label: r.domain, x: r.ranked, y: Math.round(r.visibility * 100) / 100, z: Math.max(1, Math.round(r.traffic)), highlight: r.own }))}
              height={300}
            />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Share of voice" description="Share of all estimated clicks on your tracked keywords" info="Σ(volume × CTR at the domain's position) ÷ total search volume. The remainder goes to untracked domains, other SERP features and searches without a click." />
          <CardBody>
            {d.totalVolume ? (
              <>
                <div className="mb-4 flex items-baseline gap-2">
                  <span className="text-[28px] font-semibold tracking-tight text-text">{own?.sov != null ? `${own.sov.toFixed(2)}%` : "n/a"}</span>
                  <Delta value={own?.sovDelta} digits={2} />
                  <span className="text-[12.5px] text-text-3">your share of voice</span>
                </div>
                <SovBars rows={d.rows.map((r) => ({ domain: r.domain, index: r.index, sov: r.sov }))} />
                <p className="mt-4 border-t border-border pt-3 text-[12px] text-text-3">
                  Tracked domains capture {pct(100 - unclaimed, 1)} of estimated clicks; the rest goes to other sites and SERP features.
                </p>
              </>
            ) : (
              <p className="py-12 text-center text-[13px] text-text-3">Search volume is not available for these keywords yet.</p>
            )}
          </CardBody>
        </Card>
      </Grid>

      <Card className="mb-4">
        <CardHeader title="Tracked competitors" description={`${ctx.domains.length} domains · end of range vs start`} />
        <CompetitorsTable rows={d.rows} db={ctx.campaign.db} exportName={`competitors-${ctx.project.domain}`} />
      </Card>

      <Grid cols={2} className="mb-4">
        <Card>
          <CardHeader title="Share of voice trend" />
          <CardBody>
            {sovByDay.size > 1 ? <TrendChart data={[...sovByDay.values()]} xKey="day" xFormat="day" yFormat="percent" series={series} height={240} /> : <p className="py-12 text-center text-[13px] text-text-3">Not enough history yet.</p>}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Average position trend" description="Keywords outside the top 100 count as 100" />
          <CardBody>
            {posByDay.size > 1 ? <TrendChart data={[...posByDay.values()]} xKey="day" xFormat="day" yFormat="number" reversed yDomain={["dataMin", "dataMax"]} series={series} height={240} /> : <p className="py-12 text-center text-[13px] text-text-3">Not enough history yet.</p>}
          </CardBody>
        </Card>
      </Grid>

      <Card>
        <CardHeader
          title="Competitors discovery"
          description={d.serpDay ? `Domains found in the top 20 for your tracked keywords · SERPs from ${dayLabel(d.serpDay)}` : "Domains found in the top 20 for your tracked keywords"}
          info="Visibility here uses only the top 20 results of the latest SERP snapshot per keyword."
        />
        {d.discovered.length ? (
          <DiscoveredTable rows={d.discovered} projectId={ctx.project.id} db={ctx.campaign.db} canAdd={ctx.campaign.competitors.length < MAX_COMPETITORS} exportName={`discovered-competitors-${ctx.project.domain}`} />
        ) : (
          <CardBody>
            <p className="py-8 text-center text-[13px] text-text-3">SERP snapshots are stored with each daily check. Run a check to discover competitors.</p>
          </CardBody>
        )}
      </Card>
    </>
  );
}
