import { cannibalization, type Ctx } from "@/lib/position-tracking/reports";
import { Card, CardHeader } from "@/components/ui/card";
import { Callout } from "@/components/ui/feedback";
import { Metric, MetricStrip } from "@/components/ui/metric";
import { ScoreRing } from "@/components/ui/progress";
import { CannibalizationTable } from "../cannibalization-table";

export async function CannibalizationTab({ ctx }: { ctx: Ctx }) {
  const d = await cannibalization(ctx);
  const params = new URLSearchParams({ project: ctx.project.id, tab: "overview", range: String(ctx.range), device: ctx.device });
  const high = d.rows.filter((r) => r.severity === "high").length;
  return (
    <>
      <Card className="mb-4">
        <MetricStrip>
          <div className="flex items-center gap-3">
            <ScoreRing value={d.score} size={60} stroke={7} label={`${d.score}%`} />
            <Metric label="Cannibalization score" info="Share of ranking keywords served by a single URL during the range. 100% = no cannibalization." value={`${d.score}%`} sub={`${d.ranking} ranking keywords`} />
          </div>
          <Metric label="Cannibalized keywords" value={d.rows.length} sub={high ? `${high} high severity` : "none high severity"} />
          <Metric label="Affected pages" value={d.affectedPages} sub="URLs competing with each other" />
          <Metric label="URL switches" value={d.switches} sub={`in the last ${ctx.days.length} day${ctx.days.length === 1 ? "" : "s"}`} />
        </MetricStrip>
      </Card>
      {d.rows.length > 0 && (
        <Callout tone="info" className="mb-4" title="How to fix cannibalization">
          Pick one canonical page per keyword: merge overlapping content, point internal links and anchors at the preferred URL, and use redirects or canonical tags for the others.
        </Callout>
      )}
      <Card>
        <CardHeader title="Keywords with competing URLs" description={`${ctx.project.domain} · keywords where more than one of your URLs ranked or the ranking URL changed`} />
        <CannibalizationTable rows={d.rows} days={d.days} exportName={`cannibalization-${ctx.project.domain}`} kwBase={`/position-tracking?${params.toString()}`} />
      </Card>
    </>
  );
}
