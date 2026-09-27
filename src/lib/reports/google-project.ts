import { getProjectGoogle, organicInsights } from "@/lib/google/data";
import { getGoogleConnection, googleConfigured } from "@/lib/google/oauth";
import type { Project } from "@/lib/projects";
import { googleSnapshot, type GoogleSnapshot } from "./google-snapshot";

export type ProjectGoogleState =
  | { state: "not-configured" }
  | { state: "not-connected" }
  | { state: "not-linked" }
  | { state: "error"; message: string }
  | { state: "ready"; snapshot: GoogleSnapshot; fetchedAt: string; site: string | null; property: string | null };

/** Real Search Console/GA4 snapshot for a project (28 days), or why it is unavailable. */
export async function projectGoogle(project: Pick<Project, "id" | "owner_id">, days = 28): Promise<ProjectGoogleState> {
  if (!googleConfigured()) return { state: "not-configured" };
  const [link, conn] = await Promise.all([getProjectGoogle(project.id), getGoogleConnection(project.owner_id)]);
  if (!conn) return { state: "not-connected" };
  if (!link.gscSite && !link.ga4Property) return { state: "not-linked" };
  try {
    const { data, fetchedAt } = await organicInsights(project.owner_id, link, days);
    return { state: "ready", snapshot: googleSnapshot(data), fetchedAt, site: link.gscSite, property: link.ga4PropertyName ?? link.ga4Property };
  } catch (e) {
    return { state: "error", message: e instanceof Error ? e.message : String(e) };
  }
}
