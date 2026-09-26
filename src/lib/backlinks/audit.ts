import { randomUUID } from "node:crypto";
import { query } from "@/lib/db";
import { AppError, database } from "@/lib/domain";
import { enqueue, getSchedule, latestJob, notify, setSchedule } from "@/lib/jobs/queue";
import type { JobContext, JobRow } from "@/lib/jobs/types";
import { getProject, type Project } from "@/lib/projects";
import { liveEnabled } from "@/lib/providers/source";
import { SPAM_TLDS } from "@/lib/seo/engine/vocab";
import { overallScore, scoreProfile, toxicClass, type ScoredDomain } from "./audit-score";
import * as live from "./live";
import { POTENTIAL_MIN, TOXIC_MIN, type AuditDomainRow, type AuditList, type AuditRunRow, type RemoveStatus } from "./types";

export const AUDIT_JOB = "backlinks.audit";

export type AuditSettings = { brandTerms: string[]; country: string; weekly: boolean; createdAt: string; updatedAt: string };

export async function getAuditSettings(projectId: string): Promise<AuditSettings | null> {
  const [row] = await query<{ brand_terms: string[]; country: string; weekly: boolean; created_at: string; updated_at: string }>(
    "SELECT brand_terms, country, weekly, created_at, updated_at FROM bl_audit_settings WHERE project_id=$1",
    [projectId],
  );
  return row ? { brandTerms: row.brand_terms ?? [], country: row.country, weekly: row.weekly, createdAt: String(row.created_at), updatedAt: String(row.updated_at) } : null;
}

export function normalizeBrandTerms(input: string[]) {
  const terms = [...new Set(input.map((t) => t.trim().replace(/\s+/g, " ")).filter(Boolean))];
  if (terms.length > 20) throw new AppError("Add at most 20 brand terms.");
  if (terms.some((t) => t.length > 80)) throw new AppError("Brand terms can be at most 80 characters.");
  return terms;
}

/** Saves the audit setup, (re)schedules the weekly audit and enqueues a run. Returns the job id. */
export async function saveAuditSettings(ownerId: string, projectId: string, input: { brandTerms: string[]; country: string; weekly: boolean }) {
  await getProject(ownerId, projectId);
  const brandTerms = normalizeBrandTerms(input.brandTerms);
  const country = database(input.country).code;
  await query(
    `INSERT INTO bl_audit_settings(project_id, brand_terms, country, weekly) VALUES($1,$2::jsonb,$3,$4)
     ON CONFLICT(project_id) DO UPDATE SET brand_terms=excluded.brand_terms, country=excluded.country, weekly=excluded.weekly, updated_at=now()`,
    [projectId, JSON.stringify(brandTerms), country, input.weekly],
  );
  await setSchedule(projectId, AUDIT_JOB, { cadence: "weekly", enabled: input.weekly });
  return startAudit(ownerId, projectId, "setup");
}

export async function startAudit(ownerId: string, projectId: string, trigger: "setup" | "manual") {
  await getProject(ownerId, projectId);
  const running = await latestJob(projectId, AUDIT_JOB);
  if (running && (running.status === "queued" || running.status === "running")) return running.id;
  const job = await enqueue({ kind: AUDIT_JOB, ownerId, projectId, payload: { trigger }, dedupeKey: `${AUDIT_JOB}:${projectId}:${Date.now()}` });
  return job.id;
}

/* ------------------------------------------------------------------------------------------------
 * Reads
 * ---------------------------------------------------------------------------------------------- */

type DomainDbRow = {
  domain: string;
  toxicity: number;
  markers: string[];
  authority_score: number;
  backlinks: number;
  country: string;
  ip: string;
  category: string;
  follow: boolean;
  first_seen: string;
  last_seen: string;
  sample_url: string;
  sample_anchor: string;
  first_audit_id: string | null;
  list: AuditList | null;
  contact: string | null;
  status: RemoveStatus | null;
  note: string | null;
  listed_at: string | null;
};

