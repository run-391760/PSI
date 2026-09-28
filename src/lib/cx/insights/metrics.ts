/**
 * Pure KPI math for CX insights (no DB access; unit-tested in tests/cx-insights.test.ts).
 * All functions return null when there is nothing to measure — callers render "n/a", never 0.
 */

export type Priority = "low" | "normal" | "high" | "urgent";
export const PRIORITIES: Priority[] = ["urgent", "high", "normal", "low"];

export type TicketTimes = {
  created_at: string | Date;
  first_response_at?: string | Date | null;
  resolved_at?: string | Date | null;
  first_response_due?: string | Date | null;
  resolution_due?: string | Date | null;
  priority?: string;
};

const ms = (d: string | Date | null | undefined) => (d == null ? null : new Date(d).getTime());

export const mean = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null);
export function median(xs: number[]) {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Average first response time in seconds over tickets that have been answered. */
export function avgFirstResponse(tickets: TicketTimes[]) {
  const xs = tickets.flatMap((t) => {
    const a = ms(t.created_at), b = ms(t.first_response_at);
    return a != null && b != null && b >= a ? [(b - a) / 1000] : [];
  });
  return mean(xs);
}

/** Average resolution time in seconds over resolved tickets. */
export function avgResolution(tickets: TicketTimes[]) {
  const xs = tickets.flatMap((t) => {
    const a = ms(t.created_at), b = ms(t.resolved_at);
    return a != null && b != null && b >= a ? [(b - a) / 1000] : [];
  });
  return mean(xs);
}

export type SlaTargetsMinutes = Partial<Record<Priority, { firstResponse: number | null; resolution: number | null }>>;

/**
 * SLA compliance: for every ticket target (first response, resolution) that is decided — met (done before
 * the due time) or breached (done late, or still open past due) — count it; pending targets are skipped.
 * Due times come from the ticket; when missing, from `fallback` policy minutes (calendar time).
 */
export function slaCompliance(tickets: TicketTimes[], now: Date = new Date(), fallback: SlaTargetsMinutes = {}) {
  let met = 0, breached = 0, pending = 0;
  const t0 = now.getTime();
  for (const t of tickets) {
    const created = ms(t.created_at)!;
    const pol = fallback[(t.priority as Priority) ?? "normal"];
    const pairs: [number | null, number | null][] = [
      [ms(t.first_response_due) ?? (pol?.firstResponse != null ? created + pol.firstResponse * 60000 : null), ms(t.first_response_at)],
      [ms(t.resolution_due) ?? (pol?.resolution != null ? created + pol.resolution * 60000 : null), ms(t.resolved_at)],
    ];
    for (const [due, done] of pairs) {
      if (due == null) continue;
      if (done != null) done <= due ? met++ : breached++;
      else if (t0 > due) breached++;
      else pending++;
    }
  }
  const decided = met + breached;
  return { met, breached, pending, rate: decided ? (met / decided) * 100 : null };
}

/** NPS = % promoters (9–10) − % detractors (0–6). */
export function nps(scores: number[]) {
  const xs = scores.filter((s) => Number.isFinite(s) && s >= 0 && s <= 10);
  if (!xs.length) return { score: null as number | null, promoters: 0, passives: 0, detractors: 0, n: 0 };
  const promoters = xs.filter((s) => s >= 9).length;
  const detractors = xs.filter((s) => s <= 6).length;
  return { score: ((promoters - detractors) / xs.length) * 100, promoters, passives: xs.length - promoters - detractors, detractors, n: xs.length };
}

/** CSAT = share of satisfied answers (4–5 on a 1–5 scale), plus the mean score. */
export function csat(scores: number[]) {
  const xs = scores.filter((s) => Number.isFinite(s) && s >= 1 && s <= 5);
  if (!xs.length) return { score: null as number | null, average: null as number | null, n: 0 };
  return { score: (xs.filter((s) => s >= 4).length / xs.length) * 100, average: mean(xs), n: xs.length };
}

/** Net sentiment in −100…100 from positive/negative counts (neutral ignored). */
export function netSentiment(pos: number, neg: number) {
  return pos + neg ? ((pos - neg) / (pos + neg)) * 100 : null;
}

/** Percent change; null when either side is unknown or the base is 0. */
export function pctDelta(cur: number | null | undefined, prev: number | null | undefined) {
  if (cur == null || prev == null || prev === 0) return null;
  return ((cur - prev) / Math.abs(prev)) * 100;
}

/** ISO days (YYYY-MM-DD, UTC) from `days` ago to today inclusive. */
export function dayKeys(days: number, end: Date = new Date()) {
  const out: string[] = [];
  const base = Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate());
  for (let i = days - 1; i >= 0; i--) out.push(new Date(base - i * 86400000).toISOString().slice(0, 10));
  return out;
}

