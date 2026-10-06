"use server";

import { revalidatePath } from "next/cache";
import type { z } from "zod";
import { requireUser } from "@/lib/auth";
import { getCxBrand } from "@/lib/cx/context";
import { actionError, type ActionResult } from "@/app/(app)/projects/actions";
import { deleteSchedule, deleteTemplate, getFile, runExport, saveSchedule, saveTemplate, toggleSchedule, type scheduleInput, type templateInput } from "@/lib/cx/insights/exports";
import type { Period } from "@/lib/cx/insights/export-defs";
import { syncHourly } from "@/lib/cx/insights/schedule";
import { aiConfigured } from "@/lib/cx/ai";
import { chartInsight } from "@/lib/cx/insights/intelligence";
import { drillExport, drillItems, type DrillItem } from "@/lib/cx/reports/drill";
import type { DrillSpec, Refine } from "@/lib/cx/reports/model";

async function brand(projectId: string, write = true) {
  const user = await requireUser();
  await getCxBrand(user.id, projectId, { write });
  return user;
}
const done = () => {
  revalidatePath("/cx/reports");
  revalidatePath("/cx/reports/download");
};

export async function exportNowAction(projectId: string, templateId: string, period: Period): Promise<ActionResult<{ name: string; rows: number; csv: string }>> {
  try {
    const user = await brand(projectId, false);
    const f = await runExport(projectId, user.id, templateId, period);
    done();
    return { ok: true, data: { name: f.name, rows: f.rows, csv: f.csv } };
  } catch (e) {
    return actionError(e);
  }
}
export async function downloadFileAction(projectId: string, id: string): Promise<ActionResult<{ name: string; csv: string }>> {
  try {
    await brand(projectId, false);
    return { ok: true, data: await getFile(projectId, id) };
  } catch (e) {
    return actionError(e);
  }
}
export async function saveTemplateAction(projectId: string, input: z.input<typeof templateInput>, id?: string): Promise<ActionResult<{ id: string }>> {
  try {
    const user = await brand(projectId);
    const tid = await saveTemplate(projectId, user.id, input, id);
    done();
    return { ok: true, data: { id: tid } };
  } catch (e) {
    return actionError(e);
  }
}
export async function deleteTemplateAction(projectId: string, id: string): Promise<ActionResult<null>> {
  try {
    await brand(projectId);
    await deleteTemplate(projectId, id);
    await syncHourly(projectId);
    done();
    return { ok: true, data: null };
  } catch (e) {
    return actionError(e);
  }
}
export async function saveScheduleAction(projectId: string, input: z.input<typeof scheduleInput>): Promise<ActionResult<{ id: string }>> {
  try {
    const user = await brand(projectId);
    const id = await saveSchedule(projectId, user.id, input);
    await syncHourly(projectId);
    done();
    return { ok: true, data: { id } };
  } catch (e) {
    return actionError(e);
  }
}
export async function scheduleFlagAction(projectId: string, id: string, action: "pause" | "resume" | "delete"): Promise<ActionResult<null>> {
  try {
    await brand(projectId);
    if (action === "delete") await deleteSchedule(projectId, id);
    else await toggleSchedule(projectId, id, action === "resume");
    await syncHourly(projectId);
    done();
    return { ok: true, data: null };
  } catch (e) {
    return actionError(e);
  }
}

// ---------------------------------------------------------------- WP-K4: drill-down drawer and widget menu


/** Items behind a clicked chart slice (paged, 25 per page). */
export async function drillItemsAction(projectId: string, spec: DrillSpec, page = 1, refine?: Refine): Promise<ActionResult<{ items: DrillItem[]; total: number; nextPage: number | null; media: string[] }>> {
  try {
    const user = await requireUser();
    const b = await getCxBrand(user.id, projectId, { write: false });
    return { ok: true, data: await drillItems({ id: b.id, name: b.name }, spec, { page, refine }) };
  } catch (e) {
    return actionError(e);
  }
}

/** Every item of a slice as CSV or XLSX (base64). */
export async function drillExportAction(projectId: string, spec: DrillSpec, format: "csv" | "xlsx", refine?: Refine): Promise<ActionResult<{ name: string; rows: number; data: string; mime: string }>> {
  try {
    const user = await requireUser();
    const b = await getCxBrand(user.id, projectId, { write: false });
    return { ok: true, data: await drillExport({ id: b.id, name: b.name }, spec, format, refine) };
  } catch (e) {
    return actionError(e);
  }
}

/** ~120-word AI reading of one report widget from its plotted values (needs an AI key). */
export async function reportInsightAction(projectId: string, chart: { title: string; metric: string; range: string; rows: { key: string; value: number | null }[]; total: number | null; previous: number | null }): Promise<ActionResult<{ text: string }>> {
  try {
    await brand(projectId, false);
    if (!aiConfigured()) return { ok: false, error: "Connect an AI key (Anthropic, OpenAI or Gemini) on the server to get insights." };
    const text = await chartInsight({ ...chart, rows: chart.rows.slice(0, 60) });
    return text ? { ok: true, data: { text } } : { ok: false, error: "The AI provider returned no answer." };
  } catch (e) {
    return actionError(e);
  }
}
