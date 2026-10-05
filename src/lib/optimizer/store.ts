import { randomUUID } from "node:crypto";
import { z } from "zod";
import { query } from "@/lib/db";
import { AppError, normalizeKeyword } from "@/lib/domain";
import { analyze, summarize } from "./analyze";
import type { OtherDraft } from "./context";
import { aiFresh } from "./hash";
export { aiFresh, bodyHash } from "./hash";
import type { AiReview, Brief, Draft, DraftInput, DraftMeta, LinkCheck, LiveCheck, Report, ReportSummary, Research, ResearchBundle } from "./types";

/** Drafts, revisions (change history) and research of the optimizer. Server-only. */

export const MAX_BODY = 200_000;
const MAX_DRAFTS = 500;
const MAX_REVISIONS = 200;

const person = z.object({ name: z.string().trim().max(120).optional(), bio: z.string().trim().max(1500).optional(), credentials: z.string().trim().max(200).optional(), url: z.string().trim().max(500).optional() });
export const metaSchema = z.object({
  db: z.string().max(4).optional(),
  pageType: z.enum(["blog", "guide", "how-to", "listicle", "comparison", "review", "landing", "news", "course"]).optional(),
  funnel: z.enum(["awareness", "consideration", "decision"]).optional(),
  author: person.optional(),
  organization: z.object({ name: z.string().trim().max(160).optional(), url: z.string().trim().max(500).optional(), logo: z.string().trim().max(500).optional() }).optional(),
  publishedAt: z.string().max(40).optional(),
  modifiedAt: z.string().max(40).optional(),
  canonical: z.string().trim().max(500).optional(),
  robots: z.string().trim().max(120).optional(),
  featuredImage: z.string().trim().max(1000).optional(),
  cta: z.object({ text: z.string().trim().max(120).optional(), url: z.string().trim().max(500).optional() }).optional(),
  competitors: z.array(z.string().trim().max(500)).max(10).optional(),
  sitePages: z.array(z.object({ url: z.string().max(500), title: z.string().max(300) })).max(500).optional(),
  sitemapUrl: z.string().trim().max(500).optional(),
  schema: z.string().max(60_000).optional(),
  checklist: z.record(z.string().max(80), z.boolean()).optional(),
  brief: z.any().optional(),
});

export const draftPatch = z.object({
  title: z.string().max(300).optional(),
  keyword: z.string().max(120).optional(),
  keywords: z.array(z.string().trim().min(1).max(120)).max(10).optional(),
  metaDescription: z.string().max(400).optional(),
  slug: z.string().max(200).optional(),
  url: z.string().max(500).optional(),
  body: z.string().max(MAX_BODY, "The draft is too long (200,000 characters max).").optional(),
  meta: metaSchema.partial().optional(),
});
export type DraftPatch = z.infer<typeof draftPatch>;

type Row = {
  id: string;
  title: string;
  keyword: string;
  keywords: string[];
  meta_description: string;
  slug: string;
  url: string;
  body: string;
  meta: DraftMeta;
  status: "draft" | "published";
  score: string | null;
  baseline_score: string | null;
  summary: ReportSummary | Record<string, never>;
  created_at: string;
  updated_at: string;
  published_at: string | null;
};

const iso = (v: string | Date | null) => (v ? new Date(v).toISOString() : null);
const num = (v: string | null) => (v == null ? null : Number(v));

function toDraft(r: Row): Draft {
  return {
    id: r.id,
    title: r.title,
    keyword: r.keyword,
    keywords: r.keywords ?? [],
    metaDescription: r.meta_description,
    slug: r.slug,
    url: r.url,
    body: r.body,
    meta: r.meta ?? {},
    status: r.status,
    score: num(r.score),
    baselineScore: num(r.baseline_score),
    createdAt: iso(r.created_at)!,
    updatedAt: iso(r.updated_at)!,
    publishedAt: iso(r.published_at),
  };
}

export const inputOf = (d: Draft): DraftInput => ({ title: d.title, keyword: d.keyword, keywords: d.keywords, metaDescription: d.metaDescription, slug: d.slug, url: d.url, body: d.body, meta: d.meta });

