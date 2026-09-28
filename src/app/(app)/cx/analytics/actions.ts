"use server";

import { revalidatePath } from "next/cache";
import { actionError, type ActionResult } from "@/app/(app)/projects/actions";
import { requireUser } from "@/lib/auth";
import { getCxBrand } from "@/lib/cx/context";
import type { ErFormula } from "@/lib/cx/listening/social";
import { saveFormula } from "@/lib/cx/listening/social-data";

export async function saveFormulaAction(brandId: string, f: ErFormula): Promise<ActionResult<ErFormula>> {
  try {
    const user = await requireUser();
    const project = await getCxBrand(user.id, brandId);
    const saved = await saveFormula(project.id, f);
    revalidatePath("/cx/analytics");
    return { ok: true, data: saved };
  } catch (e) {
    return actionError(e);
  }
}
