import { randomUUID } from "node:crypto";
import { z } from "zod";
import { query } from "@/lib/db";
import { AppError, DB_CODES, rootDomain } from "@/lib/domain";
import { getProject } from "@/lib/projects";
import { iso } from "./platform";
import { demoAllowed, providerStatus } from "@/lib/data-mode";
import { ACCENTS, type Availability, sectionAvailable, TEMPLATES, templateAvailable, templateById, type ReportRecord } from "./templates";

/** Which report sources are connected on this server. */
export function reportAvailability(): Availability {
  const st = providerStatus();
  return { dataforseo: st.dataforseo, google: st.google, demo: demoAllowed() };
}

/** Saved reports (My Reports). Server-only. */

export const reportInput = z.object({
  template: z.enum(["domain", "project", "backlinks", "comparison"]),
  title: z.string().trim().min(1, "Give the report a title.").max(140),
  subject: z.string().trim().max(255).default(""),
  db: z.enum(DB_CODES).default("US"),
  project_id: z.string().trim().max(64).nullable().default(null),
  competitors: z.array(z.string().trim().max(255)).max(4, "Compare with at most 4 competitors.").default([]),
  sections: z.array(z.string().trim().max(40)).min(1, "Choose at least one section.").max(20),
  branding: z
    .object({
      company: z.string().trim().max(80).default(""),
      preparedFor: z.string().trim().max(80).default(""),
      accent: z.enum(ACCENTS.map((a) => a.id) as [string, ...string[]]).default("indigo"),
      intro: z.string().trim().max(1500).default(""),
    })
    .default({ company: "", preparedFor: "", accent: "indigo", intro: "" }),
});
export type ReportInput = z.input<typeof reportInput>;

const SELECT = `SELECT r.id, r.template, r.title, r.subject, r.db, r.project_id, p.name AS project_name, r.options, r.sections, r.branding,
  r.created_at, r.updated_at FROM reports r LEFT JOIN projects p ON p.id=r.project_id`;

/** Validate + normalize: project reports take domain/db from the project; domain reports need a valid domain. */
async function normalize(ownerId: string, raw: ReportInput) {
  const input = reportInput.parse(raw);
  const template = templateById(input.template)!;
  const available = reportAvailability();
  if (!templateAvailable(template, available)) throw new AppError(`${template.name} needs DataForSEO, which is not connected on this server.`);
  const allowed = new Set(template.sections.filter((s) => sectionAvailable(template, s, available)).map((s) => s.id));
  const sections = [...new Set(input.sections)].filter((s) => allowed.has(s));
  if (!sections.length) throw new AppError("Choose at least one section that has a connected data source.");
  let subject = input.subject;
  let db: string = input.db;
  let projectId: string | null = input.project_id || null;
  if (projectId) {
    const project = await getProject(ownerId, projectId);
    if (template.subject === "project" || !subject) {
      subject = project.domain;
      db = project.country;
    }
  } else if (template.subject === "project") throw new AppError("Choose a project for this report.");
  if (template.subject === "domain") {
    if (!subject) throw new AppError("Enter a domain for this report.");
    subject = rootDomain(subject);
  }
  const competitors = template.competitors ? [...new Set(input.competitors.filter(Boolean).map(rootDomain))].filter((c) => c !== subject).slice(0, 4) : [];
  if (template.competitors && !competitors.length) throw new AppError("Add at least one competitor to compare with.");
  return { input, sections, subject, db, projectId, competitors };
}

const clean = (r: ReportRecord): ReportRecord => ({ ...r, created_at: iso(r.created_at), updated_at: iso(r.updated_at), options: r.options ?? {}, sections: r.sections ?? [], branding: { ...BRANDING_DEFAULTS, ...((r.branding ?? {}) as Partial<ReportRecord["branding"]>) } });
const BRANDING_DEFAULTS: ReportRecord["branding"] = { company: "", preparedFor: "", accent: "indigo", intro: "" };

export async function listReports(ownerId: string) {
  const rows = await query<ReportRecord>(`${SELECT} WHERE r.owner_id=$1 ORDER BY r.updated_at DESC`, [ownerId]);
  return rows.map(clean);
}

export async function getReport(ownerId: string, id: string) {
  const row = await findReport(ownerId, id);
  if (!row) throw new AppError("Report not found.", 404);
  return row;
}
export async function findReport(ownerId: string, id: string) {
  const [row] = await query<ReportRecord>(`${SELECT} WHERE r.id=$1 AND r.owner_id=$2`, [id, ownerId]);
  return row ? clean(row) : null;
}

export async function createReport(ownerId: string, raw: ReportInput) {
  const n = await normalize(ownerId, raw);
  const [{ count }] = await query<{ count: number }>("SELECT count(*)::int AS count FROM reports WHERE owner_id=$1", [ownerId]);
  if (count >= 200) throw new AppError("You can keep up to 200 reports. Delete some to create more.", 409);
  const id = randomUUID();
  await query(
    `INSERT INTO reports(id,owner_id,project_id,template,title,subject,db,options,sections,branding)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10::jsonb)`,
    [id, ownerId, n.projectId, n.input.template, n.input.title, n.subject, n.db, JSON.stringify({ competitors: n.competitors }), JSON.stringify(n.sections), JSON.stringify(n.input.branding)],
  );
  return id;
}

export async function updateReport(ownerId: string, id: string, raw: ReportInput) {
  await getReport(ownerId, id);
  const n = await normalize(ownerId, raw);
  await query(
    `UPDATE reports SET project_id=$3, template=$4, title=$5, subject=$6, db=$7, options=$8::jsonb, sections=$9::jsonb, branding=$10::jsonb, updated_at=now()
     WHERE id=$1 AND owner_id=$2`,
    [id, ownerId, n.projectId, n.input.template, n.input.title, n.subject, n.db, JSON.stringify({ competitors: n.competitors }), JSON.stringify(n.sections), JSON.stringify(n.input.branding)],
  );
}

export async function duplicateReport(ownerId: string, id: string) {
  const r = await getReport(ownerId, id);
  const copy = randomUUID();
  await query(
    `INSERT INTO reports(id,owner_id,project_id,template,title,subject,db,options,sections,branding)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10::jsonb)`,
    [copy, ownerId, r.project_id, r.template, `${r.title} (copy)`.slice(0, 140), r.subject, r.db, JSON.stringify(r.options), JSON.stringify(r.sections), JSON.stringify(r.branding)],
  );
  return copy;
}

export async function deleteReport(ownerId: string, id: string) {
  const rows = await query("DELETE FROM reports WHERE id=$1 AND owner_id=$2 RETURNING id", [id, ownerId]);
  if (!rows.length) throw new AppError("Report not found.", 404);
}

export { TEMPLATES };