export async function listAuditDomains(projectId: string, latestRunId: string | null): Promise<AuditDomainRow[]> {
  const rows = await query<DomainDbRow>(
    `SELECT d.domain, d.toxicity, d.markers, d.authority_score, d.backlinks, d.country, d.ip, d.category, d.follow, d.first_seen, d.last_seen,
            d.sample_url, d.sample_anchor, d.first_audit_id, l.list, l.contact, l.status, l.note, l.updated_at AS listed_at
     FROM bl_audit_domains d LEFT JOIN bl_audit_lists l ON l.project_id=d.project_id AND l.domain=d.domain
     WHERE d.project_id=$1 ORDER BY d.toxicity DESC, d.authority_score ASC`,
    [projectId],
  );
  return rows.map((r) => ({
    domain: r.domain,
    toxicity: r.toxicity,
    markers: r.markers ?? [],
    authorityScore: r.authority_score,
    backlinks: r.backlinks,
    country: r.country,
    ip: r.ip,
    category: r.category,
    follow: r.follow,
    firstSeen: r.first_seen,
    lastSeen: r.last_seen,
    sampleUrl: r.sample_url,
    sampleAnchor: r.sample_anchor,
    isNew: !!latestRunId && r.first_audit_id === latestRunId,
    list: r.list,
    contact: r.contact ?? "",
    status: r.status ?? "not_sent",
    note: r.note ?? "",
    listedAt: r.listed_at ? new Date(r.listed_at).toISOString() : null,
  }));
}

/** List entries whose domain is no longer in the latest audit (they stay listed until restored). */
export async function listOrphanListEntries(projectId: string): Promise<AuditDomainRow[]> {
  const rows = await query<{ domain: string; list: AuditList; contact: string; status: RemoveStatus; note: string; updated_at: string }>(
    `SELECT l.domain, l.list, l.contact, l.status, l.note, l.updated_at FROM bl_audit_lists l
     WHERE l.project_id=$1 AND NOT EXISTS (SELECT 1 FROM bl_audit_domains d WHERE d.project_id=l.project_id AND d.domain=l.domain)`,
    [projectId],
  );
  return rows.map((r) => ({
    domain: r.domain,
    toxicity: 0,
    markers: ["Not in latest audit"],
    authorityScore: 0,
    backlinks: 0,
    country: "",
    ip: "",
    category: "",
    follow: false,
    firstSeen: "",
    lastSeen: "",
    sampleUrl: `https://${r.domain}/`,
    sampleAnchor: "",
    isNew: false,
    list: r.list,
    contact: r.contact,
    status: r.status,
    note: r.note,
    listedAt: new Date(r.updated_at).toISOString(),
  }));
}

type RunDbRow = {
  id: string;
  trigger: string;
  analyzed: number;
  backlinks: number;
  toxic: number;
  potentially_toxic: number;
  non_toxic: number;
  toxic_score: number;
  level: AuditRunRow["level"];
  new_toxic: number;
  created_at: string;
  source: string;
};
const toRun = (r: RunDbRow): AuditRunRow & { source: string } => ({
  id: r.id,
  trigger: r.trigger,
  analyzed: r.analyzed,
  backlinks: r.backlinks,
  toxic: r.toxic,
  potentiallyToxic: r.potentially_toxic,
  nonToxic: r.non_toxic,
  toxicScore: r.toxic_score,
  level: r.level,
  newToxic: r.new_toxic,
  createdAt: new Date(r.created_at).toISOString(),
  source: r.source,
});

export async function listAuditRuns(projectId: string, limit = 52) {
  const rows = await query<RunDbRow>("SELECT * FROM bl_audit_runs WHERE project_id=$1 ORDER BY created_at DESC LIMIT $2", [projectId, limit]);
  return rows.map(toRun);
}

