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

const iso = (v: Date | string) => new Date(v).toISOString();
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

/**
 * Merge SLA, unassigned and crisis signals into one prioritised list: breached SLAs first (most
 * overdue first), then open crises (critical first), then SLAs due within the risk window, then the
 * oldest unassigned tickets. A ticket appears once (its most urgent reason).
 */
export function buildAttention(input: { sla: TicketRow[]; unassigned: TicketRow[]; crises: CrisisRow[] }, now: Date, limit = 8): AttentionItem[] {
  const t0 = now.getTime();
  const seen = new Set<string>();
  const breached: AttentionItem[] = [];
  const risk: AttentionItem[] = [];
  const label = (t: TicketRow) => `#${t.number} ${t.subject || "(no subject)"}`;
  for (const t of [...input.sla].sort((a, b) => (nextDue(a) ?? Infinity) - (nextDue(b) ?? Infinity))) {
    const due = nextDue(t);
    if (due == null || seen.has(t.id)) continue;
    if (due > t0 + SLA_RISK_MINUTES * 60000) continue;
    seen.add(t.id);
    const which = t.first_response_at == null && ms(t.first_response_due) === due ? "First response" : "Resolution";
    const item: AttentionItem = { key: `t:${t.id}`, ticketId: t.id, title: label(t), at: new Date(due).toISOString(), kind: due < t0 ? "sla_breached" : "sla_risk", detail: `${which} ${due < t0 ? "overdue" : "due"} ${relTime(due, t0)}` };
    (due < t0 ? breached : risk).push(item);
  }
  const crises: AttentionItem[] = [...input.crises]
    .filter((c) => c.status !== "resolved")
    .sort((a, b) => Number(b.severity === "critical") - Number(a.severity === "critical") || ms(b.detected_at)! - ms(a.detected_at)!)
    .map((c) => ({ key: `c:${c.id}`, crisisId: c.id, kind: "crisis", title: c.title, severity: c.severity === "critical" ? "critical" : "warning", at: iso(c.detected_at), detail: `${c.severity === "critical" ? "Critical" : "Warning"} · ${c.status} · detected ${relTime(ms(c.detected_at)!, t0)}` }));
  const unassigned: AttentionItem[] = [];
  for (const t of [...input.unassigned].sort((a, b) => ms(a.created_at)! - ms(b.created_at)!)) {
    if (seen.has(t.id)) continue;
    seen.add(t.id);
    unassigned.push({ key: `t:${t.id}`, ticketId: t.id, kind: "unassigned", title: label(t), at: iso(t.created_at), detail: `Unassigned · waiting ${relTime(ms(t.created_at)!, t0).replace(" ago", "")}${t.priority === "urgent" || t.priority === "high" ? ` · ${t.priority}` : ""}` });
  }
  return [...breached, ...crises, ...risk, ...unassigned].slice(0, limit);
}

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

/** Missing is not zero: without a channel/SLA policy/topic, the KPI is n/a with a setup link. */
export function headlineKpis(k: KpiInput) {
  const noTickets = k.channels === 0 && k.tickets === 0;
  const connect = { label: "Connect a channel", href: "/cx/settings/channels" };
  const open: Kpi = noTickets ? { value: null, sub: "No channel connected", setup: connect } : { value: k.open, sub: k.open ? "Not solved or closed" : "Nothing waiting" };
  const unassigned: Kpi = noTickets
    ? { value: null, sub: "No channel connected", setup: connect }
    : { value: k.unassigned, sub: k.queued == null || k.queued === 0 ? (k.unassigned ? "Open tickets with no assignee" : "Everything has an owner") : `${k.queued} waiting in queue` };
  const sla: Kpi = !k.slaConfigured
    ? { value: null, sub: "No SLA targets set", setup: { label: "Set SLA targets", href: "/cx/settings/team?tab=sla" } }
    : noTickets
      ? { value: null, sub: "No channel connected", setup: connect }
      : { value: k.slaRisk, sub: k.slaBreached ? `${k.slaBreached} already breached` : `Due within ${SLA_RISK_MINUTES} min or overdue` };
  const negative: Kpi = k.topics === 0
    ? { value: null, sub: "No listening topic", setup: { label: "Add a topic", href: "/cx/listening/topics" } }
    : { value: k.negativeToday, sub: k.mentionsToday ? `of ${k.mentionsToday} mentions today` : "No mentions today yet" };
  return { open, unassigned, sla, negative };
}
