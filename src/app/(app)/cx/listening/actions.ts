"use server";

import { revalidatePath } from "next/cache";
import { actionError, type ActionResult } from "@/app/(app)/projects/actions";
import { requireUser } from "@/lib/auth";
import { enqueue, latestJob, setSchedule } from "@/lib/jobs/queue";
import { getCxBrand } from "@/lib/cx/context";
import { bulkUpdate, createTicketFromMention, deleteTopic, saveTopic, setTopicActive, updateMentionLabels, type TopicInput } from "@/lib/cx/listening/data";

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

export async function saveTopicAction(brandId: string, input: TopicInput, id?: string): Promise<ActionResult<{ id: string; jobId: string | null }>> {
  try {
    const { user, project } = await brand(brandId);
    const topicId = await saveTopic(project.id, input, id);
    let jobId: string | null = null;
    if (!id) {
      // First (or new) topic: keep the brand on an hourly schedule and fetch right away.
      await setSchedule(project.id, FETCH, { cadence: "hourly" });
      jobId = await startFetch(user.id, project.id);
    }
    revalidatePath("/cx/listening", "layout");
    return { ok: true, data: { id: topicId, jobId } };
  } catch (e) {
    return actionError(e);
  }
}

export async function deleteTopicAction(brandId: string, id: string): Promise<ActionResult<null>> {
  try {
    const { project } = await brand(brandId);
    await deleteTopic(project.id, id);
    revalidatePath("/cx/listening", "layout");
    return { ok: true, data: null };
  } catch (e) {
    return actionError(e);
  }
}

export async function toggleTopicAction(brandId: string, id: string, active: boolean): Promise<ActionResult<null>> {
  try {
    const { project } = await brand(brandId);
    await setTopicActive(project.id, id, active);
    revalidatePath("/cx/listening", "layout");
    return { ok: true, data: null };
  } catch (e) {
    return actionError(e);
  }
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

// ------------------------------------------------------------------ UGC consent (WP3)

export async function setConsentAction(brandId: string, input: { mentionId: string; status: "requested" | "granted" | "denied" | "withdrawn"; requestText?: string; note?: string }): Promise<ActionResult<null>> {
  try {
    const { user, project } = await brand(brandId);
    const { setConsent } = await import("@/lib/cx/listening/ugc");
    await setConsent(project.id, input, user.name || user.email);
    revalidatePath("/cx/listening/ugc");
    return { ok: true, data: null };
  } catch (e) {
    return actionError(e);
  }
}

export async function clearConsentAction(brandId: string, mentionId: string): Promise<ActionResult<null>> {
  try {
    const { project } = await brand(brandId);
    const { clearConsent } = await import("@/lib/cx/listening/ugc");
    await clearConsent(project.id, mentionId);
    revalidatePath("/cx/listening/ugc");
    return { ok: true, data: null };
  } catch (e) {
    return actionError(e);
  }
}
