/** Queue engine (pure, fixture-tested): assignment types, eligibility, segments, ordering, cleanup, breaks. */
export type AssignmentType = "round_robin" | "rr_one_by_one" | "rr_availability" | "equal" | "priority";
export const ASSIGNMENT_TYPES: { value: AssignmentType; label: string; description: string }[] = [
  { value: "round_robin", label: "Round robin", description: "Rotate through every queue agent who isn't paused, up to each agent's limit." },
  { value: "rr_one_by_one", label: "Round robin (one by one)", description: "Rotate, but an agent gets the next ticket only after finishing the current one." },
  { value: "rr_availability", label: "Round robin (availability)", description: "Rotate only among agents whose status is available (not on a break) and within office hours." },
  { value: "equal", label: "Equal load", description: "Give each ticket to the available agent with the fewest open queued tickets." },
  { value: "priority", label: "Priority (sticky)", description: "Send a returning customer to the agent who last handled them; otherwise equal load." },
];

export type QueueAgent = {
  id: string;
  status: "available" | "break" | "offline";
  paused: boolean;
  load: number;
  capacity: number;
  lastAssignedAt: string | null;
  officeStart?: string | null;
  officeEnd?: string | null;
  timezone?: string | null;
};

const minutes = (hhmm: string) => { const [h, m] = hhmm.split(":").map(Number); return (h || 0) * 60 + (m || 0); };
/** Local minutes-of-day of `now` in `tz`. */
export function localMinutes(now: Date, tz: string) {
  try {
    const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", hour: "2-digit", minute: "2-digit" }).formatToParts(now).map((x) => [x.type, x.value]));
    return (Number(p.hour) % 24) * 60 + Number(p.minute);
  } catch {
    return now.getUTCHours() * 60 + now.getUTCMinutes();
  }
}
/** Within office hours (overnight windows like 22:00–06:00 supported). No hours set = always. */
export function inOffice(now: Date, start?: string | null, end?: string | null, tz?: string | null) {
  if (!start || !end) return true;
  const m = localMinutes(now, tz || "UTC"), s = minutes(start), e = minutes(end);
  return s <= e ? m >= s && m < e : m >= s || m < e;
}

/** Agents that may receive a ticket now under the given assignment type. */
export function eligible(type: AssignmentType, agents: QueueAgent[], now: Date, byTimezone = false) {
  return agents.filter((a) => {
    if (a.paused || a.status === "offline") return false;
    if (a.load >= a.capacity) return false;
    if (type === "rr_one_by_one" && a.load > 0) return false;
    if ((type === "rr_availability" || type === "equal" || type === "priority") && a.status !== "available") return false;
    if (type === "round_robin" && a.status === "break") return false;
    if ((byTimezone || type === "rr_availability") && !inOffice(now, a.officeStart, a.officeEnd, a.timezone)) return false;
    return true;
  });
}

/**
 * Pick an agent. Round-robin types walk the full (id-sorted) agent list from `cursor`, so the rotation is
 * stable when agents come and go; returns the new cursor.
 */
export function pickAgent(type: AssignmentType, agents: QueueAgent[], opts: { cursor: number; previousAgentId?: string | null; now?: Date; byTimezone?: boolean }) {
  const now = opts.now ?? new Date();
  const all = [...agents].sort((a, b) => a.id.localeCompare(b.id));
  const ok = new Set(eligible(type, all, now, opts.byTimezone).map((a) => a.id));
  if (!ok.size) return { agentId: null as string | null, cursor: opts.cursor };
  if (type === "priority" && opts.previousAgentId && ok.has(opts.previousAgentId)) return { agentId: opts.previousAgentId, cursor: opts.cursor };
  if (type === "equal" || type === "priority") {
    const best = all
      .filter((a) => ok.has(a.id))
      .sort((a, b) => a.load / Math.max(1, a.capacity) - b.load / Math.max(1, b.capacity) || a.load - b.load || (a.lastAssignedAt ? Date.parse(a.lastAssignedAt) : 0) - (b.lastAssignedAt ? Date.parse(b.lastAssignedAt) : 0) || a.id.localeCompare(b.id))[0];
    return { agentId: best.id, cursor: opts.cursor };
  }
  for (let i = 0; i < all.length; i++) {
    const idx = (opts.cursor + i) % all.length;
    if (ok.has(all[idx].id)) return { agentId: all[idx].id, cursor: (idx + 1) % all.length };
  }
  return { agentId: null, cursor: opts.cursor };
}

