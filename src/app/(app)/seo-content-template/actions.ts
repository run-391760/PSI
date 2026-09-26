"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { AppError } from "@/lib/domain";
import { fail, type ActionResult } from "@/lib/content/action";
import { createDocument } from "@/lib/content/documents";
import { buildTemplate, parseTemplateKeywords } from "@/lib/content/template";

/** Create a Writing Assistant document prefilled with the template's targets and a suggested outline. */
export async function openInWritingAssistantAction(q: string, db: string): Promise<ActionResult<{ id: string }>> {
  try {
    const user = await requireUser();
    const keywords = parseTemplateKeywords(q);
    if (!keywords.length) throw new AppError("Enter at least one keyword.");
    const { data: t } = buildTemplate(keywords, db);
    const body = [`# ${t.recommendations.h1Example}`, "", ...t.outline.flatMap((o) => [`## ${o}`, ""])].join("\n");
    const id = await createDocument(user.id, {
      title: t.recommendations.titleExamples[0],
      keywords,
      db: t.db,
      body,
      settings: {
        targetWords: t.targets.words,
        targetReadability: t.targets.readability,
        recommended: t.semantic.slice(0, 20).map((s) => s.term),
        db: t.db,
        origin: "template",
        demoTargets: true,
      },
    });
    revalidatePath("/writing-assistant");
    return { ok: true, data: { id } };
  } catch (e) {
    return fail(e);
  }
}
