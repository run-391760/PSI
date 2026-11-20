import { normalizeKeyword } from "@/lib/domain";

/** Parse keywords from legacy Content Template links before redirecting to Content Planning. */
export function parseTemplateKeywords(q: string) {
  return [...new Set(q.split(/[,\n;]+/).map(normalizeKeyword).filter((k) => k.length >= 2 && k.length <= 100 && /\p{L}/u.test(k)))].slice(0, 5);
}
