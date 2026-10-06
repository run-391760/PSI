"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { getCxBrand } from "@/lib/cx/context";
import { actionError, type ActionResult } from "@/app/(app)/projects/actions";
import { createDashboard, createShareLink, deleteDashboard, getDashboard, normalizeWidget, revokeShareLink, runWidget, updateDashboard, widgetInput } from "@/lib/cx/insights/dashboards";
import { chartInsight } from "@/lib/cx/insights/intelligence";
import { aiConfigured } from "@/lib/cx/ai";
import { AppError } from "@/lib/domain";
import { GROUP_LABELS, metricDef, rangeLabel, type DashboardFilters } from "@/lib/cx/insights/widget-defs";
import { TEMPLATES, type Widget, type WidgetResult } from "@/lib/cx/insights/widget-defs";

async function brand(projectId: string) {
  const user = await requireUser();
  await getCxBrand(user.id, projectId);
  return user;
}

export async function createDashboardAction(projectId: string, input: { name: string; description: string; shared: boolean; template: string }): Promise<ActionResult<{ id: string }>> {
  try {
    const user = await brand(projectId);
    const t = TEMPLATES.find((x) => x.id === input.template) ?? TEMPLATES[0];
    const widgets = t.widgets.map((w, i) => ({ ...w, id: `w${Date.now().toString(36)}${i}` }));
    const id = await createDashboard(projectId, user.id, { name: input.name, description: input.description, shared: input.shared, widgets });
    revalidatePath("/cx/dashboards");
    return { ok: true, data: { id } };
  } catch (e) {
    return actionError(e);
  }
}

export async function updateDashboardAction(projectId: string, id: string, patch: { name?: string; description?: string; shared?: boolean; widgets?: Widget[]; theme?: string; filters?: DashboardFilters }): Promise<ActionResult<null>> {
  try {
    const user = await brand(projectId);
    await updateDashboard(projectId, user.id, id, patch);
    revalidatePath("/cx/dashboards");
    return { ok: true, data: null };
  } catch (e) {
    return actionError(e);
  }
}

export async function deleteDashboardAction(projectId: string, id: string): Promise<ActionResult<null>> {
  try {
    const user = await brand(projectId);
    await deleteDashboard(projectId, user.id, id);
    revalidatePath("/cx/dashboards");
    return { ok: true, data: null };
  } catch (e) {
    return actionError(e);
  }
}

/** Runs a widget definition without saving it (builder preview). */
export async function previewWidgetAction(projectId: string, widget: Widget, dashboardId?: string): Promise<ActionResult<{ widget: Widget; result: WidgetResult }>> {
  try {
    const user = await brand(projectId);
    const w = normalizeWidget(widgetInput.parse(widget) as Widget);
    const d = dashboardId ? await getDashboard(projectId, user.id, dashboardId) : null;
    return { ok: true, data: { widget: w, result: await runWidget(projectId, w, new Date(), d?.filters) } };
  } catch (e) {
    return actionError(e);
  }
}

/** Creates a public, read-only link to a dashboard (token; revocable). */
export async function createShareAction(projectId: string, dashboardId: string): Promise<ActionResult<{ token: string }>> {
  try {
    const user = await brand(projectId);
    const token = await createShareLink(projectId, user.id, "dashboard", dashboardId);
    revalidatePath(`/cx/dashboards/${dashboardId}`);
    return { ok: true, data: { token } };
  } catch (e) {
    return actionError(e);
  }
}
export async function revokeShareAction(projectId: string, token: string): Promise<ActionResult<null>> {
  try {
    await brand(projectId);
    await revokeShareLink(projectId, token);
    revalidatePath("/cx/dashboards", "layout");
    return { ok: true, data: null };
  } catch (e) {
    return actionError(e);
  }
}

/** ~120-word AI read of one widget, from its plotted values only (L33). */
export async function widgetInsightAction(projectId: string, dashboardId: string, widgetId: string): Promise<ActionResult<{ text: string }>> {
  try {
    const user = await requireUser();
    await getCxBrand(user.id, projectId, { write: false });
    if (!aiConfigured()) throw new AppError("Connect an AI key (Anthropic, OpenAI or Gemini) on the server for chart insights.", 400);
    const d = await getDashboard(projectId, user.id, dashboardId);
    const w = d.widgets.find((x) => x.id === widgetId);
    if (!w) throw new AppError("Widget not found.", 404);
    const r = await runWidget(projectId, w, new Date(), d.filters);
    const def = metricDef(w);
    const text = await chartInsight({ title: w.title, metric: `${def?.label ?? w.metric}${w.groupBy !== "none" ? ` by ${GROUP_LABELS[w.groupBy as keyof typeof GROUP_LABELS] ?? w.groupBy}` : ""} (${def?.format ?? "number"}${def?.format === "hours" ? ", values in hours" : ""})`, range: rangeLabel(w), rows: r.rows, total: r.total, previous: r.previous });
    if (!text) throw new AppError("The AI did not return an insight. Try again.", 502);
    return { ok: true, data: { text } };
  } catch (e) {
    return actionError(e);
  }
}
