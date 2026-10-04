import { query } from "@/lib/db";
import type { CxBrand } from "@/lib/cx/context";
import { listMembers } from "@/lib/cx/insights/team";
import { getSettings, storageUsed } from "@/lib/cx/publishing/data";
import { monthlySpend } from "@/lib/providers/dataforseo";
import { globalBudgetUsd, maxMonthlyUsd, spendByEndpoint } from "@/lib/reports/platform";
import { monthSeries } from "./model";

/** Plan & usage (server-only): real seats, channels, monthly volume, storage and paid-API spend. No plan limits exist. */

const MONTHS = 6;
type MonthRow = { month: string; n: number };

function windowStart(now = new Date()) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (MONTHS - 1), 1)).toISOString();
}

async function perMonth(sql: string, params: unknown[]) {
  const rows = await query<MonthRow>(sql, params);
  return monthSeries(rows.map((r) => ({ month: r.month, n: Number(r.n) })), MONTHS);
}

export async function planUsage(brand: CxBrand) {
  const start = windowStart();
  const canSeeSpend = brand.role === "owner" || brand.role === "admin";
  const [members, channels, tickets, messagesIn, messagesOut, mentions, [inbox], pub, settings, [contacts], spend] = await Promise.all([
    listMembers(brand.id),
    query<{ kind: string; status: string; n: number; last_synced_at: string | null }>(
      "SELECT kind,status,count(*)::int n,max(last_synced_at) last_synced_at FROM cx_channels WHERE project_id=$1 GROUP BY kind,status ORDER BY kind,status",
      [brand.id],
    ),
    perMonth(
      "SELECT to_char(created_at AT TIME ZONE 'UTC','YYYY-MM') AS month, count(*)::int n FROM cx_tickets WHERE project_id=$1 AND created_at >= $2 GROUP BY 1",
      [brand.id, start],
    ),
    perMonth(
      `SELECT to_char(m.created_at AT TIME ZONE 'UTC','YYYY-MM') AS month, count(*)::int n FROM cx_messages m JOIN cx_tickets t ON t.id=m.ticket_id
        WHERE t.project_id=$1 AND m.created_at >= $2 AND m.direction='in' GROUP BY 1`,
      [brand.id, start],
    ),
    perMonth(
      `SELECT to_char(m.created_at AT TIME ZONE 'UTC','YYYY-MM') AS month, count(*)::int n FROM cx_messages m JOIN cx_tickets t ON t.id=m.ticket_id
        WHERE t.project_id=$1 AND m.created_at >= $2 AND m.direction='out' GROUP BY 1`,
      [brand.id, start],
    ),
    perMonth(
      "SELECT to_char(fetched_at AT TIME ZONE 'UTC','YYYY-MM') AS month, count(*)::int n FROM cx_mentions WHERE project_id=$1 AND fetched_at >= $2 GROUP BY 1",
      [brand.id, start],
    ),
    query<{ bytes: number; files: number }>("SELECT COALESCE(sum(size),0)::float8 bytes, count(*)::int files FROM cx_inbox_files WHERE project_id=$1", [brand.id]),
    storageUsed(brand.id),
    getSettings(brand.id),
    query<{ n: number }>("SELECT count(*)::int n FROM cx_contacts WHERE project_id=$1", [brand.id]),
    canSeeSpend ? ownerSpend(brand.owner_id) : Promise.resolve(null),
  ]);

  const roles: Record<string, number> = { admin: 0, supervisor: 0, agent: 0, viewer: 0 };
  for (const m of members) if (!m.owner) roles[m.role] = (roles[m.role] ?? 0) + 1;

  const byKind = new Map<string, { kind: string; active: number; paused: number; error: number; lastSynced: string | null }>();
  for (const c of channels) {
    const k = byKind.get(c.kind) ?? { kind: c.kind, active: 0, paused: 0, error: 0, lastSynced: null };
    if (c.status === "active" || c.status === "paused" || c.status === "error") k[c.status] += c.n;
    const ls = c.last_synced_at ? new Date(c.last_synced_at).toISOString() : null;
    if (ls && (!k.lastSynced || ls > k.lastSynced)) k.lastSynced = ls;
    byKind.set(c.kind, k);
  }

  const volume = tickets.map((t, i) => ({ month: t.month, tickets: t.n, messagesIn: messagesIn[i]?.n ?? 0, messagesOut: messagesOut[i]?.n ?? 0, mentions: mentions[i]?.n ?? 0 }));

  return {
    seats: {
      total: members.length,
      owner: members.find((m) => m.owner) ?? null,
      roles,
      members: members.map((m) => ({ id: m.id, name: m.name || m.email, email: m.email, role: m.owner ? "owner" : m.role, team: m.team_name })),
    },
    channels: [...byKind.values()].sort((a, b) => a.kind.localeCompare(b.kind)),
    volume,
    contacts: contacts?.n ?? 0,
    storage: {
      inboxBytes: Number(inbox?.bytes ?? 0),
      inboxFiles: inbox?.files ?? 0,
      pubBytes: pub.bytes,
      pubFiles: pub.files,
      pubQuotaMb: settings.quotaMb,
    },
    spend,
    canSeeSpend,
  };
}

async function ownerSpend(ownerId: string) {
  const [spent, [u], endpoints] = await Promise.all([
    monthlySpend(ownerId),
    query<{ monthly_budget_micros: string; name: string; email: string }>("SELECT monthly_budget_micros,name,email FROM users WHERE id=$1", [ownerId]),
    spendByEndpoint(ownerId),
  ]);
  const cap = maxMonthlyUsd();
  const budget = u ? Math.min(Number(u.monthly_budget_micros) / 1e6, cap) : null;
  return { spent, budget, cap, globalCap: globalBudgetUsd(), ownerName: u?.name || u?.email || "Brand owner", endpoints: endpoints.slice(0, 6) };
}

export type PlanUsage = Awaited<ReturnType<typeof planUsage>>;
