import { query } from "@/lib/db";

/** Notification center queries (notifications table from the core schema; all tools write to it). */
export type NotificationFilter = { tool?: string; severity?: "info" | "success" | "warning" | "critical"; project?: string; unread?: boolean };
export type NotificationItem = {
  id: string;
  tool: string;
  severity: "info" | "success" | "warning" | "critical";
  title: string;
  body: string;
  link: string | null;
  projectId: string | null;
  projectName: string | null;
  read: boolean;
  createdAt: string;
};

function where(ownerId: string, f: NotificationFilter, start = 1) {
  const clauses = [`n.owner_id=$${start}`];
  const params: unknown[] = [ownerId];
  const add = (sql: string, v: unknown) => {
    params.push(v);
    clauses.push(sql.replace("?", `$${start + params.length - 1}`));
  };
  if (f.tool) add("n.tool=?", f.tool);
  if (f.severity) add("n.severity=?", f.severity);
  if (f.project) add("n.project_id=?", f.project);
  if (f.unread) clauses.push("n.read_at IS NULL");
  return { sql: clauses.join(" AND "), params };
}

export async function listNotifications(ownerId: string, f: NotificationFilter, limit = 50, offset = 0) {
  const w = where(ownerId, f);
  const rows = await query<{ id: string; tool: string; severity: NotificationItem["severity"]; title: string; body: string; link: string | null; project_id: string | null; project_name: string | null; read_at: string | null; created_at: string }>(
    `SELECT n.*, p.name AS project_name FROM notifications n LEFT JOIN projects p ON p.id=n.project_id WHERE ${w.sql}
     ORDER BY n.created_at DESC LIMIT ${Number(limit)} OFFSET ${Number(offset)}`,
    w.params,
  );
  const [{ total }] = await query<{ total: number }>(`SELECT count(*)::int AS total FROM notifications n WHERE ${w.sql}`, w.params);
  return {
    total,
    items: rows.map(
      (r): NotificationItem => ({
        id: r.id,
        tool: r.tool,
        severity: r.severity,
        title: r.title,
        body: r.body,
        link: r.link,
        projectId: r.project_id,
        projectName: r.project_name,
        read: r.read_at != null,
        createdAt: new Date(r.created_at).toISOString(),
      }),
    ),
  };
}

/** Counts for the filter chips (all notifications of the user). */
export async function notificationFacets(ownerId: string) {
  const [tools, severities, projects, [totals]] = await Promise.all([
    query<{ tool: string; total: number; unread: number }>(
      "SELECT tool, count(*)::int AS total, count(*) FILTER (WHERE read_at IS NULL)::int AS unread FROM notifications WHERE owner_id=$1 GROUP BY tool ORDER BY tool",
      [ownerId],
    ),
    query<{ severity: string; total: number; unread: number }>(
      "SELECT severity, count(*)::int AS total, count(*) FILTER (WHERE read_at IS NULL)::int AS unread FROM notifications WHERE owner_id=$1 GROUP BY severity",
      [ownerId],
    ),
    query<{ project_id: string; total: number }>("SELECT project_id, count(*)::int AS total FROM notifications WHERE owner_id=$1 AND project_id IS NOT NULL GROUP BY project_id", [ownerId]),
    query<{ total: number; unread: number; week: number }>(
      "SELECT count(*)::int AS total, count(*) FILTER (WHERE read_at IS NULL)::int AS unread, count(*) FILTER (WHERE created_at > now() - interval '7 days')::int AS week FROM notifications WHERE owner_id=$1",
      [ownerId],
    ),
  ]);
  return { tools, severities, projects, totals };
}

export async function markNotifications(ownerId: string, target: { ids?: string[]; filter?: NotificationFilter }, read: boolean) {
  if (target.ids) {
    if (!target.ids.length) return 0;
    const res = await query(
      `UPDATE notifications SET read_at=${read ? "COALESCE(read_at, now())" : "NULL"} WHERE owner_id=$1 AND id IN (SELECT jsonb_array_elements_text($2::jsonb)) RETURNING id`,
      [ownerId, JSON.stringify(target.ids)],
    );
    return res.length;
  }
  const w = where(ownerId, { ...target.filter, unread: true });
  const res = await query(`UPDATE notifications n SET read_at=now() WHERE ${w.sql} RETURNING n.id`, w.params);
  return res.length;
}

export async function deleteNotifications(ownerId: string, target: { ids?: string[]; filter?: NotificationFilter; readOnly?: boolean }) {
  if (target.ids) {
    if (!target.ids.length) return 0;
    const res = await query("DELETE FROM notifications WHERE owner_id=$1 AND id IN (SELECT jsonb_array_elements_text($2::jsonb)) RETURNING id", [ownerId, JSON.stringify(target.ids)]);
    return res.length;
  }
  const w = where(ownerId, { ...target.filter, unread: false });
  const res = await query(`DELETE FROM notifications n WHERE ${w.sql}${target.readOnly ? " AND n.read_at IS NOT NULL" : ""} RETURNING n.id`, w.params);
  return res.length;
}
