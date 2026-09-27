import { listRules, ruleProjects } from "@/lib/position-tracking/alerts";
import type { Ctx } from "@/lib/position-tracking/reports";
import { availableSources } from "@/lib/position-tracking/store";
import { NewRuleButton } from "@/components/alerts/rule-dialog";
import { RulesTable } from "@/components/alerts/rules-table";
import { Grid } from "@/components/shell/page";
import { Card, CardHeader } from "@/components/ui/card";
import { CampaignSettings, DangerZone, DataSourceSettings, ScheduleSettings } from "../settings-panel";

export async function SettingsTab({ ctx, ownerId, schedule }: { ctx: Ctx; ownerId: string; schedule: { cadence: string; enabled: boolean; nextRunAt: string } | null }) {
  const [rules, projects, available] = await Promise.all([listRules(ownerId, ctx.project.id), ruleProjects(ownerId, ctx.project.id), availableSources(ctx.project.id)]);
  return (
    <>
      <Grid cols={2} className="mb-4 lg:grid-cols-[1.5fr_1fr]">
        <CampaignSettings projectId={ctx.project.id} domain={ctx.project.domain} campaign={{ db: ctx.campaign.db, location: ctx.campaign.location, device: ctx.campaign.device, competitors: ctx.campaign.competitors, source: ctx.campaign.source }} />
        <div className="space-y-4">
          <ScheduleSettings projectId={ctx.project.id} schedule={schedule} />
          <DataSourceSettings projectId={ctx.project.id} source={ctx.campaign.source} available={available} />
          <DangerZone projectId={ctx.project.id} domain={ctx.project.domain} />
        </div>
      </Grid>
      <Card id="alerts">
        <CardHeader
          title="Alert rules"
          description="Evaluated after every check against the previous day. Matches go to Alerts and the notification bell."
          actions={rules.length > 0 ? <NewRuleButton projects={projects} defaultProject={ctx.project.id} variant="secondary" /> : undefined}
        />
        <RulesTable rules={rules} projects={projects} showProject={false} emptyAction={<NewRuleButton projects={projects} defaultProject={ctx.project.id} label="Create your first rule" />} />
      </Card>
    </>
  );
}
