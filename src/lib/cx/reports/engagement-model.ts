/**
 * Community Engagement + Calls Analytics reports (WP-K4): pure, client-safe aggregation. No DB access;
 * fixture-tested in tests/cx-k4-engagement.test.ts. Counts use the same definitions as the drill-down
 * sources in drill.ts (tasks by created_at in the window, survey responses by created_at, tickets by the
 * ticket tile rules), so a clicked number lists exactly the counted items. Unknown values are null ("n/a").
 *
 * Times: `at` fields are local-time ISO strings (UTC instant shifted by the brand's offset); raw UTC
 * instants are named `*_utc` / `*At` and only used for durations and "now" comparisons.
 */
import { TASK_PRIORITIES, TASK_STATUSES } from "@/lib/cx/ops/model";
import { bucketKey, bucketKeys, dmy, rangeDays, timeSeries, type Interval, type Range } from "./model";

const DAY = 86400000;
/** Shift a UTC instant to the brand's local time, as an ISO string (bucketing is plain UTC math). */
export const toLocal = (v: string | Date | null | undefined, offsetMin: number) => (v == null ? null : new Date(new Date(v).getTime() + offsetMin * 60000).toISOString());
/** "29/09/2026 14:05" in the brand's local time from a UTC instant; "n/a" when missing. */
export function dmyTime(v: string | Date | null | undefined, offsetMin: number) {
  const l = toLocal(v, offsetMin);
  return l ? `${dmy(l.slice(0, 10))} ${l.slice(11, 16)}` : "n/a";
}
const inR = (at: string | null | undefined, r: Range) => !!at && at.slice(0, 10) >= r.from && at.slice(0, 10) <= r.to;
const avg = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null);
const round = (v: number | null, d = 2) => (v == null ? null : Math.round(v * 10 ** d) / 10 ** d);

// ================================================================ tasks

export type TaskRow = {
  id: string;
  number: number;
  title: string;
  status: string;
  priority: string;
  assigneeId: string | null;
  assignee: string | null;
  classificationId: string | null;
  classification: string;
  /** Local-time ISO of created_at (the report/drill basis). */
  at: string;
  /** UTC ISO instants. */
  dueAt: string | null;
  completedAt: string | null;
  createdAt: string;
  ticketNumber: number | null;
};
export const TASK_DONE_IDS = new Set(["done", "cancelled"]);
export const TASK_STATUS_IDS = TASK_STATUSES.map((s) => s.id) as string[];
/** Status colors: active work uses series slots; done/cancelled carry meaning (always labelled). */
export const TASK_STATUS_COLOR: Record<string, string> = { open: "var(--series-1)", in_progress: "var(--series-2)", waiting: "var(--warning)", done: "var(--good)", cancelled: "var(--text-3)" };
export const PRIORITY_LABEL: Record<string, string> = { low: "Low", normal: "Normal", high: "High", urgent: "Urgent" };
/** Highest priority first. */
export const PRIORITY_ORDER = [...TASK_PRIORITIES].reverse() as string[];

/** Same rule as the drill's `due: "overdue"` (due_at < now and not done/cancelled). */
export const isOverdue = (t: Pick<TaskRow, "dueAt" | "status">, now: number) => !!t.dueAt && Date.parse(t.dueAt) < now && !TASK_DONE_IDS.has(t.status);

/** Tile counts: total, one per task status, active (= open_all), overdue, and average time to complete. */
export function taskTiles(rows: TaskRow[], now: number) {
  const byStatus: Record<string, number> = Object.fromEntries(TASK_STATUS_IDS.map((s) => [s, 0]));
  let overdue = 0;
  const durations: number[] = [];
  for (const t of rows) {
    if (t.status in byStatus) byStatus[t.status]++;
    if (isOverdue(t, now)) overdue++;
    if (t.status === "done" && t.completedAt) {
      const s = (Date.parse(t.completedAt) - Date.parse(t.createdAt)) / 1000;
      if (s >= 0) durations.push(s);
    }
  }
  const active = rows.filter((t) => !TASK_DONE_IDS.has(t.status)).length;
  const closed = byStatus.done + byStatus.cancelled;
  return {
    total: rows.length,
    byStatus,
    active,
    overdue,
    avgCompleteSeconds: avg(durations),
    completionRate: rows.length ? (byStatus.done / rows.length) * 100 : null,
    closed,
  };
}

