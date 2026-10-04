"use server";

import { revalidatePath } from "next/cache";
import { actionError, type ActionResult } from "@/app/(app)/projects/actions";
import { brandUser } from "@/lib/cx/inbox/guard";
import { addTracked, removeTracked } from "@/lib/cx/ops/tracker";
import type { TrackedInput } from "@/lib/cx/ops/tracker-model";

export async function addTrackedAction(brandId: string, input: TrackedInput): Promise<ActionResult<{ id: string }>> {
  try {
    const { project } = await brandUser(brandId);
    const id = await addTracked(project.id, input);
    revalidatePath("/cx/mentions-tracker");
    return { ok: true, data: { id } };
  } catch (e) {
    return actionError(e);
  }
}

export async function removeTrackedAction(brandId: string, id: string): Promise<ActionResult<null>> {
  try {
    const { project } = await brandUser(brandId);
    await removeTracked(project.id, id);
    revalidatePath("/cx/mentions-tracker");
    return { ok: true, data: null };
  } catch (e) {
    return actionError(e);
  }
}
