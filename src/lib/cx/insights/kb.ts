import { randomUUID } from "node:crypto";
import { z } from "zod";
import { query } from "@/lib/db";
import { AppError } from "@/lib/domain";

/** Internal knowledge base (T1, T2): categories/subcategories, articles, search, and AI grounding. */
export type KbCategory = { id: string; parent_id: string | null; name: string; position: number; articles: number };
export type KbArticle = { id: string; category_id: string | null; category: string | null; title: string; body: string; tags: string[]; status: "draft" | "published"; views: number; author: string | null; created_at: string; updated_at: string };
export type KbHit = { id: string; title: string; snippet: string; score: number; category: string | null; url: string };

export const articleInput = z.object({
  title: z.string().trim().min(1, "Title is required").max(200),
  body: z.string().trim().min(1, "Write the article").max(50000),
  category_id: z.string().max(64).nullable().default(null),
  tags: z.array(z.string().trim().toLowerCase().min(1).max(40)).max(20).default([]),
  status: z.enum(["draft", "published"]).default("published"),
});

export async function listCategories(projectId: string) {
  return query<KbCategory>(
    "SELECT c.id,c.parent_id,c.name,c.position,(SELECT count(*)::int FROM cx_kb_articles a WHERE a.category_id=c.id) AS articles FROM cx_kb_categories c WHERE c.project_id=$1 ORDER BY c.position,c.name",
    [projectId],
  );
}
export async function saveCategory(projectId: string, input: { id?: string; name: string; parent_id?: string | null }) {
  const name = input.name.trim().slice(0, 100);
  if (!name) throw new AppError("Name is required.", 400);
  if (input.parent_id) {
    const [p] = await query<{ parent_id: string | null }>("SELECT parent_id FROM cx_kb_categories WHERE id=$1 AND project_id=$2", [input.parent_id, projectId]);
    if (!p) throw new AppError("Parent category not found.", 404);
    if (p.parent_id) throw new AppError("Subcategories can't have their own subcategories.", 400);
    if (input.id && input.parent_id === input.id) throw new AppError("A category can't be its own parent.", 400);
  }
  if (input.id) {
    await query("UPDATE cx_kb_categories SET name=$3,parent_id=$4 WHERE id=$1 AND project_id=$2", [input.id, projectId, name, input.parent_id || null]);
    return input.id;
  }
  const id = randomUUID();
  await query("INSERT INTO cx_kb_categories(id,project_id,parent_id,name,position) VALUES($1,$2,$3,$4,(SELECT COALESCE(max(position),0)+1 FROM cx_kb_categories WHERE project_id=$2))", [id, projectId, input.parent_id || null, name]);
  return id;
}
export async function deleteCategory(projectId: string, id: string) {
  await query("DELETE FROM cx_kb_categories WHERE id=$1 AND project_id=$2", [id, projectId]);
}

const ASELECT = `SELECT a.id,a.category_id,c.name AS category,a.title,a.body,a.tags,a.status,a.views,COALESCE(NULLIF(u.name,''),u.email) AS author,a.created_at,a.updated_at
  FROM cx_kb_articles a LEFT JOIN cx_kb_categories c ON c.id=a.category_id LEFT JOIN users u ON u.id=a.created_by`;

export async function listArticles(projectId: string) {
  return query<KbArticle>(`${ASELECT} WHERE a.project_id=$1 ORDER BY a.updated_at DESC LIMIT 2000`, [projectId]);
}
export async function getArticle(projectId: string, id: string) {
  const [a] = await query<KbArticle>(`${ASELECT} WHERE a.id=$1 AND a.project_id=$2`, [id, projectId]);
  if (!a) throw new AppError("Article not found.", 404);
  return a;
}
export async function saveArticle(projectId: string, userId: string, raw: z.input<typeof articleInput>, id?: string) {
  const a = articleInput.parse(raw);
  if (a.category_id) {
    const [c] = await query("SELECT 1 FROM cx_kb_categories WHERE id=$1 AND project_id=$2", [a.category_id, projectId]);
    if (!c) throw new AppError("Category not found.", 404);
  }
  if (id) {
    await getArticle(projectId, id);
    await query("UPDATE cx_kb_articles SET title=$3,body=$4,category_id=$5,tags=$6,status=$7,updated_at=now() WHERE id=$1 AND project_id=$2", [id, projectId, a.title, a.body, a.category_id, JSON.stringify(a.tags), a.status]);
    return id;
  }
  const nid = randomUUID();
  await query("INSERT INTO cx_kb_articles(id,project_id,category_id,title,body,tags,status,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8)", [nid, projectId, a.category_id, a.title, a.body, JSON.stringify(a.tags), a.status, userId]);
  return nid;
}
export async function deleteArticle(projectId: string, id: string) {
  await query("DELETE FROM cx_kb_articles WHERE id=$1 AND project_id=$2", [id, projectId]);
}
export async function countView(projectId: string, id: string) {
  await query("UPDATE cx_kb_articles SET views=views+1 WHERE id=$1 AND project_id=$2", [id, projectId]);
}