/** Tasks created per bucket, one series per status. */
export const taskTrend = (rows: TaskRow[], range: Range, interval: Interval) => timeSeries(rows, range, interval, (r) => [r.status], TASK_STATUS_IDS);

/** Status counts per priority (highest first; priorities without tasks are kept so the axis is stable). */
export function taskByPriority(rows: TaskRow[]) {
  const known = new Set(PRIORITY_ORDER);
  const extra = [...new Set(rows.map((r) => r.priority).filter((p) => !known.has(p)))].sort();
  return [...PRIORITY_ORDER, ...extra].map((p) => {
    const of = rows.filter((r) => r.priority === p);
    return { key: p, total: of.length, ...Object.fromEntries(TASK_STATUS_IDS.map((s) => [s, of.filter((r) => r.status === s).length])) } as Record<string, number | string> & { key: string; total: number };
  });
}

export type AssigneeRow = { key: string; name: string; total: number; byStatus: Record<string, number>; active: number; overdue: number };
/** Per assignee ("none" = unassigned, listed last): status counts, active and overdue. Busiest first. */
export function taskByAssignee(rows: TaskRow[], now: number): AssigneeRow[] {
  const m = new Map<string, AssigneeRow>();
  for (const t of rows) {
    const key = t.assigneeId ?? "none";
    const a = m.get(key) ?? { key, name: t.assigneeId ? t.assignee || "Unknown user" : "Unassigned", total: 0, byStatus: Object.fromEntries(TASK_STATUS_IDS.map((s) => [s, 0])), active: 0, overdue: 0 };
    a.total++;
    if (t.status in a.byStatus) a.byStatus[t.status]++;
    if (!TASK_DONE_IDS.has(t.status)) a.active++;
    if (isOverdue(t, now)) a.overdue++;
    m.set(key, a);
  }
  return [...m.values()].sort((a, b) => (a.key === "none" ? 1 : 0) - (b.key === "none" ? 1 : 0) || b.total - a.total || a.name.localeCompare(b.name));
}

/** Tasks per classification ("none" = unclassified), largest first, the rest folded beyond `limit`. */
export function taskByClassification(rows: TaskRow[], limit = 12) {
  const m = new Map<string, { key: string; label: string; count: number }>();
  for (const t of rows) {
    const key = t.classificationId ?? "none";
    const c = m.get(key) ?? { key, label: t.classificationId ? t.classification || "Classification" : "Unclassified", count: 0 };
    c.count++;
    m.set(key, c);
  }
  return [...m.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label)).slice(0, limit);
}

/** Overdue tasks, most overdue first. */
export function overdueTasks(rows: TaskRow[], now: number, limit = 50) {
  return rows
    .filter((t) => isOverdue(t, now))
    .sort((a, b) => Date.parse(a.dueAt!) - Date.parse(b.dueAt!))
    .slice(0, limit)
    .map((t) => ({ ...t, overdueSeconds: (now - Date.parse(t.dueAt!)) / 1000 }));
}

/** "all" (default) or "mine" from ?scope= (anything else = all). */
export const taskScope = (v: unknown): "all" | "mine" => (v === "mine" ? "mine" : "all");

// ================================================================ surveys (CSAT)

