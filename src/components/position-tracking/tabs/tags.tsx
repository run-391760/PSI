import { tagsReport, type Ctx } from "@/lib/position-tracking/reports";
import { Card, CardHeader } from "@/components/ui/card";
import { TagsManager } from "../tags-manager";

export async function TagsTab({ ctx, base }: { ctx: Ctx; base: string }) {
  const rows = await tagsReport(ctx);
  const untagged = ctx.keywords.filter((k) => k.tags.length === 0).length;
  const params = new URLSearchParams({ project: ctx.project.id });
  if (ctx.range !== 30) params.set("range", String(ctx.range));
  return (
    <Card>
      <CardHeader
        title="Tags"
        description={`${ctx.tags.length} tag${ctx.tags.length === 1 ? "" : "s"} · ${untagged} untagged keyword${untagged === 1 ? "" : "s"} · performance on the ${ctx.device} end date vs start of range`}
        info="Tags group keywords so every report can be filtered by them (use the tag filter above each report)."
      />
      <TagsManager rows={rows} projectId={ctx.project.id} base={base.includes("tags=") ? `/position-tracking?${params.toString()}` : base} />
    </Card>
  );
}
