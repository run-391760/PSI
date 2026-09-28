import { randomUUID } from "node:crypto";
import { query } from "@/lib/db";
import { AppError } from "@/lib/domain";
import { inviteMember, listTeams, saveTeam } from "@/lib/cx/insights/team";
import { audit } from "./audit";
import { ACTION_PERMS, effectivePermissions, PAGE_PERMS, parseUserImport, type BaseRole, type Permission, type RoleDef } from "./pure/permissions";
import { parseCsv } from "./pure/fields";

/**
 * Custom roles with page and action permissions (U2–U5), bulk user import (U8).
 * Other packages check permissions with:
 *   if (!(await can(projectId, user.id, "reply_public"))) throw new AppError("…", 403);
 *   const perms = await permissionsFor(projectId, user.id);   // { base, role, perms: string[] }
 */
export type CustomRole = RoleDef & { description: string; members: number; created_at: string };

export async function baseRole(projectId: string, userId: string): Promise<BaseRole | null> {
  const [r] = await query<{ owner: boolean; role: string | null }>(
    "SELECT (p.owner_id=$2) AS owner, (SELECT role FROM cx_members m WHERE m.project_id=p.id AND m.user_id=$2) AS role FROM projects p WHERE p.id=$1",
    [projectId, userId],
  );
  if (!r) return null;
  if (r.owner) return "owner";
  return (r.role as BaseRole | null) ?? null;
}

export async function permissionsFor(projectId: string, userId: string) {
  const base = await baseRole(projectId, userId);
  const [role] = await query<RoleDef>(
    "SELECT r.id,r.name,r.pages,r.actions FROM cx_admin_member_roles mr JOIN cx_admin_roles r ON r.id=mr.role_id WHERE mr.project_id=$1 AND mr.user_id=$2",
    [projectId, userId],
  );
  const perms = effectivePermissions(base, role ?? null);
  return { base, role: role ?? null, perms: [...perms] };
}

export async function can(projectId: string, userId: string, perm: Permission | `status:${string}`) {
  const { perms } = await permissionsFor(projectId, userId);
  return perms.includes(perm);
}

/** Throw 403 unless the user holds the permission. */
export async function requirePermission(projectId: string, userId: string, perm: Permission | `status:${string}`, what = "do that") {
  if (!(await can(projectId, userId, perm))) throw new AppError(`Your role can't ${what}.`, 403);
}

export async function listRoles(projectId: string): Promise<CustomRole[]> {
  const rows = await query<CustomRole>(
    "SELECT r.id,r.name,r.description,r.pages,r.actions,r.created_at,(SELECT count(*)::int FROM cx_admin_member_roles m WHERE m.role_id=r.id) AS members FROM cx_admin_roles r WHERE r.project_id=$1 ORDER BY r.name",
    [projectId],
  );
  return rows.map((r) => ({ ...r, created_at: new Date(r.created_at).toISOString() }));
}

export async function saveRole(projectId: string, r: { id?: string; name: string; description: string; pages: string[]; actions: string[] }, actor: { id: string; name: string }) {
  const name = r.name.trim().slice(0, 60);
  if (!name) throw new AppError("Name the role.");
  const pages = r.pages.filter((p) => PAGE_PERMS.some((x) => x.key === p));
  const actions = r.actions.filter((a) => ACTION_PERMS.some((x) => x.key === a));
  const [dupe] = await query("SELECT 1 FROM cx_admin_roles WHERE project_id=$1 AND lower(name)=lower($2) AND id<>COALESCE($3,'')", [projectId, name, r.id ?? null]);
  if (dupe) throw new AppError("A role with that name exists.");
  if (r.id) {
    await query("UPDATE cx_admin_roles SET name=$3,description=$4,pages=$5::jsonb,actions=$6::jsonb WHERE id=$1 AND project_id=$2", [r.id, projectId, name, r.description.slice(0, 300), JSON.stringify(pages), JSON.stringify(actions)]);
    await audit(projectId, actor, "role.update", name, `${pages.length} pages, ${actions.length} actions`);
    return r.id;
  }
  const id = randomUUID();
  await query("INSERT INTO cx_admin_roles(id,project_id,name,description,pages,actions) VALUES($1,$2,$3,$4,$5::jsonb,$6::jsonb)", [id, projectId, name, r.description.slice(0, 300), JSON.stringify(pages), JSON.stringify(actions)]);
  await audit(projectId, actor, "role.create", name, `${pages.length} pages, ${actions.length} actions`);
  return id;
}

export async function deleteRole(projectId: string, id: string, actor: { id: string; name: string }) {
  const [r] = await query<{ name: string }>("DELETE FROM cx_admin_roles WHERE id=$1 AND project_id=$2 RETURNING name", [id, projectId]);
  if (r) await audit(projectId, actor, "role.delete", r.name);
}

export async function memberRoles(projectId: string) {
  const rows = await query<{ user_id: string; role_id: string }>("SELECT user_id,role_id FROM cx_admin_member_roles WHERE project_id=$1", [projectId]);
  return Object.fromEntries(rows.map((r) => [r.user_id, r.role_id])) as Record<string, string>;
}

export async function assignRole(projectId: string, userId: string, roleId: string | null, actor: { id: string; name: string }) {
  if (roleId) {
    const [r] = await query<{ name: string }>("SELECT name FROM cx_admin_roles WHERE id=$1 AND project_id=$2", [roleId, projectId]);
    if (!r) throw new AppError("Role not found.", 404);
    await query("INSERT INTO cx_admin_member_roles(project_id,user_id,role_id) VALUES($1,$2,$3) ON CONFLICT(project_id,user_id) DO UPDATE SET role_id=excluded.role_id", [projectId, userId, roleId]);
    await audit(projectId, actor, "member.role", userId, `custom role → ${r.name}`);
  } else {
    await query("DELETE FROM cx_admin_member_roles WHERE project_id=$1 AND user_id=$2", [projectId, userId]);
    await audit(projectId, actor, "member.role", userId, "custom role removed");
  }
}

/** Bulk import members from CSV (email, role, team). Accounts must already exist; teams are created when missing. */
export async function importUsers(projectId: string, csv: string, actor: { id: string; name: string }) {
  const roles = await listRoles(projectId);
  const { rows, errors } = parseUserImport(parseCsv(csv), roles.map((r) => r.name));
  const teams = await listTeams(projectId);
  let added = 0;
  const skipped: string[] = [];
  for (const r of rows.slice(0, 1000)) {
    try {
      let teamId: string | null = null;
      if (r.team) {
        const t = teams.find((x) => x.name.toLowerCase() === r.team!.toLowerCase());
        teamId = t?.id ?? (await saveTeam(projectId, { name: r.team, description: "" }));
        if (!t) teams.push({ id: teamId, name: r.team, description: "", members: 0, created_at: new Date().toISOString() });
      }
      await inviteMember(projectId, actor.id, r.email, r.role, teamId);
      if (r.customRole) {
        const [u] = await query<{ id: string }>("SELECT id FROM users WHERE lower(email)=lower($1)", [r.email]);
        const role = roles.find((x) => x.name === r.customRole);
        if (u && role) await query("INSERT INTO cx_admin_member_roles(project_id,user_id,role_id) VALUES($1,$2,$3) ON CONFLICT(project_id,user_id) DO UPDATE SET role_id=excluded.role_id", [projectId, u.id, role.id]);
      }
      added++;
    } catch (e) {
      skipped.push(`${r.email}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  await audit(projectId, actor, "member.import", `${added} added`, [...errors, ...skipped].slice(0, 20).join("\n"));
  return { added, skipped, errors };
}
