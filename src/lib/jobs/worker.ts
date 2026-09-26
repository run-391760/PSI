import { query } from "@/lib/db";
import { enqueue, INTERVALS } from "./queue";
import { handlers } from "./registry";
import type { Cadence, JobRow } from "./types";

const MAX_CONCURRENT = Number(process.env.WORKER_CONCURRENCY || 3);
const LEASE = "10 minutes";
const state = globalThis as unknown as { synapseWorker?: { running: Set<string>; timers: NodeJS.Timeout[] } };

async function claim(): Promise<JobRow | null> {
  const [job] = await query<JobRow>(
    `UPDATE jobs SET status='running', started_at=COALESCE(started_at, now()), attempts=attempts+1, lease_until=now()+interval '${LEASE}'
     WHERE id=(SELECT id FROM jobs WHERE status='queued' AND run_after<=now() ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED)
     RETURNING *`,
  );
  return job ?? null;
}

async function run(job: JobRow) {
  const live = (globalThis as unknown as { synapseJobHandlers?: typeof handlers }).synapseJobHandlers;
  const handler = live?.[job.kind] ?? handlers[job.kind];
  const ctx = {
    progress: async (done: number, total?: number, message?: string) => {
      await query(
        `UPDATE jobs SET progress=$2, total=COALESCE($3,total), message=COALESCE($4,message), lease_until=now()+interval '${LEASE}' WHERE id=$1`,
        [job.id, Math.round(done), total == null ? null : Math.round(total), message ?? null],
      );
    },
    cancelled: async () => {
      const [row] = await query<{ status: string }>("SELECT status FROM jobs WHERE id=$1", [job.id]);
      return row?.status === "cancelled";
    },
  };
  try {
    if (!handler) throw new Error(`No handler registered for job kind "${job.kind}".`);
    const result = await handler(job, ctx);
    await query("UPDATE jobs SET status='done', result=$2::jsonb, finished_at=now(), lease_until=NULL WHERE id=$1 AND status='running'", [job.id, JSON.stringify(result ?? null)]);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[worker] ${job.kind} ${job.id} failed:`, message);
    await query("UPDATE jobs SET status='failed', error=$2, finished_at=now(), lease_until=NULL WHERE id=$1 AND status='running'", [job.id, message.slice(0, 2000)]);
  }
}

async function tick() {
  const w = state.synapseWorker!;
  // Recover jobs whose worker died mid-run (lease expired).
  await query(
    `UPDATE jobs SET status=CASE WHEN attempts<3 THEN 'queued' ELSE 'failed' END,
       error=CASE WHEN attempts<3 THEN error ELSE 'Worker stopped before the job finished.' END, lease_until=NULL
     WHERE status='running' AND lease_until<now()`,
  );
  while (w.running.size < MAX_CONCURRENT) {
    const job = await claim();
    if (!job) break;
    w.running.add(job.id);
    run(job).finally(() => w.running.delete(job.id));
  }
}

async function scheduleTick() {
  const due = await query<{ project_id: string; kind: string; cadence: Cadence; payload: Record<string, unknown>; owner_id: string }>(
    `UPDATE schedules s SET last_run_at=now(), next_run_at=now() + (CASE s.cadence WHEN 'hourly' THEN interval '${INTERVALS.hourly}' WHEN 'weekly' THEN interval '${INTERVALS.weekly}' ELSE interval '${INTERVALS.daily}' END)
     FROM projects p WHERE p.id=s.project_id AND s.enabled AND s.next_run_at<=now()
     RETURNING s.project_id, s.kind, s.cadence, s.payload, p.owner_id`,
  );
  for (const s of due) {
    const bucket = new Date().toISOString().slice(0, s.cadence === "hourly" ? 13 : 10);
    await enqueue({ kind: s.kind, ownerId: s.owner_id, projectId: s.project_id, payload: { ...s.payload, scheduled: true }, dedupeKey: `sched:${s.kind}:${s.project_id}:${bucket}` });
  }
}

/** Starts the in-process worker once per server process. */
export function startWorker() {
  if (state.synapseWorker) return;
  state.synapseWorker = { running: new Set(), timers: [] };
  const safe = (fn: () => Promise<void>) => () => fn().catch((e) => console.error("[worker]", e instanceof Error ? e.message : e));
  state.synapseWorker.timers.push(setInterval(safe(tick), 2000), setInterval(safe(scheduleTick), 60_000));
  setTimeout(safe(scheduleTick), 5000);
  console.log(`[worker] started (concurrency ${MAX_CONCURRENT})`);
}
