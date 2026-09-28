import { randomUUID } from "node:crypto";
import { query, type Query } from "@/lib/db";
import { iso } from "./util";

/**
 * Admin audit log (U13). Other packages may record their own admin-level actions:
 *   await audit(projectId, { id: user.id, name: user.name }, "ticket.export", "12 tickets");
 */
export type AuditRow = { id: string; actor_id: string | null; actor_name: string; action: string; target: string; detail: string; created_at: string };

export async function audit(projectId: string, actor: { id?: string | null; name?: string | null } | null, action: string, target = "", detail = "", q: Query = query) {
  await q("INSERT INTO cx_admin_audit(id,project_id,actor_id,actor_name,action,target,detail) VALUES($1,$2,$3,$4,$5,$6,$7)", [
    randomUUID(), projectId, actor?.id ?? null, (actor?.name ?? "System").slice(0, 120), action.slice(0, 80), target.slice(0, 300), detail.slice(0, 2000),
  ]);
}

export async function listAudit(projectId: string, f: { action?: string; actor?: string; limit?: number } = {}) {
  const rows = await query<AuditRow>(
    `SELECT id,actor_id,actor_name,action,target,detail,created_at FROM cx_admin_audit
      WHERE project_id=$1 AND ($2::text IS NULL OR action LIKE $2 || '%') AND ($3::text IS NULL OR actor_id=$3)
      ORDER BY created_at DESC LIMIT $4`,
    [projectId, f.action || null, f.actor || null, f.limit ?? 500],
  );
  return rows.map((r) => ({ ...r, created_at: iso(r.created_at)! }));
}
