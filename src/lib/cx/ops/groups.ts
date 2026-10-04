import { randomUUID } from "node:crypto";
import { query } from "@/lib/db";
import { AppError } from "@/lib/domain";
import { LISTEN_SOURCES } from "@/lib/cx/listening/sources";
import { cleanGroup, type ProfileGroupInput } from "./model";

/**
 * Profile groups (Konnect "PU Overall"): named sets of connected profiles (cx_channels) plus listening
 * sources. Other modules scope their data with:
 *   const ids = await channelIdsForGroup(projectId, groupId)   // channel ids, [] when the group is unknown
 *   const s = await groupScope(projectId, groupId)              // { channelIds, sources, name } | null
 */
export type ProfileGroup = { id: string; name: string; description: string; channelIds: string[]; sources: string[]; isDefault: boolean; createdAt: string; updatedAt: string };
type Row = { id: string; name: string; description: string; channel_ids: string[]; sources: string[]; is_default: boolean; created_at: string; updated_at: string };
const toGroup = (r: Row): ProfileGroup => ({ id: r.id, name: r.name, description: r.description, channelIds: r.channel_ids ?? [], sources: r.sources ?? [], isDefault: r.is_default, createdAt: new Date(r.created_at).toISOString(), updatedAt: new Date(r.updated_at).toISOString() });

export async function listGroups(projectId: string): Promise<ProfileGroup[]> {
  const rows = await query<Row>("SELECT id,name,description,channel_ids,sources,is_default,created_at,updated_at FROM cx_ops_profile_groups WHERE project_id=$1 ORDER BY is_default DESC, lower(name)", [projectId]);
  return rows.map(toGroup);
}

export async function groupScope(projectId: string, groupId: string | null | undefined) {
  if (!groupId) return null;
  const [r] = await query<Row>("SELECT id,name,description,channel_ids,sources,is_default,created_at,updated_at FROM cx_ops_profile_groups WHERE project_id=$1 AND id=$2", [projectId, groupId]);
  if (!r) return null;
  const g = toGroup(r);
  return { id: g.id, name: g.name, channelIds: g.channelIds, sources: g.sources };
}

/** Channel (profile) ids of a group; [] when the group doesn't exist in this brand. */
export async function channelIdsForGroup(projectId: string, groupId: string) {
  return (await groupScope(projectId, groupId))?.channelIds ?? [];
}

/** The brand's default group id (used when the inbox opens without ?group=), or null. */
export async function defaultGroupId(projectId: string) {
  const [r] = await query<{ id: string }>("SELECT id FROM cx_ops_profile_groups WHERE project_id=$1 AND is_default LIMIT 1", [projectId]);
  return r?.id ?? null;
}

export async function saveGroup(projectId: string, userId: string, input: ProfileGroupInput & { id?: string }) {
  const chans = await query<{ id: string }>("SELECT id FROM cx_channels WHERE project_id=$1", [projectId]);
  const c = cleanGroup(input, { channelIds: chans.map((x) => x.id), sources: LISTEN_SOURCES });
  if (!c.ok) throw new AppError(c.error);
  const v = c.value;
  const [dupe] = await query<{ id: string }>("SELECT id FROM cx_ops_profile_groups WHERE project_id=$1 AND lower(name)=lower($2) AND id<>$3", [projectId, v.name, input.id ?? ""]);
  if (dupe) throw new AppError("A profile group with that name already exists.");
  if (v.isDefault) await query("UPDATE cx_ops_profile_groups SET is_default=false WHERE project_id=$1", [projectId]);
  if (input.id) {
    const r = await query("UPDATE cx_ops_profile_groups SET name=$3,description=$4,channel_ids=$5::jsonb,sources=$6::jsonb,is_default=$7,updated_at=now() WHERE id=$1 AND project_id=$2 RETURNING id", [input.id, projectId, v.name, v.description, JSON.stringify(v.channelIds), JSON.stringify(v.sources), v.isDefault]);
    if (!r.length) throw new AppError("Profile group not found.", 404);
    return input.id;
  }
  const id = randomUUID();
  await query("INSERT INTO cx_ops_profile_groups(id,project_id,name,description,channel_ids,sources,is_default,created_by) VALUES($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7,$8)", [id, projectId, v.name, v.description, JSON.stringify(v.channelIds), JSON.stringify(v.sources), v.isDefault, userId]);
  return id;
}

export async function deleteGroup(projectId: string, id: string) {
  await query("DELETE FROM cx_ops_profile_groups WHERE id=$1 AND project_id=$2", [id, projectId]);
}

/** SQL condition limiting tickets (alias t) to a group: its channels, or tickets created from its listening sources. */
export function groupTicketSql(scope: { channelIds: string[]; sources: string[] }, p: (v: unknown) => string) {
  const parts: string[] = [];
  if (scope.channelIds.length) parts.push(`t.channel_id = ANY(${p(scope.channelIds)}::text[])`);
  if (scope.sources.length) parts.push(`(t.channel_id IS NULL AND t.channel_kind = ANY(${p(scope.sources)}::text[]))`);
  return parts.length ? `(${parts.join(" OR ")})` : "false";
}