/** Distribute several waiting tickets in order, updating loads as it goes. */
export function distribute(type: AssignmentType, agents: QueueAgent[], ticketIds: { id: string; previousAgentId?: string | null }[], cursor: number, now = new Date(), byTimezone = false) {
  const pool = agents.map((a) => ({ ...a }));
  const out: { ticketId: string; agentId: string }[] = [];
  let c = cursor;
  for (const t of ticketIds) {
    const r = pickAgent(type, pool, { cursor: c, previousAgentId: t.previousAgentId, now, byTimezone });
    if (!r.agentId) break;
    c = r.cursor;
    const a = pool.find((x) => x.id === r.agentId)!;
    a.load++;
    a.lastAssignedAt = now.toISOString();
    out.push({ ticketId: t.id, agentId: r.agentId });
  }
  return { assignments: out, cursor: c };
}

// ---------------------------------------------------------------- segments and ordering

export type Segment = { id: string; name: string; weight: number; match: { field: "contact_tag" | "email_domain" | "channel" | "priority"; values: string[] }[] };
/** First segment (highest weight) whose rules all match. */
export function segmentFor(segments: Segment[], t: { contactTags: string[]; email: string | null; channel: string; priority: string }) {
  const lc = (xs: string[]) => xs.map((x) => x.trim().toLowerCase());
  for (const s of [...segments].sort((a, b) => b.weight - a.weight)) {
    const ok = s.match.length > 0 && s.match.every((m) => {
      const vals = lc(m.values);
      if (m.field === "contact_tag") return lc(t.contactTags).some((x) => vals.includes(x));
      if (m.field === "email_domain") return vals.includes((t.email ?? "").split("@")[1]?.toLowerCase() ?? "");
      if (m.field === "channel") return vals.includes(t.channel.toLowerCase());
      return vals.includes(t.priority.toLowerCase());
    });
    if (ok) return s;
  }
  return null;
}

const PRI: Record<string, number> = { urgent: 3, high: 2, normal: 1, low: 0 };
/** Queue order: segment weight, then priority, then nearest SLA due, then oldest. */
export function orderQueue<T extends { id: string; segmentWeight: number; priority: string; due: string | null; created_at: string }>(rows: T[]) {
  return [...rows].sort((a, b) =>
    b.segmentWeight - a.segmentWeight || (PRI[b.priority] ?? 1) - (PRI[a.priority] ?? 1) ||
    (a.due ? Date.parse(a.due) : Infinity) - (b.due ? Date.parse(b.due) : Infinity) || Date.parse(a.created_at) - Date.parse(b.created_at));
}

/** Smart cleanup: a queued ticket with no agent action for `minutes` since assignment returns to Unassigned. */
export function cleanupDue(assignedAt: string, lastAgentActionAt: string | null, minutesLimit: number | null, now = new Date()) {
  if (!minutesLimit) return false;
  const since = Math.max(Date.parse(assignedAt), lastAgentActionAt ? Date.parse(lastAgentActionAt) : 0);
  return now.getTime() - since >= minutesLimit * 60_000;
}

/** Break overrun: status with a limit held longer than the limit. */
export function breakOverrun(since: string, limitMinutes: number | null | undefined, now = new Date()) {
  return !!limitMinutes && now.getTime() - Date.parse(since) > limitMinutes * 60_000;
}

/** Queue timer colour: green under the threshold, red after (C16). */
export function queueTimer(queuedAt: string | null, thresholdMinutes: number, now = new Date()) {
  if (!queuedAt) return null;
  const mins = Math.floor((now.getTime() - Date.parse(queuedAt)) / 60_000);
  return { minutes: mins, tone: mins < thresholdMinutes ? ("good" as const) : ("critical" as const) };
}
