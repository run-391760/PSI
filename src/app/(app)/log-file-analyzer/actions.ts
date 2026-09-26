"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { rateLimit, requireUser } from "@/lib/auth";
import { AppError } from "@/lib/domain";
import { fail, type ActionResult } from "@/lib/content/action";
import { ingestText } from "@/lib/content/logs/ingest";
import { SAMPLE_HOST, generateSampleLog } from "@/lib/content/logs/sample";
import { deleteAnalyses, renameAnalysis, saveAnalysis } from "@/lib/content/logs/store";

/** Generate the deterministic demo log, run it through the real parser and save the analysis. */
export async function loadSampleAction(): Promise<ActionResult<{ id: string }>> {
  try {
    const user = await requireUser();
    await rateLimit(`content-logs-sample:${user.id}`, 20, 3600);
    const text = generateSampleLog({ days: 30 });
    const agg = ingestText(text);
    const verification = Object.fromEntries(agg.botIds().map((id) => [id, { status: "unverified" as const, checked: 0, verified: 0, note: "Sample data: IPs are illustrative and were not looked up." }]));
    const id = await saveAnalysis(user.id, { name: `Sample log · ${SAMPLE_HOST}`, origin: "sample", sizeBytes: Buffer.byteLength(text), summary: agg.finish(verification) });
    revalidatePath("/log-file-analyzer");
    return { ok: true, data: { id } };
  } catch (e) {
    return fail(e);
  }
}

export async function deleteAnalysesAction(ids: string[]): Promise<ActionResult<null>> {
  try {
    const user = await requireUser();
    await deleteAnalyses(user.id, z.array(z.string().max(64)).max(100).parse(ids));
    revalidatePath("/log-file-analyzer");
    return { ok: true, data: null };
  } catch (e) {
    return fail(e);
  }
}

export async function renameAnalysisAction(id: string, name: string): Promise<ActionResult<null>> {
  try {
    const user = await requireUser();
    if (!name.trim()) throw new AppError("Enter a name.");
    await renameAnalysis(user.id, id, name.trim());
    revalidatePath("/log-file-analyzer");
    return { ok: true, data: null };
  } catch (e) {
    return fail(e);
  }
}
