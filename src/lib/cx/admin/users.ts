import { createHash, randomBytes, randomUUID } from "node:crypto";
import { query } from "@/lib/db";
import { AppError } from "@/lib/domain";
import { inviteMember, listMembers, listTeams, removeMember, saveTeam, updateMember, type Role } from "@/lib/cx/insights/team";
import { audit } from "./audit";
import { sendAdminEmail } from "./mailer";
import { cleanUserGroup, type UserGroupInput } from "./pure/settings";
import { parseCsv } from "./pure/fields";
import { parseUserImport } from "./pure/permissions";
import { listRoles } from "./roles";
import { iso } from "./util";

/**
 * Settings → Users (WP-K3): brand members, pending email invites (for people without an account yet),
 * adding users who already work on another of your brands, CSV upload, and user groups.
 * Routing uses user groups through:
 *   const ids = await userIdsForUserGroup(projectId, groupId)   // member user ids, [] when unknown
 */
export type UserRow = {
  id: string;
  userId: string | null;
  inviteId: string | null;
  name: string;
  email: string;
  role: Role | "owner";
  customRole: string | null;
  customRoleId: string | null;
  team: string | null;
  verified: boolean;
  createdBy: string | null;
  createdAt: string;
  owner: boolean;
  expiresAt: string | null;
};

const ROLE_SET = new Set(["admin", "supervisor", "agent", "viewer"]);
const tokenHash = (t: string) => createHash("sha256").update(t).digest("hex");

export async function listUsers(projectId: string): Promise<UserRow[]> {
  const [members, roles, creators, invites] = await Promise.all([
    listMembers(projectId),
    query<{ user_id: string; role_id: string; name: string }>("SELECT mr.user_id, mr.role_id, r.name FROM cx_admin_member_roles mr JOIN cx_admin_roles r ON r.id=mr.role_id WHERE mr.project_id=$1", [projectId]),
    query<{ user_id: string; by: string | null }>("SELECT m.user_id, COALESCE(NULLIF(u.name,''),u.email) AS by FROM cx_members m LEFT JOIN users u ON u.id=m.invited_by WHERE m.project_id=$1", [projectId]),
    query<{ id: string; email: string; role: string; custom_role_id: string | null; created_at: string; expires_at: string; by: string | null }>(
      "SELECT i.id,i.email,i.role,i.custom_role_id,i.created_at,i.expires_at,COALESCE(NULLIF(u.name,''),u.email) AS by FROM cx_settings_invites i LEFT JOIN users u ON u.id=i.invited_by WHERE i.project_id=$1 AND i.accepted_at IS NULL ORDER BY i.created_at",
      [projectId],
    ),
  ]);
  const roleNames = await listRoles(projectId);
  const rows: UserRow[] = members.map((m) => {
    const cr = roles.find((r) => r.user_id === m.user_id);
    return {
      id: m.user_id,
      userId: m.user_id,
      inviteId: null,
      name: m.name || m.email.split("@")[0],
      email: m.email,
      role: m.owner ? "owner" : m.role,
      customRole: cr?.name ?? null,
      customRoleId: cr?.role_id ?? null,
      team: m.team_name,
      verified: true,
      createdBy: m.owner ? null : creators.find((c) => c.user_id === m.user_id)?.by ?? null,
      createdAt: iso(m.created_at)!,
      owner: m.owner,
      expiresAt: null,
    };
  });
  for (const i of invites)
    rows.push({
      id: `invite:${i.id}`,
      userId: null,
      inviteId: i.id,
      name: i.email.split("@")[0],
      email: i.email,
      role: (ROLE_SET.has(i.role) ? i.role : "agent") as Role,
      customRole: roleNames.find((r) => r.id === i.custom_role_id)?.name ?? null,
      customRoleId: i.custom_role_id,
      team: null,
      verified: false,
      createdBy: i.by,
      createdAt: iso(i.created_at)!,
      owner: false,
      expiresAt: iso(i.expires_at),
    });
  return rows;
}

async function setCustomRole(projectId: string, userId: string, customRoleId: string | null | undefined) {
  if (customRoleId === undefined) return;
  if (customRoleId) {
    const [r] = await query("SELECT 1 FROM cx_admin_roles WHERE id=$1 AND project_id=$2", [customRoleId, projectId]);
    if (!r) throw new AppError("Role not found.", 404);
    await query("INSERT INTO cx_admin_member_roles(project_id,user_id,role_id) VALUES($1,$2,$3) ON CONFLICT(project_id,user_id) DO UPDATE SET role_id=excluded.role_id", [projectId, userId, customRoleId]);
  } else await query("DELETE FROM cx_admin_member_roles WHERE project_id=$1 AND user_id=$2", [projectId, userId]);
}

