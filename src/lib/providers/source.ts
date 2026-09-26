import { query } from "@/lib/db";

import type { DataSource, Sourced } from "./labels";
export { SOURCE_LABELS, type DataSource, type Sourced } from "./labels";

export function demo<T>(data: T, note?: string): Sourced<T> {
  return { data, source: "demo", fetchedAt: new Date().toISOString(), live: false, note };
}
export function sourced<T>(data: T, source: DataSource, note?: string): Sourced<T> {
  return { data, source, fetchedAt: new Date().toISOString(), live: source !== "demo", note };
}

/** DataForSEO credentials present → paid live data is available. */
export function liveEnabled() {
  return Boolean(process.env.DATAFORSEO_LOGIN && process.env.DATAFORSEO_PASSWORD);
}
export const flagEnabled = (name: "ENABLE_AUTOCOMPLETE" | "ENABLE_PAGESPEED" | "ENABLE_NEWS_MENTIONS") =>
  process.env[name] !== "false";

/**
 * Read-through cache in provider_cache. Use for every paid or rate-limited external call so the same
 * question is not paid for twice within `ttlHours`.
 */
export async function cached<T>(key: string, source: DataSource, ttlHours: number, fetcher: () => Promise<T>): Promise<Sourced<T>> {
  const [hit] = await query<{ payload: T; fetched_at: Date }>(
    "SELECT payload, fetched_at FROM provider_cache WHERE key=$1 AND expires_at>now()",
    [key],
  );
  if (hit) return { data: hit.payload, source, fetchedAt: new Date(hit.fetched_at).toISOString(), live: source !== "demo" };
  const data = await fetcher();
  await query(
    `INSERT INTO provider_cache(key,source,payload,fetched_at,expires_at) VALUES($1,$2,$3::jsonb,now(),now()+($4 * interval '1 hour'))
     ON CONFLICT(key) DO UPDATE SET payload=excluded.payload, source=excluded.source, fetched_at=now(), expires_at=excluded.expires_at`,
    [key, source, JSON.stringify(data), ttlHours],
  );
  return { data, source, fetchedAt: new Date().toISOString(), live: source !== "demo" };
}
