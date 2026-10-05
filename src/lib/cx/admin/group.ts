import { query } from "@/lib/db";
import { AppError } from "@/lib/domain";
import { getHours, saveHours } from "@/lib/cx/insights/team";
import { audit } from "./audit";
import { iso } from "./util";

/** Group Details (Settings): brand identity shown across CX — name, logo, domain, timezone, language, description. */
export type GroupDetails = {
  id: string;
  name: string;
  domain: string;
  country: string;
  language: string;
  timezone: string;
  logo: string;
  description: string;
  industry: string;
  supportEmail: string;
  ownerName: string;
  ownerEmail: string;
  createdAt: string;
  updatedAt: string | null;
};

export async function getGroupDetails(projectId: string): Promise<GroupDetails> {
  const [r] = await query<{ id: string; name: string; domain: string; country: string; language: string; created_at: string; owner_name: string; owner_email: string; logo: string | null; description: string | null; industry: string | null; support_email: string | null; updated_at: string | null }>(
    `SELECT p.id,p.name,p.domain,p.country,p.language,p.created_at,u.name AS owner_name,u.email AS owner_email,g.logo,g.description,g.industry,g.support_email,g.updated_at
       FROM projects p JOIN users u ON u.id=p.owner_id LEFT JOIN cx_settings_group g ON g.project_id=p.id WHERE p.id=$1`,
    [projectId],
  );
  if (!r) throw new AppError("Brand not found.", 404);
  const hours = await getHours(projectId);
  return {
    id: r.id, name: r.name, domain: r.domain, country: r.country, language: r.language, timezone: hours.timezone,
    logo: r.logo ?? "", description: r.description ?? "", industry: r.industry ?? "", supportEmail: r.support_email ?? "",
    ownerName: r.owner_name, ownerEmail: r.owner_email, createdAt: iso(r.created_at)!, updatedAt: iso(r.updated_at),
  };
}

export type GroupInput = { name: string; domain: string; country: string; language: string; timezone: string; logo: string; description: string; industry: string; supportEmail: string };

const LOGO_MAX = 200_000;
export function cleanLogo(v: string) {
  const s = String(v ?? "").trim();
  if (!s) return "";
  if (/^https:\/\/[^\s"'<>]+$/i.test(s) && s.length <= 1000) return s;
  if (/^data:image\/(png|jpeg|webp|gif);base64,[a-z0-9+/=]+$/i.test(s) && s.length <= LOGO_MAX) return s;
  throw new AppError("The logo must be an https image URL or a PNG/JPEG/WebP/GIF up to about 150 KB.");
}

/** Save Group Details. Name, domain, country and language change the project itself, so only its owner can change them. */
export async function saveGroupDetails(projectId: string, actor: { id: string; name: string }, isOwner: boolean, input: GroupInput) {
  const cur = await getGroupDetails(projectId);
  const name = input.name.trim().replace(/\s+/g, " ").slice(0, 80);
  const domain = input.domain.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "").replace(/^www\./, "");
  const country = input.country.trim().toUpperCase();
  const language = input.language.trim().toLowerCase();
  if (!name) throw new AppError("Enter the brand name.");
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(domain)) throw new AppError("Enter a domain like example.com.");
  if (!/^[A-Z]{2}$/.test(country)) throw new AppError("Country is a 2-letter code (IN, US…).");
  if (!/^[a-z]{2}$/.test(language)) throw new AppError("Language is a 2-letter code (en, hi…).");
  const identityChanged = name !== cur.name || domain !== cur.domain || country !== cur.country || language !== cur.language;
  if (identityChanged) {
    if (!isOwner) throw new AppError("Only the brand owner can change its name, domain, country or language.", 403);
    const [dupe] = await query("SELECT 1 FROM projects WHERE owner_id=(SELECT owner_id FROM projects WHERE id=$1) AND domain=$2 AND id<>$1", [projectId, domain]);
    if (dupe) throw new AppError("You already have a brand with that domain.");
    await query("UPDATE projects SET name=$2,domain=$3,country=$4,language=$5 WHERE id=$1", [projectId, name, domain, country, language]);
  }
  const tz = input.timezone.trim();
  if (tz && tz !== cur.timezone) {
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: tz });
    } catch {
      throw new AppError("Unknown timezone.");
    }
    const h = await getHours(projectId);
    await saveHours(projectId, { ...h, timezone: tz });
  }
  const email = input.supportEmail.trim().toLowerCase();
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new AppError("Enter a valid support email.");
  await query(
    `INSERT INTO cx_settings_group(project_id,logo,description,industry,support_email,updated_by,updated_at) VALUES($1,$2,$3,$4,$5,$6,now())
     ON CONFLICT(project_id) DO UPDATE SET logo=excluded.logo,description=excluded.description,industry=excluded.industry,support_email=excluded.support_email,updated_by=excluded.updated_by,updated_at=now()`,
    [projectId, cleanLogo(input.logo), input.description.trim().slice(0, 1000), input.industry.trim().slice(0, 80), email, actor.id],
  );
  await audit(projectId, actor, "group.update", name, identityChanged ? "identity changed" : "");
}

/** Brand logo for other packages (header, reports); "" when none. */
export async function brandLogo(projectId: string) {
  const [r] = await query<{ logo: string }>("SELECT logo FROM cx_settings_group WHERE project_id=$1", [projectId]);
  return r?.logo ?? "";
}
