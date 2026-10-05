import type { AiReview } from "./types";

/** A Claude review stays in use while the body is unchanged or within 20% of the reviewed length. */
export function aiFresh(ai: AiReview | null, body: string) {
  if (!ai) return false;
  if (ai.bodyHash === bodyHash(body)) return true;
  return !!ai.bodyLength && Math.abs(body.length - ai.bodyLength) / ai.bodyLength < 0.2;
}

export function bodyHash(body: string) {
  let h = 2166136261;
  for (let i = 0; i < body.length; i++) h = Math.imul(h ^ body.charCodeAt(i), 16777619);
  return (h >>> 0).toString(16);
}