export type SurveyRow = {
  id: string;
  surveyId: string;
  kind: "csat" | "nps" | "custom";
  score: number | null;
  comment: string;
  sentiment: string | null;
  /** Local ISO of created_at. */
  at: string;
  agentId: string | null;
  agent: string | null;
  ticketId: string | null;
  ticketNumber: number | null;
  contact: string | null;
};
export type Band = "satisfied" | "neutral" | "unsatisfied";
export const BANDS: Band[] = ["satisfied", "neutral", "unsatisfied"];
export const BAND_LABEL: Record<Band, string> = { satisfied: "Satisfied (4–5)", neutral: "Neutral (3)", unsatisfied: "Unsatisfied (1–2)" };
export const BAND_COLOR: Record<Band, string> = { satisfied: "var(--good)", neutral: "var(--series-1)", unsatisfied: "var(--critical)" };
/** The drill's band rule (score >= 4 / = 3 / <= 2); null without a score. */
export function bandOf(score: number | null): Band | null {
  if (score == null) return null;
  return score >= 4 ? "satisfied" : score === 3 ? "neutral" : "unsatisfied";
}

/** CSAT headline numbers over 1–5 responses: responses (all rows), scored, average, % satisfied, band counts. */
export function csatSummary(rows: Pick<SurveyRow, "score">[]) {
  const scored = rows.filter((r) => r.score != null) as { score: number }[];
  const bands: Record<Band, number> = { satisfied: 0, neutral: 0, unsatisfied: 0 };
  for (const r of scored) bands[bandOf(r.score)!]++;
  return {
    responses: rows.length,
    scored: scored.length,
    average: round(avg(scored.map((r) => r.score))),
    satisfiedPct: scored.length ? (bands.satisfied / scored.length) * 100 : null,
    bands,
  };
}

/** NPS (−100…100) from 0–10 scores; null without answers. */
export function npsSummary(scores: (number | null)[]) {
  const xs = scores.filter((s): s is number => s != null && s >= 0 && s <= 10);
  if (!xs.length) return { score: null as number | null, promoters: 0, passives: 0, detractors: 0, n: 0 };
  const promoters = xs.filter((s) => s >= 9).length, detractors = xs.filter((s) => s <= 6).length;
  return { score: Math.round(((promoters - detractors) / xs.length) * 1000) / 10, promoters, passives: xs.length - promoters - detractors, detractors, n: xs.length };
}

/** Count per score from `min` to `max` (inclusive), as category rows for a column chart. */
export function scoreDistribution(rows: Pick<SurveyRow, "score">[], min = 1, max = 5) {
  return Array.from({ length: max - min + 1 }, (_, i) => {
    const s = min + i;
    return { key: String(s), count: rows.filter((r) => r.score === s).length, band: bandOf(s) };
  });
}

/** Responses per bucket split by band, plus the average score of the bucket (null when nothing scored). */
export function surveyTrend(rows: Pick<SurveyRow, "at" | "score">[], range: Range, interval: Interval) {
  const series = timeSeries(rows, range, interval, (r) => { const b = bandOf(r.score); return b ? [b] : []; }, BANDS);
  const sums = new Map<string, number[]>();
  for (const r of rows) if (r.score != null) sums.set(bucketKey(r.at, interval), [...(sums.get(bucketKey(r.at, interval)) ?? []), r.score]);
  return series.map((row) => ({ ...row, average: round(avg(sums.get(row.key) ?? [])) }) as Record<string, number | string | null> & { key: string; average: number | null });
}

export type SurveyAgentRow = { key: string; name: string; responses: number; average: number | null; satisfied: number; neutral: number; unsatisfied: number; satisfiedPct: number | null };
/** Per ticket assignee ("none" = no agent): responses, average, band counts. Most responses first. */
export function surveyByAgent(rows: SurveyRow[]): SurveyAgentRow[] {
  const m = new Map<string, SurveyRow[]>();
  for (const r of rows) m.set(r.agentId ?? "none", [...(m.get(r.agentId ?? "none") ?? []), r]);
  return [...m.entries()]
    .map(([key, list]) => {
      const s = csatSummary(list);
      return { key, name: key === "none" ? "No agent" : list[0].agent || "Unknown user", responses: s.responses, average: s.average, ...s.bands, satisfiedPct: s.satisfiedPct };
    })
    .sort((a, b) => (a.key === "none" ? 1 : 0) - (b.key === "none" ? 1 : 0) || b.responses - a.responses || a.name.localeCompare(b.name));
}

