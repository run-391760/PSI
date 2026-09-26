"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { createReport, deleteReport, duplicateReport, updateReport, type ReportInput } from "@/lib/reports";
import { actionError, type ActionResult } from "../projects/actions";

export async function createReportAction(input: ReportInput): Promise<ActionResult<{ id: string }>> {
  try {
    const user = await requireUser();
    const id = await createReport(user.id, input);
    revalidatePath("/reports");
    return { ok: true, data: { id } };
  } catch (e) {
    return actionError(e);
  }
}

export async function updateReportAction(id: string, input: ReportInput): Promise<ActionResult<{ id: string }>> {
  try {
    const user = await requireUser();
    await updateReport(user.id, String(id), input);
    revalidatePath("/reports");
    revalidatePath(`/reports/${id}`);
    return { ok: true, data: { id } };
  } catch (e) {
    return actionError(e);
  }
}

export async function duplicateReportAction(id: string): Promise<ActionResult<{ id: string }>> {
  try {
    const user = await requireUser();
    const copy = await duplicateReport(user.id, String(id));
    revalidatePath("/reports");
    return { ok: true, data: { id: copy } };
  } catch (e) {
    return actionError(e);
  }
}

export async function deleteReportAction(id: string): Promise<ActionResult<null>> {
  try {
    const user = await requireUser();
    await deleteReport(user.id, String(id));
    revalidatePath("/reports");
    return { ok: true, data: null };
  } catch (e) {
    return actionError(e);
  }
}