export type InviteInput = { email: string; role: Role; customRoleId?: string | null; teamId?: string | null };

/**
 * ADD NEW USER: people with an account are added right away; others get a pending invite whose link
 * (valid 14 days) is emailed through the brand's email channel when one is connected and returned to show/copy.
 */
export async function inviteUser(projectId: string, actor: { id: string; name: string }, input: InviteInput, origin: string, brandName: string) {
  const email = input.email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new AppError("Enter a valid email address.");
  if (!ROLE_SET.has(input.role)) throw new AppError("Choose a role.");
  const [u] = await query<{ id: string }>("SELECT id FROM users WHERE lower(email)=$1", [email]);
  if (u) {
    const [owner] = await query("SELECT 1 FROM projects WHERE id=$1 AND owner_id=$2", [projectId, u.id]);
    if (owner) throw new AppError("That person owns this brand already.");
    await inviteMember(projectId, actor.id, email, input.role, input.teamId || null);
    await setCustomRole(projectId, u.id, input.customRoleId ?? null);
    await audit(projectId, actor, "member.add", email, input.role);
    return { added: true as const, link: null, emailed: false, emailError: null as string | null };
  }
  const token = randomBytes(24).toString("base64url");
  await query("DELETE FROM cx_settings_invites WHERE project_id=$1 AND lower(email)=$2 AND accepted_at IS NULL", [projectId, email]);
  await query("INSERT INTO cx_settings_invites(id,project_id,email,role,custom_role_id,team_id,token_hash,invited_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8)", [
    randomUUID(), projectId, email, input.role, input.customRoleId || null, input.teamId || null, tokenHash(token), actor.id,
  ]);
  const link = `${origin}/cx/settings/users/accept?token=${token}`;
  const mail = await sendAdminEmail(projectId, {
    to: [email],
    subject: `You're invited to ${brandName} on SynapseSEO CX`,
    text: `${actor.name} invited you to work on ${brandName} as ${input.role}.\n\n1. Create an account with this email address (${email}) if you don't have one.\n2. Open this link to join: ${link}\n\nThe link expires in 14 days.`,
  });
  await audit(projectId, actor, "member.invite", email, `${input.role}${mail.ok ? ", emailed" : ""}`);
  return { added: false as const, link, emailed: mail.ok, emailError: mail.ok ? null : mail.error };
}

/** Accept an invite as the signed-in user (the account email must match the invited address). */
export async function acceptInvite(token: string, user: { id: string; email: string }) {
  if (!/^[\w-]{20,64}$/.test(token)) throw new AppError("This invite link is not valid.", 404);
  const [i] = await query<{ id: string; project_id: string; email: string; role: Role; custom_role_id: string | null; team_id: string | null; invited_by: string | null; expires_at: string; accepted_at: string | null }>(
    "SELECT id,project_id,email,role,custom_role_id,team_id,invited_by,expires_at,accepted_at FROM cx_settings_invites WHERE token_hash=$1",
    [tokenHash(token)],
  );
  if (!i) throw new AppError("This invite link is not valid or was revoked.", 404);
  if (i.accepted_at) return { projectId: i.project_id, already: true };
  if (new Date(i.expires_at).getTime() < Date.now()) throw new AppError("This invite has expired. Ask a brand admin to invite you again.", 410);
  if (i.email.toLowerCase() !== user.email.toLowerCase()) throw new AppError(`This invite is for ${i.email}. Sign in with that address to accept it.`, 403);
  const [team] = i.team_id ? await query<{ id: string }>("SELECT id FROM cx_teams WHERE id=$1 AND project_id=$2", [i.team_id, i.project_id]) : [];
  await query(
    `INSERT INTO cx_members(id,project_id,user_id,role,team_id,invited_by) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(project_id,user_id) DO UPDATE SET role=excluded.role`,
    [randomUUID(), i.project_id, user.id, ROLE_SET.has(i.role) ? i.role : "agent", team?.id ?? null, i.invited_by],
  );
  if (i.custom_role_id) await setCustomRole(i.project_id, user.id, i.custom_role_id).catch(() => {});
  await query("UPDATE cx_settings_invites SET accepted_at=now(), accepted_by=$2 WHERE id=$1", [i.id, user.id]);
  await audit(i.project_id, { id: user.id, name: user.email }, "member.accept", user.email);
  return { projectId: i.project_id, already: false };
}