/** Fill a day series with zeros for days that have no rows (counts only — averages stay null). */
export function fillDays<T extends Record<string, unknown>>(rows: (T & { day: string })[], days: number, zero: Omit<T, "day">, end?: Date) {
  const by = new Map(rows.map((r) => [r.day, r]));
  return dayKeys(days, end).map((day) => ({ ...zero, ...(by.get(day) ?? {}), day }));
}

// ------------------------------------------------------------- business hours

export type DayHours = { day: number; open: boolean; start: string; end: string }; // day 0 = Sunday
export type Holiday = { date: string; name: string };
export const DEFAULT_HOURS: DayHours[] = [0, 1, 2, 3, 4, 5, 6].map((day) => ({ day, open: day >= 1 && day <= 5, start: "09:00", end: "17:00" }));

const minutesOf = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
};

/** Offset (minutes) of `tz` from UTC at instant `d`. */
export function tzOffset(tz: string, d: Date) {
  try {
    const parts = Object.fromEntries(
      new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" })
        .formatToParts(d)
        .map((p) => [p.type, p.value]),
    );
    const asUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour % 24, +parts.minute, +parts.second);
    return Math.round((asUtc - Math.floor(d.getTime() / 1000) * 1000) / 60000);
  } catch {
    return 0;
  }
}

/**
 * Add `minutes` of business time to `start` using weekly opening hours in timezone `tz`, skipping
 * holidays. Falls back to calendar time when no day is open.
 */
export function addBusinessMinutes(start: Date, minutes: number, hours: DayHours[], holidays: Holiday[] = [], tz = "UTC") {
  const open = hours.filter((h) => h.open && minutesOf(h.end) > minutesOf(h.start));
  if (!open.length || minutes <= 0) return new Date(start.getTime() + Math.max(0, minutes) * 60000);
  const off = tzOffset(tz, start);
  // Work in "wall clock" ms (local time expressed as UTC).
  let wall = start.getTime() + off * 60000;
  let left = minutes;
  const hol = new Set(holidays.map((h) => h.date));
  for (let guard = 0; guard < 800 && left > 0; guard++) {
    const d = new Date(wall);
    const dayStart = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
    const iso = new Date(dayStart).toISOString().slice(0, 10);
    const h = open.find((x) => x.day === d.getUTCDay());
    if (h && !hol.has(iso)) {
      const s = dayStart + minutesOf(h.start) * 60000, e = dayStart + minutesOf(h.end) * 60000;
      const from = Math.max(wall, s);
      if (from < e) {
        const avail = (e - from) / 60000;
        if (avail >= left) {
          const endWall = from + left * 60000;
          return new Date(endWall - tzOffset(tz, new Date(endWall - off * 60000)) * 60000);
        }
        left -= avail;
      }
    }
    wall = dayStart + 86400000;
  }
  return new Date(start.getTime() + minutes * 60000);
}

// ------------------------------------------------------------- quality scoring

/**
 * Response types: yesno (Yes/Partly/No/N/A), input (free text, not scored), scale (1..scaleMax),
 * scale_text (scale plus a required comment), auto (computed from ticket facts; see autoScore).
 */
export type ResponseType = "yesno" | "input" | "scale" | "scale_text" | "auto";
export type AutoRule = { metric: "frt" | "resolution" | "csat" | "sentiment"; target: number };
export type QaCriterion = { id: string; label: string; weight: number; fatal?: boolean; description?: string; type?: ResponseType; scaleMax?: number; auto?: AutoRule };
export type QaSection = { id: string; name: string; criteria: QaCriterion[] };
/** Answer per criterion: 1 = meets, 0 = does not meet, 0.5 = partially, null = not applicable. */
export type QaAnswers = Record<string, number | null | undefined>;

