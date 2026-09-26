import { clamp, domainEntity, rng, round, unit } from "@/lib/seo/engine";
import type { Project } from "@/lib/projects";
import type { BusinessProfile } from "./profile-schema";
import { titleCase } from "./profile";
import { brandName } from "@/lib/monitoring/names";

/**
 * Deterministic local competitor set (demo): nearby businesses in the same category. Shared by the
 * Map Rank Tracker (local pack) and Review Management (rating comparison) so both tools agree.
 */
export type LocalBusiness = {
  id: string;
  name: string;
  /** Prominence 0..1 (reviews, links, profile completeness). */
  strength: number;
  /** Position relative to your business in km (east, north). */
  dx: number;
  dy: number;
  rating: number;
  reviews: number;
  responseRate: number;
  reviewsPerMonth: number;
  you?: boolean;
  /** Linked to a tracked competitor domain from the project. */
  domain?: string;
};

const FAMILIES: { match: RegExp; nouns: string[] }[] = [
  { match: /dent/i, nouns: ["Dental Care", "Dental Clinic", "Smile Studio", "Dental Hospital", "Orthodontics", "Dental Centre"] },
  { match: /restaurant|food|dine|kitchen|grill|biryani|pizza/i, nouns: ["Kitchen", "Bistro", "Grill", "Restaurant", "Eatery", "Dhaba", "Diner"] },
  { match: /cafe|coffee|bakery|bake/i, nouns: ["Cafe", "Coffee House", "Bakery", "Brew Bar", "Patisserie", "Roasters"] },
  { match: /salon|hair|beauty|spa|nail/i, nouns: ["Salon", "Hair Studio", "Beauty Lounge", "Spa", "Unisex Salon", "Makeover Studio"] },
  { match: /gym|fitness|yoga|crossfit/i, nouns: ["Fitness", "Gym", "Fitness Studio", "Yoga Centre", "Athletic Club", "CrossFit"] },
  { match: /clinic|hospital|medical|doctor|health|physio/i, nouns: ["Hospital", "Clinic", "Multispeciality Hospital", "Medical Centre", "Health Clinic", "Diagnostics"] },
  { match: /law|legal|attorney|advocate/i, nouns: ["Law Associates", "Legal Advisors", "& Partners", "Law Chambers", "Attorneys", "Legal"] },
  { match: /plumb|electric|repair|hvac|roof|clean/i, nouns: ["Home Services", "Plumbing", "Electricals", "Repairs", "Maintenance Co", "Fixers"] },
  { match: /real estate|realty|property|realtor/i, nouns: ["Realty", "Properties", "Estates", "Real Estate", "Homes", "Property Consultants"] },
  { match: /hotel|resort|inn|stay|hostel/i, nouns: ["Hotel", "Residency", "Inn", "Grand", "Suites", "Resort"] },
  { match: /universit|college|school|academy|institute|coaching|education/i, nouns: ["University", "Institute of Technology", "College", "Academy", "Institute", "School of Management"] },
  { match: /auto|car|garage|motor/i, nouns: ["Auto Care", "Motors", "Car Service", "Garage", "Auto Works", "Car Clinic"] },
  { match: /pharm|chemist|drug/i, nouns: ["Pharmacy", "Chemists", "Medicals", "Drug Store", "Wellness Pharmacy", "Medical Store"] },
  { match: /vet|pet/i, nouns: ["Pet Clinic", "Veterinary Hospital", "Pet Care", "Animal Clinic", "Vets", "Pet Hospital"] },
  { match: /agency|marketing|software|it |consult/i, nouns: ["Digital", "Technologies", "Solutions", "Labs", "Consulting", "Media"] },
  { match: /store|shop|boutique|cloth|fashion/i, nouns: ["Store", "Boutique", "Mart", "Emporium", "Fashions", "Collections"] },
];
const PREFIXES = ["City", "Sunrise", "Green Park", "Prime", "Elite", "Family", "Royal", "Metro", "Lotus", "Silver Oak", "Crescent", "Riverside", "Harmony", "Apex", "Bluebell", "Heritage", "Pioneer", "Evergreen", "Sterling", "Orchid", "Galaxy", "Unity", "Maple", "Summit"];

export function nounsFor(category: string) {
  return FAMILIES.find((f) => f.match.test(category))?.nouns ?? ["Services", "& Co", "Group", "Centre", "Associates", "Hub"];
}

function slug(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-");
}

/** You + 59 nearby businesses (sorted by prominence). */
export function localCompetitors(project: Pick<Project, "domain" | "competitors">, profile: BusinessProfile): LocalBusiness[] {
  const seed = `${project.domain}:${profile.primaryCategory.toLowerCase()}:${profile.city.toLowerCase()}`;
  const r = rng(`localcomp:${seed}`);
  const nouns = nounsFor(`${profile.primaryCategory} ${profile.categories.join(" ")}`);
  const you: LocalBusiness = {
    id: "you",
    name: profile.name,
    strength: round(clamp(0.34 + 0.45 * domainEntity(project.domain).strength + 0.14 * unit(`you:${seed}`), 0.3, 0.92), 3),
    dx: 0,
    dy: 0,
    rating: round(clamp(r.normal(4.35, 0.22), 3.6, 4.9), 1),
    reviews: 0,
    responseRate: 0,
    reviewsPerMonth: 0,
    you: true,
    domain: project.domain,
  };
  const names = new Set<string>([profile.name.toLowerCase()]);
  const out: LocalBusiness[] = [you];
  // Tracked competitor domains become named local rivals first.
  for (const d of project.competitors.slice(0, 4)) {
    const name = brandName(d);
    if (names.has(name.toLowerCase())) continue;
    names.add(name.toLowerCase());
    out.push(business(`${seed}:${d}`, name, domainEntity(d).strength, d));
  }
  const city = titleCase(profile.city.split(",")[0].trim());
  while (out.length < 60) {
    const prefix = r.chance(0.18) && city ? city : r.pick(PREFIXES);
    const name = `${prefix} ${r.pick(nouns)}`;
    if (names.has(name.toLowerCase())) continue;
    names.add(name.toLowerCase());
    out.push(business(`${seed}:${name}`, name, clamp(r.logNormal(0.42, 0.45), 0.08, 0.93)));
  }
  return out.sort((a, b) => (a.you ? -1 : b.you ? 1 : b.strength - a.strength));
}

function business(key: string, name: string, prominence: number, domain?: string): LocalBusiness {
  const r = rng(`biz:${key}`);
  const distance = clamp(r.logNormal(4.2, 0.75), 0.3, 20);
  const angle = r.range(0, Math.PI * 2);
  const strength = round(clamp(prominence * 0.8 + r.range(0, 0.25), 0.08, 0.96), 3);
  const reviews = Math.round(r.logNormal(40 + 900 * strength ** 2, 0.5));
  return {
    id: slug(name),
    name,
    strength,
    dx: round(Math.cos(angle) * distance, 2),
    dy: round(Math.sin(angle) * distance, 2),
    rating: round(clamp(r.normal(3.7 + 0.8 * strength, 0.25), 2.8, 4.9), 1),
    reviews,
    responseRate: round(clamp(r.normal(0.25 + 0.5 * strength, 0.15), 0, 0.98), 2),
    reviewsPerMonth: round(Math.max(0.2, reviews / r.range(30, 70)), 1),
    domain,
  };
}