export async function revokeInvite(projectId: string, inviteId: string, actor: { id: string; name: string }) {
  const [r] = await query<{ email: string }>("DELETE FROM cx_settings_invites WHERE id=$1 AND project_id=$2 AND accepted_at IS NULL RETURNING email", [inviteId, projectId]);
  if (r) await audit(projectId, actor, "member.invite.revoke", r.email);
}

/** ADD EXISTING USER: people who work on (or own) another brand you own or administer, not yet on this one. */
export async function existingUserCandidates(projectId: string, actorId: string) {
  return query<{ id: string; name: string; email: string; brands: string }>(
    `WITH mine AS (
       SELECT p.id FROM projects p WHERE p.owner_id=$2
       UNION SELECT m.project_id FROM cx_members m WHERE m.user_id=$2 AND m.role='admin'
     ), people AS (
       SELECT m.user_id, m.project_id FROM cx_members m WHERE m.project_id IN (SELECT id FROM mine)
       UNION SELECT p.owner_id, p.id FROM projects p WHERE p.id IN (SELECT id FROM mine)
     )
     SELECT u.id, u.name, u.email, string_agg(DISTINCT pr.name, ', ') AS brands
       FROM people x JOIN users u ON u.id=x.user_id JOIN projects pr ON pr.id=x.project_id
      WHERE x.project_id<>$1 AND u.id<>(SELECT owner_id FROM projects WHERE id=$1)
        AND NOT EXISTS (SELECT 1 FROM cx_members m2 WHERE m2.project_id=$1 AND m2.user_id=u.id)
      GROUP BY u.id, u.name, u.email ORDER BY lower(COALESCE(NULLIF(u.name,''),u.email)) LIMIT 500`,
    [projectId, actorId],
  );
}

export async function addExistingUsers(projectId: string, actor: { id: string; name: string }, userIds: string[], role: Role, customRoleId: string | null) {
  if (!ROLE_SET.has(role)) throw new AppError("Choose a role.");
  const allowed = new Set((await existingUserCandidates(projectId, actor.id)).map((c) => c.id));
  const ids = [...new Set(userIds)].filter((id) => allowed.has(id));
  if (!ids.length) throw new AppError("Pick at least one person.");
  for (const id of ids) {
    await query(
      "INSERT INTO cx_members(id,project_id,user_id,role,invited_by) VALUES($1,$2,$3,$4,$5) ON CONFLICT(project_id,user_id) DO UPDATE SET role=excluded.role",
      [randomUUID(), projectId, id, role, actor.id],
    );
    await setCustomRole(projectId, id, customRoleId);
  }
  await audit(projectId, actor, "member.add", `${ids.length} existing user(s)`, role);
  return ids.length;
}

export async function changeUserRole(projectId: string, actor: { id: string; name: string }, userId: string, role: Role, customRoleId: string | null) {
  if (!ROLE_SET.has(role)) throw new AppError("Choose a role.");
  const [owner] = await query("SELECT 1 FROM projects WHERE id=$1 AND owner_id=$2", [projectId, userId]);
  if (owner) throw new AppError("The brand owner's role can't be changed.");
  const [m] = await query("SELECT 1 FROM cx_members WHERE project_id=$1 AND user_id=$2", [projectId, userId]);
  if (!m) throw new AppError("User not found in this brand.", 404);
  await updateMember(projectId, userId, { role });
  await setCustomRole(projectId, userId, customRoleId);
  await audit(projectId, actor, "member.role", userId, `${role}${customRoleId ? " + custom role" : ""}`);
}

export async function removeUser(projectId: string, actor: { id: string; name: string }, userId: string) {
  const [owner] = await query("SELECT 1 FROM projects WHERE id=$1 AND owner_id=$2", [projectId, userId]);
  if (owner) throw new AppError("The brand owner can't be removed.");
  if (userId === actor.id) throw new AppError("You can't remove yourself.");
  await removeMember(projectId, userId);
  await query("DELETE FROM cx_admin_member_roles WHERE project_id=$1 AND user_id=$2", [projectId, userId]);
  await query("UPDATE cx_settings_user_groups SET member_ids = member_ids - $2, updated_at=now() WHERE project_id=$1 AND member_ids ? $2", [projectId, userId]);
  await audit(projectId, actor, "member.remove", userId);
}

