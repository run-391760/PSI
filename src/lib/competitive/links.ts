/** Client-safe URL helpers shared by the competitive research tools. */

/** Keyword Strategy Builder import link (another module reads ?import=). */
export function keywordListHref(keywords: string[], db: string) {
  const list = [...new Set(keywords)].slice(0, 300);
  return `/keyword-strategy?import=${encodeURIComponent(list.join(","))}&db=${encodeURIComponent(db)}`;
}

/** Tool URL with repeated `d` params (Keyword Gap / Backlink Gap). */
export function compareHref(path: string, domains: string[], extra: Record<string, string | undefined> = {}) {
  const p = new URLSearchParams();
  for (const d of domains) p.append("d", d);
  for (const [k, v] of Object.entries(extra)) if (v) p.set(k, v);
  return `${path}?${p.toString()}`;
}

export function toolHref(path: string, params: Record<string, string | undefined>) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) p.set(k, v);
  const s = p.toString();
  return s ? `${path}?${s}` : path;
}