/** Current effective stats: whitelisted and disavowed domains no longer count as toxic. */
export function effectiveStats(rows: AuditDomainRow[]) {
  const counted = rows.filter((r) => r.list !== "whitelist" && r.list !== "disavow");
  let toxic = 0;
  let potentially = 0;
  for (const r of counted) {
    const c = toxicClass(r.toxicity);
    if (c === "toxic") toxic++;
    else if (c === "potentially") potentially++;
  }
  const { score, level } = overallScore(toxic, potentially, rows.length);
  return { analyzed: rows.length, toxic, potentially, nonToxic: rows.length - toxic - potentially, score, level };
}

/* ------------------------------------------------------------------------------------------------
 * Mutations
 * ---------------------------------------------------------------------------------------------- */

export async function setDomainsList(ownerId: string, projectId: string, domains: string[], list: AuditList | null) {
  await getProject(ownerId, projectId);
  const clean = [...new Set(domains.map((d) => String(d).trim().toLowerCase()).filter((d) => /^[a-z0-9.-]{3,253}$/.test(d)))].slice(0, 1000);
  if (!clean.length) throw new AppError("Select at least one domain.");
  if (list === null) {
    await query("DELETE FROM bl_audit_lists WHERE project_id=$1 AND domain = ANY($2::text[])", [projectId, clean]);
    return clean.length;
  }
  await query(
    `INSERT INTO bl_audit_lists(project_id, domain, list) SELECT $1, d, $3 FROM unnest($2::text[]) AS d
     ON CONFLICT(project_id, domain) DO UPDATE SET list=excluded.list, updated_at=now()`,
    [projectId, clean, list],
  );
  return clean.length;
}

export async function updateRemoveEntry(ownerId: string, projectId: string, domain: string, patch: { contact?: string; status?: RemoveStatus; note?: string }) {
  await getProject(ownerId, projectId);
  const contact = patch.contact?.trim() ?? null;
  if (contact && (contact.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact))) throw new AppError("Enter a valid contact email address.");
  if (patch.note && patch.note.length > 2000) throw new AppError("Notes can be at most 2,000 characters.");
  const updated = await query(
    `UPDATE bl_audit_lists SET contact=COALESCE($3, contact), status=COALESCE($4, status), note=COALESCE($5, note), updated_at=now()
     WHERE project_id=$1 AND domain=$2 RETURNING domain`,
    [projectId, domain, contact, patch.status ?? null, patch.note ?? null],
  );
  if (!updated.length) throw new AppError("That domain is not in the removal list.", 404);
}

/* ------------------------------------------------------------------------------------------------
 * Disavow file
 * ---------------------------------------------------------------------------------------------- */

export async function disavowText(project: Project) {
  const rows = await query<{ domain: string; toxicity: number | null; markers: string[] | null; updated_at: string }>(
    `SELECT l.domain, d.toxicity, d.markers, l.updated_at FROM bl_audit_lists l
     LEFT JOIN bl_audit_domains d ON d.project_id=l.project_id AND d.domain=l.domain
     WHERE l.project_id=$1 AND l.list='disavow' ORDER BY d.toxicity DESC NULLS LAST, l.domain`,
    [project.id],
  );
  const lines = [
    `# Disavow file for ${project.domain}`,
    `# Generated by SynapseSEO Backlink Audit on ${new Date().toISOString().slice(0, 10)}`,
    `# ${rows.length} domain${rows.length === 1 ? "" : "s"}. Upload at https://search.google.com/search-console/disavow-links`,
    "",
  ];
  for (const r of rows) {
    const why = r.markers?.length ? ` — ${r.markers.slice(0, 3).join(", ")}` : "";
    lines.push(`# Toxicity ${r.toxicity ?? "n/a"}${why}`);
    lines.push(`domain:${r.domain}`);
  }
  return { text: `${lines.join("\n")}\n`, count: rows.length };
}

/* ------------------------------------------------------------------------------------------------
 * Job
 * ---------------------------------------------------------------------------------------------- */

