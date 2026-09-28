"use server";

import { revalidatePath } from "next/cache";
import { actionError, type ActionResult } from "@/app/(app)/projects/actions";
import { cloneAutomation, deleteAutomation, moveAutomation, saveAutomation, toggleAutomation, type AutomationInput } from "@/lib/cx/admin/automation";
import { adminAction } from "@/lib/cx/admin/guard";
import { deleteQuickAction, runQuickAction, saveQuickAction, type QuickActionDef } from "@/lib/cx/admin/quick-actions";
import { requirePermission } from "@/lib/cx/admin/roles";
import { brandUser } from "@/lib/cx/inbox/guard";

/** Automation v2 + Quick Actions server actions (WP2). The legacy routing/canned actions stay in ./actions. */
const P = "/cx/settings/automation";
const act = <T,>(brand: string, fn: (u: { id: string; name: string }) => Promise<T>) => adminAction(brand, "page:settings.automation", P, fn);

export const saveAutomationAction = async (brand: string, a: AutomationInput) => act(brand, (u) => saveAutomation(brand, a, u));
export const deleteAutomationAction = async (brand: string, id: string) => act(brand, (u) => deleteAutomation(brand, id, u));
export const toggleAutomationAction = async (brand: string, id: string, active: boolean) => act(brand, () => toggleAutomation(brand, id, active));
export const moveAutomationAction = async (brand: string, id: string, dir: -1 | 1) => act(brand, () => moveAutomation(brand, id, dir));

/** Clone to another channel of this brand, or into another brand (the caller must be able to edit automation there too). */
export const cloneAutomationAction = async (brand: string, id: string, target: { channel?: string | null; brandId?: string | null }) =>
  act(brand, async (u) => {
    if (target.brandId && target.brandId !== brand) {
      await brandUser(target.brandId);
      await requirePermission(target.brandId, u.id, "page:settings.automation", "add automations to that brand");
    }
    return cloneAutomation(brand, id, target, u);
  });

export const saveQuickActionAction = async (brand: string, q: { id?: string; name: string; description: string; actions: QuickActionDef }) => act(brand, (u) => saveQuickAction(brand, q, u));
export const deleteQuickActionAction = async (brand: string, id: string) => act(brand, (u) => deleteQuickAction(brand, id, u));

/**
 * Inbox entry point (WP1): run a Quick Action on selected tickets as the signed-in user.
 * Permission checks ("quick_actions", "reply_public", "status:*") happen inside runQuickAction.
 */
export async function runQuickActionAction(brand: string, id: string, ticketIds: string[]): Promise<ActionResult<{ tickets: number; failed: number }>> {
  try {
    const { user } = await brandUser(brand);
    const data = await runQuickAction(brand, id, ticketIds, user);
    revalidatePath("/cx/inbox");
    return { ok: true, data };
  } catch (e) {
    return actionError(e);
  }
}
