import { randomUUID } from "node:crypto";
import { query } from "@/lib/db";
import { AppError } from "@/lib/domain";
import { DEFAULT_HOURS, type DayHours, type Holiday, type Priority } from "./metrics";

/** Brand members, teams, business hours and SLA policies (server-only). */
export type Role = "admin" | "supervisor" | "agent" | "viewer";
export const ROLES: { value: Role; label: string; description: string }[] = [
  { value: "admin", label: "Admin", description: "Manage settings, team and all data" },
  { value: "supervisor", label: "Supervisor", description: "Assign tickets, review quality, see reports" },
  { value: "agent", label: "Agent", description: "Handle assigned conversations" },
  { value: "viewer", label: "Viewer", description: "Read-only access to reports" },
];

export type Member = { id: string; user_id: string; name: string; email: string; role: Role; team_id: string | null; team_name: string | null; created_at: string; owner: boolean };
export type Team = { id: string; name: string; description: string; members: number; created_at: string };
export type SlaPolicy = { priority: Priority; first_response_minutes: number | null; resolution_minutes: number | null; business_hours: boolean };
export type HoursSettings = { timezone: string; hours: DayHours[]; holidays: Holiday[] };

/** Members of a brand; the brand owner is always listed first as an implicit admin. */
export async function listMembers(projectId: string): Promise<Member[]> {
  const [owner] = await query<{ id: string; name: string; email: string; created_at: string }>(
    "SELECT u.id,u.name,u.email,p.created_at FROM projects p JOIN users u ON u.id=p.owner_id WHERE p.id=$1",
    [projectId],
  );
  const rows = await query<Member>(
    `SELECT m.id,m.user_id,u.name,u.email,m.role,m.team_id,t.name AS team_name,m.created_at,false AS owner
     FROM cx_members m JOIN users u ON u.id=m.user_id LEFT JOIN cx_teams t ON t.id=m.team_id
     WHERE m.project_id=$1 ORDER BY m.created_at`,
    [projectId],
  );
  const own = rows.find((r) => r.user_id === owner?.id);
  const list = rows.filter((r) => r.user_id !== owner?.id);
  if (owner) list.unshift(own ? { ...own, owner: true } : { id: `owner:${owner.id}`, user_id: owner.id, name: owner.name, email: owner.email, role: "admin", team_id: null, team_name: null, created_at: owner.created_at, owner: true });
  return list;
}

export async function inviteMember(projectId: string, invitedBy: string, email: string, role: Role, teamId: string | null) {
  const [u] = await query<{ id: string }>("SELECT id FROM users WHERE lower(email)=lower($1)", [email.trim()]);
  if (!u) throw new AppError("No SynapseSEO account uses that email yet. Ask them to register first, then invite them.", 400);
  if (teamId) await assertTeam(projectId, teamId);
  await query(
    `INSERT INTO cx_members(id,project_id,user_id,role,team_id,invited_by) VALUES($1,$2,$3,$4,$5,$6)
     ON CONFLICT(project_id,user_id) DO UPDATE SET role=excluded.role, team_id=excluded.team_id`,
    [randomUUID(), projectId, u.id, role, teamId, invitedBy],
  );
}

export async function updateMember(projectId: string, userId: string, patch: { role?: Role; teamId?: string | null }) {
  if (patch.teamId) await assertTeam(projectId, patch.teamId);
  await query(
    `INSERT INTO cx_members(id,project_id,user_id,role,team_id) VALUES($1,$2,$3,COALESCE($4,'admin'),$5)
     ON CONFLICT(project_id,user_id) DO UPDATE SET role=COALESCE($4,cx_members.role), team_id=CASE WHEN $6 THEN $5 ELSE cx_members.team_id END`,
    [randomUUID(), projectId, userId, patch.role ?? null, patch.teamId ?? null, patch.teamId !== undefined],
  );
}

export async function removeMember(projectId: string, userId: string) {
  await query("DELETE FROM cx_members WHERE project_id=$1 AND user_id=$2", [projectId, userId]);
}

async function assertTeam(projectId: string, teamId: string) {
  const [t] = await query("SELECT 1 FROM cx_teams WHERE id=$1 AND project_id=$2", [teamId, projectId]);
  if (!t) throw new AppError("Team not found.", 404);
}

export async function listTeams(projectId: string) {
  return query<Team>(
    `SELECT t.id,t.name,t.description,t.created_at,(SELECT count(*)::int FROM cx_members m WHERE m.team_id=t.id) AS members
     FROM cx_teams t WHERE t.project_id=$1 ORDER BY t.name`,
    [projectId],
  );
}
export async function saveTeam(projectId: string, input: { id?: string; name: string; description: string }) {
  if (input.id) {
    await query("UPDATE cx_teams SET name=$3, description=$4 WHERE id=$1 AND project_id=$2", [input.id, projectId, input.name, input.description]);
    return input.id;
  }
  const id = randomUUID();
  await query("INSERT INTO cx_teams(id,project_id,name,description) VALUES($1,$2,$3,$4)", [id, projectId, input.name, input.description]);
  return id;
}
export async function deleteTeam(projectId: string, id: string) {
  await query("DELETE FROM cx_teams WHERE id=$1 AND project_id=$2", [id, projectId]);
}

export async function getHours(projectId: string): Promise<HoursSettings> {
  const [row] = await query<HoursSettings>("SELECT timezone,hours,holidays FROM cx_insight_settings WHERE project_id=$1", [projectId]);
  const hours = row?.hours?.length === 7 ? row.hours : DEFAULT_HOURS;
  return { timezone: row?.timezone ?? "UTC", hours, holidays: row?.holidays ?? [] };
}
export async function saveHours(projectId: string, s: HoursSettings) {
  await query(
    `INSERT INTO cx_insight_settings(project_id,timezone,hours,holidays) VALUES($1,$2,$3,$4)
     ON CONFLICT(project_id) DO UPDATE SET timezone=excluded.timezone, hours=excluded.hours, holidays=excluded.holidays, updated_at=now()`,
    [projectId, s.timezone, JSON.stringify(s.hours), JSON.stringify(s.holidays)],
  );
}

export async function listSlaPolicies(projectId: string): Promise<SlaPolicy[]> {
  return query<SlaPolicy>("SELECT priority,first_response_minutes,resolution_minutes,business_hours FROM cx_sla_policies WHERE project_id=$1", [projectId]);
}
export async function saveSlaPolicies(projectId: string, policies: SlaPolicy[]) {
  for (const p of policies) {
    if (p.first_response_minutes == null && p.resolution_minutes == null) {
      await query("DELETE FROM cx_sla_policies WHERE project_id=$1 AND priority=$2", [projectId, p.priority]);
      continue;
    }
    await query(
      `INSERT INTO cx_sla_policies(id,project_id,priority,first_response_minutes,resolution_minutes,business_hours) VALUES($1,$2,$3,$4,$5,$6)
       ON CONFLICT(project_id,priority) DO UPDATE SET first_response_minutes=excluded.first_response_minutes,
       resolution_minutes=excluded.resolution_minutes, business_hours=excluded.business_hours, updated_at=now()`,
      [randomUUID(), projectId, p.priority, p.first_response_minutes, p.resolution_minutes, p.business_hours],
    );
  }
}

/** Assignable agents of a brand (owner + members except viewers), for pickers in other modules. */
export async function agentsOf(projectId: string) {
  return (await listMembers(projectId)).filter((m) => m.role !== "viewer").map((m) => ({ id: m.user_id, name: m.name || m.email, email: m.email, role: m.role, team: m.team_name }));
}
