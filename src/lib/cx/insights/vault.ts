import { randomUUID } from "node:crypto";
import { inflateRawSync } from "node:zlib";
import * as cheerio from "cheerio";
import { query, transaction } from "@/lib/db";
import { AppError } from "@/lib/domain";
import { rankArticles, searchKb, type KbHit } from "./kb";

/**
 * Knowledge vault: the brand's own internal material (prospectus, fee rules, placement reports, FAQs,
 * policies) that the AI assistant answers from. Stored as text split into passages; searched with the
 * same BM25 ranking as the knowledge base. Published KB articles are searched alongside (not copied).
 */

export const VAULT_LIMITS = { fileBytes: 10 * 1024 * 1024, docChars: 400_000, docs: 300 } as const;
export const VAULT_TYPES = ".txt, .md, .csv, .html, .docx";

// ------------------------------------------------------------------ text extraction

/** Text of `word/document.xml` inside a .docx (zip) — paragraphs and table cells, no formatting. */
export function docxText(buf: Buffer): string {
  // End of central directory: signature 0x06054b50 within the last 64 KiB.
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65_557); i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new AppError("This .docx file could not be read (not a valid Word document).");
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  for (let n = 0; n < count && p + 46 <= buf.length; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break;
    const method = buf.readUInt16LE(p + 10);
    const size = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString("utf8", p + 46, p + 46 + nameLen);
    if (name === "word/document.xml") {
      const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
      const raw = buf.subarray(start, start + size);
      const xml = (method === 8 ? inflateRawSync(raw) : raw).toString("utf8");
      return xml
        .replace(/<w:tab\/>/g, "\t")
        .replace(/<\/w:p>|<w:br\/>/g, "\n")
        .replace(/<\/w:tc>/g, " | ")
        .replace(/<[^>]+>/g, "")
        .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'");
    }
    p += 46 + nameLen + extraLen + commentLen;
  }
  throw new AppError("This .docx file has no document text.");
}

export function extractText(filename: string, bytes: Buffer): string {
  const ext = filename.toLowerCase().split(".").pop() ?? "";
  if (ext === "docx") return docxText(bytes);
  if (ext === "pdf") throw new AppError("PDF is not supported yet: open it, copy the text and use “Paste text”, or save it as .docx.");
  if (!["txt", "md", "markdown", "csv", "html", "htm"].includes(ext)) throw new AppError(`Unsupported file type. Use ${VAULT_TYPES}.`);
  const text = bytes.toString("utf8");
  if (ext === "html" || ext === "htm") {
    const $ = cheerio.load(text);
    $("script,style,noscript").remove();
    return $("body").text() || $.root().text();
  }
  return text;
}

export const cleanText = (s: string) => s.replace(/\r\n?/g, "\n").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();

/** Split into ~1,200-character passages on paragraph boundaries (long paragraphs are cut on sentences). */
export function chunkText(text: string, size = 1200): string[] {
  const paras = cleanText(text).split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  const pieces = paras.flatMap((p) => (p.length <= size ? [p] : p.match(new RegExp(`[\\s\\S]{1,${size}}(?:[.!?](?=\\s)|$)|[\\s\\S]{1,${size}}`, "g")) ?? [p]));
  const out: string[] = [];
  let cur = "";
  for (const piece of pieces) {
    if (cur && cur.length + piece.length + 2 > size) {
      out.push(cur);
      cur = "";
    }
    cur = cur ? `${cur}\n\n${piece}` : piece;
  }
  if (cur) out.push(cur);
  return out.map((c) => c.trim()).filter((c) => c.length > 20 || out.length === 1);
}

// ------------------------------------------------------------------ storage

export type VaultDoc = { id: string; title: string; filename: string | null; chars: number; chunks: number; created_at: string; author: string | null };

export async function listVault(projectId: string) {
  return query<VaultDoc>(
    `SELECT d.id, d.title, d.filename, d.chars, d.created_at, COALESCE(NULLIF(u.name,''),u.email) author,
       (SELECT count(*)::int FROM cx_assistant_chunks c WHERE c.doc_id=d.id) chunks
     FROM cx_assistant_docs d LEFT JOIN users u ON u.id=d.created_by WHERE d.project_id=$1 ORDER BY d.created_at DESC`,
    [projectId],
  );
}

export async function addVaultDoc(projectId: string, userId: string, input: { title: string; text: string; filename?: string | null }) {
  const title = input.title.trim().slice(0, 160);
  if (!title) throw new AppError("Give the document a title.");
  const text = cleanText(input.text);
  if (text.length < 20) throw new AppError("The document has no readable text.");
  if (text.length > VAULT_LIMITS.docChars) throw new AppError(`The document is too long (${Math.round(text.length / 1000)}k characters; max ${VAULT_LIMITS.docChars / 1000}k). Split it into parts.`);
  const chunks = chunkText(text);
  const id = randomUUID();
  await transaction(async (q) => {
    const [{ n }] = await q<{ n: number }>("SELECT count(*)::int n FROM cx_assistant_docs WHERE project_id=$1", [projectId]);
    if (n >= VAULT_LIMITS.docs) throw new AppError(`The vault holds up to ${VAULT_LIMITS.docs} documents. Delete old ones first.`);
    await q("INSERT INTO cx_assistant_docs(id,project_id,title,filename,chars,created_by) VALUES($1,$2,$3,$4,$5,$6)", [id, projectId, title, input.filename ?? null, text.length, userId]);
    for (let i = 0; i < chunks.length; i++) await q("INSERT INTO cx_assistant_chunks(id,doc_id,project_id,position,body) VALUES($1,$2,$3,$4,$5)", [randomUUID(), id, projectId, i, chunks[i]]);
  });
  return { id, chunks: chunks.length };
}

export async function deleteVaultDoc(projectId: string, id: string) {
  await query("DELETE FROM cx_assistant_docs WHERE id=$1 AND project_id=$2", [id, projectId]);
}

// ------------------------------------------------------------------ search

export type VaultHit = { kind: "vault" | "kb"; id: string; title: string; text: string; url: string | null; score: number };

/** Best passages from the vault plus published knowledge-base articles for a question. */
export async function searchKnowledge(projectId: string, q: string, limit = 6): Promise<VaultHit[]> {
  const rows = await query<{ id: string; doc_id: string; title: string; body: string }>(
    "SELECT c.id, c.doc_id, d.title, c.body FROM cx_assistant_chunks c JOIN cx_assistant_docs d ON d.id=c.doc_id WHERE c.project_id=$1 LIMIT 20000",
    [projectId],
  );
  const byId = new Map(rows.map((r) => [r.id, r]));
  const vault = rankArticles(q, rows.map((r) => ({ id: r.id, title: r.title, body: r.body })), limit).map((h) => {
    const r = byId.get(h.id)!;
    return { kind: "vault" as const, id: r.doc_id, title: r.title, text: r.body, url: null, score: h.score };
  });
  const kb: KbHit[] = await searchKb(projectId, q, 3);
  const kbHits = kb.map((h) => ({ kind: "kb" as const, id: h.id, title: h.title, text: h.snippet, url: h.url, score: h.score }));
  return [...vault, ...kbHits].sort((a, b) => b.score - a.score).slice(0, limit);
}
