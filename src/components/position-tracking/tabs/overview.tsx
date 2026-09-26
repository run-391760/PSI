import { overview, type Ctx } from "@/lib/position-tracking/reports";
import { Card, CardHeader } from "@/components/ui/card";
import { OverviewTable } from "../overview-table";

export async function OverviewTab({ ctx, initialKeyword, filter }: { ctx: Ctx; initialKeyword: string | null; filter: string | null }) {
  const rows = await overview(ctx);
  return (
    <Card>
      <CardHeader
        title="Rankings overview"
        description={`${ctx.project.domain} and ${ctx.campaign.competitors.length} competitor${ctx.campaign.competitors.length === 1 ? "" : "s"} · ${ctx.device === "mobile" ? "mobile" : "desktop"} · positions at the start and end of the range`}
        info="Click a keyword for its position history, landing pages and the latest SERP. Select rows to tag or delete them."
      />
      <OverviewTable
        rows={rows}
        projectId={ctx.project.id}
        domain={ctx.project.domain}
        competitors={ctx.campaign.competitors}
        tags={ctx.tags.map((t) => ({ id: t.id, name: t.name }))}
        device={ctx.device}
        range={ctx.range}
        db={ctx.campaign.db}
        startDay={ctx.startDay}
        endDay={ctx.endDay}
        initialKeyword={initialKeyword}
        initialFilter={filter}
      />
    </Card>
  );
}
