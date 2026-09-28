import { query } from "@/lib/db";
import { addBusinessMinutes, type Priority, type SlaTargetsMinutes } from "./metrics";
import { getHours } from "./team";

export type SlaTargets = {
  priority: Priority;
  /** Minutes until the first reply is due (null = no target). */
  firstResponseMinutes: number | null;
  /** Minutes until resolution is due (null = no target). */
  resolutionMinutes: number | null;
  /** Targets count business hours only (see Team & SLAs → Business hours). */
  businessHours: boolean;
};

/**
 * SLA targets of a brand for a ticket priority. Public helper for the inbox module:
 *   const t = await slaTargets(projectId, "high");
 *   const due = await slaDueDates(projectId, "high", new Date());   // { firstResponseDue, resolutionDue }
 * Returns null targets when no policy exists for that priority.
 */
export async function slaTargets(projectId: string, priority: string): Promise<SlaTargets> {
  const p = (["low", "normal", "high", "urgent"].includes(priority) ? priority : "normal") as Priority;
  const [row] = await query<{ first_response_minutes: number | null; resolution_minutes: number | null; business_hours: boolean }>(
    "SELECT first_response_minutes,resolution_minutes,business_hours FROM cx_sla_policies WHERE project_id=$1 AND priority=$2",
    [projectId, p],
  );
  return { priority: p, firstResponseMinutes: row?.first_response_minutes ?? null, resolutionMinutes: row?.resolution_minutes ?? null, businessHours: row?.business_hours ?? false };
}

/** Due timestamps for a ticket created at `from` (business hours and holidays applied when the policy says so). */
export async function slaDueDates(projectId: string, priority: string, from: Date = new Date()) {
  const t = await slaTargets(projectId, priority);
  const h = t.businessHours ? await getHours(projectId) : null;
  const due = (m: number | null) => (m == null ? null : h ? addBusinessMinutes(from, m, h.hours, h.holidays, h.timezone) : new Date(from.getTime() + m * 60000));
  return { ...t, firstResponseDue: due(t.firstResponseMinutes), resolutionDue: due(t.resolutionMinutes) };
}

/** All policies as a map (calendar minutes) — used as a fallback when tickets carry no due dates. */
export async function slaTargetMap(projectId: string): Promise<SlaTargetsMinutes> {
  const rows = await query<{ priority: Priority; first_response_minutes: number | null; resolution_minutes: number | null }>(
    "SELECT priority,first_response_minutes,resolution_minutes FROM cx_sla_policies WHERE project_id=$1",
    [projectId],
  );
  return Object.fromEntries(rows.map((r) => [r.priority, { firstResponse: r.first_response_minutes, resolution: r.resolution_minutes }]));
}
