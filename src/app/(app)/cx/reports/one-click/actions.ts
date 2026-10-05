"use server";

import { requireUser } from "@/lib/auth";
import { AppError } from "@/lib/domain";
import { getCxBrand } from "@/lib/cx/context";
import { reportContext } from "@/lib/cx/reports/data";
import { FILTER_PARAMS } from "@/lib/cx/reports/filters";
import { buildOneClick } from "@/lib/cx/reports/one-click";
import { isChoice } from "@/lib/cx/reports/one-click-model";
import { actionError, type ActionResult } from "@/app/(app)/projects/actions";

/**
 * One-click report workbook for the given report ("sov" | "sentiment" | "ticketing" | "all") and the page's URL
 * filters (from, to, scope, media, basis, interval). Returns the XLSX as base64.
 */
export async function oneClickReportAction(
  projectId: string,
  report: string,
  filters: Record<string, string>,
): Promise<ActionResult<{ name: string; sheets: string[]; data: string; mime: string }>> {
  try {
    const user = await requireUser();
    const b = await getCxBrand(user.id, projectId, { write: false });
    if (!isChoice(report)) throw new AppError("Pick a report.", 400);
    const sp: Record<string, string> = {};
    for (const k of FILTER_PARAMS) if (typeof filters?.[k] === "string" && filters[k].length <= 2000) sp[k] = filters[k];
    const ctx = await reportContext({ id: b.id, name: b.name }, sp);
    const wb = await buildOneClick(ctx, report);
    if (wb.empty) throw new AppError("No data for this scope and period. Widen the date range or scope.", 400);
    return { ok: true, data: { name: wb.name, sheets: wb.sheets, data: wb.data, mime: wb.mime } };
  } catch (e) {
    return actionError(e);
  }
}
