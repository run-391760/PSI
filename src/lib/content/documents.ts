import { randomUUID } from "node:crypto";
import { z } from "zod";
import { query } from "@/lib/db";
import { AppError, database, normalizeKeyword } from "@/lib/domain";
import { benchmark, semanticTerms } from "./benchmark";

export type Tone = "casual" | "neutral" | "formal";
export type DocSettings = {
  targetWords: number;
  targetReadability: number;
  tone: Tone;
  recommended: string[];
  db: string;
  /** Where the targets came from (shown in the UI). */
  origin?: "template" | "manual";
  /** True when targets were derived from the demo engine's top-10 benchmark. */
  demoTargets?: boolean;
};
export type DocSummary = { id: string; title: string; keywords: string[]; words: number; score: number; created_at: string; updated_at: string };
export type Doc = DocSummary & { body: string; settings: DocSettings };

export const MAX_BODY = 200_000;
export const docPatch = z.object({
  title: z.string().trim().max(200, "Title is too long.").optional(),
  body: z.string().max(MAX_BODY, "The document is too long (200,000 characters max).").optional(),
  keywords: z.array(z.string().trim().min(1).max(100)).max(10, "Use at most 10 target keywords.").optional(),
  settings: z
    .object({
      targetWords: z.number().int().min(0).max(20000),
      targetReadability: z.number().min(0).max(100),
      tone: z.enum(["casual", "neutral", "formal"]),
      recommended: z.array(z.string().trim().min(1).max(80)).max(40),
      db: z.string().max(4),
      origin: z.enum(["template", "manual"]).optional(),
      demoTargets: z.boolean().optional(),
    })
    .optional(),
  words: z.number().int().min(0).max(1_000_000).optional(),
  score: z.number().min(0).max(10).optional(),
});
export type DocPatch = z.infer<typeof docPatch>;

const toNum = (d: { score: unknown; created_at: unknown; updated_at: unknown }) => ({ ...d, score: Number(d.score), created_at: new Date(d.created_at as string).toISOString(), updated_at: new Date(d.updated_at as string).toISOString() });

export async function listDocuments(ownerId: string) {
  const rows = await query<DocSummary>("SELECT id,title,keywords,words,score,created_at,updated_at FROM content_documents WHERE owner_id=$1 ORDER BY updated_at DESC", [ownerId]);
  return rows.map(toNum) as DocSummary[];
}
export async function getDocument(ownerId: string, id: string) {
  const [row] = await query<Doc>("SELECT * FROM content_documents WHERE id=$1 AND owner_id=$2", [id, ownerId]);
  if (!row) throw new AppError("Document not found.", 404);
  return toNum(row) as Doc;
}
export async function findDocument(ownerId: string, id: string) {
  try {
    return await getDocument(ownerId, id);
  } catch {
    return null;
  }
}

/** Targets for a set of keywords from the (demo) top-10 benchmark of the first keyword. */
export function targetsFor(keywords: string[], dbInput: string): DocSettings {
  const db = database(dbInput).code;
  if (!keywords.length) return { targetWords: 1000, targetReadability: 60, tone: "neutral", recommended: [], db, origin: "manual", demoTargets: false };
  const b = benchmark(keywords[0], db, null);
  const intent = b.metrics.intents[0];
  return {
    targetWords: b.avg.words,
    targetReadability: b.avg.readability,
    tone: intent === "transactional" ? "casual" : "neutral",
    recommended: (keywords.length > 1 ? semanticTerms(keywords.slice(0, 5), db, b.rivals, 20) : b.semantic).slice(0, 15).map((s) => s.term),
    db,
    origin: "manual",
    demoTargets: true,
  };
}

export async function createDocument(ownerId: string, input: { title?: string; keywords?: string[]; body?: string; db?: string; settings?: Partial<DocSettings> }) {
  const [{ count }] = await query<{ count: number }>("SELECT count(*)::int AS count FROM content_documents WHERE owner_id=$1", [ownerId]);
  if (count >= 500) throw new AppError("You can keep up to 500 documents. Delete some to create new ones.");
  const keywords = [...new Set((input.keywords ?? []).map(normalizeKeyword).filter(Boolean))].slice(0, 10);
  const settings: DocSettings = { ...targetsFor(keywords, input.db ?? "US"), ...input.settings };
  const parsed = docPatch.parse({ title: input.title?.trim() || (keywords[0] ? `Article: ${keywords[0]}` : "Untitled document"), body: input.body ?? "", keywords, settings });
  const id = randomUUID();
  await query("INSERT INTO content_documents(id,owner_id,title,body,keywords,settings) VALUES($1,$2,$3,$4,$5::jsonb,$6::jsonb)", [
    id,
    ownerId,
    parsed.title,
    parsed.body,
    JSON.stringify(parsed.keywords),
    JSON.stringify(parsed.settings),
  ]);
  return id;
}

export async function updateDocument(ownerId: string, id: string, raw: DocPatch) {
  const p = docPatch.parse(raw);
  if (p.keywords) p.keywords = [...new Set(p.keywords.map(normalizeKeyword).filter(Boolean))];
  const rows = await query<{ updated_at: string }>(
    `UPDATE content_documents SET
       title=COALESCE($3,title), body=COALESCE($4,body), keywords=COALESCE($5::jsonb,keywords), settings=COALESCE($6::jsonb,settings),
       words=COALESCE($7,words), score=COALESCE($8,score), updated_at=now()
     WHERE id=$1 AND owner_id=$2 RETURNING updated_at`,
    [id, ownerId, p.title === undefined ? null : p.title || "Untitled document", p.body ?? null, p.keywords ? JSON.stringify(p.keywords) : null, p.settings ? JSON.stringify(p.settings) : null, p.words ?? null, p.score ?? null],
  );
  if (!rows.length) throw new AppError("Document not found.", 404);
  return new Date(rows[0].updated_at).toISOString();
}

export async function deleteDocument(ownerId: string, id: string) {
  const rows = await query("DELETE FROM content_documents WHERE id=$1 AND owner_id=$2 RETURNING id", [id, ownerId]);
  if (!rows.length) throw new AppError("Document not found.", 404);
}

export async function duplicateDocument(ownerId: string, id: string) {
  const d = await getDocument(ownerId, id);
  const newId = randomUUID();
  await query("INSERT INTO content_documents(id,owner_id,title,body,keywords,settings,words,score) VALUES($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7,$8)", [
    newId,
    ownerId,
    `${d.title} (copy)`.slice(0, 200),
    d.body,
    JSON.stringify(d.keywords),
    JSON.stringify(d.settings),
    d.words,
    d.score,
  ]);
  return newId;
}
