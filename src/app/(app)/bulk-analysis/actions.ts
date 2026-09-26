"use server";

import { actionError, type ActionResult } from "@/app/(app)/projects/actions";
import { rateLimit, requireUser } from "@/lib/auth";
import { BULK_LIMIT, bulkAnalysis, parseTargets } from "@/lib/backlinks/bulk";
import type { BulkInvalid, BulkRow } from "@/lib/backlinks/types";
import { AppError } from "@/lib/domain";
import type { DataSource } from "@/lib/providers/labels";

export type BulkResult = { rows: BulkRow[]; invalid: BulkInvalid[]; duplicates: number; source: DataSource; fetchedAt: string; ms: number };

export async function analyzeBulkAction(text: string): Promise<ActionResult<BulkResult>> {
  try {
    const user = await requireUser();
    await rateLimit(`bulk-analysis:${user.id}`, 30, 60);
    if (typeof text !== "string" || text.length > 60_000) throw new AppError("The list is too long.");
    const { targets, invalid, duplicates } = parseTargets(text);
    if (!targets.length) throw new AppError(invalid.length ? "None of the lines is a valid domain or URL." : "Enter at least one domain or URL.");
    if (targets.length > BULK_LIMIT) throw new AppError(`You can analyze up to ${BULK_LIMIT} targets at once (you entered ${targets.length}).`);
    const t = Date.now();
    const { data, source, fetchedAt } = await bulkAnalysis(user.id, targets);
    return { ok: true, data: { rows: data, invalid, duplicates, source, fetchedAt, ms: Date.now() - t } };
  } catch (e) {
    return actionError(e);
  }
}
