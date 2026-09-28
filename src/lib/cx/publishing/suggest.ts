/**
 * Pure (client-safe) suggestion logic from the brand's own data: best time to post (weekday × hour
 * activity of tracked-link clicks, falling back to listening mention times) and hashtag suggestions
 * (listening hashtags + top terms, and hashtags from the brand's past posts weighted by clicks).
 */

export type Slot = { day: number; hour: number; share: number };
export const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** 168 buckets (UTC weekday × hour) from event times with optional weights. */
export function bucketUtc(events: { at: string | Date; weight?: number }[]): number[] {
  const b = new Array(168).fill(0);
  for (const e of events) {
    const d = new Date(e.at);
    if (Number.isNaN(d.getTime())) continue;
    b[d.getUTCDay() * 24 + d.getUTCHours()] += e.weight ?? 1;
  }
  return b;
}

/** Shift UTC buckets to local time (tzOffsetMinutes = Date#getTimezoneOffset, i.e. UTC − local). */
export function localBuckets(utc: number[], tzOffsetMinutes: number): number[] {
  const shift = Math.round(-tzOffsetMinutes / 60);
  const out = new Array(168).fill(0);
  utc.forEach((v, i) => (out[(((i + shift) % 168) + 168) % 168] += v));
  return out;
}

/** Top non-adjacent slots by a 3-hour smoothed score; null when there are fewer than `minTotal` events. */
export function topSlots(b: number[], n = 3, minTotal = 20): Slot[] | null {
  const total = b.reduce((s, v) => s + v, 0);
  if (total < minTotal) return null;
  const at = (i: number) => b[((i % 168) + 168) % 168];
  const score = b.map((_, i) => at(i - 1) * 0.5 + at(i) + at(i + 1) * 0.5);
  const order = score.map((s, i) => [s, i] as const).sort((a, c) => c[0] - a[0] || a[1] - c[1]);
  const out: Slot[] = [];
  for (const [s, i] of order) {
    if (out.length >= n || s <= 0) break;
    if (out.some((o) => Math.abs(o.day * 24 + o.hour - i) < 3 || 168 - Math.abs(o.day * 24 + o.hour - i) < 3)) continue;
    out.push({ day: Math.floor(i / 24), hour: i % 24, share: at(i) / total });
  }
  return out;
}

