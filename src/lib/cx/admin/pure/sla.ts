/** SLA / TAT v2 math (pure, fixture-tested): rule selection, TAT start, ERT, pre-breach tiers, escalation levels. */
import { addBusinessMinutes, type DayHours, type Holiday } from "@/lib/cx/insights/metrics";
import { localMinutes } from "./queue";

export type SlaRule = {
  id: string; name: string; priority: string | null; channels: string[]; segment: string | null; team: string | null;
  first_response_minutes: number | null; every_response_minutes: number | null; resolution_minutes: number | null;
  business_hours: boolean; start_from: "created" | "queued"; valid_from: string | null; valid_to: string | null;
  windows: { start: string; end: string }[]; active: boolean; position: number;
};
export type SlaSubject = { priority: string; channel: string; segment: string | null; team: string | null };

const hm = (s: string) => { const [h, m] = s.split(":").map(Number); return (h || 0) * 60 + (m || 0); };
const localDate = (d: Date, tz: string) => {
  try { return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(d); } catch { return d.toISOString().slice(0, 10); }
};

/** The first active rule (by position) whose criteria, date range and daily time windows (≤3) all match. */
export function selectSlaRule(rules: SlaRule[], t: SlaSubject, at: Date, tz = "UTC") {
  const day = localDate(at, tz), mins = localMinutes(at, tz);
  return [...rules].sort((a, b) => a.position - b.position).find((r) => {
    if (!r.active) return false;
    if (r.priority && r.priority !== t.priority) return false;
    if (r.channels.length && !r.channels.includes(t.channel)) return false;
    if (r.segment && r.segment !== t.segment) return false;
    if (r.team && r.team !== t.team) return false;
    if (r.valid_from && day < r.valid_from) return false;
    if (r.valid_to && day > r.valid_to) return false;
    if (r.windows.length && !r.windows.slice(0, 3).some((w) => { const s = hm(w.start), e = hm(w.end); return s <= e ? mins >= s && mins < e : mins >= s || mins < e; })) return false;
    return true;
  }) ?? null;
}

/** TAT clock start: ticket publish (created) time, or the time it was assigned from the queue (J7). */
export const tatStart = (createdAt: string | Date, queuedAt: string | Date | null, from: "created" | "queued") => new Date(from === "queued" && queuedAt ? queuedAt : createdAt);

export type Hours = { hours: DayHours[]; holidays: Holiday[]; timezone: string } | null;
export function addTat(start: Date, minutes: number | null, hours: Hours) {
  if (minutes == null) return null;
  return hours ? addBusinessMinutes(start, minutes, hours.hours, hours.holidays, hours.timezone) : new Date(start.getTime() + minutes * 60_000);
}

export function ruleDueDates(rule: Pick<SlaRule, "first_response_minutes" | "resolution_minutes" | "business_hours">, start: Date, hours: Hours) {
  const h = rule.business_hours ? hours : null;
  return { firstResponseDue: addTat(start, rule.first_response_minutes, h)?.toISOString() ?? null, resolutionDue: addTat(start, rule.resolution_minutes, h)?.toISOString() ?? null };
}

type Msg = { direction: "in" | "out" | "note"; created_at: string };
/**
 * Every-response time (ERT): for each run of customer messages, the time until the next agent reply.
 * Returns response spans (ms) and the timestamp of the oldest still-unanswered customer message.
 */
export function responseSpans(messages: Msg[]) {
  const sorted = [...messages].filter((m) => m.direction !== "note").sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at));
  const spans: number[] = [];
  let waiting: number | null = null;
  for (const m of sorted) {
    const t = Date.parse(m.created_at);
    if (m.direction === "in") waiting ??= t;
    else if (waiting != null) { spans.push(t - waiting); waiting = null; }
  }
  return { spans, unansweredSince: waiting == null ? null : new Date(waiting).toISOString() };
}

/** Next-response due for ERT: oldest unanswered customer message + ERT minutes (null when nothing is waiting). */
export function nextResponseDue(messages: Msg[], everyResponseMinutes: number | null, hours: Hours) {
  if (!everyResponseMinutes) return null;
  const { unansweredSince } = responseSpans(messages);
  return unansweredSince ? addTat(new Date(unansweredSince), everyResponseMinutes, hours)?.toISOString() ?? null : null;
}

/** Pre-breach tiers crossed (percent of the start→due span elapsed), e.g. [75, 90]. */
export function prebreachTiers(start: string | Date, due: string | Date | null, tiers: number[], now = new Date()) {
  if (!due) return [];
  const s = new Date(start).getTime(), d = new Date(due).getTime();
  if (d <= s) return [];
  const pct = ((now.getTime() - s) / (d - s)) * 100;
  return tiers.filter((t) => t > 0 && t < 100 && pct >= t).sort((a, b) => a - b);
}

export type EscalationLevel = { afterMinutes: number; notifyUserIds: string[]; emails: string[]; reassignTo: string | null; priority: string | null };
/** Highest escalation level reached: level n applies `afterMinutes` after the breach. */
export function escalationLevel(breachedAt: string | Date | null, levels: EscalationLevel[], now = new Date()) {
  if (!breachedAt) return 0;
  const since = (now.getTime() - new Date(breachedAt).getTime()) / 60_000;
  if (since < 0) return 0;
  let level = 0;
  levels.forEach((l, i) => { if (since >= l.afterMinutes) level = i + 1; });
  return level;
}

/** HH:MM:SS for exports (J6). */
export function hms(ms: number | null | undefined) {
  if (ms == null || Number.isNaN(ms)) return "";
  const s = Math.max(0, Math.round(ms / 1000));
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(Math.floor(s / 3600))}:${p(Math.floor((s % 3600) / 60))}:${p(s % 60)}`;
}
