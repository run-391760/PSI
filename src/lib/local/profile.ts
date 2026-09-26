import { query } from "@/lib/db";
import { hash } from "@/lib/seo/engine";
import { brandName } from "@/lib/monitoring/names";
import type { Project } from "@/lib/projects";
import { locate } from "./geo";
import { DEFAULT_HOURS, profileInput, type BusinessProfile, type ProfileInput } from "./profile-schema";

export const titleCase = (s: string) => s.replace(/\b[a-z]/g, (c) => c.toUpperCase());

export async function getProfile(projectId: string): Promise<{ profile: BusinessProfile; updatedAt: string } | null> {
  const [row] = await query<{ data: BusinessProfile; updated_at: Date | string }>("SELECT data, updated_at FROM local_profiles WHERE project_id=$1", [projectId]);
  if (!row) return null;
  // Parse through the schema so older rows gain new defaults.
  const parsed = profileInput.safeParse(row.data);
  return { profile: parsed.success ? parsed.data : (row.data as BusinessProfile), updatedAt: new Date(row.updated_at).toISOString() };
}

export async function saveProfile(projectId: string, raw: ProfileInput) {
  const profile = profileInput.parse(raw);
  await query(
    `INSERT INTO local_profiles(project_id,data,updated_at) VALUES($1,$2::jsonb,now())
     ON CONFLICT(project_id) DO UPDATE SET data=excluded.data, updated_at=now()`,
    [projectId, JSON.stringify(profile)],
  );
  return profile;
}

/** Pre-filled values for a project that has no profile yet. */
export function profileDefaults(project: Project): ProfileInput {
  const brand = project.brand_terms[0] || brandName(project.domain);
  const [city, region] = (project.location || "").split(",").map((s) => s.trim());
  return {
    name: brand,
    street: "",
    city: city || "",
    region: region || "",
    postalCode: "",
    phone: "",
    website: `https://www.${project.domain}/`,
    primaryCategory: "",
    categories: [],
    hours: DEFAULT_HOURS,
    description: "",
    photos: 0,
    lat: null,
    lng: null,
  };
}

/** Identity of the NAP+ fields; a listing synced with another hash needs an update. */
export function napHash(p: BusinessProfile) {
  return hash(JSON.stringify([p.name, p.street, p.city, p.region, p.postalCode, p.phone.replace(/\D/g, ""), p.website, p.primaryCategory, p.categories, p.hours])).toString(36);
}

export function businessLocation(profile: BusinessProfile, country: string) {
  return locate({ lat: profile.lat, lng: profile.lng, city: profile.city, country });
}
