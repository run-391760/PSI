"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { getProject } from "@/lib/projects";
import { actionError, type ActionResult } from "@/app/(app)/projects/actions";
import { deleteTeam, inviteMember, removeMember, saveHours, saveSlaPolicies, saveTeam, updateMember, type Role } from "@/lib/cx/insights/team";

const role = z.enum(["admin", "supervisor", "agent", "viewer"]);
async function brand(projectId: string) {
  const user = await requireUser();
  await getProject(user.id, projectId);
  return user;
}
const done = () => revalidatePath("/cx/settings/team");

export async function inviteMemberAction(projectId: string, email: string, r: Role, teamId: string | null): Promise<ActionResult<null>> {
  try {
    const user = await brand(projectId);
    await inviteMember(projectId, user.id, z.string().trim().email("Enter a valid email").parse(email), role.parse(r), teamId || null);
    done();
    return { ok: true, data: null };
  } catch (e) {
    return actionError(e);
  }
}
export async function updateMemberAction(projectId: string, userId: string, patch: { role?: Role; teamId?: string | null }): Promise<ActionResult<null>> {
  try {
    await brand(projectId);
    await updateMember(projectId, userId, { role: patch.role ? role.parse(patch.role) : undefined, teamId: patch.teamId });
    done();
    return { ok: true, data: null };
  } catch (e) {
    return actionError(e);
  }
}
export async function removeMemberAction(projectId: string, userId: string): Promise<ActionResult<null>> {
  try {
    await brand(projectId);
    await removeMember(projectId, userId);
    done();
    return { ok: true, data: null };
  } catch (e) {
    return actionError(e);
  }
}
export async function saveTeamAction(projectId: string, input: { id?: string; name: string; description: string }): Promise<ActionResult<{ id: string }>> {
  try {
    await brand(projectId);
    const v = z.object({ id: z.string().optional(), name: z.string().trim().min(1, "Team name is required").max(80), description: z.string().trim().max(300) }).parse(input);
    const id = await saveTeam(projectId, v);
    done();
    return { ok: true, data: { id } };
  } catch (e) {
    return actionError(e);
  }
}
export async function deleteTeamAction(projectId: string, id: string): Promise<ActionResult<null>> {
  try {
    await brand(projectId);
    await deleteTeam(projectId, id);
    done();
    return { ok: true, data: null };
  } catch (e) {
    return actionError(e);
  }
}

const hhmm = z.string().regex(/^\d{2}:\d{2}$/, "Use HH:MM");
export async function saveHoursAction(projectId: string, input: unknown): Promise<ActionResult<null>> {
  try {
    await brand(projectId);
    const v = z
      .object({
        timezone: z.string().min(1).max(60).refine((tz) => {
          try {
            new Intl.DateTimeFormat("en-US", { timeZone: tz });
            return true;
          } catch {
            return false;
          }
        }, "Unknown timezone"),
        hours: z.array(z.object({ day: z.number().int().min(0).max(6), open: z.boolean(), start: hhmm, end: hhmm })).length(7),
        holidays: z.array(z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Holiday dates must be YYYY-MM-DD"), name: z.string().trim().max(80) })).max(100),
      })
      .parse(input);
    for (const h of v.hours) if (h.open && h.end <= h.start) throw Object.assign(new Error(), { issues: [{ message: "Closing time must be after opening time." }] });
    await saveHours(projectId, v);
    done();
    return { ok: true, data: null };
  } catch (e) {
    return actionError(e);
  }
}
export async function saveSlaAction(projectId: string, input: unknown): Promise<ActionResult<null>> {
  try {
    await brand(projectId);
    const mins = z.number().int().min(1).max(525600).nullable();
    const v = z.array(z.object({ priority: z.enum(["low", "normal", "high", "urgent"]), first_response_minutes: mins, resolution_minutes: mins, business_hours: z.boolean() })).max(4).parse(input);
    await saveSlaPolicies(projectId, v);
    done();
    return { ok: true, data: null };
  } catch (e) {
    return actionError(e);
  }
}
