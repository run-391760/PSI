import { randomUUID } from "node:crypto";
import { query } from "@/lib/db";
import { AppError } from "@/lib/domain";
import type { Cadence, JobRow } from "./types";

export async function enqueue<P extends Record<string, unknown>>(input: {
  kind: string;
  ownerId: string;
  projectId?: string | null;
  payload?: P;
  /** Jobs with the same dedupe key are created once (e.g. `site-audit:<project>:<date>`). */
  dedupeKey?: string;
  runAfter?: Date;
}) {
  // Load the handler registry lazily (not at module top level, which would create import cycles
  // registry -> module jobs -> queue). Evaluating it here also refreshes the worker's handler set
  // after hot reloads in development (see registry.ts).
  await import("./registry");
  const [job] = await query<JobRow>(
    `INSERT INTO jobs(id,owner_id,project_id,kind,payload,dedupe_key,run_after)
     VALUES($1,$2,$3,$4,$5::jsonb,$6,COALESCE($7,now()))
     ON CONFLICT(dedupe_key) DO NOTHING RETURNING *`,
    [randomUUID(), input.ownerId, input.projectId ?? null, input.kind, JSON.stringify(input.payload ?? {}), input.dedupeKey ?? null, input.runAfter ?? null],
  );
  if (job) return job;
  const [existing] = await query<JobRow>("SELECT * FROM jobs WHERE dedupe_key=$1", [input.dedupeKey]);
  return existing;
}

export async function getJob(ownerId: string, id: string) {
  const [job] = await query<JobRow>("SELECT * FROM jobs WHERE id=$1 AND owner_id=$2", [id, ownerId]);
  if (!job) throw new AppError("Job not found.", 404);
  return job;
}
export async function listJobs(ownerId: string, opts: { projectId?: string; kind?: string; limit?: number } = {}) {
  return query<JobRow>(
    `SELECT * FROM jobs WHERE owner_id=$1 AND ($2::text IS NULL OR project_id=$2) AND ($3::text IS NULL OR kind=$3)
     ORDER BY created_at DESC LIMIT $4`,
    [ownerId, opts.projectId ?? null, opts.kind ?? null, opts.limit ?? 50],
  );
}
/** Most recent job of a kind for a project (any status). */
export async function latestJob(projectId: string, kind: string, status?: JobRow["status"]) {
  const [job] = await query<JobRow>(
    "SELECT * FROM jobs WHERE project_id=$1 AND kind=$2 AND ($3::text IS NULL OR status=$3) ORDER BY created_at DESC LIMIT 1",
    [projectId, kind, status ?? null],
  );
  return job ?? null;
}
export async function cancelJob(ownerId: string, id: string) {
  await query("UPDATE jobs SET status='cancelled', finished_at=now() WHERE id=$1 AND owner_id=$2 AND status IN ('queued','running')", [id, ownerId]);
}

const INTERVALS: Record<Cadence, string> = { hourly: "1 hour", daily: "1 day", weekly: "7 days" };
/** Create or update a recurring schedule for a project tool. The worker enqueues it when due. */
export async function setSchedule(projectId: string, kind: string, opts: { cadence?: Cadence; enabled?: boolean; payload?: Record<string, unknown>; startNow?: boolean }) {
  const cadence = opts.cadence ?? "daily";
  await query(
    `INSERT INTO schedules(id,project_id,kind,cadence,enabled,payload,next_run_at)
     VALUES($1,$2,$3,$4,$5,$6::jsonb, CASE WHEN $7 THEN now() ELSE now() + $8::interval END)
     ON CONFLICT(project_id,kind) DO UPDATE SET cadence=excluded.cadence, enabled=excluded.enabled, payload=excluded.payload`,
    [randomUUID(), projectId, kind, cadence, opts.enabled ?? true, JSON.stringify(opts.payload ?? {}), opts.startNow ?? false, INTERVALS[cadence]],
  );
}
export async function getSchedule(projectId: string, kind: string) {
  const [row] = await query<{ cadence: Cadence; enabled: boolean; next_run_at: string; last_run_at: string | null; payload: Record<string, unknown> }>(
    "SELECT cadence,enabled,next_run_at,last_run_at,payload FROM schedules WHERE project_id=$1 AND kind=$2",
    [projectId, kind],
  );
  return row ?? null;
}
export { INTERVALS };

/** In-app notification (Alerts page + bell badge). */
export async function notify(n: { ownerId: string; projectId?: string | null; tool: string; severity?: "info" | "success" | "warning" | "critical"; title: string; body?: string; link?: string }) {
  await query("INSERT INTO notifications(id,owner_id,project_id,tool,severity,title,body,link) VALUES($1,$2,$3,$4,$5,$6,$7,$8)", [
    randomUUID(),
    n.ownerId,
    n.projectId ?? null,
    n.tool,
    n.severity ?? "info",
    n.title,
    n.body ?? "",
    n.link ?? null,
  ]);
}