export type DraftListItem = { id: string; title: string; keyword: string; status: Draft["status"]; score: number | null; baselineScore: number | null; summary: Partial<ReportSummary>; updatedAt: string; words: number };

export async function listDrafts(ownerId: string): Promise<DraftListItem[]> {
  const rows = await query<{ id: string; title: string; keyword: string; status: Draft["status"]; score: string | null; baseline_score: string | null; summary: Partial<ReportSummary>; updated_at: string; words: number }>(
    "SELECT id,title,keyword,status,score,baseline_score,summary,updated_at,array_length(regexp_split_to_array(trim(body),'\\s+'),1) AS words FROM opt_drafts WHERE owner_id=$1 ORDER BY updated_at DESC",
    [ownerId],
  );
  return rows.map((r) => ({ id: r.id, title: r.title, keyword: r.keyword, status: r.status, score: num(r.score), baselineScore: num(r.baseline_score), summary: r.summary ?? {}, updatedAt: iso(r.updated_at)!, words: Number(r.words ?? 0) }));
}

export async function getDraft(ownerId: string, id: string): Promise<Draft> {
  const [row] = await query<Row>("SELECT * FROM opt_drafts WHERE id=$1 AND owner_id=$2", [id, ownerId]);
  if (!row) throw new AppError("Draft not found.", 404);
  return toDraft(row);
}

export async function findDraft(ownerId: string, id: string | null | undefined) {
  if (!id) return null;
  try {
    return await getDraft(ownerId, id);
  } catch {
    return null;
  }
}

export async function otherDrafts(ownerId: string, exceptId: string): Promise<OtherDraft[]> {
  return query<OtherDraft>("SELECT id,title,keyword,slug,url FROM opt_drafts WHERE owner_id=$1 AND id<>$2 ORDER BY updated_at DESC LIMIT 300", [ownerId, exceptId]);
}

export async function getBundle(draftId: string): Promise<ResearchBundle> {
  const [r] = await query<{ research: Research | null; ai: AiReview | null; links: LinkCheck | null; live: LiveCheck | null }>("SELECT research,ai,links,live FROM opt_research WHERE draft_id=$1", [draftId]);
  return { research: r?.research ?? null, ai: r?.ai ?? null, links: r?.links ?? null, live: r?.live ?? null };
}

export async function saveBundle(draftId: string, patch: Partial<ResearchBundle>) {
  const cols = Object.keys(patch) as (keyof ResearchBundle)[];
  if (!cols.length) return;
  const vals = cols.map((c) => JSON.stringify(patch[c] ?? null));
  await query(
    `INSERT INTO opt_research(draft_id,${cols.join(",")},updated_at) VALUES($1,${cols.map((_, i) => `$${i + 2}::jsonb`).join(",")},now())
     ON CONFLICT(draft_id) DO UPDATE SET ${cols.map((c) => `${c}=excluded.${c}`).join(",")},updated_at=now()`,
    [draftId, ...vals],
  );
}

/** Analyze a stored draft with its research and the owner's other drafts. */
export async function reportFor(ownerId: string, draft: Draft, bundle?: ResearchBundle): Promise<Report> {
  const [b, others] = await Promise.all([bundle ? Promise.resolve(bundle) : getBundle(draft.id), otherDrafts(ownerId, draft.id)]);
  return analyze(inputOf(draft), { ...b, ai: aiFresh(b.ai, draft.body) ? b.ai : null, others });
}

async function persistScore(draftId: string, report: Report) {
  const summary = summarize(report);
  await query("UPDATE opt_drafts SET score=$2, summary=$3::jsonb, baseline_score=COALESCE(baseline_score,$2) WHERE id=$1", [draftId, report.overall, JSON.stringify(summary)]);
  return summary;
}

