"use server";

import { revalidatePath } from "next/cache";
import { actionError, type ActionResult } from "@/app/(app)/projects/actions";
import { requireUser } from "@/lib/auth";
import { AppError } from "@/lib/domain";
import { enqueue } from "@/lib/jobs/queue";
import { getCxBrand } from "@/lib/cx/context";
import { saveSettings } from "@/lib/cx/listening/data";
import { addNote, updateEvent } from "@/lib/cx/listening/crisis";
import { query } from "@/lib/db";

async function brand(brandId: string) {
  const user = await requireUser();
  const project = await getCxBrand(user.id, brandId);
  return { user, project };
}

export async function saveCrisisSettingsAction(
  brandId: string,
  input: { volumeZ: number; negativeZ: number; minMentions: number; baselineDays: number; windowHours: number; escalationOwner: string; notify: boolean },
): Promise<ActionResult<null>> {
  try {
    const { project } = await brand(brandId);
    await saveSettings(project.id, input);
    revalidatePath("/cx/crisis");
    return { ok: true, data: null };
  } catch (e) {
    return actionError(e);
  }
}

export async function runDetectionAction(brandId: string): Promise<ActionResult<{ jobId: string }>> {
  try {
    const { user, project } = await brand(brandId);
    const job = await enqueue({ kind: "cx.listening.detect", ownerId: user.id, projectId: project.id, payload: { manual: true } });
    return { ok: true, data: { jobId: job.id } };
  } catch (e) {
    return actionError(e);
  }
}

export async function updateEventAction(brandId: string, id: string, patch: { status?: "open" | "monitoring" | "resolved"; owner?: string; severity?: "warning" | "critical" }): Promise<ActionResult<null>> {
  try {
    const { user, project } = await brand(brandId);
    if (patch.status && !["open", "monitoring", "resolved"].includes(patch.status)) throw new AppError("Invalid status.");
    if (patch.severity && !["warning", "critical"].includes(patch.severity)) throw new AppError("Invalid severity.");
    await updateEvent(project.id, id, patch, { id: user.id, name: user.name || user.email });
    revalidatePath("/cx/crisis");
    return { ok: true, data: null };
  } catch (e) {
    return actionError(e);
  }
}

export async function addNoteAction(brandId: string, id: string, body: string): Promise<ActionResult<null>> {
  try {
    const { user, project } = await brand(brandId);
    const text = body.trim();
    if (!text) throw new AppError("Write a note first.");
    const [e] = await query("SELECT id FROM cx_crisis_events WHERE id=$1 AND project_id=$2", [id, project.id]);
    if (!e) throw new AppError("Crisis event not found.", 404);
    await addNote(id, user.id, user.name || user.email, text);
    revalidatePath("/cx/crisis");
    return { ok: true, data: null };
  } catch (e) {
    return actionError(e);
  }
}
