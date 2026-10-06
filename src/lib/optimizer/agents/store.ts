import { randomUUID } from "node:crypto";
import { query } from "@/lib/db";
import { AppError } from "@/lib/domain";
import type { JobStatus } from "@/lib/jobs/types";
import { type AgentRunView, emptyGrid, ITEMS, type ItemResult, type RunProgress, type RunStatus, type RunSummary } from "./types";

/** Agent runs (opt_agent_runs). Server-only; every read is owner-scoped. */

const KEEP = 20;
export const TOTAL_STAGES = ITEMS.length * 4;

type Row = {
  id: string;
  draft_id: string;
  owner_id: string;
  job_id: string | null;
  status: RunStatus;
  body_hash: string;
  items: ItemResult[];
  stages: Partial<RunProgress>;
  summary: RunSummary | Record<string, never>;
  error: string | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  job_status?: JobStatus | null;
  job_error?: string | null;
};

const iso = (v: string | Date | null) => (v ? new Date(v).toISOString() : null);
const SELECT = "SELECT r.*, j.status AS job_status, j.error AS job_error FROM opt_agent_runs r LEFT JOIN jobs j ON j.id=r.job_id";

function toView(r: Row): AgentRunView {
  let status = r.status;
  let error = r.error;
  // The job ended without the handler recording it (server restart, lease expiry, cancel from the jobs page).
  if ((status === "queued" || status === "running") && r.job_status && !["queued", "running"].includes(r.job_status)) {
    status = r.job_status === "cancelled" ? "cancelled" : "failed";
    error ??= r.job_error ?? "The background job stopped before the agents finished.";
  }
  const progress = r.stages ?? {};
  return {
    id: r.id,
    draftId: r.draft_id,
    jobId: r.job_id,
    status,
    fingerprint: r.body_hash,
    progress: { grid: progress.grid ?? emptyGrid(), done: progress.done ?? 0, total: progress.total ?? TOTAL_STAGES, message: progress.message ?? "" },
    items: r.items ?? [],
    summary: r.summary && "final" in r.summary ? (r.summary as RunSummary) : null,
    error,
    createdAt: iso(r.created_at)!,
    startedAt: iso(r.started_at),
    finishedAt: iso(r.finished_at),
  };
}

/**
 * Creates a queued run unless the draft already has an active one, in a single statement so a double
 * click or a second tab cannot start two billed runs. Active means queued / running with a live job (a
 * run whose job ended without the handler recording it does not count), or just created and not yet
 * given a job. Returns null when another run is active.
 */
export async function createRun(ownerId: string, draftId: string, fingerprint: string): Promise<string | null> {
  const id = randomUUID();
  const progress: RunProgress = { grid: emptyGrid(), done: 0, total: TOTAL_STAGES, message: "Waiting for a worker" };
  const rows = await query<{ id: string }>(
    `INSERT INTO opt_agent_runs(id,draft_id,owner_id,body_hash,stages)
     SELECT $1,$2,$3,$4,$5::jsonb
     WHERE NOT EXISTS (
       SELECT 1 FROM opt_agent_runs r LEFT JOIN jobs j ON j.id=r.job_id
       WHERE r.draft_id=$2 AND r.status IN ('queued','running')
         AND (j.status IN ('queued','running') OR (r.job_id IS NULL AND r.created_at > now() - interval '5 minutes'))
     )
     RETURNING id`,
    [id, draftId, ownerId, fingerprint, JSON.stringify(progress)],
  );
  return rows.length ? id : null;
}

export async function attachJob(runId: string, jobId: string) {
  await query("UPDATE opt_agent_runs SET job_id=$2 WHERE id=$1", [runId, jobId]);
}

export async function getRun(ownerId: string, runId: string): Promise<AgentRunView> {
  const [row] = await query<Row>(`${SELECT} WHERE r.id=$1 AND r.owner_id=$2`, [runId, ownerId]);
  if (!row) throw new AppError("Agent run not found.", 404);
  return toView(row);
}

/** Owner and draft of a run, for the job handler (which runs without a session). */
export async function runOwner(runId: string) {
  const [row] = await query<{ owner_id: string; draft_id: string; status: RunStatus }>("SELECT owner_id,draft_id,status FROM opt_agent_runs WHERE id=$1", [runId]);
  return row ?? null;
}

export async function latestRun(ownerId: string, draftId: string): Promise<AgentRunView | null> {
  const [row] = await query<Row>(`${SELECT} WHERE r.draft_id=$1 AND r.owner_id=$2 ORDER BY r.created_at DESC LIMIT 1`, [draftId, ownerId]);
  return row ? toView(row) : null;
}

/** Latest finished run (what the score card shows while a new run is in progress). */
export async function latestDoneRun(ownerId: string, draftId: string): Promise<AgentRunView | null> {
  const [row] = await query<Row>(`${SELECT} WHERE r.draft_id=$1 AND r.owner_id=$2 AND r.status='done' ORDER BY r.created_at DESC LIMIT 1`, [draftId, ownerId]);
  return row ? toView(row) : null;
}

export async function activeRun(ownerId: string, draftId: string): Promise<AgentRunView | null> {
  const run = await latestRun(ownerId, draftId);
  return run && (run.status === "queued" || run.status === "running") ? run : null;
}

/** False when the run was cancelled (or ended) in the meantime: the handler must not start it. */
export async function markRunning(runId: string, fingerprint: string, progress: RunProgress): Promise<boolean> {
  const rows = await query<{ id: string }>("UPDATE opt_agent_runs SET status='running', body_hash=$2, stages=$3::jsonb, started_at=now(), error=NULL WHERE id=$1 AND status IN ('queued','running') RETURNING id", [runId, fingerprint, JSON.stringify(progress)]);
  return rows.length > 0;
}

export async function saveProgress(runId: string, progress: RunProgress) {
  await query("UPDATE opt_agent_runs SET stages=$2::jsonb WHERE id=$1 AND status='running'", [runId, JSON.stringify(progress)]);
}

/** False when the run was cancelled while the last stages ran: a cancel is never overwritten with "done". */
export async function completeRun(runId: string, items: ItemResult[], summary: RunSummary, progress: RunProgress): Promise<boolean> {
  const rows = await query<{ id: string }>("UPDATE opt_agent_runs SET status='done', items=$2::jsonb, summary=$3::jsonb, stages=$4::jsonb, finished_at=now() WHERE id=$1 AND status='running' RETURNING id", [runId, JSON.stringify(items), JSON.stringify(summary), JSON.stringify(progress)]);
  return rows.length > 0;
}

export async function endRun(runId: string, status: "failed" | "cancelled", error: string | null) {
  await query("UPDATE opt_agent_runs SET status=$2, error=$3, finished_at=now() WHERE id=$1 AND status IN ('queued','running')", [runId, status, error?.slice(0, 2000) ?? null]);
}

export async function pruneRuns(draftId: string) {
  await query("DELETE FROM opt_agent_runs WHERE draft_id=$1 AND id NOT IN (SELECT id FROM opt_agent_runs WHERE draft_id=$1 ORDER BY created_at DESC LIMIT $2)", [draftId, KEEP]);
}