// ------------------------------------------------------------- search (pure ranking, unit-tested)

const STOP = new Set("a an and are as at be by can do does for from has have how i in is it its my of on or our please that the this to we what when where which why will with you your".split(" "));
export function tokens(s: string) {
  return (s.toLowerCase().normalize("NFKD").match(/[\p{L}\p{N}]+/gu) ?? []).filter((w) => w.length > 1 && !STOP.has(w)).map((w) => (w.length > 4 ? w.replace(/(ing|ed|es|s)$/, "") : w));
}

/**
 * BM25 ranking over title (weight 3), tags (2) and body (1). Returns the best `limit` hits with a
 * snippet around the first matched term.
 */
export function rankArticles(q: string, docs: { id: string; title: string; body: string; tags?: string[]; category?: string | null }[], limit = 5) {
  const qt = [...new Set(tokens(q))];
  if (!qt.length || !docs.length) return [];
  const toks = docs.map((d) => ({ d, t: [...tokens(d.title), ...tokens(d.title), ...tokens(d.title), ...(d.tags ?? []).flatMap((x) => [...tokens(x), ...tokens(x)]), ...tokens(d.body)] }));
  const avg = toks.reduce((s, x) => s + x.t.length, 0) / toks.length || 1;
  const df = new Map(qt.map((w) => [w, toks.filter((x) => x.t.includes(w)).length]));
  const N = docs.length, k1 = 1.2, b = 0.75;
  const scored = toks.map(({ d, t }) => {
    let score = 0;
    for (const w of qt) {
      const f = t.filter((x) => x === w).length;
      if (!f) continue;
      const n = df.get(w) ?? 0;
      const idf = Math.log(1 + (N - n + 0.5) / (n + 0.5));
      score += idf * ((f * (k1 + 1)) / (f + k1 * (1 - b + (b * t.length) / avg)));
    }
    return { d, score };
  });
  return scored
    .filter((x) => x.score > 0)
    .sort((a, b2) => b2.score - a.score)
    .slice(0, limit)
    .map(({ d, score }) => {
      const body = d.body.replace(/\s+/g, " ");
      const lower = body.toLowerCase();
      const at = Math.max(0, Math.min(...qt.map((w) => lower.indexOf(w)).filter((i) => i >= 0), body.length));
      const start = at >= body.length ? 0 : Math.max(0, at - 60);
      return { id: d.id, title: d.title, category: d.category ?? null, score: Math.round(score * 100) / 100, snippet: (start ? "…" : "") + body.slice(start, start + 220) + (body.length > start + 220 ? "…" : "") };
    });
}

/**
 * Knowledge-base search for other packages (e.g. AI reply grounding in the inbox):
 *   const hits = await searchKb(projectId, "refund after 30 days", 3);
 * → [{ id, title, snippet, score, category, url }] over published articles; [] when nothing matches.
 */
export async function searchKb(projectId: string, q: string, limit = 5): Promise<KbHit[]> {
  const docs = await query<{ id: string; title: string; body: string; tags: string[]; category: string | null }>(
    "SELECT a.id,a.title,a.body,a.tags,c.name AS category FROM cx_kb_articles a LEFT JOIN cx_kb_categories c ON c.id=a.category_id WHERE a.project_id=$1 AND a.status='published' LIMIT 3000",
    [projectId],
  );
  return rankArticles(q, docs, limit).map((h) => ({ ...h, url: `/cx/knowledge?brand=${projectId}&article=${h.id}` }));
}

/** Full text of articles (for grounding prompts), capped per article. */
export async function articleTexts(projectId: string, ids: string[], cap = 3000) {
  if (!ids.length) return [];
  const rows = await query<{ id: string; title: string; body: string }>("SELECT id,title,body FROM cx_kb_articles WHERE project_id=$1 AND id = ANY($2)", [projectId, ids]);
  return ids.flatMap((id) => rows.filter((r) => r.id === id)).map((r) => ({ ...r, body: r.body.slice(0, cap) }));
}