/** Share of invites that got a response (null without invites). */
export const responseRate = (responded: number, invites: number) => (invites > 0 ? (responded / invites) * 100 : null);

// ================================================================ queue

export type QueueStateRow = { ticketId: string; queuedAt: string | null; assignedAt: string | null };
/** Tickets queued (by queued_at) and assigned from the queue (by assigned_at) per local bucket. */
export function queueTrend(rows: QueueStateRow[], range: Range, interval: Interval, offsetMin: number) {
  const buckets = bucketKeys(new Date(`${range.from}T00:00:00Z`), new Date(`${range.to}T23:59:59Z`), interval);
  const by = new Map(buckets.map((b) => [b, { key: b, queued: 0, assigned: 0 }]));
  for (const r of rows) {
    const q = toLocal(r.queuedAt, offsetMin), a = toLocal(r.assignedAt, offsetMin);
    if (q && inR(q, range)) by.get(bucketKey(q, interval))!.queued++;
    if (a && inR(a, range)) by.get(bucketKey(a, interval))!.assigned++;
  }
  return buckets.map((b) => by.get(b)!);
}

/** Wait from queued to assigned for tickets assigned in the range (seconds): average, median, longest, n. */
export function waitToAssign(rows: QueueStateRow[], range: Range, offsetMin: number) {
  const xs: number[] = [];
  for (const r of rows) {
    if (!r.queuedAt || !r.assignedAt || !inR(toLocal(r.assignedAt, offsetMin), range)) continue;
    const s = (Date.parse(r.assignedAt) - Date.parse(r.queuedAt)) / 1000;
    if (s >= 0) xs.push(s);
  }
  xs.sort((a, b) => a - b);
  const median = xs.length ? (xs.length % 2 ? xs[(xs.length - 1) / 2] : (xs[xs.length / 2 - 1] + xs[xs.length / 2]) / 2) : null;
  return { n: xs.length, average: avg(xs), median, longest: xs.length ? xs[xs.length - 1] : null };
}

/** Tickets waiting now: count and the oldest wait (seconds since queued). */
export function waitingSummary(rows: { queuedAt: string | null }[], now: number) {
  const ts = rows.map((r) => (r.queuedAt ? Date.parse(r.queuedAt) : NaN)).filter(Number.isFinite);
  return { count: rows.length, oldestSeconds: ts.length ? Math.max(0, (now - Math.min(...ts)) / 1000) : null };
}

export type StatusLogRow = { id: string; name: string; status: string; started_at: string; ended_at: string | null };
/** Whether a status-log entry is a break (anything that is neither available nor offline). */
export const isBreak = (status: string) => !/^(available|online|offline)$/i.test(status.trim());
/** Status log entries that overlap the local range, with durations (open entries run until `now`). */
export function statusLogRows(log: StatusLogRow[], range: Range, offsetMin: number, now: number) {
  const start = Date.parse(`${range.from}T00:00:00Z`) - offsetMin * 60000;
  const end = Date.parse(`${range.to}T23:59:59.999Z`) - offsetMin * 60000;
  return log
    .filter((l) => Date.parse(l.started_at) <= end && (l.ended_at ? Date.parse(l.ended_at) : now) >= start)
    .map((l) => ({ ...l, seconds: Math.max(0, ((l.ended_at ? Date.parse(l.ended_at) : now) - Date.parse(l.started_at)) / 1000), open: !l.ended_at, isBreak: isBreak(l.status) }));
}
/** Break time per agent from status-log rows (breaks only): sessions, total and longest seconds. */
export function breakSummary(rows: ReturnType<typeof statusLogRows>) {
  const m = new Map<string, { name: string; sessions: number; total: number; longest: number }>();
  for (const r of rows) {
    if (!r.isBreak) continue;
    const a = m.get(r.name) ?? { name: r.name, sessions: 0, total: 0, longest: 0 };
    a.sessions++;
    a.total += r.seconds;
    a.longest = Math.max(a.longest, r.seconds);
    m.set(r.name, a);
  }
  return [...m.values()].sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
}

