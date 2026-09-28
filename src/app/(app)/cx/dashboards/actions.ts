"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { getCxBrand } from "@/lib/cx/context";
import { actionError, type ActionResult } from "@/app/(app)/projects/actions";
import { createDashboard, deleteDashboard, normalizeWidget, runWidget, updateDashboard, widgetInput } from "@/lib/cx/insights/dashboards";
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

export async function updateDashboardAction(projectId: string, id: string, patch: { name?: string; description?: string; shared?: boolean; widgets?: Widget[] }): Promise<ActionResult<null>> {
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
export async function previewWidgetAction(projectId: string, widget: Widget): Promise<ActionResult<{ widget: Widget; result: WidgetResult }>> {
  try {
    await brand(projectId);
    const w = normalizeWidget(widgetInput.parse(widget) as Widget);
    return { ok: true, data: { widget: w, result: await runWidget(projectId, w) } };
  } catch (e) {
    return actionError(e);
  }
}
