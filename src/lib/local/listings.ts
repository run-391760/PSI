import { query } from "@/lib/db";
import { rng } from "@/lib/seo/engine";
import type { Project } from "@/lib/projects";
import { directoriesFor, type Directory } from "./directories";
import { formatAddress, formatHours, type BusinessProfile } from "./profile-schema";
import { FIELD_LABELS, NAP_FIELDS, STATUS_META, type FieldKey, type FoundListing, type ListingRow, type ListingStatus } from "./listing-meta";

/**
 * Listing Management (demo): there are no public directory APIs, so the "found" listings are generated
 * deterministically from the stored business profile with realistic drift (old phone numbers, previous
 * addresses, missing websites, duplicates). A sync ("Distribute updates") stores a snapshot of the
 * profile per directory; later profile edits make those listings stale again.
 */

export { FIELD_LABELS, NAP_FIELDS, STATUS_META, type FieldKey, type FoundListing, type ListingRow, type ListingStatus };

export type NapField = { field: FieldKey; consistent: number; total: number; variants: { value: string; directories: string[] }[] };
export type ListingsView = {
  rows: ListingRow[];
  expected: FoundListing;
  counts: Record<ListingStatus, number> & { total: number; listed: number; duplicateListings: number };
  scores: { presence: number; accuracy: number; overall: number };
  nap: NapField[];
  lastSync: string | null;
};

const IN_REVIEW_MS = 3 * 60 * 1000;

export function expectedListing(p: BusinessProfile): FoundListing {
  return {
    name: p.name,
    address: formatAddress(p),
    phone: p.phone,
    website: p.website,
    hours: formatHours(p.hours),
    categories: [p.primaryCategory, ...p.categories],
    photos: p.photos,
    hasDescription: !!p.description,
  };
}

const norm = {
  text: (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim(),
  phone: (s: string) => s.replace(/\D/g, "").slice(-10),
  url: (s: string) => s.toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/+$/, ""),
};
function same(field: FieldKey, a: FoundListing, b: FoundListing) {
  switch (field) {
    case "name":
      return norm.text(a.name) === norm.text(b.name);
    case "address":
      return norm.text(a.address) === norm.text(b.address);
    case "phone":
      return norm.phone(a.phone) === norm.phone(b.phone) && !!a.phone;
    case "website":
      return !!a.website === !!b.website && norm.url(a.website) === norm.url(b.website);
    case "hours":
      return a.hours === b.hours;
    case "categories":
      return norm.text(a.categories[0] ?? "") === norm.text(b.categories[0] ?? "");
  }
}
const FIELDS: FieldKey[] = ["name", "address", "phone", "website", "hours", "categories"];
function diff(found: FoundListing, expected: FoundListing) {
  return FIELDS.filter((f) => !same(f, found, expected));
}

const OLD_STREETS = ["Station Road", "Old Padra Road", "Main Street", "Market Road", "High Street", "Park Avenue", "Church Street", "MG Road", "Mill Road", "Lake View Road"];

/** Deterministic "found" listing on a directory before we ever synced it. */
function discovered(p: BusinessProfile, domain: string, dir: Directory) {
  const r = rng(`listing:${domain}:${dir.id}`);
  const listed = r.next() >= dir.missing;
  const owned = dir.id === "google" ? 0.5 : 1;
  const duplicates = listed && r.chance(dir.id === "google" ? 0.08 : 0.13) ? r.int(1, 3) : 0;
  const e = expectedListing(p);
  if (!listed) return { found: null, duplicates: 0 };
  const f: FoundListing = { ...e, categories: [...e.categories] };
  if (r.chance(0.14 * owned)) {
    const suffix = r.pick([" Pvt Ltd", " LLC", " & Co", " - Main Branch", " Inc", ""]);
    const words = p.name.split(" ");
    f.name = suffix ? `${p.name}${suffix}` : words.length > 1 ? words.slice(0, -1).join(" ") : `The ${p.name}`;
  }
  if (r.chance(0.22 * owned)) {
    // Previous address: a different street number or an old street.
    const num = p.street.match(/\d+/)?.[0];
    const street = num && r.chance(0.5) ? p.street.replace(num, String(Number(num) + r.int(2, 40))) : `${r.int(3, 180)}, ${r.pick(OLD_STREETS)}`;
    f.address = formatAddress({ ...p, street, postalCode: r.chance(0.3) ? "" : p.postalCode });
  }
  const digits = p.phone.replace(/\D/g, "");
  if (r.chance(0.18 * owned)) {
    // An old number: same prefix, different last four digits.
    let tail = String(r.int(1000, 9999));
    if (tail === digits.slice(-4)) tail = String((Number(tail) + 1111) % 10000).padStart(4, "0");
    const next = digits.slice(0, -4) + tail;
    let i = 0;
    f.phone = p.phone.replace(/\d/g, () => next[i++] ?? "");
  } else if (r.chance(0.3) && digits.length >= 10) {
    // Same number written differently: consistent after normalisation.
    const local = digits.slice(-10);
    f.phone = `(${local.slice(0, 3)}) ${local.slice(3, 6)}-${local.slice(6)}`;
  }
  if (r.chance(0.15 * owned)) f.website = r.chance(0.55) ? "" : p.website.replace(/^https?:\/\/(www\.)?/, "http://old.").replace(/\/?$/, "/home");
  if (r.chance(0.18 * owned)) f.hours = r.chance(0.5) ? "" : formatHours(p.hours.map((h) => (h.day === "sat" ? { ...h, closed: !h.closed, open: "10:00", close: "16:00" } : h.day === "mon" ? { ...h, open: "10:00" } : h)));
  if (r.chance(0.12 * owned)) f.categories = [r.pick(["Business", "Local business", "Service", "Store", "Consultant"])];
  f.photos = Math.max(0, Math.round(p.photos * r.range(0.05, 0.6)));
  f.hasDescription = r.chance(0.45) && !!p.description;
  return { found: f, duplicates };
}

