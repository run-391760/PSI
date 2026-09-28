import { query } from "@/lib/db";
import { setSchedule } from "@/lib/jobs/queue";

/** Keeps the brand's hourly insights job on while it has export schedules, briefs or auto-accept forms. */
export async function syncHourly(projectId: string) {
  const [r] = await query<{ n: number }>(
    `SELECT ((SELECT count(*) FROM cx_export_schedules WHERE project_id=$1 AND enabled)
           + (SELECT count(*) FROM cx_ai_settings WHERE project_id=$1 AND brief_cadence<>'off')
           + (SELECT count(*) FROM cx_qa_scorecards WHERE project_id=$1 AND auto_accept AND due_days IS NOT NULL))::int AS n`,
    [projectId],
  );
  await setSchedule(projectId, "cx.insights.hourly", { cadence: "hourly", enabled: r.n > 0 });
}
