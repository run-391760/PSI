import { overview, type Ctx } from "@/lib/position-tracking/reports";
import { Card, CardHeader } from "@/components/ui/card";
import { NeedsData } from "@/components/seo/needs-data";
import { OverviewTable } from "../overview-table";

export async function OverviewTab({ ctx, initialKeyword, filter }: { ctx: Ctx; initialKeyword: string | null; filter: string | null }) {
  const rows = await overview(ctx);
  return (
    <Card>
      <CardHeader
        title="Rankings overview"
        description={
          ctx.measured
            ? `${ctx.project.domain} · ${ctx.device === "mobile" ? "mobile" : "desktop"} · Search Console average positions at the start and end of the range, clicks and impressions over the range`
            : `${ctx.project.domain} and ${ctx.campaign.competitors.length} competitor${ctx.campaign.competitors.length === 1 ? "" : "s"} · ${ctx.device === "mobile" ? "mobile" : "desktop"} · positions at the start and end of the range`
        }
        info="Click a keyword for its position history, landing pages and the latest SERP. Select rows to tag or delete them."
      />
      <OverviewTable
        rows={rows}
        projectId={ctx.project.id}
        domain={ctx.project.domain}
        competitors={ctx.measured ? [] : ctx.campaign.competitors}
        measured={ctx.measured}
        tags={ctx.tags.map((t) => ({ id: t.id, name: t.name }))}
        device={ctx.device}
        range={ctx.range}
        db={ctx.campaign.db}
        startDay={ctx.startDay}
        endDay={ctx.endDay}
        initialKeyword={initialKeyword}
        initialFilter={filter}
      />
      {ctx.measured && ctx.campaign.competitors.length > 0 && (
        <div className="border-t border-border p-4">
          <NeedsData compact providers={["dataforseo"]} title={`Competitor positions (${ctx.campaign.competitors.join(", ")}) need DataForSEO`} shows={["Each competitor's position per keyword, next to yours"]} />
        </div>
      )}
    </Card>
  );
}
