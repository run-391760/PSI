"use server";

import { revalidatePath } from "next/cache";
import { actionError, type ActionResult } from "@/app/(app)/projects/actions";
import { requireUser } from "@/lib/auth";
import { getCxBrand } from "@/lib/cx/context";
import { deleteBoard, saveBoard, type StreamDef } from "@/lib/cx/listening/command";

export async function saveBoardAction(brandId: string, input: { name: string; streams: Omit<StreamDef, "id">[] & { id?: string }[] }, id?: string): Promise<ActionResult<{ id: string }>> {
  try {
    const user = await requireUser();
    const project = await getCxBrand(user.id, brandId);
    const bid = await saveBoard(project.id, input as never, id);
    revalidatePath("/cx/command/streams");
    return { ok: true, data: { id: bid } };
  } catch (e) {
    return actionError(e);
  }
}

export async function deleteBoardAction(brandId: string, id: string): Promise<ActionResult<null>> {
  try {
    const user = await requireUser();
    const project = await getCxBrand(user.id, brandId);
    await deleteBoard(project.id, id);
    revalidatePath("/cx/command/streams");
    return { ok: true, data: null };
  } catch (e) {
    return actionError(e);
  }
}
