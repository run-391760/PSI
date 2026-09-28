/**
 * Pure report math for CX Reports (ticket trend, SLA breach, TAT summaries, reply TAT, daywise FRT).
 * No DB access; unit-tested in tests/cx-wp5.test.ts. Unknown values are null ("n/a"), never 0.
 */
import { median, tzOffset, type DayHours, type Holiday } from "./metrics";

export type Basis = "calendar" | "business";
export type Interval = "day" | "week" | "month";
export type HoursCfg = { hours: DayHours[]; holidays: Holiday[]; timezone: string };

const t = (d: string | Date | null | undefined) => (d == null ? null : new Date(d).getTime());
const minutesOf = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
};

/** Seconds as HH:MM:SS (hours may exceed 24). Empty string for unknown. */
export function hms(seconds: number | null | undefined) {
  if (seconds == null || !Number.isFinite(seconds)) return "";
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(x).padStart(2, "0")}`;
}

/**
 * Open (business) seconds between two instants using weekly opening hours in `tz`, skipping holidays.
 * Falls back to calendar seconds when no day is open.
 */
export function businessSecondsBetween(start: Date | string, end: Date | string, cfg: HoursCfg) {
  const a = new Date(start).getTime(), b = new Date(end).getTime();
  if (!(b > a)) return 0;
  const open = cfg.hours.filter((h) => h.open && minutesOf(h.end) > minutesOf(h.start));
  if (!open.length) return (b - a) / 1000;
  const hol = new Set(cfg.holidays.map((h) => h.date));
  const off = tzOffset(cfg.timezone, new Date(a)) * 60000;
  const wa = a + off, wb = b + tzOffset(cfg.timezone, new Date(b)) * 60000;
  let total = 0;
  let day = Date.UTC(new Date(wa).getUTCFullYear(), new Date(wa).getUTCMonth(), new Date(wa).getUTCDate());
  for (let guard = 0; guard < 3700 && day < wb; guard++, day += 86400000) {
    const d = new Date(day);
    const h = open.find((x) => x.day === d.getUTCDay());
    if (!h || hol.has(d.toISOString().slice(0, 10))) continue;
    const s = Math.max(wa, day + minutesOf(h.start) * 60000), e = Math.min(wb, day + minutesOf(h.end) * 60000);
    if (e > s) total += e - s;
  }
  return total / 1000;
}

/** Elapsed seconds on the chosen basis; null when either side is unknown or end < start. */
export function tat(start: string | Date | null | undefined, end: string | Date | null | undefined, basis: Basis, cfg?: HoursCfg | null) {
  const a = t(start), b = t(end);
  if (a == null || b == null || b < a) return null;
  return basis === "business" && cfg ? businessSecondsBetween(new Date(a), new Date(b), cfg) : (b - a) / 1000;
}

/** Bucket key: YYYY-MM-DD (day), Monday of the ISO week (week) or YYYY-MM (month), in UTC. */
export function bucketKey(d: string | Date, interval: Interval) {
  const x = new Date(d);
  if (interval === "month") return x.toISOString().slice(0, 7);
  const day = new Date(Date.UTC(x.getUTCFullYear(), x.getUTCMonth(), x.getUTCDate()));
  if (interval === "week") day.setUTCDate(day.getUTCDate() - ((day.getUTCDay() + 6) % 7));
  return day.toISOString().slice(0, 10);
}

/** Continuous bucket keys covering [from, to]. */
export function bucketKeys(from: Date, to: Date, interval: Interval) {
  const out: string[] = [];
  let cur = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()));
  for (let guard = 0; guard < 1000 && cur <= to; guard++) {
    const k = bucketKey(cur, interval);
    if (out[out.length - 1] !== k) out.push(k);
    cur = new Date(cur.getTime() + 86400000);
  }
  return out;
}

export type TrendTicket = { created_at: string | Date; resolved_at?: string | Date | null; status?: string };

/** Created / solved counts per bucket plus the backlog still open at the end of each bucket window. */
export function ticketTrend(tickets: TrendTicket[], from: Date, to: Date, interval: Interval) {
  const keys = bucketKeys(from, to, interval);
  const created = new Map<string, number>(), solved = new Map<string, number>();
  for (const x of tickets) {
    const c = t(x.created_at)!;
    if (c >= from.getTime() && c <= to.getTime()) created.set(bucketKey(x.created_at, interval), (created.get(bucketKey(x.created_at, interval)) ?? 0) + 1);
    const r = t(x.resolved_at);
    if (r != null && r >= from.getTime() && r <= to.getTime()) solved.set(bucketKey(x.resolved_at!, interval), (solved.get(bucketKey(x.resolved_at!, interval)) ?? 0) + 1);
  }
  return keys.map((key) => ({ key, created: created.get(key) ?? 0, solved: solved.get(key) ?? 0 }));
}

export type BreachTicket = {
  assignee: string | null;
  created_at: string | Date;
  first_response_at?: string | Date | null;
  resolved_at?: string | Date | null;
  first_response_due?: string | Date | null;
  resolution_due?: string | Date | null;
};

/** Per-agent SLA outcome counts: first-response and resolution targets met / breached (pending skipped). */
export function agentBreaches(tickets: BreachTicket[], now: Date = new Date()) {
  const by = new Map<string, { agent: string; frMet: number; frBreached: number; resMet: number; resBreached: number; tickets: number }>();
  for (const x of tickets) {
    const k = x.assignee ?? "Unassigned";
    const a = by.get(k) ?? { agent: k, frMet: 0, frBreached: 0, resMet: 0, resBreached: 0, tickets: 0 };
    a.tickets++;
    const judge = (due: number | null, done: number | null): "met" | "breached" | null => (due == null ? null : done != null ? (done <= due ? "met" : "breached") : now.getTime() > due ? "breached" : null);
    const fr = judge(t(x.first_response_due), t(x.first_response_at));
    const rs = judge(t(x.resolution_due), t(x.resolved_at));
    if (fr === "met") a.frMet++;
    if (fr === "breached") a.frBreached++;
    if (rs === "met") a.resMet++;
    if (rs === "breached") a.resBreached++;
    by.set(k, a);
  }
  return [...by.values()]
    .map((a) => {
      const decided = a.frMet + a.frBreached + a.resMet + a.resBreached;
      return { ...a, breached: a.frBreached + a.resBreached, breachRate: decided ? ((a.frBreached + a.resBreached) / decided) * 100 : null };
    })
    .sort((x, y) => y.breached - x.breached || x.agent.localeCompare(y.agent));
}

/** n / avg / median / p90 / min / max of durations in seconds. */
export function summarize(xs: number[]) {
  const v = xs.filter((x) => Number.isFinite(x) && x >= 0).sort((a, b) => a - b);
  if (!v.length) return { n: 0, avg: null as number | null, median: null as number | null, p90: null as number | null, min: null as number | null, max: null as number | null };
  const p90 = v[Math.min(v.length - 1, Math.ceil(v.length * 0.9) - 1)];
  return { n: v.length, avg: v.reduce((s, x) => s + x, 0) / v.length, median: median(v), p90, min: v[0], max: v[v.length - 1] };
}

export type ThreadMessage = { ticket_id: string; direction: "in" | "out" | "note"; created_at: string | Date; author_user_id?: string | null; author?: string | null };

/**
 * Reply TAT: for every run of customer messages, the time from the first message of the run to the next
 * agent reply. Notes are ignored. Returns one row per answered run (unanswered runs are skipped).
 */
export function replyTats(messages: ThreadMessage[], basis: Basis = "calendar", cfg?: HoursCfg | null) {
  const by = new Map<string, ThreadMessage[]>();
  for (const m of messages) if (m.direction !== "note") by.set(m.ticket_id, [...(by.get(m.ticket_id) ?? []), m]);
  const out: { ticket_id: string; agent_id: string | null; agent: string | null; at: string; seconds: number }[] = [];
  for (const [ticket, list] of by) {
    list.sort((a, b) => t(a.created_at)! - t(b.created_at)!);
    let waiting: ThreadMessage | null = null;
    for (const m of list) {
      if (m.direction === "in") waiting ??= m;
      else if (waiting) {
        const s = tat(waiting.created_at, m.created_at, basis, cfg);
        if (s != null) out.push({ ticket_id: ticket, agent_id: m.author_user_id ?? null, agent: m.author ?? null, at: new Date(m.created_at).toISOString(), seconds: s });
        waiting = null;
      }
    }
  }
  return out;
}

/** Group durations by a key and summarize each group (sorted by key for dates, by count otherwise). */
export function groupSummaries<T>(rows: T[], key: (r: T) => string, value: (r: T) => number | null, sortByKey = false) {
  const by = new Map<string, { xs: number[]; count: number }>();
  for (const r of rows) {
    const v = value(r);
    const k = key(r);
    const g = by.get(k) ?? { xs: [], count: 0 };
    g.count++;
    if (v != null) g.xs.push(v);
    by.set(k, g);
  }
  const out = [...by.entries()].map(([k, g]) => ({ key: k, count: g.count, ...summarize(g.xs) }));
  return sortByKey ? out.sort((a, b) => a.key.localeCompare(b.key)) : out.sort((a, b) => b.count - a.count);
}

const PHRASE_STOP = new Set("a an and are as at be but by can could did do does for from had has have he her his how i if in into is it its just me my no not of on or our she so than that the their them then there they this to too up us was we were what when which who will with would you your http https www com".split(" "));

/** Top 2- and 3-word phrases (no stop word at either end) across texts, counted once per text. */
export function topPhrases(texts: string[], limit = 40) {
  const counts = new Map<string, number>();
  for (const text of texts) {
    const words = (text.toLowerCase().replace(/https?:\/\/\S+/g, " ").match(/[\p{L}\p{N}']+/gu) ?? []).map((w) => w.replace(/^'+|'+$/g, "")).filter(Boolean);
    const seen = new Set<string>();
    for (let n = 2; n <= 3; n++)
      for (let i = 0; i + n <= words.length; i++) {
        const g = words.slice(i, i + n);
        if (PHRASE_STOP.has(g[0]) || PHRASE_STOP.has(g[n - 1]) || g.some((w) => w.length < 2 || /^\d+$/.test(w))) continue;
        seen.add(g.join(" "));
      }
    for (const p of seen) counts.set(p, (counts.get(p) ?? 0) + 1);
  }
  const all = [...counts.entries()].filter(([, c]) => c >= 2).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  // Drop a 2-word phrase when a 3-word phrase containing it has the same count.
  const out = all.filter(([p, c]) => !(p.split(" ").length === 2 && all.some(([q, d]) => d === c && q.split(" ").length === 3 && q.includes(p))));
  return out.slice(0, limit).map(([term, count]) => ({ term, count }));
}
