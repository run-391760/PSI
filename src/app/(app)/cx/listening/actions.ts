"use server";

import { revalidatePath } from "next/cache";
import { actionError, type ActionResult } from "@/app/(app)/projects/actions";
import { requireUser } from "@/lib/auth";
import { enqueue, latestJob } from "@/lib/jobs/queue";
import { getCxBrand } from "@/lib/cx/context";
import { bulkUpdate, createTicketFromMention, updateMentionLabels } from "@/lib/cx/listening/data";

const FETCH = "cx.listening.fetch";

async function brand(brandId: string) {
  const user = await requireUser();
  const project = await getCxBrand(user.id, brandId);
  return { user, project };
}

async function startFetch(ownerId: string, projectId: string) {
  const running = await latestJob(projectId, FETCH);
  if (running && ["queued", "running"].includes(running.status)) return running.id;
  const job = await enqueue({ kind: FETCH, ownerId, projectId, payload: { manual: true } });
  return job.id;
}

export async function fetchNowAction(brandId: string): Promise<ActionResult<{ jobId: string }>> {
  try {
    const { user, project } = await brand(brandId);
    return { ok: true, data: { jobId: await startFetch(user.id, project.id) } };
  } catch (e) {
    return actionError(e);
  }
}

export async function bulkMentionsAction(brandId: string, ids: string[], op: "read" | "new" | "ignored" | "actioned" | "tag" | "untag", tag?: string): Promise<ActionResult<{ count: number }>> {
  try {
    const { project } = await brand(brandId);
    const count = await bulkUpdate(project.id, { ids, op, tag });
    revalidatePath("/cx/listening");
    return { ok: true, data: { count } };
  } catch (e) {
    return actionError(e);
  }
}

export async function labelMentionAction(brandId: string, id: string, patch: { sentiment?: string; intent?: string }): Promise<ActionResult<null>> {
  try {
    const { project } = await brand(brandId);
    await updateMentionLabels(project.id, id, patch);
    return { ok: true, data: null };
  } catch (e) {
    return actionError(e);
  }
}

export async function createTicketAction(brandId: string, mentionId: string): Promise<ActionResult<{ ticketId: string; number: number; existing: boolean }>> {
  try {
    const { project } = await brand(brandId);
    const r = await createTicketFromMention(project.id, mentionId);
    revalidatePath("/cx/listening");
    return { ok: true, data: r };
  } catch (e) {
    return actionError(e);
  }
}
