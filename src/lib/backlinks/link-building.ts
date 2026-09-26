import { randomUUID } from "node:crypto";
import { query } from "@/lib/db";
import { AppError, database, matchesDomain, normalizeKeywords, safeUrl } from "@/lib/domain";
import { enqueue, getSchedule, latestJob, setSchedule } from "@/lib/jobs/queue";
import { getProject, type Project } from "@/lib/projects";
import { linkingDomainAs } from "./metrics";
import { looseRootDomain } from "./normalize";
import { computeProspects } from "./prospects";
import { DEFAULT_TEMPLATE, type LbLinkRow, type LbSettings, type OutreachStatus, type PipelineRow } from "./types";

export const VERIFY_JOB = "backlinks.verify";
export const MAX_KEYWORDS = 10;
export const MAX_COMPETITORS = 10;

/* ------------------------------------------------------------------------------------------------
 * Settings
 * ---------------------------------------------------------------------------------------------- */

export async function getLbSettings(projectId: string): Promise<LbSettings | null> {
  const [r] = await query<{ keywords: string[]; competitors: string[]; sender_name: string; template_subject: string; template_body: string; updated_at: string; prospect_count: number | null }>(
    "SELECT keywords, competitors, sender_name, template_subject, template_body, updated_at, prospect_count FROM bl_lb_settings WHERE project_id=$1",
    [projectId],
  );
  if (!r) return null;
  return {
    keywords: r.keywords ?? [],
    competitors: r.competitors ?? [],
    senderName: r.sender_name,
    templateSubject: r.template_subject || DEFAULT_TEMPLATE.subject,
    templateBody: r.template_body || DEFAULT_TEMPLATE.body,
    updatedAt: new Date(r.updated_at).toISOString(),
    prospectCount: r.prospect_count,
  };
}

export async function saveLbSetup(ownerId: string, projectId: string, input: { keywords: string[]; competitors: string[] }) {
  const project = await getProject(ownerId, projectId);
  const keywords = normalizeKeywords(input.keywords, MAX_KEYWORDS + 1000).slice(0, 1000);
  if (!keywords.length) throw new AppError("Add at least one target keyword.");
  if (keywords.length > MAX_KEYWORDS) throw new AppError(`Add at most ${MAX_KEYWORDS} target keywords.`);
  const competitors: string[] = [];
  for (const c of input.competitors) {
    const raw = c.trim();
    if (!raw) continue;
    const d = looseRootDomain(raw);
    if (!d) throw new AppError(`“${raw}” is not a valid competitor domain.`);
    if (d !== project.domain && !competitors.includes(d)) competitors.push(d);
  }
  if (competitors.length > MAX_COMPETITORS) throw new AppError(`Choose at most ${MAX_COMPETITORS} competitors.`);
  const prospectCount = computeProspects(project.domain, database(project.country).code, keywords, competitors).length;
  await query(
    `INSERT INTO bl_lb_settings(project_id, keywords, competitors, prospect_count) VALUES($1,$2::jsonb,$3::jsonb,$4)
     ON CONFLICT(project_id) DO UPDATE SET keywords=excluded.keywords, competitors=excluded.competitors, prospect_count=excluded.prospect_count, updated_at=now()`,
    [projectId, JSON.stringify(keywords), JSON.stringify(competitors), prospectCount],
  );
}

export async function saveTemplate(ownerId: string, projectId: string, input: { subject: string; body: string; senderName: string }) {
  await getProject(ownerId, projectId);
  const subject = input.subject.trim();
  const body = input.body.trim();
  if (!subject || subject.length > 200) throw new AppError("The subject must be 1–200 characters.");
  if (!body || body.length > 5000) throw new AppError("The email body must be 1–5,000 characters.");
  if (input.senderName.length > 100) throw new AppError("Your name can be at most 100 characters.");
  const updated = await query("UPDATE bl_lb_settings SET template_subject=$2, template_body=$3, sender_name=$4, updated_at=now() WHERE project_id=$1 RETURNING project_id", [projectId, subject, body, input.senderName.trim()]);
  if (!updated.length) throw new AppError("Set up the Link Building Tool first.");
}

