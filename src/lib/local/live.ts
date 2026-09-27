import { query } from "@/lib/db";
import type { Project } from "@/lib/projects";
import { dfs, dfsGet, market } from "@/lib/providers/dataforseo";
import { liveEnabled } from "@/lib/providers/source";
import { googleListing, googleReviews, gridCell, mapsBusinesses, type GoogleListing, type LiveReview, type MapsBusiness } from "./dfs-map";
import { formatAddress, type BusinessProfile } from "./profile-schema";

/**
 * Real Local SEO data from DataForSEO (Business Data + Google Maps SERP). Every call is budgeted via
 * dfs() and results are stored per project; nothing is simulated.
 */

export const localLive = () => liveEnabled();
const toIso = (d: Date | string) => new Date(d).toISOString();

// ---------------------------------------------------------------------------------- Google listing

export async function getGoogleListing(projectId: string) {
  const [row] = await query<{ listing: GoogleListing | null; query: string; fetched_at: Date | string }>("SELECT listing, query, fetched_at FROM local_gbp WHERE project_id=$1", [projectId]);
  return row ? { listing: row.listing, query: row.query, fetchedAt: toIso(row.fetched_at) } : null;
}

/** Look up the business on Google (my_business_info/live, ~$0.005) and store the listing. */
export async function refreshGoogleListing(ownerId: string, project: Pick<Project, "id" | "country">, profile: BusinessProfile) {
  const keyword = [profile.name, profile.city].filter(Boolean).join(" ").trim();
  const [result] = await dfs(ownerId, "business_data/google/my_business_info/live", { keyword, ...market(project.country) }, 10000);
  const listing = googleListing(result as Record<string, unknown> | undefined);
  await query(
    `INSERT INTO local_gbp(project_id,listing,query,fetched_at) VALUES($1,$2::jsonb,$3,now())
     ON CONFLICT(project_id) DO UPDATE SET listing=excluded.listing, query=excluded.query, fetched_at=now()`,
    [project.id, JSON.stringify(listing), keyword],
  );
  return listing;
}

export const profileNap = (p: BusinessProfile) => ({ name: p.name, address: formatAddress(p), phone: p.phone, website: p.website, category: p.primaryCategory });

// ---------------------------------------------------------------------------------------- reviews

export async function getLiveReviews(projectId: string) {
  const [row] = await query<{ rating: number | null; total: number | null; reviews: LiveReview[]; fetched_at: Date | string }>("SELECT rating, total, reviews, fetched_at FROM local_reviews WHERE project_id=$1", [projectId]);
  return row ? { rating: row.rating == null ? null : Number(row.rating), total: row.total, reviews: row.reviews ?? [], fetchedAt: toIso(row.fetched_at) } : null;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Google reviews via the (task-based) business_data/google/reviews API: post a task tagged with the
 * project, poll tasks_ready (free) until it is done, then task_get (free). ~$0.0075 per 100 reviews.
 */
export async function fetchGoogleReviews(
  ownerId: string,
  project: Pick<Project, "id" | "country">,
  profile: BusinessProfile,
  onWait: (i: number) => Promise<boolean>,
) {
  const g = await getGoogleListing(project.id);
  const keyword = g?.listing?.placeId ? `place_id:${g.listing.placeId}` : g?.listing?.cid ? `cid:${g.listing.cid}` : [profile.name, profile.city].filter(Boolean).join(" ");
  const tag = `synapse-reviews:${project.id}:${Date.now()}`;
  await dfs(ownerId, "business_data/google/reviews/task_post", { keyword, ...market(project.country), depth: 100, sort_by: "newest", tag }, 10000);
  let id: string | null = null;
  for (let i = 0; i < 60 && !id; i++) {
    if (await onWait(i)) return null;
    await sleep(10000);
    const ready = await dfsGet<{ id: string; tag?: string }>("business_data/google/reviews/tasks_ready").catch(() => []);
    id = ready.find((t) => t?.tag === tag)?.id ?? null;
  }
  if (!id) throw new Error("Google reviews were not ready after 10 minutes. Try again later.");
  const [result] = await dfsGet(`business_data/google/reviews/task_get/${id}`);
  const data = googleReviews(result as Record<string, unknown> | undefined);
  await query(
    `INSERT INTO local_reviews(project_id,rating,total,reviews,fetched_at) VALUES($1,$2,$3,$4::jsonb,now())
     ON CONFLICT(project_id) DO UPDATE SET rating=excluded.rating, total=excluded.total, reviews=excluded.reviews, fetched_at=now()`,
    [project.id, data.rating, data.total, JSON.stringify(data.reviews)],
  );
  return data;
}

// ------------------------------------------------------------------------------------ maps grid

/** Zoom that roughly fits the grid radius in view (Google Maps zoom levels). */
export const zoomFor = (radiusKm: number) => (radiusKm <= 1 ? 16 : radiusKm <= 3 ? 15 : radiusKm <= 7 ? 14 : radiusKm <= 15 ? 13 : 12);

/** One grid point: Google Maps results at lat,lng (serp/google/maps/live/advanced, ~$0.002). */
export async function mapsAt(ownerId: string, country: string, keyword: string, lat: number, lng: number, radiusKm: number): Promise<MapsBusiness[]> {
  const { language_code } = market(country);
  const [result] = await dfs(ownerId, "serp/google/maps/live/advanced", { keyword, location_coordinate: `${lat},${lng},${zoomFor(radiusKm)}z`, language_code, depth: 20 }, 4000);
  return mapsBusinesses(result as Record<string, unknown> | undefined);
}

export { gridCell };
