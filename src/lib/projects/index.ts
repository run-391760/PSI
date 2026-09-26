import { randomUUID } from "node:crypto";
import { z } from "zod";
import { query, transaction } from "@/lib/db";
import { AppError, DB_CODES, rootDomain } from "@/lib/domain";

export type Project = {
  id: string;
  owner_id: string;
  name: string;
  domain: string;
  country: string;
  language: string;
  device: "desktop" | "mobile";
  location: string;
  brand_terms: string[];
  settings: Record<string, unknown>;
  created_at: string;
  competitors: string[];
};

export const projectInput = z.object({
  name: z.string().trim().min(1, "Name is required").max(100),
  domain: z.string().trim().min(3).max(255),
  country: z.enum(DB_CODES).default("US"),
  language: z.string().trim().min(2).max(8).default("en"),
  device: z.enum(["desktop", "mobile"]).default("desktop"),
  location: z.string().trim().max(120).default(""),
  competitors: z.array(z.string().trim().max(255)).max(10).default([]),
  brand_terms: z.array(z.string().trim().min(1).max(80)).max(20).default([]),
});
export type ProjectInput = z.input<typeof projectInput>;

const SELECT = `SELECT p.*, COALESCE((SELECT json_agg(c.domain ORDER BY c.created_at) FROM project_competitors c
  WHERE c.project_id=p.id), '[]'::json) AS competitors FROM projects p`;

export async function listProjects(ownerId: string) {
  return query<Project>(`${SELECT} WHERE p.owner_id=$1 ORDER BY p.created_at DESC`, [ownerId]);
}

/** Owner-scoped fetch. Throws 404 for projects the user does not own. */
export async function getProject(ownerId: string, id: string) {
  const [project] = await query<Project>(`${SELECT} WHERE p.id=$1 AND p.owner_id=$2`, [id, ownerId]);
  if (!project) throw new AppError("Project not found.", 404);
  return project;
}
export async function findProject(ownerId: string, id: string | null | undefined) {
  if (!id) return null;
  const [project] = await query<Project>(`${SELECT} WHERE p.id=$1 AND p.owner_id=$2`, [id, ownerId]);
  return project ?? null;
}

export async function createProject(ownerId: string, raw: ProjectInput) {
  const input = projectInput.parse(raw);
  const domain = rootDomain(input.domain);
  const competitors = [...new Set(input.competitors.filter(Boolean).map(rootDomain))].filter((d) => d !== domain);
  const id = randomUUID();
  await transaction(async (q) => {
    const created = await q(
      `INSERT INTO projects(id,owner_id,name,domain,country,language,device,location,brand_terms)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb) ON CONFLICT(owner_id,domain) DO NOTHING RETURNING id`,
      [id, ownerId, input.name, domain, input.country, input.language, input.device, input.location, JSON.stringify(input.brand_terms)],
    );
    if (!created.length) throw new AppError(`You already have a project for ${domain}.`, 409);
    for (const c of competitors) await q("INSERT INTO project_competitors(project_id,domain) VALUES($1,$2) ON CONFLICT DO NOTHING", [id, c]);
  });
  return getProject(ownerId, id);
}

export async function updateProject(ownerId: string, id: string, raw: Partial<ProjectInput>) {
  const current = await getProject(ownerId, id);
  const input = projectInput.partial().parse(raw);
  await transaction(async (q) => {
    await q(
      `UPDATE projects SET name=$3,country=$4,language=$5,device=$6,location=$7,brand_terms=$8::jsonb WHERE id=$1 AND owner_id=$2`,
      [
        id,
        ownerId,
        input.name ?? current.name,
        input.country ?? current.country,
        input.language ?? current.language,
        input.device ?? current.device,
        input.location ?? current.location,
        JSON.stringify(input.brand_terms ?? current.brand_terms),
      ],
    );
    if (input.competitors) {
      const competitors = [...new Set(input.competitors.filter(Boolean).map(rootDomain))].filter((d) => d !== current.domain);
      await q("DELETE FROM project_competitors WHERE project_id=$1", [id]);
      for (const c of competitors) await q("INSERT INTO project_competitors(project_id,domain) VALUES($1,$2) ON CONFLICT DO NOTHING", [id, c]);
    }
  });
  return getProject(ownerId, id);
}

export async function updateProjectSettings(ownerId: string, id: string, patch: Record<string, unknown>) {
  await getProject(ownerId, id);
  await query("UPDATE projects SET settings = settings || $3::jsonb WHERE id=$1 AND owner_id=$2", [id, ownerId, JSON.stringify(patch)]);
}

export async function deleteProject(ownerId: string, id: string) {
  const deleted = await query("DELETE FROM projects WHERE id=$1 AND owner_id=$2 RETURNING id", [id, ownerId]);
  if (!deleted.length) throw new AppError("Project not found.", 404);
}
