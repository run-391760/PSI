"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { query } from "@/lib/db";
import { AppError } from "@/lib/domain";
import { setSchedule } from "@/lib/jobs/queue";
import { getCxBrand } from "@/lib/cx/context";
import { actionError, type ActionResult } from "@/app/(app)/projects/actions";
import { deleteSurvey, dispatchSurveys, getSurvey, inviteForTicket, saveSurvey, saveSurveySettings, surveyInput } from "@/lib/cx/insights/surveys";
import type { z } from "zod";

async function brand(projectId: string) {
  const user = await requireUser();
  await getCxBrand(user.id, projectId);
  return user;
}
async function syncSchedule(projectId: string) {
  const [r] = await query<{ n: number }>("SELECT count(*)::int AS n FROM cx_surveys WHERE project_id=$1 AND auto_send AND status='active'", [projectId]);
  await setSchedule(projectId, "cx.insights.survey-dispatch", { cadence: "hourly", enabled: r.n > 0, startNow: r.n > 0 });
}

export async function saveSurveyAction(projectId: string, input: z.input<typeof surveyInput>, id?: string): Promise<ActionResult<{ id: string }>> {
  try {
    await brand(projectId);
    const sid = await saveSurvey(projectId, input, id);
    await syncSchedule(projectId);
    revalidatePath("/cx/surveys");
    return { ok: true, data: { id: sid } };
  } catch (e) {
    return actionError(e);
  }
}

export async function updateSurveyFlagsAction(projectId: string, id: string, patch: { status?: "active" | "paused"; auto_send?: boolean }): Promise<ActionResult<null>> {
  try {
    await brand(projectId);
    const s = await getSurvey(projectId, id);
    await saveSurvey(projectId, { ...s, status: patch.status ?? s.status, auto_send: patch.auto_send ?? s.auto_send }, id);
    await syncSchedule(projectId);
    if (patch.auto_send) await dispatchSurveys(projectId);
    revalidatePath("/cx/surveys");
    return { ok: true, data: null };
  } catch (e) {
    return actionError(e);
  }
}

export async function deleteSurveyAction(projectId: string, id: string): Promise<ActionResult<null>> {
  try {
    await brand(projectId);
    await deleteSurvey(projectId, id);
    await syncSchedule(projectId);
    revalidatePath("/cx/surveys");
    return { ok: true, data: null };
  } catch (e) {
    return actionError(e);
  }
}

/** Creates (or reuses) the per-ticket link for ticket #number; answering it writes the ticket's CSAT. */
export async function ticketLinkAction(projectId: string, surveyId: string, ticketNumber: number): Promise<ActionResult<{ path: string }>> {
  try {
    await brand(projectId);
    await getSurvey(projectId, surveyId);
    const [t] = await query<{ id: string }>("SELECT id FROM cx_tickets WHERE project_id=$1 AND number=$2", [projectId, ticketNumber]);
    if (!t) throw new AppError(`Ticket #${ticketNumber} was not found in this brand.`, 404);
    const token = await inviteForTicket(projectId, surveyId, t.id, "manual");
    revalidatePath(`/cx/surveys/${surveyId}`);
    return { ok: true, data: { path: `/s/${surveyId}?t=${token}` } };
  } catch (e) {
    return actionError(e);
  }
}

/** Delivery settings: subject/template, trigger, inline rating, social email dispatch, redirect, background, conditions. */
export async function saveSurveySettingsAction(projectId: string, id: string, settings: unknown): Promise<ActionResult<null>> {
  try {
    await brand(projectId);
    await saveSurveySettings(projectId, id, settings);
    revalidatePath(`/cx/surveys/${id}`);
    return { ok: true, data: null };
  } catch (e) {
    return actionError(e);
  }
}
