import { revalidatePath } from "next/cache";
import { actionError, type ActionResult } from "@/app/(app)/projects/actions";
import { brandUser } from "@/lib/cx/inbox/guard";
import type { CxBrand } from "@/lib/cx/context";
import { assertIpAllowed } from "./ip";
import type { Permission } from "./pure/permissions";
import { requirePermission } from "./roles";

/**
 * Server-action wrapper for the WP-K3 settings pages: brand access (write), role permission, the brand's
 * IP allowlist, then revalidation of the given paths.
 */
export async function settingsAction<T>(
  brand: string,
  perm: Permission | null,
  paths: string[],
  fn: (user: { id: string; name: string; email: string }, project: CxBrand) => Promise<T>,
): Promise<ActionResult<T>> {
  try {
    const { user, project } = await brandUser(brand);
    if (perm) await requirePermission(brand, user.id, perm, "change these settings");
    await assertIpAllowed(brand, user.id);
    const data = await fn(user, project);
    for (const p of paths) revalidatePath(p);
    return { ok: true, data };
  } catch (e) {
    return actionError(e);
  }
}
