"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { AppError } from "@/lib/domain";
import { fail, type ActionResult } from "@/lib/content/action";
import { createDocument } from "@/lib/content/documents";
import { buildTemplate, cap, parseTemplateKeywords } from "@/lib/content/template";
import { liveEnabled } from "@/lib/providers/source";

/** Create a Writing Assistant document prefilled with the template's targets and a suggested outline. */
export async function openInWritingAssistantAction(q: string, db: string): Promise<ActionResult<{ id: string }>> {
  try {
    const user = await requireUser();
    const keywords = parseTemplateKeywords(q);
    if (!keywords.length) throw new AppError("Enter at least one keyword.");
    if (!liveEnabled()) throw new AppError("Content templates need DataForSEO.");
    const { data: t } = await buildTemplate(user.id, keywords, db);
    const body = [`# ${cap(keywords[0])}`, "", ...t.outline.flatMap((o) => [`## ${cap(o)}`, ""])].join("\n");
    const id = await createDocument(user.id, {
      title: cap(keywords[0]),
      keywords,
      db: t.db,
      body,
      settings: {
        ...(t.avg ? { targetWords: t.avg.words } : {}),
        ...(t.avg?.readability != null ? { targetReadability: t.avg.readability } : {}),
        recommended: t.semantic.slice(0, 20).map((s) => s.term),
        db: t.db,
        origin: "template",
        targetsSource: "serp",
      },
    });
    revalidatePath("/writing-assistant");
    return { ok: true, data: { id } };
  } catch (e) {
    return fail(e);
  }
}