type ListingDbRow = { directory: string; status: "synced" | "pending"; snapshot: BusinessProfile; duplicates_suppressed: number; synced_at: Date | string };

export async function listingRows(projectId: string) {
  return query<ListingDbRow>("SELECT directory,status,snapshot,duplicates_suppressed,synced_at FROM local_listings WHERE project_id=$1", [projectId]);
}

export function buildListings(project: Pick<Project, "domain" | "country">, profile: BusinessProfile, stored: ListingDbRow[], now = Date.now()): ListingsView {
  const expected = expectedListing(profile);
  const byDir = new Map(stored.map((s) => [s.directory, s]));
  const rows: ListingRow[] = directoriesFor(project.country).map((dir) => {
    const s = byDir.get(dir.id);
    let found: FoundListing | null;
    let duplicates = 0;
    let status: ListingStatus;
    let syncedAt: string | null = null;
    if (s) {
      found = expectedListing(s.snapshot);
      syncedAt = new Date(s.synced_at).toISOString();
      const mismatches = diff(found, expected);
      status = s.status === "pending" && now - new Date(s.synced_at).getTime() < IN_REVIEW_MS ? "in_review" : mismatches.length ? "needs_update" : "synced";
    } else {
      const d = discovered(profile, project.domain, dir);
      found = d.found;
      duplicates = d.duplicates;
      status = !found ? "not_listed" : duplicates ? "duplicates" : diff(found, expected).length ? "needs_update" : "synced";
    }
    const mismatches = found ? diff(found, expected) : [];
    const napOk = found ? NAP_FIELDS.filter((f) => !mismatches.includes(f)).length : 0;
    return {
      id: dir.id,
      name: dir.name,
      domain: dir.domain,
      kind: dir.kind,
      weight: dir.weight,
      verification: !!dir.verification,
      status,
      found,
      mismatches,
      duplicates,
      suppressed: s?.duplicates_suppressed ?? 0,
      syncedAt,
      accuracy: found ? Math.round((napOk / NAP_FIELDS.length) * 100) : null,
    };
  });

  const counts = { synced: 0, needs_update: 0, not_listed: 0, duplicates: 0, in_review: 0, total: rows.length, listed: 0, duplicateListings: 0 };
  for (const r of rows) {
    counts[r.status]++;
    if (r.found) counts.listed++;
    counts.duplicateListings += r.duplicates;
  }
  const totalWeight = rows.reduce((s, r) => s + r.weight, 0) || 1;
  const presence = (rows.reduce((s, r) => s + (r.status === "in_review" ? r.weight * 0.5 : r.found ? r.weight : 0), 0) / totalWeight) * 100;
  const listedWeight = rows.filter((r) => r.found).reduce((s, r) => s + r.weight, 0);
  const accuracy = listedWeight ? rows.reduce((s, r) => s + (r.accuracy ?? 0) * (r.found ? r.weight : 0), 0) / listedWeight : 0;
  const overall = Math.max(0, Math.min(100, 0.45 * presence + 0.55 * accuracy - Math.min(10, counts.duplicateListings * 2)));

  const nap: NapField[] = (["name", "address", "phone", "website", "hours", "categories"] as FieldKey[]).map((field) => {
    const listed = rows.filter((r) => r.found);
    const variants = new Map<string, string[]>();
    let consistent = 0;
    for (const r of listed) {
      if (!r.mismatches.includes(field)) {
        consistent++;
        continue;
      }
      const v = field === "categories" ? r.found!.categories[0] || "" : (r.found![field] as string);
      const key = v || "(missing)";
      variants.set(key, [...(variants.get(key) ?? []), r.name]);
    }
    return { field, consistent, total: listed.length, variants: [...variants.entries()].map(([value, directories]) => ({ value, directories })).sort((a, b) => b.directories.length - a.directories.length) };
  });

  const lastSync = stored.reduce<string | null>((m, s) => {
    const t = new Date(s.synced_at).toISOString();
    return !m || t > m ? t : m;
  }, null);

  return { rows, expected, counts, scores: { presence: Math.round(presence), accuracy: Math.round(accuracy), overall: Math.round(overall) }, nap, lastSync };
}

/** Directories that a distribution run would touch. */
export function distributionTargets(view: ListingsView, only?: string[]) {
  return view.rows.filter((r) => (only?.length ? only.includes(r.id) : r.status !== "synced" && r.status !== "in_review"));
}

export async function writeListing(projectId: string, row: ListingRow, profile: BusinessProfile) {
  const pending = row.status === "not_listed" && row.verification;
  await query(
    `INSERT INTO local_listings(project_id,directory,status,snapshot,duplicates_suppressed,synced_at) VALUES($1,$2,$3,$4::jsonb,$5,now())
     ON CONFLICT(project_id,directory) DO UPDATE SET status=excluded.status, snapshot=excluded.snapshot,
       duplicates_suppressed=local_listings.duplicates_suppressed+excluded.duplicates_suppressed, synced_at=now()`,
    [projectId, row.id, pending ? "pending" : "synced", JSON.stringify(profile), row.duplicates],
  );
}