// ================================================================ my dashboard

/** Fixed ticket-status colors so the same status looks the same in every chart of a page. */
export const TICKET_STATUS_COLOR: Record<string, string> = {
  open: "var(--series-1)", wip: "var(--series-2)", follow_up: "var(--series-3)", assigned: "var(--series-4)", responded: "var(--series-5)",
  pending: "var(--series-6)", on_hold: "var(--series-7)", ignored: "var(--text-3)", solved: "var(--good)", closed: "var(--series-8)",
};

/** Seconds between two instants per row (negative / missing skipped), averaged; null when none. */
export function avgSpan<T>(rows: T[], start: (r: T) => string | null | undefined, end: (r: T) => string | null | undefined) {
  const xs: number[] = [];
  for (const r of rows) {
    const a = start(r), b = end(r);
    if (!a || !b) continue;
    const s = (Date.parse(b) - Date.parse(a)) / 1000;
    if (s >= 0) xs.push(s);
  }
  return { n: xs.length, average: avg(xs) };
}
/** Count of instants per local bucket (e.g. my replies per day). */
export function countPerBucket(ats: string[], range: Range, interval: Interval) {
  const buckets = bucketKeys(new Date(`${range.from}T00:00:00Z`), new Date(`${range.to}T23:59:59Z`), interval);
  const by = new Map(buckets.map((b) => [b, 0]));
  for (const at of ats) if (inR(at, range)) { const k = bucketKey(at, interval); if (by.has(k)) by.set(k, by.get(k)! + 1); }
  return buckets.map((key) => ({ key, count: by.get(key)! }));
}
export const perDay = (n: number, range: Range) => Math.round((n / rangeDays(range)) * 10) / 10;

// ================================================================ calls

export type CallTab = "overview" | "agent-performance" | "live-status" | "agentwise";
export const CALL_TABS: { id: CallTab; label: string; summary: string; metrics: string[] }[] = [
  { id: "overview", label: "Overview", summary: "Call volume and outcomes for the selected period.", metrics: ["Total, inbound and outbound calls", "Answered, missed and abandoned calls", "Average wait, talk and handle time", "Calls by hour of day and by day", "Service level (answered within target)"] },
  { id: "agent-performance", label: "Agent Performance", summary: "How each agent handles calls.", metrics: ["Calls handled and missed per agent", "Average talk, hold and after-call work time", "First-call resolution per agent", "Transfers and call-backs", "Login and ready time"] },
  { id: "live-status", label: "Agent Live Status", summary: "Who is on a call right now.", metrics: ["Agents ready, on call, on break and offline", "Current call duration per agent", "Calls waiting in queue and the longest wait", "Live service level for today"] },
  { id: "agentwise", label: "Agentwise Report", summary: "One row per agent per day, ready to export.", metrics: ["Per-agent daily call counts", "Inbound vs outbound split", "Total and average talk time", "Missed calls and call-back rate", "CSV / XLSX export"] },
];
export const callTab = (v: unknown): CallTab => (CALL_TABS.some((t) => t.id === v) ? (v as CallTab) : "overview");
/** Ticket channel kinds that represent calls (media type "phone"). */
export const PHONE_KINDS = ["phone"];

/** Days between two yyyy-mm-dd dates (helper for windows). */
export const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY);
