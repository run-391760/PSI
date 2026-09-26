"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { query } from "@/lib/db";
import { getProject } from "@/lib/projects";
import { disconnectGoogle } from "@/lib/google/oauth";
import { setProjectGoogle } from "@/lib/google/data";
import { actionError, type ActionResult } from "@/app/(app)/projects/actions";

export async function linkGoogleAction(projectId: string, link: { gscSite: string | null; ga4Property: string | null; ga4PropertyName: string | null }): Promise<ActionResult<null>> {
  try {
    const user = await requireUser();
    const project = await getProject(user.id, projectId);
    if (!link.gscSite && !link.ga4Property) throw new Error("Choose a Search Console property, a GA4 property, or both.");
    await setProjectGoogle(project.id, { gscSite: link.gscSite || null, ga4Property: link.ga4Property || null, ga4PropertyName: link.ga4PropertyName || null });
    revalidatePath("/organic-traffic-insights");
    return { ok: true, data: null };
  } catch (e) {
    if (e instanceof Error && e.message.startsWith("Choose")) return { ok: false, error: e.message };
    return actionError(e);
  }
}

/** Drop cached Google responses for this user so the next load fetches fresh data. */
export async function refreshGoogleDataAction(): Promise<ActionResult<null>> {
  try {
    const user = await requireUser();
    await query("DELETE FROM provider_cache WHERE key LIKE $1", [`google-insights:v1:${user.id}:%`]);
    revalidatePath("/organic-traffic-insights");
    return { ok: true, data: null };
  } catch (e) {
    return actionError(e);
  }
}

export async function disconnectGoogleAction(): Promise<ActionResult<null>> {
  try {
    const user = await requireUser();
    await disconnectGoogle(user.id);
    await query("DELETE FROM provider_cache WHERE key LIKE $1", [`google-insights:v1:${user.id}:%`]);
    revalidatePath("/organic-traffic-insights");
    return { ok: true, data: null };
  } catch (e) {
    return actionError(e);
  }
}