/* ------------------------------------------------------------------------------------------------
 * Prospects (demo engine)
 * ---------------------------------------------------------------------------------------------- */

export function projectProspects(project: Project, settings: LbSettings) {
  return computeProspects(project.domain, database(project.country).code, settings.keywords, settings.competitors);
}

/* ------------------------------------------------------------------------------------------------
 * Pipeline (prospects the user acted on)
 * ---------------------------------------------------------------------------------------------- */

type PipelineDb = {
  domain: string;
  state: "in_progress" | "rejected";
  status: OutreachStatus;
  rating: number;
  reason: string;
  authority_score: number;
  contact_name: string;
  contact_email: string;
  notes: string;
  created_at: string;
  updated_at: string;
};

export async function listPipeline(projectId: string): Promise<PipelineRow[]> {
  const rows = await query<PipelineDb>("SELECT * FROM bl_lb_prospects WHERE project_id=$1 ORDER BY updated_at DESC", [projectId]);
  return rows.map((r) => ({
    domain: r.domain,
    state: r.state,
    status: r.status,
    rating: r.rating,
    reason: r.reason,
    authorityScore: r.authority_score,
    contactName: r.contact_name,
    contactEmail: r.contact_email,
    notes: r.notes,
    createdAt: new Date(r.created_at).toISOString(),
    updatedAt: new Date(r.updated_at).toISOString(),
  }));
}

export async function setProspectState(ownerId: string, project: Project, domains: string[], state: "in_progress" | "rejected" | null) {
  await getProject(ownerId, project.id);
  const clean = [...new Set(domains.map((d) => String(d).trim().toLowerCase()).filter((d) => /^[a-z0-9.-]{3,253}$/.test(d)))].slice(0, 500);
  if (!clean.length) throw new AppError("Select at least one prospect.");
  if (state === null) {
    await query("DELETE FROM bl_lb_prospects WHERE project_id=$1 AND domain = ANY($2::text[])", [project.id, clean]);
    return clean.length;
  }
  const settings = await getLbSettings(project.id);
  const info = new Map((settings ? projectProspects(project, settings) : []).map((p) => [p.domain, p]));
  const payload = clean.map((d) => ({ domain: d, rating: info.get(d)?.rating ?? 0, reason: info.get(d)?.reason ?? "", authority_score: info.get(d)?.authorityScore ?? linkingDomainAs(d) }));
  await query(
    `INSERT INTO bl_lb_prospects(project_id, domain, state, rating, reason, authority_score)
     SELECT $1, x.domain, $2, x.rating, x.reason, x.authority_score FROM jsonb_to_recordset($3::jsonb) AS x(domain text, rating int, reason text, authority_score int)
     ON CONFLICT(project_id, domain) DO UPDATE SET state=excluded.state, status=CASE WHEN excluded.state='in_progress' AND bl_lb_prospects.state='rejected' THEN 'to_contact' ELSE bl_lb_prospects.status END, updated_at=now()`,
    [project.id, state, JSON.stringify(payload)],
  );
  return clean.length;
}