export async function addRevision(ownerId: string, draft: Draft, note: string, kind: "create" | "edit" | "fix" | "restore" | "publish" | "research", report?: Report) {
  const r = report ?? (await reportFor(ownerId, draft));
  const summary = await persistScore(draft.id, r);
  await query("INSERT INTO opt_revisions(id,draft_id,note,kind,snapshot,score,summary) VALUES($1,$2,$3,$4,$5::jsonb,$6,$7::jsonb)", [randomUUID(), draft.id, note.slice(0, 300), kind, JSON.stringify(inputOf(draft)), r.overall, JSON.stringify(summary)]);
  await query("DELETE FROM opt_revisions WHERE draft_id=$1 AND id NOT IN (SELECT id FROM opt_revisions WHERE draft_id=$1 ORDER BY created_at DESC LIMIT $2)", [draft.id, MAX_REVISIONS]);
  return r;
}

export type Revision = { id: string; note: string; kind: string; score: number | null; summary: Partial<ReportSummary>; createdAt: string };

export async function listRevisions(ownerId: string, draftId: string): Promise<Revision[]> {
  const rows = await query<{ id: string; note: string; kind: string; score: string | null; summary: Partial<ReportSummary>; created_at: string }>(
    "SELECT r.id,r.note,r.kind,r.score,r.summary,r.created_at FROM opt_revisions r JOIN opt_drafts d ON d.id=r.draft_id WHERE r.draft_id=$1 AND d.owner_id=$2 ORDER BY r.created_at ASC",
    [draftId, ownerId],
  );
  return rows.map((r) => ({ id: r.id, note: r.note, kind: r.kind, score: num(r.score), summary: r.summary ?? {}, createdAt: iso(r.created_at)! }));
}

export async function revisionSnapshot(ownerId: string, draftId: string, revisionId: string): Promise<DraftInput> {
  const [row] = await query<{ snapshot: DraftInput }>("SELECT r.snapshot FROM opt_revisions r JOIN opt_drafts d ON d.id=r.draft_id WHERE r.id=$1 AND r.draft_id=$2 AND d.owner_id=$3", [revisionId, draftId, ownerId]);
  if (!row) throw new AppError("Revision not found.", 404);
  return row.snapshot;
}

export async function createDraft(ownerId: string, input: Partial<DraftInput> & { brief?: Brief | null }): Promise<Draft> {
  const [{ count }] = await query<{ count: number }>("SELECT count(*)::int AS count FROM opt_drafts WHERE owner_id=$1", [ownerId]);
  if (count >= MAX_DRAFTS) throw new AppError(`You can keep up to ${MAX_DRAFTS} drafts. Delete some first.`);
  const p = draftPatch.parse({ ...input, meta: { ...(input.meta ?? {}), ...(input.brief ? { brief: input.brief } : {}) } });
  const id = randomUUID();
  await query(
    "INSERT INTO opt_drafts(id,owner_id,title,keyword,keywords,meta_description,slug,url,body,meta) VALUES($1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9,$10::jsonb)",
    [id, ownerId, p.title?.trim() ?? "", normalizeKeyword(p.keyword ?? ""), JSON.stringify(p.keywords ?? []), p.metaDescription ?? "", p.slug ?? "", p.url ?? "", p.body ?? "", JSON.stringify(p.meta ?? {})],
  );
  const draft = await getDraft(ownerId, id);
  await addRevision(ownerId, draft, "Draft created", "create");
  return getDraft(ownerId, id);
}

/** Save fields. Returns the fresh draft and its report (scores are persisted). */
export async function updateDraft(ownerId: string, id: string, raw: DraftPatch, revision?: { note: string; kind: "edit" | "fix" | "restore" | "publish" | "research" }) {
  const p = draftPatch.parse(raw);
  const cur = await getDraft(ownerId, id);
  const meta = p.meta ? { ...cur.meta, ...p.meta } : cur.meta;
  await query(
    `UPDATE opt_drafts SET title=$3, keyword=$4, keywords=$5::jsonb, meta_description=$6, slug=$7, url=$8, body=$9, meta=$10::jsonb, updated_at=now() WHERE id=$1 AND owner_id=$2`,
    [
      id,
      ownerId,
      p.title ?? cur.title,
      p.keyword !== undefined ? normalizeKeyword(p.keyword) : cur.keyword,
      JSON.stringify(p.keywords ?? cur.keywords),
      p.metaDescription ?? cur.metaDescription,
      p.slug ?? cur.slug,
      p.url ?? cur.url,
      p.body ?? cur.body,
      JSON.stringify(meta),
    ],
  );
  const draft = await getDraft(ownerId, id);
  const report = await reportFor(ownerId, draft);
  if (revision) await addRevision(ownerId, draft, revision.note, revision.kind, report);
  else await persistScore(id, report);
  return { draft, report };
}

