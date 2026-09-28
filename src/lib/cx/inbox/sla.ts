/** SLA computation (pure, fixture-tested). Due dates are wall-clock from ticket creation. */
/** Default when the brand has no SLA policy for a priority (Team & SLAs settings): 1 h first response, 24 h resolution. */
export const DEFAULT_SLA = { firstResponseMinutes: 60, resolutionMinutes: 24 * 60 };

export function dueDates(createdAt: string | Date, policy: { firstResponseMinutes: number | null; resolutionMinutes: number | null }) {
  const t = new Date(createdAt).getTime();
  const at = (m: number | null) => (m == null ? null : new Date(t + m * 60_000).toISOString());
  return { firstResponseDue: at(policy.firstResponseMinutes), resolutionDue: at(policy.resolutionMinutes) };
}

/**
 * Combine the Team & SLAs policy result (each target independent; null = no target) with the default:
 * the 1h/24h default applies only when the priority has no policy at all.
 */
export function withDefaults(
  p: { firstResponseMinutes: number | null; resolutionMinutes: number | null; firstResponseDue: Date | string | null; resolutionDue: Date | string | null },
  from: Date | string,
) {
  if (p.firstResponseMinutes == null && p.resolutionMinutes == null) return { ...dueDates(from, DEFAULT_SLA), source: "default" as const };
  const iso = (d: Date | string | null) => (d == null ? null : new Date(d).toISOString());
  return { firstResponseDue: iso(p.firstResponseDue), resolutionDue: iso(p.resolutionDue), source: "policy" as const };
}

export type SlaTicket = { status: string; first_response_due: string | null; resolution_due: string | null; first_response_at: string | null; resolved_at: string | null };
export type SlaClock = { state: "met" | "breached" | "running" | "paused" | "n/a"; due: string | null; remainingMs: number | null; late: boolean };

const DONE = new Set(["solved", "closed"]);
function clock(due: string | null, doneAt: string | null, active: boolean, now: number): SlaClock {
  if (!due) return { state: "n/a", due: null, remainingMs: null, late: false };
  const d = new Date(due).getTime();
  if (doneAt) {
    const late = new Date(doneAt).getTime() > d;
    return { state: late ? "breached" : "met", due, remainingMs: null, late };
  }
  if (!active) return { state: "paused", due, remainingMs: null, late: false };
  return { state: now > d ? "breached" : "running", due, remainingMs: d - now, late: now > d };
}

/** First-response and resolution clocks; solved tickets without a reply count first response as n/a. */
export function slaStatus(t: SlaTicket, now: Date | number = Date.now()) {
  const n = typeof now === "number" ? now : now.getTime();
  const open = !DONE.has(t.status);
  const firstResponse = open || t.first_response_at ? clock(t.first_response_due, t.first_response_at, open, n) : { state: "n/a" as const, due: t.first_response_due, remainingMs: null, late: false };
  const resolution = clock(t.resolution_due, t.resolved_at, open, n);
  const breached: ("first_response" | "resolution")[] = [];
  if (firstResponse.state === "breached") breached.push("first_response");
  if (resolution.state === "breached") breached.push("resolution");
  return { firstResponse, resolution, breached };
}

/** "12m", "3h 5m", "2d 4h" (absolute). */
export function formatSpan(ms: number) {
  const m = Math.round(Math.abs(ms) / 60_000);
  if (m < 1) return "<1m";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h${m % 60 ? ` ${m % 60}m` : ""}`;
  return `${Math.floor(h / 24)}d${h % 24 ? ` ${h % 24}h` : ""}`;
}