async function liveScored(ownerId: string, domain: string): Promise<{ rows: ScoredDomain[]; backlinksAnalyzed: number }> {
  const items = await live.auditDomains(ownerId, domain);
  const rows = items.map((d) => {
    const markers: string[] = [];
    if (d.spamScore >= 60) markers.push("Spam in domain name");
    if (SPAM_TLDS.some((t) => d.domain.endsWith(t))) markers.push("Suspicious TLD");
    if (d.authorityScore < 5) markers.push("Low Authority Score");
    if (d.backlinks > 200) markers.push("Sitewide link");
    return {
      domain: d.domain,
      toxicity: Math.max(0, Math.min(100, Math.round(d.spamScore))),
      markers,
      authority_score: d.authorityScore,
      backlinks: d.backlinks,
      country: "",
      ip: "",
      category: "",
      follow: d.follow,
      first_seen: d.firstSeen,
      last_seen: d.lastSeen,
      sample_url: `https://${d.domain}/`,
      sample_anchor: "",
    };
  });
  return { rows, backlinksAnalyzed: rows.reduce((s, r) => s + r.backlinks, 0) };
}

export async function runAuditJob(job: JobRow, ctx: JobContext) {
  if (!job.project_id || !job.owner_id) throw new Error("Audit job without a project.");
  const project = await getProject(job.owner_id, job.project_id);
  const settings = (await getAuditSettings(project.id)) ?? { brandTerms: project.brand_terms ?? [], country: project.country, weekly: true, createdAt: "", updatedAt: "" };
  const trigger = job.payload?.scheduled ? "scheduled" : String(job.payload?.trigger ?? "manual");
  const source = liveEnabled() ? "dataforseo" : "demo";

  await ctx.progress(0, 5, "Collecting referring domains");
  const { rows, backlinksAnalyzed } = source === "demo" ? scoreProfile(project.domain, settings) : await liveScored(job.owner_id, project.domain);
  await ctx.progress(1, 5, `Scoring ${rows.length.toLocaleString()} referring domains`);
  if (await ctx.cancelled()) return { cancelled: true };

  const [prevRun] = await query<{ id: string }>("SELECT id FROM bl_audit_runs WHERE project_id=$1 ORDER BY created_at DESC LIMIT 1", [project.id]);
  const prevToxic = new Set((await query<{ domain: string }>("SELECT domain FROM bl_audit_domains WHERE project_id=$1 AND toxicity >= $2", [project.id, TOXIC_MIN])).map((r) => r.domain));
  const lists = new Map((await query<{ domain: string; list: AuditList }>("SELECT domain, list FROM bl_audit_lists WHERE project_id=$1", [project.id])).map((r) => [r.domain, r.list]));
  const runId = randomUUID();

  const chunk = 150;
  for (let i = 0; i < rows.length; i += chunk) {
    const part = rows.slice(i, i + chunk);
    await query(
      `INSERT INTO bl_audit_domains(project_id, domain, toxicity, markers, authority_score, backlinks, country, ip, category, follow, first_seen, last_seen, sample_url, sample_anchor, first_audit_id, last_audit_id)
       SELECT $1, x.domain, x.toxicity, x.markers, x.authority_score, x.backlinks, x.country, x.ip, x.category, x.follow, x.first_seen, x.last_seen, x.sample_url, x.sample_anchor, $2, $2
       FROM jsonb_to_recordset($3::jsonb) AS x(domain text, toxicity int, markers jsonb, authority_score int, backlinks int, country text, ip text, category text, follow boolean, first_seen text, last_seen text, sample_url text, sample_anchor text)
       ON CONFLICT(project_id, domain) DO UPDATE SET toxicity=excluded.toxicity, markers=excluded.markers, authority_score=excluded.authority_score, backlinks=excluded.backlinks,
         country=excluded.country, ip=excluded.ip, category=excluded.category, follow=excluded.follow, first_seen=excluded.first_seen, last_seen=excluded.last_seen,
         sample_url=excluded.sample_url, sample_anchor=excluded.sample_anchor, last_audit_id=excluded.last_audit_id`,
      [project.id, runId, JSON.stringify(part)],
    );
    await ctx.progress(1 + Math.round(((i + part.length) / rows.length) * 2), 5, `Saved ${Math.min(rows.length, i + chunk).toLocaleString()} of ${rows.length.toLocaleString()} domains`);
  }
  await query("DELETE FROM bl_audit_domains WHERE project_id=$1 AND last_audit_id IS DISTINCT FROM $2", [project.id, runId]);
  await ctx.progress(4, 5, "Comparing with the previous audit");

  let toxic = 0;
  let potentially = 0;
  const dist = Array.from({ length: 10 }, () => 0);
  const markerCounts = new Map<string, number>();
  const newToxic: string[] = [];
  for (const r of rows) {
    dist[Math.min(9, Math.floor(r.toxicity / 10))]++;
    for (const m of r.markers) markerCounts.set(m, (markerCounts.get(m) ?? 0) + 1);
    const list = lists.get(r.domain);
    if (list === "whitelist" || list === "disavow") continue;
    const c = toxicClass(r.toxicity);
    if (c === "toxic") {
      toxic++;
      if (prevRun && !prevToxic.has(r.domain)) newToxic.push(r.domain);
    } else if (c === "potentially") potentially++;
  }
  const { score, level } = overallScore(toxic, potentially, rows.length);
  await query(
    `INSERT INTO bl_audit_runs(id, project_id, job_id, trigger, analyzed, backlinks, toxic, potentially_toxic, non_toxic, toxic_score, level, new_toxic, distribution, markers, source)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,$14::jsonb,$15)`,
    [runId, project.id, job.id, trigger, rows.length, backlinksAnalyzed, toxic, potentially, rows.length - toxic - potentially, score, level, newToxic.length, JSON.stringify(dist), JSON.stringify([...markerCounts.entries()].sort((a, b) => b[1] - a[1])), source],
  );

  const link = `/backlink-audit?project=${project.id}&tab=audit`;
  if (!prevRun)
    await notify({
      ownerId: job.owner_id,
      projectId: project.id,
      tool: "backlink-audit",
      severity: toxic ? "warning" : "success",
      title: `Backlink Audit ready for ${project.domain}`,
      body: `${rows.length.toLocaleString()} referring domains analyzed: ${toxic} toxic, ${potentially} potentially toxic. Overall toxic score ${score} (${level}).`,
      link,
    });
  else if (newToxic.length)
    await notify({
      ownerId: job.owner_id,
      projectId: project.id,
      tool: "backlink-audit",
      severity: "warning",
      title: `${newToxic.length} new toxic domain${newToxic.length === 1 ? "" : "s"} linking to ${project.domain}`,
      body: `${newToxic.slice(0, 5).join(", ")}${newToxic.length > 5 ? ` and ${newToxic.length - 5} more` : ""}. Review them and add to your disavow list if needed.`,
      link,
    });
  await ctx.progress(5, 5, "Audit complete");
  return { runId, analyzed: rows.length, toxic, potentiallyToxic: potentially, newToxic: newToxic.length, toxicScore: score, level, source };
}

export async function auditSchedule(projectId: string) {
  return getSchedule(projectId, AUDIT_JOB);
}

export { POTENTIAL_MIN, TOXIC_MIN };

/** Latest audit run per project (for the project gate and dashboards). */
export async function latestRunsByProject(projectIds: string[]) {
  if (!projectIds.length) return new Map<string, AuditRunRow & { source: string }>();
  const rows = await query<RunDbRow & { project_id: string }>(
    "SELECT DISTINCT ON (project_id) * FROM bl_audit_runs WHERE project_id = ANY($1::text[]) ORDER BY project_id, created_at DESC",
    [projectIds],
  );
  return new Map(rows.map((r) => [r.project_id, toRun(r)]));
}
