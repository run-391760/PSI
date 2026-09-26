import { compact, displayUrl, pct } from "@/lib/format";
import { pages, type Ctx } from "@/lib/position-tracking/reports";
import { Grid } from "@/components/shell/page";
import { BarChart } from "@/components/charts/bar-chart";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Metric } from "@/components/ui/metric";
import { PagesTable } from "../pages-table";

export async function PagesTab({ ctx, domain: requested }: { ctx: Ctx; domain: string | null }) {
  const domain = requested && ctx.domains.includes(requested) ? requested : ctx.project.domain;
  const rows = await pages(ctx, domain);
  const ranking = rows.filter((r) => r.keywords > 0);
  const total = rows.reduce((s, r) => s + r.traffic, 0);
  const own = domain === ctx.project.domain;
  const params = new URLSearchParams({ project: ctx.project.id, tab: "overview", range: String(ctx.range), device: ctx.device });
  const chart = rows.slice(0, 8).map((r) => ({ page: displayUrl(r.url).replace(/^www\./, "").replace(/^[^/]+/, "") || "/", visibility: Math.round(r.visibility * 100) / 100 }));
  return (
    <>
      <Grid cols={2} className="mb-4 lg:grid-cols-[1fr_1.4fr]">
        <Card>
          <div className="grid h-full grid-cols-2">
            <Metric className="border-r border-b border-border p-4" label="Ranking pages" value={ranking.length} sub={`on ${domain}${rows.length > ranking.length ? ` · ${rows.length - ranking.length} dropped out` : ""}`} />
            <Metric className="border-b border-border p-4" label="Est. traffic" value={compact(total)} sub="visits / month" />
            <Metric className="border-r border-border p-4" label="Top page visibility" value={rows[0] ? pct(rows[0].visibility, 2) : "n/a"} sub={<span className="block truncate">{rows[0] ? displayUrl(rows[0].url).replace(/^www\./, "") : "–"}</span>} />
            <Metric className="p-4" label="Pages gaining" value={rows.filter((r) => r.visibilityDelta > 0.001).length} sub={`${rows.filter((r) => r.visibilityDelta < -0.001).length} losing visibility`} />
          </div>
        </Card>
        <Card>
          <CardHeader title="Visibility by page" description={`Top ${chart.length} landing pages of ${domain}`} />
          <CardBody>
            {chart.length ? <BarChart data={chart} xKey="page" layout="bars" categoryWidth={180} series={[{ key: "visibility", label: "Visibility %" }]} yFormat="percent" valueLabels height={Math.max(140, chart.length * 30)} /> : <p className="py-10 text-center text-[13px] text-text-3">No ranking pages.</p>}
          </CardBody>
        </Card>
      </Grid>
      <Card>
        <CardHeader title="Landing pages" description="Pages ranking for your tracked keywords on the end date, with change vs the start of the range" />
        <PagesTable rows={rows} domains={ctx.domains} domain={domain} exportName={`pages-${domain}`} kwBase={own ? `/position-tracking?${params.toString()}` : null} />
      </Card>
    </>
  );
}
