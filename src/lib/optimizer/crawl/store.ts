import "server-only";
import { query } from "@/lib/db";
import { AppError } from "@/lib/domain";
import type { CrawlListItem, CrawlRecord, CrawlStatus, CrawlSummary, PageResult, Skip } from "./types";

/** Stored live crawls (opt_crawls): the last 20 per user, reopened and replayed without the network. */

const KEEP = 20;

type Row = { id: string; start_url: string; domain: string; status: CrawlStatus; max_pages: number; pages: PageResult[]; skips: Skip[]; summary: CrawlSummary | null; created_at: string | Date; finished_at: string | Date | null };
const iso = (v: string | Date | null) => (v == null ? null : new Date(v).toISOString());

export async function saveCrawl(ownerId: string, c: Omit<CrawlRecord, "createdAt" | "finishedAt"> & { startedAt: string }) {
  await query(
    `INSERT INTO opt_crawls(id,owner_id,start_url,domain,status,max_pages,pages,skips,summary,created_at,finished_at)
     VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9::jsonb,$10,now())
     ON CONFLICT(id) DO UPDATE SET status=excluded.status, pages=excluded.pages, skips=excluded.skips, summary=excluded.summary, finished_at=now()`,
    [c.id, ownerId, c.startUrl, c.domain, c.status, c.maxPages, JSON.stringify(c.pages), JSON.stringify(c.skips), c.summary ? JSON.stringify(c.summary) : null, c.startedAt],
  );
  await query(`DELETE FROM opt_crawls WHERE owner_id=$1 AND id NOT IN (SELECT id FROM opt_crawls WHERE owner_id=$1 ORDER BY created_at DESC LIMIT ${KEEP})`, [ownerId]);
}

export async function listCrawls(ownerId: string): Promise<CrawlListItem[]> {
  const rows = await query<{ id: string; start_url: string; domain: string; status: CrawlStatus; summary: CrawlSummary | null; created_at: string | Date; finished_at: string | Date | null }>(
    "SELECT id,start_url,domain,status,summary,created_at,finished_at FROM opt_crawls WHERE owner_id=$1 ORDER BY created_at DESC LIMIT $2",
    [ownerId, KEEP],
  );
  return rows.map((r) => ({
    id: r.id,
    startUrl: r.start_url,
    domain: r.domain,
    status: r.status,
    createdAt: iso(r.created_at)!,
    finishedAt: iso(r.finished_at),
    pages: r.summary?.pages ?? 0,
    flags: r.summary?.flags ?? 0,
    avgScore: r.summary?.avgScore ?? null,
  }));
}

export async function getCrawl(ownerId: string, id: string): Promise<CrawlRecord> {
  const [r] = await query<Row>("SELECT * FROM opt_crawls WHERE id=$1 AND owner_id=$2", [id, ownerId]);
  if (!r) throw new AppError("Crawl not found.", 404);
  return { id: r.id, startUrl: r.start_url, domain: r.domain, status: r.status, maxPages: r.max_pages, pages: r.pages ?? [], skips: r.skips ?? [], summary: r.summary, createdAt: iso(r.created_at)!, finishedAt: iso(r.finished_at) };
}

export async function deleteCrawl(ownerId: string, id: string) {
  await query("DELETE FROM opt_crawls WHERE id=$1 AND owner_id=$2", [id, ownerId]);
}
