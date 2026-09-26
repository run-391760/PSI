import { pct } from "@/lib/format";
import { serpFeatures, type Ctx } from "@/lib/position-tracking/reports";
import { FeatureIcon, featureLabel } from "@/components/seo/badges";
import { Grid } from "@/components/shell/page";
import { TrendChart } from "@/components/charts/trend-chart";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Metric, MetricStrip } from "@/components/ui/metric";
import { MiniTable } from "@/components/ui/mini-table";
import { Bar } from "@/components/ui/progress";
import { ExportButton } from "../export-button";
import { SnippetsTable } from "../features-table";
import { Delta } from "../ui";

export async function FeaturesTab({ ctx }: { ctx: Ctx; base: string }) {
  const d = await serpFeatures(ctx);
  const params = new URLSearchParams({ project: ctx.project.id, tab: "overview", range: String(ctx.range), device: ctx.device });
  const fs = d.features.find((f) => f.feature === "featured_snippet");
  const owned = d.snippets.filter((s) => s.status === "owned").length;
  const opportunities = d.snippets.filter((s) => s.status === "opportunity").length;
  const byCompetitors = d.snippets.filter((s) => s.ownerIsCompetitor).length;
  const totalOwned = d.features.reduce((s, f) => s + f.owned, 0);
  const totalOwnedStart = d.features.reduce((s, f) => s + f.ownedStart, 0);
  return (
    <>
      <Card className="mb-4">
        <MetricStrip>
          <Metric label="Featured snippets in SERPs" value={fs?.present ?? 0} sub={`of ${d.matrix.length} tracked keywords`} />
          <Metric label="Owned by you" value={owned} sub={fs?.present ? `${pct((owned / fs.present) * 100, 0)} of snippets` : "no snippets"} />
          <Metric label="Opportunities" info="Keywords with a featured snippet where you rank in the top 10 but don't own it." value={opportunities} sub="you rank top 10, snippet not yours" />
          <Metric label="Owned by competitors" value={byCompetitors} sub="tracked competitors" />
          <Metric label="SERP features owned" value={totalOwned} sub={<Delta value={totalOwned - totalOwnedStart} digits={0} />} />
        </MetricStrip>
      </Card>
      <Grid cols={2} className="mb-4 lg:grid-cols-[1fr_1.2fr]">
        <Card>
          <CardHeader
            title="SERP features"
            description="How many tracked keywords show each feature, and where you appear in it"
            actions={<ExportButton name={`serp-features-${ctx.project.domain}`} rows={[["Feature", "Keywords with feature", "Owned by you", "Owned at start"], ...d.features.map((f) => [featureLabel(f.feature), f.present, f.owned, f.ownedStart])]} />}
          />
          <CardBody>
            <MiniTable
              empty="No SERP features recorded."
              columns={[{ header: "Feature" }, { header: "In SERPs", align: "right" }, { header: "Owned", align: "right" }, { header: "Share", className: "w-28" }, { header: "Change", align: "right" }]}
              rows={d.features.map((f) => [
                <span key="f" className="inline-flex items-center gap-2 text-text-2">
                  <span className="text-text-3">
                    <FeatureIcon feature={f.feature} />
                  </span>
                  {featureLabel(f.feature)}
                </span>,
                f.present,
                <span key="o" className="font-semibold">
                  {f.owned}
                </span>,
                <Bar key="b" value={f.present ? (f.owned / f.present) * 100 : 0} className="w-24" />,
                <Delta key="d" value={f.owned - f.ownedStart} digits={0} />,
              ])}
            />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Owned SERP features trend" description="Number of SERP feature placements held by your domain across tracked keywords" />
          <CardBody>
            {d.trend.length > 1 ? (
              <TrendChart
                data={d.trend}
                xKey="day"
                xFormat="day"
                yFormat="number"
                series={[{ key: "owned", label: "SERP features owned" }]}
                height={260}
              />
            ) : (
              <p className="py-12 text-center text-[13px] text-text-3">Not enough history yet.</p>
            )}
          </CardBody>
        </Card>
      </Grid>
      <Card>
        <CardHeader title="Featured snippets" description="Who owns the snippet for each tracked keyword that shows one" />
        <SnippetsTable rows={d.snippets} domain={ctx.project.domain} exportName={`featured-snippets-${ctx.project.domain}`} kwBase={`/position-tracking?${params.toString()}`} />
      </Card>
    </>
  );
}