/** Autosaves don't create a revision every keystroke: keep one "Edited" revision per 10 minutes. */
export async function maybeEditRevision(ownerId: string, draft: Draft, report: Report) {
  const [last] = await query<{ kind: string; created_at: string }>("SELECT kind,created_at FROM opt_revisions WHERE draft_id=$1 ORDER BY created_at DESC LIMIT 1", [draft.id]);
  if (last && last.kind === "edit" && Date.now() - new Date(last.created_at).getTime() < 10 * 60_000) {
    await query("UPDATE opt_revisions SET snapshot=$2::jsonb, score=$3, summary=$4::jsonb, created_at=now() WHERE id=(SELECT id FROM opt_revisions WHERE draft_id=$1 ORDER BY created_at DESC LIMIT 1)", [draft.id, JSON.stringify(inputOf(draft)), report.overall, JSON.stringify(summarize(report))]);
    return;
  }
  await addRevision(ownerId, draft, "Edited the draft", "edit", report);
}

export async function deleteDraft(ownerId: string, id: string) {
  const rows = await query("DELETE FROM opt_drafts WHERE id=$1 AND owner_id=$2 RETURNING id", [id, ownerId]);
  if (!rows.length) throw new AppError("Draft not found.", 404);
}

export async function duplicateDraft(ownerId: string, id: string) {
  const d = await getDraft(ownerId, id);
  return createDraft(ownerId, { ...inputOf(d), title: `${d.title || "Untitled"} (copy)`.slice(0, 300) });
}

export async function setStatus(ownerId: string, id: string, status: "draft" | "published") {
  await query("UPDATE opt_drafts SET status=$3, published_at=CASE WHEN $3='published' THEN now() ELSE NULL END, updated_at=now() WHERE id=$1 AND owner_id=$2", [id, ownerId, status]);
}

// ------------------------------------------------------------------------------ briefs

export type BriefRow = { id: string; keyword: string; db: string; brief: Brief; draftId: string | null; createdAt: string };

export async function saveBrief(ownerId: string, brief: Brief) {
  const id = randomUUID();
  await query("INSERT INTO opt_briefs(id,owner_id,keyword,db,brief) VALUES($1,$2,$3,$4,$5::jsonb)", [id, ownerId, brief.keyword, brief.db, JSON.stringify(brief)]);
  await query("DELETE FROM opt_briefs WHERE owner_id=$1 AND id NOT IN (SELECT id FROM opt_briefs WHERE owner_id=$1 ORDER BY created_at DESC LIMIT 100)", [ownerId]);
  return id;
}

export async function listBriefs(ownerId: string): Promise<BriefRow[]> {
  const rows = await query<{ id: string; keyword: string; db: string; brief: Brief; draft_id: string | null; created_at: string }>("SELECT * FROM opt_briefs WHERE owner_id=$1 ORDER BY created_at DESC LIMIT 50", [ownerId]);
  return rows.map((r) => ({ id: r.id, keyword: r.keyword, db: r.db, brief: r.brief, draftId: r.draft_id, createdAt: iso(r.created_at)! }));
}

export async function getBrief(ownerId: string, id: string): Promise<BriefRow> {
  const [r] = await query<{ id: string; keyword: string; db: string; brief: Brief; draft_id: string | null; created_at: string }>("SELECT * FROM opt_briefs WHERE id=$1 AND owner_id=$2", [id, ownerId]);
  if (!r) throw new AppError("Brief not found.", 404);
  return { id: r.id, keyword: r.keyword, db: r.db, brief: r.brief, draftId: r.draft_id, createdAt: iso(r.created_at)! };
}

export async function linkBrief(ownerId: string, briefId: string, draftId: string) {
  await query("UPDATE opt_briefs SET draft_id=$3 WHERE id=$1 AND owner_id=$2", [briefId, ownerId, draftId]);
}
