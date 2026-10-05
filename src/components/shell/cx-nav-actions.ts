"use server";

import { requireUser } from "@/lib/auth";
import { findCxBrand, listCxBrands } from "@/lib/cx/context";
import { listDashboards } from "@/lib/cx/insights/dashboards";

/** Saved dashboards of a brand (or the user's first brand) for the DASHBOARD tab sidebar. */
export async function cxSavedDashboardsAction(brandId: string | null): Promise<{ id: string; name: string }[]> {
  try {
    const user = await requireUser();
    const brand = brandId ? await findCxBrand(user.id, brandId) : ((await listCxBrands(user.id))[0] ?? null);
    if (!brand) return [];
    return (await listDashboards(brand.id, user.id)).slice(0, 30).map((d) => ({ id: d.id, name: d.name || "Untitled dashboard" }));
  } catch (e) {
    console.error(e);
    return [];
  }
}
