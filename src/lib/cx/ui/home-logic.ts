/** CX overview ("calm landing"): pure helpers for headline KPIs and the "Needs attention" list. */

export type AttentionKind = "sla_breached" | "sla_risk" | "unassigned" | "crisis";
export type AttentionItem = { key: string; kind: AttentionKind; title: string; detail: string; at: string; ticketId?: string; crisisId?: string; severity?: "warning" | "critical" };

export type TicketRow = {
  id: string;
  number: number;
  subject: string;
  priority: string;
  channel_kind: string;
  created_at: Date | string;
  first_response_at: Date | string | null;
  first_response_due: Date | string | null;
  resolution_due: Date | string | null;
};
export type CrisisRow = { id: string; title: string; severity: string; status: string; detected_at: Date | string };

const ms = (v: Date | string | null | undefined) => (v == null ? null : new Date(v).getTime());

/** Earliest unmet SLA deadline of an open ticket (first response if not yet answered, else resolution). */
export function nextDue(t: Pick<TicketRow, "first_response_at" | "first_response_due" | "resolution_due">): number | null {
  const due = [t.first_response_at == null ? ms(t.first_response_due) : null, ms(t.resolution_due)].filter((x): x is number => x != null);
  return due.length ? Math.min(...due) : null;
}

/** "in 25m", "3h ago", "2d ago" relative to now (no locale dependency, testable). */
export function relTime(at: number, now: number) {
  const d = Math.round((at - now) / 60000);
  const abs = Math.abs(d);
  const s = abs < 60 ? `${abs}m` : abs < 48 * 60 ? `${Math.round(abs / 60)}h` : `${Math.round(abs / 1440)}d`;
  return d >= 0 ? `in ${s}` : `${s} ago`;
}

export const SLA_RISK_MINUTES = 60;

/** Headline KPI value: a number, or null ("n/a") when its data source isn't set up yet. */
export type Kpi = { value: number | null; sub: string; setup?: { label: string; href: string } };

export type KpiInput = {
  channels: number;
  tickets: number;
  open: number;
  unassigned: number;
  queued: number | null;
  slaConfigured: boolean;
  slaRisk: number;
  slaBreached: number;
  topics: number;
  negativeToday: number;
  mentionsToday: number;
};
