import { revalidatePath } from "next/cache";
import { actionError, type ActionResult } from "@/app/(app)/projects/actions";
import { brandUser } from "@/lib/cx/inbox/guard";

type U = { id: string; name: string; email: string };
/** Shared server-action wrapper for the ops modules: brand access check (write by default), revalidation, ActionResult. */
export async function runOps<T>(brand: string, fn: (u: U, role: string) => Promise<T>, opts: { write?: boolean; paths?: string[] } = {}): Promise<ActionResult<T>> {
  try {
    const { user, project } = await brandUser(brand, { write: opts.write !== false });
    const data = await fn(user, project.role);
    for (const p of opts.paths ?? []) revalidatePath(p);
    return { ok: true, data };
  } catch (e) {
    return actionError(e);
  }
}
