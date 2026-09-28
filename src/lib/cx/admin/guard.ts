import { revalidatePath } from "next/cache";
import { actionError, type ActionResult } from "@/app/(app)/projects/actions";
import { brandUser } from "@/lib/cx/inbox/guard";
import type { Permission } from "./pure/permissions";
import { requirePermission } from "./roles";

/** Server-action wrapper for admin settings: brand access + permission + revalidate + start the tick chain. */
export async function adminAction<T>(brand: string, perm: Permission, path: string, fn: (user: { id: string; name: string; email: string }) => Promise<T>): Promise<ActionResult<T>> {
  try {
    const { user, project } = await brandUser(brand);
    await requirePermission(brand, user.id, perm, "change these settings");
    const data = await fn(user);
    revalidatePath(path);
    const { ensureAdminJobs } = await import("./jobs");
    await ensureAdminJobs(brand, project.owner_id).catch(() => {});
    return { ok: true, data };
  } catch (e) {
    return actionError(e);
  }
}
