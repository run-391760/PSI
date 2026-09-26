import { query } from "@/lib/db";
import type { Project } from "@/lib/projects";
import { localCompetitors } from "@/lib/local/competitors";
import { getProfile } from "@/lib/local/profile";
import { getBrandSettings } from "@/lib/monitoring/brand";
import { aiContext } from "./engine";

/** Competitor names for AI answers: AI settings, else Brand Monitoring's, else derived from domains. */
export async function aiCompetitorNames(projectId: string) {
  const [row] = await query<{ competitor_names: string[] }>("SELECT competitor_names FROM ai_settings WHERE project_id=$1", [projectId]);
  if (row?.competitor_names.length) return { names: row.competitor_names, source: "ai" as const };
  const bm = await getBrandSettings(projectId);
  if (bm?.competitorTerms.length) return { names: bm.competitorTerms, source: "brand-monitoring" as const };
  return { names: [] as string[], source: "derived" as const };
}

export async function saveAiCompetitorNames(projectId: string, names: string[]) {
  await query(
    `INSERT INTO ai_settings(project_id,competitor_names,updated_at) VALUES($1,$2::jsonb,now())
     ON CONFLICT(project_id) DO UPDATE SET competitor_names=excluded.competitor_names, updated_at=now()`,
    [projectId, JSON.stringify(names)],
  );
}

/** Builds the AI context from the project, its local profile (category, nearby rivals) and competitor names. */
export async function loadAiContext(project: Project) {
  const [{ names }, stored] = await Promise.all([aiCompetitorNames(project.id), getProfile(project.id)]);
  const localRivals = stored
    ? localCompetitors(project, stored.profile)
        .filter((b) => !b.you && !b.domain)
        .slice(0, 3)
        .map((b) => ({ name: b.name, strength: b.strength }))
    : [];
  return aiContext(project, { competitorNames: names, category: stored?.profile.primaryCategory, localRivals });
}