/** UPLOAD USERS: CSV of email, role, team. Accounts are added; unknown emails get invites. */
export async function uploadUsers(projectId: string, actor: { id: string; name: string }, csv: string, origin: string, brandName: string) {
  const roles = await listRoles(projectId);
  const { rows, errors } = parseUserImport(parseCsv(csv), roles.map((r) => r.name));
  if (!rows.length) throw new AppError(errors[0] ?? "No rows found. Use columns: email, role, team.");
  const teams = await listTeams(projectId);
  let added = 0, invited = 0;
  const skipped: string[] = [];
  for (const r of rows.slice(0, 500)) {
    try {
      let teamId: string | null = null;
      if (r.team) {
        const t = teams.find((x) => x.name.toLowerCase() === r.team!.toLowerCase());
        teamId = t?.id ?? (await saveTeam(projectId, { name: r.team.slice(0, 80), description: "" }));
        if (!t) teams.push({ id: teamId, name: r.team, description: "", members: 0, created_at: new Date().toISOString() });
      }
      const customRoleId = r.customRole ? roles.find((x) => x.name === r.customRole)?.id ?? null : null;
      const res = await inviteUser(projectId, actor, { email: r.email, role: r.role, customRoleId, teamId }, origin, brandName);
      if (res.added) added++;
      else invited++;
    } catch (e) {
      skipped.push(`${r.email}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return { added, invited, skipped, errors };
}

// ---------------------------------------------------------------- user groups

export type UserGroup = { id: string; name: string; description: string; memberIds: string[]; creator: string | null; createdAt: string };

export async function listUserGroups(projectId: string): Promise<UserGroup[]> {
  const rows = await query<{ id: string; name: string; description: string; member_ids: string[]; creator: string | null; created_at: string }>(
    "SELECT g.id,g.name,g.description,g.member_ids,COALESCE(NULLIF(u.name,''),u.email) AS creator,g.created_at FROM cx_settings_user_groups g LEFT JOIN users u ON u.id=g.created_by WHERE g.project_id=$1 ORDER BY lower(g.name)",
    [projectId],
  );
  return rows.map((r) => ({ id: r.id, name: r.name, description: r.description, memberIds: r.member_ids ?? [], creator: r.creator, createdAt: iso(r.created_at)! }));
}

async function brandUserIds(projectId: string) {
  const rows = await query<{ id: string }>("SELECT owner_id AS id FROM projects WHERE id=$1 UNION SELECT user_id FROM cx_members WHERE project_id=$1", [projectId]);
  return rows.map((r) => r.id);
}

export async function saveUserGroup(projectId: string, actor: { id: string; name: string }, input: UserGroupInput & { id?: string }) {
  const c = cleanUserGroup(input, await brandUserIds(projectId));
  if (!c.ok) throw new AppError(c.error);
  const v = c.value;
  const [dupe] = await query("SELECT 1 FROM cx_settings_user_groups WHERE project_id=$1 AND lower(name)=lower($2) AND id<>$3", [projectId, v.name, input.id ?? ""]);
  if (dupe) throw new AppError("A user group with that name already exists.");
  if (input.id) {
    const r = await query("UPDATE cx_settings_user_groups SET name=$3,description=$4,member_ids=$5::jsonb,updated_at=now() WHERE id=$1 AND project_id=$2 RETURNING id", [input.id, projectId, v.name, v.description, JSON.stringify(v.memberIds)]);
    if (!r.length) throw new AppError("User group not found.", 404);
    await audit(projectId, actor, "usergroup.update", v.name, `${v.memberIds.length} members`);
    return input.id;
  }
  const id = randomUUID();
  await query("INSERT INTO cx_settings_user_groups(id,project_id,name,description,member_ids,created_by) VALUES($1,$2,$3,$4,$5::jsonb,$6)", [id, projectId, v.name, v.description, JSON.stringify(v.memberIds), actor.id]);
  await audit(projectId, actor, "usergroup.create", v.name, `${v.memberIds.length} members`);
  return id;
}

export async function deleteUserGroup(projectId: string, actor: { id: string; name: string }, id: string) {
  const [r] = await query<{ name: string }>("DELETE FROM cx_settings_user_groups WHERE id=$1 AND project_id=$2 RETURNING name", [id, projectId]);
  if (r) await audit(projectId, actor, "usergroup.delete", r.name);
}

/** Member user ids of a user group (routing); [] when the group doesn't exist in this brand. */
export async function userIdsForUserGroup(projectId: string, groupId: string | null | undefined): Promise<string[]> {
  if (!groupId) return [];
  const [r] = await query<{ member_ids: string[] }>("SELECT member_ids FROM cx_settings_user_groups WHERE id=$1 AND project_id=$2", [groupId, projectId]);
  return r?.member_ids ?? [];
}
