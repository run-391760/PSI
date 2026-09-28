"use server";

import { revalidatePath } from "next/cache";
import { actionError, type ActionResult } from "@/app/(app)/projects/actions";
import { requireUser } from "@/lib/auth";
import { AppError } from "@/lib/domain";
import { enqueue } from "@/lib/jobs/queue";
import { getCxBrand } from "@/lib/cx/context";
import { saveSettings } from "@/lib/cx/listening/data";
import { addNote, updateEvent } from "@/lib/cx/listening/crisis";
import { attachPlaybook, deletePlaybook, draftStatement, saveExtraSettings, savePlaybook, ticketEventMentions, toggleChecklistItem } from "@/lib/cx/listening/crisis2";
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

// ------------------------------------------------------------------ crisis v2 (WP3)

export async function saveExtraSettingsAction(brandId: string, input: { autoTicket: boolean; autoTicketAll: boolean; ratingDrop: number; trendingAlerts: boolean }): Promise<ActionResult<null>> {
  try {
    const { project } = await brand(brandId);
    await saveExtraSettings(project.id, input);
    revalidatePath("/cx/crisis");
    revalidatePath("/cx/listening/reviews");
    return { ok: true, data: null };
  } catch (e) {
    return actionError(e);
  }
}

export async function ticketEventAction(brandId: string, eventId: string, all: boolean): Promise<ActionResult<{ created: number }>> {
  try {
    const { user, project } = await brand(brandId);
    const created = await ticketEventMentions(project.id, eventId, { all, limit: 100, by: user.name || user.email });
    revalidatePath("/cx/crisis");
    return { ok: true, data: { created } };
  } catch (e) {
    return actionError(e);
  }
}

export async function draftStatementAction(brandId: string, eventId: string): Promise<ActionResult<{ text: string | null }>> {
  try {
    const { project } = await brand(brandId);
    return { ok: true, data: { text: await draftStatement(project, eventId) } };
  } catch (e) {
    return actionError(e);
  }
}

export async function savePlaybookAction(brandId: string, input: { name: string; description: string; autoAttach: "none" | "any" | "critical"; steps: string[] }, id?: string): Promise<ActionResult<{ id: string }>> {
  try {
    const { project } = await brand(brandId);
    const pid = await savePlaybook(project.id, input, id);
    revalidatePath("/cx/crisis", "layout");
    return { ok: true, data: { id: pid } };
  } catch (e) {
    return actionError(e);
  }
}

export async function deletePlaybookAction(brandId: string, id: string): Promise<ActionResult<null>> {
  try {
    const { project } = await brand(brandId);
    await deletePlaybook(project.id, id);
    revalidatePath("/cx/crisis", "layout");
    return { ok: true, data: null };
  } catch (e) {
    return actionError(e);
  }
}

export async function attachPlaybookAction(brandId: string, eventId: string, playbookId: string): Promise<ActionResult<null>> {
  try {
    const { user, project } = await brand(brandId);
    await attachPlaybook(project.id, eventId, playbookId, user.name || user.email);
    revalidatePath("/cx/crisis");
    return { ok: true, data: null };
  } catch (e) {
    return actionError(e);
  }
}

export async function toggleStepAction(brandId: string, eventId: string, playbookId: string, itemId: string, done: boolean): Promise<ActionResult<null>> {
  try {
    const { user, project } = await brand(brandId);
    await toggleChecklistItem(project.id, eventId, playbookId, itemId, done, user.name || user.email);
    revalidatePath("/cx/crisis");
    return { ok: true, data: null };
  } catch (e) {
    return actionError(e);
  }
}