/** Next local occurrence (at least 15 minutes ahead) of a weekday/hour slot, as a `datetime-local` value. */
export function nextOccurrence(slot: { day: number; hour: number }, now: Date = new Date()): string {
  const d = new Date(now);
  d.setMinutes(0, 0, 0);
  d.setHours(slot.hour);
  let add = (slot.day - d.getDay() + 7) % 7;
  if (add === 0 && d.getTime() < now.getTime() + 15 * 60_000) add = 7;
  d.setDate(d.getDate() + add);
  const p = (x: number) => String(x).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:00`;
}

export const slotLabel = (s: { day: number; hour: number }) => `${DAY_NAMES[s.day]} ${new Date(2000, 0, 1, s.hour).toLocaleTimeString("en-US", { hour: "numeric" })}`;

// ================================================================= hashtags

const STOP = new Set(
  "about above after again against also among another because been before being below between both but came can cannot come could does doing done down during each even every from further have having here hers herself himself how however into itself just know like made make many more most much must myself never next only other ought ours ourselves over own same shall should some such than that their theirs them themselves then there these they this those through today under until very want well were what when where which while whom whose will with within without would year years your yours yourself yourselves http https www com amp new get got one two may said says the and for are was you not all any has had his her its our out who why now use via just still back first last good great really thing things people time".split(
    " ",
  ),
);
const TAG_RE = /(^|[^\p{L}\p{N}_&])#([\p{L}][\p{L}\p{N}_]{1,49})/gu;
export const hashtagsIn = (text: string) => [...text.replace(/https?:\/\/\S+/g, " ").matchAll(TAG_RE)].map((m) => m[2].toLowerCase());

export type HashtagSuggestion = { tag: string; score: number; count: number; source: "listening" | "listening terms" | "your posts" };

/**
 * Hashtag suggestions. Listening hashtags count once per mention; listening terms need ≥3 mentions;
 * past-post hashtags are weighted by their tracked clicks (+1). Terms that appear in the draft rank higher;
 * hashtags already in the draft and the brand's own name words are excluded.
 */
export function hashtagSuggestions(input: { mentions: string[]; posts: { text: string; clicks: number }[]; draft?: string; brand?: string; limit?: number }): HashtagSuggestion[] {
  const draft = (input.draft ?? "").toLowerCase();
  const used = new Set(hashtagsIn(input.draft ?? ""));
  const brandWords = new Set((input.brand ?? "").toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean));
  const map = new Map<string, HashtagSuggestion>();
  const add = (tag: string, score: number, source: HashtagSuggestion["source"]) => {
    if (used.has(tag) || tag.length < 3) return;
    const cur = map.get(tag);
    if (cur) {
      cur.score += score;
      cur.count += 1;
    } else map.set(tag, { tag, score, count: 1, source });
  };
  const terms = new Map<string, number>();
  for (const m of input.mentions) {
    for (const t of new Set(hashtagsIn(m))) add(t, 3, "listening");
    const words = new Set(
      m
        .replace(/https?:\/\/\S+/g, " ")
        .toLowerCase()
        .split(/[^\p{L}\p{N}]+/u)
        .filter((w) => w.length >= 4 && w.length <= 30 && !STOP.has(w) && !/^\d+$/.test(w) && !brandWords.has(w)),
    );
    for (const w of words) terms.set(w, (terms.get(w) ?? 0) + 1);
  }
  for (const [w, n] of terms) if (n >= 3 && !map.has(w)) map.set(w, { tag: w, score: n, count: n, source: "listening terms" });
  for (const p of input.posts) for (const t of new Set(hashtagsIn(p.text))) add(t, 2 + Math.log2(1 + p.clicks) * 2, "your posts");
  for (const s of map.values()) if (draft && new RegExp(`(^|[^\\p{L}])${s.tag}`, "u").test(draft)) s.score *= 2;
  return [...map.values()].filter((s) => !used.has(s.tag)).sort((a, b) => b.score - a.score || a.tag.localeCompare(b.tag)).slice(0, input.limit ?? 15);
}

// ================================================================= image crop presets

export type CropPreset = { id: string; label: string; w: number; h: number };
export const CROP_PRESETS: CropPreset[] = [
  { id: "ig-square", label: "Square 1:1 · 1080×1080", w: 1080, h: 1080 },
  { id: "ig-portrait", label: "Portrait 4:5 · 1080×1350", w: 1080, h: 1350 },
  { id: "story", label: "Story / reel 9:16 · 1080×1920", w: 1080, h: 1920 },
  { id: "link", label: "Link / feed 1.91:1 · 1200×628", w: 1200, h: 628 },
  { id: "x", label: "X 16:9 · 1600×900", w: 1600, h: 900 },
  { id: "yt-thumb", label: "YouTube thumbnail · 1280×720", w: 1280, h: 720 },
  { id: "gbp", label: "Business Profile 4:3 · 1200×900", w: 1200, h: 900 },
  { id: "pin", label: "Pin 2:3 · 1000×1500", w: 1000, h: 1500 },
];

/**
 * Crop rectangle (source pixels) for an aspect ratio: `zoom` 1 = the largest rectangle that fits, >1 = tighter;
 * (cx, cy) = center in 0..1, clamped so the rectangle stays inside the image.
 */
export function cropRect(imgW: number, imgH: number, aspect: number | null, zoom = 1, cx = 0.5, cy = 0.5) {
  const a = aspect ?? imgW / imgH;
  let w = imgW;
  let h = w / a;
  if (h > imgH) {
    h = imgH;
    w = h * a;
  }
  const z = Math.max(1, zoom);
  w /= z;
  h /= z;
  const x = Math.min(Math.max(cx * imgW - w / 2, 0), imgW - w);
  const y = Math.min(Math.max(cy * imgH - h / 2, 0), imgH - h);
  return { x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) };
}

/** Output size: preset pixels, or the crop size capped at `max` on the long side (never upscaled beyond 2×). */
export function outputSize(crop: { w: number; h: number }, preset: { w: number; h: number } | null, max = 2048) {
  if (preset) return { w: preset.w, h: preset.h, upscaled: preset.w > crop.w * 2 || preset.h > crop.h * 2 };
  const s = Math.min(1, max / Math.max(crop.w, crop.h));
  return { w: Math.round(crop.w * s), h: Math.round(crop.h * s), upscaled: false };
}
