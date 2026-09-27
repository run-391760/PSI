/** Pure mapping of DataForSEO SERP items (client/test safe, no server imports). */

export type LiveSerpItem = { position: number; url: string; title: string; domain: string };

/** Organic results of a DataForSEO `serp/google/organic/live/regular` task, in rank order. */
export function mapDfsSerpItems(items: unknown): LiveSerpItem[] {
  if (!Array.isArray(items)) return [];
  return (items as Record<string, unknown>[])
    .filter((it) => it && it.type === "organic" && it.url)
    .map((it) => ({
      position: Number(it.rank_group ?? 0),
      url: String(it.url ?? ""),
      title: String(it.title ?? ""),
      domain: String(it.domain ?? "").replace(/^www\./, ""),
    }))
    .sort((a, b) => a.position - b.position);
}

/** Top-10 URL and domain sets for SERP-overlap clustering. */
export function top10Sets(items: LiveSerpItem[]) {
  const top = items.filter((r) => r.position >= 1 && r.position <= 10);
  return { urls: new Set(top.map((r) => r.url)), domains: new Set(top.map((r) => r.domain)) };
}

/** Removes the " | Brand" / " - Brand" tail of a SERP title (the domain is shown separately). */
export const cleanTitle = (t: string) => t.replace(/\s+[|–-]\s+[^|–-]+$/, "").trim();
