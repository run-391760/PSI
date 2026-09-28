import { query } from "@/lib/db";
import { AppError } from "@/lib/domain";
import { findProject, listProjects, type Project } from "@/lib/projects";

export type CxRole = "owner" | "admin" | "supervisor" | "agent" | "viewer";
export type CxBrand = Project & { role: CxRole };

const SELECT = `SELECT p.*, COALESCE((SELECT json_agg(c.domain ORDER BY c.created_at) FROM project_competitors c
  WHERE c.project_id=p.id), '[]'::json) AS competitors FROM projects p`;

/** Brands the user can open in CX: projects they own plus brands they were invited to (cx_members). */
export async function listCxBrands(userId: string): Promise<CxBrand[]> {
  const owned = (await listProjects(userId)).map((p) => ({ ...p, role: "owner" as CxRole }));
  const member = await query<Project & { role: CxRole }>(
    `${SELECT} JOIN cx_members m ON m.project_id=p.id WHERE m.user_id=$1 AND p.owner_id<>$1 ORDER BY p.created_at DESC`,
    [userId],
  );
  return [...owned, ...member];
}

/** A brand the user may access (owner or member); null if not accessible. */
export async function findCxBrand(userId: string, brandId: string | null | undefined): Promise<CxBrand | null> {
  if (!brandId) return null;
  const own = await findProject(userId, brandId);
  if (own) return { ...own, role: "owner" };
  const [row] = await query<Project & { role: CxRole }>(`${SELECT} JOIN cx_members m ON m.project_id=p.id WHERE p.id=$1 AND m.user_id=$2`, [brandId, userId]);
  return row ?? null;
}

/** For server actions: throws 404 when the user can't access the brand, 403 for viewers on writes. */
export async function getCxBrand(userId: string, brandId: string, opts: { write?: boolean } = { write: true }): Promise<CxBrand> {
  const brand = await findCxBrand(userId, brandId);
  if (!brand) throw new AppError("Brand not found.", 404);
  if (opts.write !== false && brand.role === "viewer") throw new AppError("Viewers can't make changes in this brand.", 403);
  return brand;
}

/**
 * CX pages work on a "brand" = a project the user owns or was invited to, selected with ?brand=<id>
 * (falls back to the first accessible brand). Null brand when the user has none.
 */
export async function cxContext(userId: string, sp: Record<string, string | string[] | undefined>) {
  const projects = await listCxBrands(userId);
  const requested = typeof sp.brand === "string" ? sp.brand : undefined;
  const brand = (requested ? await findCxBrand(userId, requested) : null) ?? projects[0] ?? null;
  return { projects, brand, switcher: projects.map((p) => ({ id: p.id, name: p.name, domain: p.domain })) };
}
