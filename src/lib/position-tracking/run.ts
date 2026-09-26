import { randomUUID } from "node:crypto";
import { query } from "@/lib/db";
import type { JobRow } from "@/lib/jobs/types";
import type { CheckPayload } from "./check";
import { CHECK_JOB } from "./types";

// The job queue is imported lazily: it pulls in the handler registry of every module, and pages that only
// read tracking data should not depend on other modules' job code being importable.
const queue = () => import("@/lib/jobs/queue");

/** Active (queued/running) check for a project, if any. */
export async function activeCheck(projectId: string) {
  const [job] = await query<JobRow>(
    "SELECT * FROM jobs WHERE project_id=$1 AND kind=$2 AND status IN ('queued','running') ORDER BY created_at DESC LIMIT 1",
    [projectId, CHECK_JOB],
  );
  return job ?? null;
}

/** Most recent check job (any status), to surface failures. */
export async function lastCheck(projectId: string) {
  const [job] = await query<JobRow>("SELECT * FROM jobs WHERE project_id=$1 AND kind=$2 ORDER BY created_at DESC LIMIT 1", [projectId, CHECK_JOB]);
  return job ?? null;
}

/** Enqueues a rank check. Plain checks reuse an active one; backfills always get their own job. */
export async function startCheck(ownerId: string, projectId: string, payload: CheckPayload) {
  const plain = !payload.backfill && !payload.keywordIds && !payload.rebuild;
  if (plain) {
    const active = await activeCheck(projectId);
    if (active) return active;
  }
  const { enqueue } = await queue();
  return enqueue({ kind: CHECK_JOB, ownerId, projectId, payload, dedupeKey: `pt:${projectId}:${randomUUID()}` });
}

export async function cancelCheck(ownerId: string, jobId: string) {
  const { cancelJob } = await queue();
  await cancelJob(ownerId, jobId);
}

export type Cadence = "daily" | "weekly" | "off";
export async function setCheckSchedule(projectId: string, cadence: Cadence) {
  const { setSchedule } = await queue();
  if (cadence === "off") await setSchedule(projectId, CHECK_JOB, { cadence: "daily", enabled: false });
  else await setSchedule(projectId, CHECK_JOB, { cadence, enabled: true });
}

export async function checkSchedule(projectId: string) {
  const [row] = await query<{ cadence: "hourly" | "daily" | "weekly"; enabled: boolean; next_run_at: string; last_run_at: string | null }>(
    "SELECT cadence, enabled, next_run_at, last_run_at FROM schedules WHERE project_id=$1 AND kind=$2",
    [projectId, CHECK_JOB],
  );
  return row ?? null;
}
