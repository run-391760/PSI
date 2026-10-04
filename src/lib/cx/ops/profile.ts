import { z } from "zod";
import { query } from "@/lib/db";
import { listCxBrands, type CxRole } from "@/lib/cx/context";
import { normNotify, type NotifyPrefs } from "./model";

/** My Profile (server-only): name, notification preferences (cx_ops_user_prefs) and brand memberships. */

/** Notification preferences of a user (defaults when never saved). Used by the task module before notifying. */
export async function getNotifyPrefs(userId: string): Promise<NotifyPrefs> {
  const [r] = await query<{ prefs: Partial<NotifyPrefs> | null }>("SELECT prefs FROM cx_ops_user_prefs WHERE user_id=$1", [userId]);
  return normNotify(r?.prefs);
}

/** Merge a patch into the user's notification preferences; returns the saved values. */
export async function saveNotifyPrefs(userId: string, patch: Partial<NotifyPrefs>): Promise<NotifyPrefs> {
  const next = normNotify({ ...(await getNotifyPrefs(userId)), ...pickNotify(patch) });
  await query(
    `INSERT INTO cx_ops_user_prefs(user_id,prefs,updated_at) VALUES($1,$2::jsonb,now())
     ON CONFLICT(user_id) DO UPDATE SET prefs=cx_ops_user_prefs.prefs || excluded.prefs, updated_at=now()`,
    [userId, JSON.stringify(next)],
  );
  return next;
}

function pickNotify(p: Partial<NotifyPrefs>): Partial<NotifyPrefs> {
  const out: Partial<NotifyPrefs> = {};
  for (const k of ["taskAssigned", "taskDue", "ticketAssigned", "mentions", "dailyDigest"] as const) if (typeof p?.[k] === "boolean") out[k] = p[k];
  return out;
}

export const nameInput = z.string().trim().min(1, "Enter your name.").max(80, "Use at most 80 characters.");

export async function updateUserName(userId: string, name: string) {
  const clean = nameInput.parse(name).replace(/\s+/g, " ");
  await query("UPDATE users SET name=$2 WHERE id=$1", [userId, clean]);
  return clean;
}

export type MembershipRow = { id: string; name: string; domain: string; role: CxRole; team: string | null; joined: string | null };

/** The user's account facts and every brand they can open in CX with their role there. */
export async function profileData(userId: string) {
  const [[u], brands, teams] = await Promise.all([
    query<{ name: string; email: string; created_at: string }>("SELECT name,email,created_at FROM users WHERE id=$1", [userId]),
    listCxBrands(userId),
    query<{ project_id: string; team: string | null; created_at: string }>(
      "SELECT m.project_id, t.name team, m.created_at FROM cx_members m LEFT JOIN cx_teams t ON t.id=m.team_id WHERE m.user_id=$1",
      [userId],
    ),
  ]);
  const memberships: MembershipRow[] = brands.map((b) => {
    const m = teams.find((t) => t.project_id === b.id);
    return { id: b.id, name: b.name, domain: b.domain, role: b.role, team: m?.team ?? null, joined: m ? new Date(m.created_at).toISOString() : b.role === "owner" ? new Date(b.created_at).toISOString() : null };
  });
  return { name: u?.name ?? "", email: u?.email ?? "", since: u ? new Date(u.created_at).toISOString() : null, memberships };
}
