import type { Sentiment } from "@/lib/monitoring/sentiment";

/**
 * Pure, defensive mappings of DataForSEO Business Data / Google Maps SERP responses for Local SEO
 * (unit-tested in tests/platform-real.test.ts). Missing fields stay empty/null, never estimated.
 */

type Any = Record<string, unknown>;
const str = (v: unknown) => (typeof v === "string" ? v : "");
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() && Number.isFinite(Number(v)) ? Number(v) : null);
const host = (v: string) => v.toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").split(/[/?#]/)[0];
const normName = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

export type MapsBusiness = { id: string; name: string; domain: string | null; rating: number | null; reviews: number | null; rank: number };

/** Local results of one serp/google/maps/live/advanced call, in rank order. */
export function mapsBusinesses(result: Any | undefined): MapsBusiness[] {
  const items = (Array.isArray(result?.items) ? result.items : []) as Any[];
  return items
    .filter((i) => str(i?.type) === "maps_search")
    .map((i, idx) => {
      const rating = (i.rating ?? {}) as Any;
      const domain = str(i.domain) || (str(i.url) ? host(str(i.url)) : "");
      return {
        id: str(i.cid) || str(i.place_id) || normName(str(i.title)),
        name: str(i.title) || "Unknown business",
        domain: domain || null,
        rating: num(rating.value),
        reviews: num(rating.votes_count),
        rank: num(i.rank_group) ?? idx + 1,
      };
    })
    .sort((a, b) => a.rank - b.rank);
}

/** Whether a Maps result is the tracked business: same website domain, or the same normalized name. */
export function isYou(b: Pick<MapsBusiness, "name" | "domain">, you: { domain: string; name: string }) {
  const d = you.domain.replace(/^www\./, "").toLowerCase();
  if (b.domain && (b.domain === d || b.domain.endsWith(`.${d}`))) return true;
  return !!you.name && normName(b.name) === normName(you.name);
}

/** One grid point: your rank (1–20, null = not found) and the 3-pack names. */
export function gridCell(list: MapsBusiness[], you: { domain: string; name: string }) {
  const top = list.slice(0, 20);
  const idx = top.findIndex((b) => isYou(b, you));
  return { rank: idx >= 0 ? idx + 1 : null, pack: top.slice(0, 3).map((b) => b.name), order: top.map((b) => (isYou(b, you) ? "you" : b.id)) };
}

export type GoogleListing = {
  name: string;
  address: string;
  phone: string;
  website: string;
  category: string;
  categories: string[];
  rating: number | null;
  reviews: number | null;
  photos: number | null;
  claimed: boolean | null;
  placeId: string | null;
  cid: string | null;
  hasDescription: boolean;
  hours: string;
};

const DAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
const pad = (n: unknown) => String(num(n) ?? 0).padStart(2, "0");

/** business_data/google/my_business_info result item → listing. */
export function googleListing(result: Any | undefined): GoogleListing | null {
  const items = (Array.isArray(result?.items) ? result.items : []) as Any[];
  const i = items[0];
  if (!i) return null;
  const rating = (i.rating ?? {}) as Any;
  const timetable = (((i.work_time as Any | undefined)?.work_hours as Any | undefined)?.timetable ?? null) as Record<string, Any[] | null> | null;
  const hours = timetable
    ? DAYS.map((d) => {
        const slots = timetable[d];
        if (!slots?.length) return `${d.slice(0, 3)} closed`;
        return `${d.slice(0, 3)} ${slots.map((s) => `${pad((s.open as Any)?.hour)}:${pad((s.open as Any)?.minute)}–${pad((s.close as Any)?.hour)}:${pad((s.close as Any)?.minute)}`).join(", ")}`;
      }).join("; ")
    : "";
  return {
    name: str(i.title),
    address: str(i.address),
    phone: str(i.phone),
    website: str(i.url),
    category: str(i.category),
    categories: [str(i.category), ...((Array.isArray(i.additional_categories) ? i.additional_categories : []) as unknown[]).map(str)].filter(Boolean),
    rating: num(rating.value),
    reviews: num(rating.votes_count),
    photos: num(i.total_photos),
    claimed: typeof i.is_claimed === "boolean" ? i.is_claimed : null,
    placeId: str(i.place_id) || null,
    cid: str(i.cid) || null,
    hasDescription: !!str(i.description),
    hours,
  };
}

export type NapCheck = { field: "name" | "address" | "phone" | "website" | "category"; profile: string; google: string; match: boolean | null };

/** Compare the saved business profile with the live Google listing (null = not shown on Google). */
export function napCheck(profile: { name: string; address: string; phone: string; website: string; category: string }, g: GoogleListing): NapCheck[] {
  const text = (s: string) => normName(s);
  const phone = (s: string) => s.replace(/\D/g, "").slice(-10);
  const site = (s: string) => host(s);
  const addr = (a: string, b: string) => {
    const x = new Set(text(a).split(" ").filter((w) => w.length > 1));
    const y = text(b).split(" ").filter((w) => w.length > 1);
    if (!x.size || !y.length) return false;
    return y.filter((w) => x.has(w)).length / Math.max(x.size, y.length) >= 0.6;
  };
  const row = (field: NapCheck["field"], p: string, gv: string, eq: () => boolean): NapCheck => ({ field, profile: p, google: gv, match: gv ? eq() : null });
  return [
    row("name", profile.name, g.name, () => text(profile.name) === text(g.name)),
    row("address", profile.address, g.address, () => addr(profile.address, g.address)),
    row("phone", profile.phone, g.phone, () => !!phone(profile.phone) && phone(profile.phone) === phone(g.phone)),
    row("website", profile.website, g.website, () => site(profile.website) === site(g.website)),
    row("category", profile.category, g.category, () => text(profile.category) === text(g.category)),
  ];
}

export type LiveReview = { id: string; author: string; rating: number; date: string; text: string; ownerReply: { body: string; date: string } | null };

/** business_data/google/reviews task_get result → reviews (newest first). */
export function googleReviews(result: Any | undefined): { rating: number | null; total: number | null; reviews: LiveReview[] } {
  const items = (Array.isArray(result?.items) ? result.items : []) as Any[];
  const reviews = items
    .map((i, idx) => {
      const rating = num((i.rating as Any | undefined)?.value);
      const ts = str(i.timestamp);
      const date = ts ? new Date(ts.replace(" +00:00", "Z").replace(" ", "T")).toISOString().slice(0, 10) : "";
      const answer = str(i.owner_answer);
      const ots = str(i.owner_timestamp);
      return {
        id: str(i.review_id) || `r${idx}`,
        author: str(i.profile_name) || "Google user",
        rating: rating ?? 0,
        date,
        text: str(i.review_text) || str(i.original_review_text),
        ownerReply: answer ? { body: answer, date: ots ? new Date(ots.replace(" +00:00", "Z").replace(" ", "T")).toISOString().slice(0, 10) : date } : null,
      };
    })
    .filter((r) => r.rating >= 1 && r.rating <= 5 && r.date && !Number.isNaN(Date.parse(r.date)))
    .sort((a, b) => b.date.localeCompare(a.date));
  const rating = (result?.rating ?? {}) as Any;
  return { rating: num(rating.value), total: num(result?.reviews_count) ?? num(rating.votes_count), reviews };
}

export type ReviewSentiment = Sentiment;
