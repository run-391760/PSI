"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { AppError } from "@/lib/domain";
import { cancelJob, enqueue, getJob } from "@/lib/jobs/queue";
import { handlers } from "@/lib/jobs/registry";
import { actionError, type ActionResult } from "../projects/actions";

/** Cancel a queued or running job (long handlers stop at their next cancellation check). */
export async function cancelJobAction(id: string): Promise<ActionResult<null>> {
  try {
    const user = await requireUser();
    const job = await getJob(user.id, String(id));
    if (job.status !== "queued" && job.status !== "running") throw new AppError("Only queued or running jobs can be cancelled.");
    await cancelJob(user.id, job.id);
    revalidatePath("/activity");
    return { ok: true, data: null };
  } catch (e) {
    return actionError(e);
  }
}

/** Run a failed or cancelled job again with the same kind, project and payload. */
export async function retryJobAction(id: string): Promise<ActionResult<{ id: string }>> {
  try {
    const user = await requireUser();
    const job = await getJob(user.id, String(id));
    if (job.status !== "failed" && job.status !== "cancelled") throw new AppError("Only failed or cancelled jobs can be retried.");
    const live = (globalThis as unknown as { synapseJobHandlers?: Record<string, unknown> }).synapseJobHandlers ?? handlers;
    if (!(job.kind in live)) throw new AppError("This job type is no longer available.");
    const { scheduled: _scheduled, ...payload } = (job.payload ?? {}) as Record<string, unknown>;
    const next = await enqueue({ kind: job.kind, ownerId: user.id, projectId: job.project_id, payload: { ...payload, retryOf: job.id } });
    revalidatePath("/activity");
    return { ok: true, data: { id: next.id } };
  } catch (e) {
    return actionError(e);
  }
}
