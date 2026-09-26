import { tryRootDomain } from "@/lib/domain";
import { rng, round } from "@/lib/seo/engine";

/** Maximum number of domains compared side by side (Keyword Gap, Backlink Gap, Traffic compare). */
export const MAX_COMPARE = 5;

/** First string value of a search param. */
export function spStr(v: string | string[] | undefined): string {
  return (Array.isArray(v) ? v[0] : v) ?? "";
}

/** All values of a repeated search param; comma-separated values are split too. */
export function spList(v: string | string[] | undefined): string[] {
  const list = Array.isArray(v) ? v : v ? [v] : [];
  return list
    .flatMap((x) => x.split(/[,\s]+/))
    .map((x) => x.trim())
    .filter(Boolean);
}

/**
 * Normalizes a list of user-entered domains: root domains, de-duplicated, at most `max`.
 * Entries that are not valid domains are returned in `invalid`.
 */
export function parseDomains(values: string[], max = MAX_COMPARE) {
  const domains: string[] = [];
  const invalid: string[] = [];
  for (const v of values) {
    const d = tryRootDomain(v);
    if (!d) invalid.push(v);
    else if (!domains.includes(d)) domains.push(d);
  }
  return { domains: domains.slice(0, max), invalid, truncated: domains.length > max };
}

/** Month keys (YYYY-MM) of the last `count` months ending with the current month. */
export function recentMonths(count = 12, now = new Date()) {
  const out: string[] = [];
  for (let i = count - 1; i >= 0; i--) out.push(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1)).toISOString().slice(0, 7));
  return out;
}

/** Percent change a → b (b is the newer value). */
export const changePct = (older: number | null | undefined, newer: number | null | undefined) =>
  older ? round((((newer ?? 0) - older) / older) * 100, 1) : 0;

/** Deterministic small percent delta for demo metrics that have no history in the engine. */
export function demoDelta(key: string, spread = 6) {
  return round(rng(`delta:${key}`).normal(0, spread / 2), 1);
}