/**
 * Weighted QA score in percent. Non-fatal criteria contribute weight × answer; N/A criteria are dropped
 * from the denominator. Any fatal criterion answered 0 zeroes the whole review.
 */
export function scoreReview(sections: QaSection[], answers: QaAnswers) {
  let got = 0, max = 0, fatal = false;
  const bySection: { id: string; name: string; score: number | null }[] = [];
  for (const s of sections) {
    let sg = 0, sm = 0;
    for (const c of s.criteria) {
      const a = answers[c.id];
      if (a == null || c.type === "input") continue;
      if (c.fatal) {
        if (a === 0) fatal = true;
        continue;
      }
      const w = Math.max(0, Number(c.weight) || 0);
      sg += w * Math.min(1, Math.max(0, a));
      sm += w;
    }
    got += sg;
    max += sm;
    bySection.push({ id: s.id, name: s.name, score: sm ? (sg / sm) * 100 : null });
  }
  const answered = sections.some((s) => s.criteria.some((c) => c.type !== "input" && answers[c.id] != null));
  const score = !answered ? null : fatal ? 0 : max ? (got / max) * 100 : null;
  return { score, fatal, bySection };
}

/** Pick `n` distinct items with a seeded shuffle (Fisher–Yates on a mulberry32 PRNG). */
export function sample<T>(items: T[], n: number, seed = Date.now()) {
  let a = seed >>> 0;
  const rand = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr.slice(0, Math.max(0, n));
}

/** Compact human duration: 45s, 12m, 3h 5m, 2d 4h. */
export function humanDuration(seconds: number | null | undefined) {
  if (seconds == null || !Number.isFinite(seconds)) return "n/a";
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return `${s}s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60), mm = m % 60;
  if (h < 24) return mm ? `${h}h ${mm}m` : `${h}h`;
  const d = Math.floor(h / 24), hh = h % 24;
  return hh ? `${d}d ${hh}h` : `${d}d`;
}

/** Scale answer (1..max) as a 0–1 fraction: 1 → 0, max → 1. */
export function scaleFraction(value: number, max: number) {
  if (!(max > 1)) return value >= 1 ? 1 : 0;
  return Math.min(1, Math.max(0, (value - 1) / (max - 1)));
}

/**
 * Auto-scale: a 0–1 answer computed from ticket facts. Time metrics (hours) meet the target at 1 and
 * fall linearly to 0 at 3× the target; CSAT scales 1–5 against the target; sentiment maps
 * positive/neutral/negative to 1/0.5/0. Null when the fact is unknown.
 */
export function autoScore(rule: AutoRule, facts: { frtHours: number | null; resolutionHours: number | null; csat: number | null; sentiment: string | null }) {
  const time = (h: number | null) => (h == null ? null : h <= rule.target ? 1 : h >= rule.target * 3 ? 0 : 1 - (h - rule.target) / (rule.target * 2));
  if (rule.metric === "frt") return time(facts.frtHours);
  if (rule.metric === "resolution") return time(facts.resolutionHours);
  if (rule.metric === "csat") return facts.csat == null ? null : Math.min(1, Math.max(0, (facts.csat - 1) / Math.max(0.01, rule.target - 1)));
  return facts.sentiment === "positive" ? 1 : facts.sentiment === "neutral" ? 0.5 : facts.sentiment === "negative" ? 0 : null;
}

/**
 * Early warning for an agent from weekly average QA scores (oldest first): "declining" when the last
 * three weeks fall by 10+ points in total, "below_pass" when the last two weeks are under the pass score.
 */
export function earlyWarnings(weekly: (number | null)[], passScore = 80) {
  const xs = weekly.filter((x): x is number => x != null);
  const flags: ("declining" | "below_pass")[] = [];
  if (xs.length >= 3) {
    const [a, b, c] = xs.slice(-3);
    if (a > b && b > c && a - c >= 10) flags.push("declining");
  }
  if (xs.length >= 2 && xs.slice(-2).every((x) => x < passScore)) flags.push("below_pass");
  const change = xs.length >= 2 ? xs[xs.length - 1] - xs[0] : null;
  return { flags, change, latest: xs.length ? xs[xs.length - 1] : null };
}
