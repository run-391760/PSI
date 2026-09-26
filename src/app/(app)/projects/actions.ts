"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { AppError, rootDomain } from "@/lib/domain";
import { createProject, deleteProject, getProject, updateProject, type ProjectInput } from "@/lib/projects";
import { updateSchedule } from "@/lib/reports/platform";

export type ActionResult<T = unknown> = { ok: true; data: T } | { ok: false; error: string };

export async function actionError(e: unknown): Promise<{ ok: false; error: string }> {
  if (e instanceof AppError) return { ok: false, error: e.message };
  if (e && typeof e === "object" && "issues" in e) return { ok: false, error: (e as { issues: { message: string }[] }).issues[0]?.message ?? "Invalid input." };
  console.error(e);
  return { ok: false, error: "Something went wrong. Please try again." };
}

export async function createProjectAction(input: ProjectInput): Promise<ActionResult<{ id: string; domain: string }>> {
  try {
    const user = await requireUser();
    const project = await createProject(user.id, input);
    revalidatePath("/projects");
    revalidatePath("/dashboard");
    return { ok: true, data: { id: project.id, domain: project.domain } };
  } catch (e) {
    return actionError(e);
  }
}

export async function updateProjectAction(id: string, input: Partial<ProjectInput>): Promise<ActionResult<{ id: string }>> {
  try {
    const user = await requireUser();
    await updateProject(user.id, id, input);
    revalidatePath("/projects");
    revalidatePath(`/projects/${id}`);
    return { ok: true, data: { id } };
  } catch (e) {
    return actionError(e);
  }
}

export async function deleteProjectAction(id: string): Promise<ActionResult<null>> {
  try {
    const user = await requireUser();
    await deleteProject(user.id, id);
    revalidatePath("/projects");
    revalidatePath("/dashboard");
    return { ok: true, data: null };
  } catch (e) {
    return actionError(e);
  }
}

// ------------------------------------------------------------------ project dashboard (platform module)

const cadences = ["hourly", "daily", "weekly"] as const;

/** Enable/disable a tool schedule, change its cadence, or queue it to run on the next worker tick. */
export async function updateScheduleAction(
  projectId: string,
  kind: string,
  patch: { enabled?: boolean; cadence?: (typeof cadences)[number]; runNow?: boolean },
): Promise<ActionResult<null>> {
  try {
    const user = await requireUser();
    if (patch.cadence && !cadences.includes(patch.cadence)) throw new AppError("Unknown cadence.");
    await updateSchedule(user.id, projectId, String(kind).slice(0, 120), {
      enabled: typeof patch.enabled === "boolean" ? patch.enabled : undefined,
      cadence: patch.cadence,
      runNow: patch.runNow === true,
    });
    revalidatePath(`/projects/${projectId}`);
    return { ok: true, data: null };
  } catch (e) {
    return actionError(e);
  }
}

/** Add one competitor domain to a project (max 10). */
export async function addCompetitorAction(projectId: string, domain: string): Promise<ActionResult<{ competitors: string[] }>> {
  try {
    const user = await requireUser();
    const project = await getProject(user.id, projectId);
    const d = rootDomain(domain);
    if (d === project.domain) throw new AppError("That is the project's own domain.");
    if (project.competitors.includes(d)) return { ok: true, data: { competitors: project.competitors } };
    if (project.competitors.length >= 10) throw new AppError("A project can have up to 10 competitors.");
    const updated = await updateProject(user.id, projectId, { competitors: [...project.competitors, d] });
    revalidatePath(`/projects/${projectId}`);
    revalidatePath("/projects");
    return { ok: true, data: { competitors: updated.competitors } };
  } catch (e) {
    return actionError(e);
  }
}