export async function updatePipelineRow(ownerId: string, projectId: string, domain: string, patch: { status?: OutreachStatus; contactName?: string; contactEmail?: string; notes?: string }) {
  await getProject(ownerId, projectId);
  const email = patch.contactEmail?.trim();
  if (email && (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) throw new AppError("Enter a valid contact email address.");
  if (patch.contactName && patch.contactName.length > 120) throw new AppError("The contact name can be at most 120 characters.");
  if (patch.notes && patch.notes.length > 4000) throw new AppError("Notes can be at most 4,000 characters.");
  const updated = await query(
    `UPDATE bl_lb_prospects SET status=COALESCE($3,status), contact_name=COALESCE($4,contact_name), contact_email=COALESCE($5,contact_email), notes=COALESCE($6,notes), updated_at=now()
     WHERE project_id=$1 AND domain=$2 AND state='in_progress' RETURNING domain`,
    [projectId, domain, patch.status ?? null, patch.contactName?.trim() ?? null, email ?? null, patch.notes ?? null],
  );
  if (!updated.length) throw new AppError("That prospect is not in progress.", 404);
}

/* ------------------------------------------------------------------------------------------------
 * Monitored links
 * ---------------------------------------------------------------------------------------------- */

type LinkDb = {
  id: string;
  prospect_domain: string | null;
  source_url: string;
  status: LbLinkRow["status"];
  reason: string;
  anchor: string | null;
  rel: string[];
  target_url: string | null;
  http_status: number | null;
  checks: number;
  last_checked_at: string | null;
  first_active_at: string | null;
  lost_at: string | null;
  created_at: string;
};
const iso = (d: string | null) => (d ? new Date(d).toISOString() : null);

export async function listLinks(projectId: string): Promise<LbLinkRow[]> {
  const rows = await query<LinkDb>("SELECT * FROM bl_lb_links WHERE project_id=$1 ORDER BY created_at DESC", [projectId]);
  return rows.map((r) => ({
    id: r.id,
    prospectDomain: r.prospect_domain,
    sourceUrl: r.source_url,
    status: r.status,
    reason: r.reason,
    anchor: r.anchor,
    rel: r.rel ?? [],
    targetUrl: r.target_url,
    httpStatus: r.http_status,
    checks: r.checks,
    lastCheckedAt: iso(r.last_checked_at),
    firstActiveAt: iso(r.first_active_at),
    lostAt: iso(r.lost_at),
    createdAt: iso(r.created_at)!,
  }));
}

export async function startVerification(ownerId: string, projectId: string, linkIds?: string[]) {
  const running = await latestJob(projectId, VERIFY_JOB);
  if (running && (running.status === "queued" || running.status === "running") && !linkIds) return running.id;
  const job = await enqueue({ kind: VERIFY_JOB, ownerId, projectId, payload: linkIds ? { linkIds } : {}, dedupeKey: `${VERIFY_JOB}:${projectId}:${Date.now()}` });
  return job.id;
}

export async function addLink(ownerId: string, projectId: string, input: { sourceUrl: string; prospectDomain?: string | null }) {
  const project = await getProject(ownerId, projectId);
  let url: string;
  try {
    const raw = input.sourceUrl.trim();
    url = safeUrl(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    const host = new URL(url).hostname;
    if (!host.includes(".") || /^[\d.]+$/.test(host) || host.startsWith("[")) throw new Error("bad host");
  } catch {
    throw new AppError("Enter the full URL of the page that links to you, e.g. https://example.com/article.");
  }
  if (matchesDomain(url, project.domain)) throw new AppError(`That page is on ${project.domain} itself. Enter the external page that links to your site.`);
  const [{ count }] = await query<{ count: number }>("SELECT count(*)::int AS count FROM bl_lb_links WHERE project_id=$1", [projectId]);
  if (count >= 500) throw new AppError("You can monitor up to 500 links per project.");
  const id = randomUUID();
  const inserted = await query(
    "INSERT INTO bl_lb_links(id, project_id, prospect_domain, source_url) VALUES($1,$2,$3,$4) ON CONFLICT(project_id, source_url) DO NOTHING RETURNING id",
    [id, projectId, input.prospectDomain?.trim().toLowerCase() || null, url],
  );
  if (!inserted.length) throw new AppError("This link is already monitored.");
  if (input.prospectDomain) await query("UPDATE bl_lb_prospects SET status='acquired', updated_at=now() WHERE project_id=$1 AND domain=$2", [projectId, input.prospectDomain.trim().toLowerCase()]);
  const existing = await getSchedule(projectId, VERIFY_JOB);
  if (!existing) await setSchedule(projectId, VERIFY_JOB, { cadence: "daily" });
  const jobId = await startVerification(ownerId, projectId, [id]);
  return { id, jobId };
}

export async function removeLink(ownerId: string, projectId: string, id: string) {
  await getProject(ownerId, projectId);
  const deleted = await query("DELETE FROM bl_lb_links WHERE project_id=$1 AND id=$2 RETURNING id", [projectId, id]);
  if (!deleted.length) throw new AppError("Link not found.", 404);
}

export async function verifySchedule(projectId: string) {
  return getSchedule(projectId, VERIFY_JOB);
}
