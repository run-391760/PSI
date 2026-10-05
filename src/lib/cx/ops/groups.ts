import { randomUUID } from "node:crypto";
import { query } from "@/lib/db";
import { AppError } from "@/lib/domain";
import { LISTEN_SOURCES } from "@/lib/cx/listening/sources";
import { cleanCluster, colorFor, isHexColor, type ClusterInput } from "@/lib/cx/admin/pure/settings";
import type { ProfileGroupInput } from "./model";

/**
 * Profile groups = Clusters (Konnect "PU Overall"): named sets of connected profiles (cx_channels),
 * listening topics (cx_topics) and listening sources. Other modules scope their data with:
 *   const ids = await channelIdsForGroup(projectId, groupId)   // channel ids, [] when the group is unknown
 *   const s = await groupScope(projectId, groupId)              // { channelIds, topicIds, sources, name } | null
 *   groupTicketSql(s, p) / groupMentionSql(s, p)                // SQL conditions for tickets (alias t) / mentions (alias m)
 */
export type ProfileGroup = {
  id: string;
  name: string;
  description: string;
  channelIds: string[];
  topicIds: string[];
  sources: string[];
  isDefault: boolean;
  color: string;
  createdBy: string | null;
  creator: string | null;
  createdAt: string;
  updatedAt: string;
};
type Row = { id: string; name: string; description: string; channel_ids: string[]; topic_ids: string[] | null; sources: string[]; is_default: boolean; color: string | null; created_by: string | null; creator: string | null; created_at: string; updated_at: string };
const toGroup = (r: Row): ProfileGroup => ({
  id: r.id,
  name: r.name,
  description: r.description,
  channelIds: r.channel_ids ?? [],
  topicIds: r.topic_ids ?? [],
  sources: r.sources ?? [],
  isDefault: r.is_default,
  color: isHexColor(r.color) ? r.color : colorFor(r.id),
  createdBy: r.created_by,
  creator: r.creator,
  createdAt: new Date(r.created_at).toISOString(),
  updatedAt: new Date(r.updated_at).toISOString(),
});
const SELECT = `SELECT g.id,g.name,g.description,g.channel_ids,g.topic_ids,g.sources,g.is_default,g.color,g.created_by,COALESCE(NULLIF(u.name,''),u.email) AS creator,g.created_at,g.updated_at
  FROM cx_ops_profile_groups g LEFT JOIN users u ON u.id=g.created_by`;

export async function listGroups(projectId: string): Promise<ProfileGroup[]> {
  const rows = await query<Row>(`${SELECT} WHERE g.project_id=$1 ORDER BY g.is_default DESC, lower(g.name)`, [projectId]);
  return rows.map(toGroup);
}

export type GroupScope = { id: string; name: string; channelIds: string[]; topicIds: string[]; sources: string[] };

export async function groupScope(projectId: string, groupId: string | null | undefined): Promise<GroupScope | null> {
  if (!groupId) return null;
  const [r] = await query<Row>(`${SELECT} WHERE g.project_id=$1 AND g.id=$2`, [projectId, groupId]);
  if (!r) return null;
  const g = toGroup(r);
  return { id: g.id, name: g.name, channelIds: g.channelIds, topicIds: g.topicIds, sources: g.sources };
}

/** Channel (profile) ids of a group; [] when the group doesn't exist in this brand. */
export async function channelIdsForGroup(projectId: string, groupId: string) {
  return (await groupScope(projectId, groupId))?.channelIds ?? [];
}

/** Listening topic ids of a group; [] when the group doesn't exist in this brand. */
export async function topicIdsForGroup(projectId: string, groupId: string) {
  return (await groupScope(projectId, groupId))?.topicIds ?? [];
}

/** The brand's default group id (used when the inbox opens without ?group=), or null. */
export async function defaultGroupId(projectId: string) {
  const [r] = await query<{ id: string }>("SELECT id FROM cx_ops_profile_groups WHERE project_id=$1 AND is_default LIMIT 1", [projectId]);
  return r?.id ?? null;
}

/** Create or update a cluster. Accepts the old profile-group input (no topics) as well. */
export async function saveGroup(projectId: string, userId: string, input: (ProfileGroupInput | ClusterInput) & { id?: string }) {
  const [chans, topics] = await Promise.all([
    query<{ id: string }>("SELECT id FROM cx_channels WHERE project_id=$1", [projectId]),
    query<{ id: string }>("SELECT id FROM cx_topics WHERE project_id=$1", [projectId]),
  ]);
  const existing = input.id ? (await groupScope(projectId, input.id)) : null;
  if (input.id && !existing) throw new AppError("Cluster not found.", 404);
  const c = cleanCluster(
    { ...input, topicIds: "topicIds" in input && input.topicIds ? input.topicIds : existing?.topicIds ?? [] },
    { channelIds: chans.map((x) => x.id), topicIds: topics.map((x) => x.id), sources: LISTEN_SOURCES },
  );
  if (!c.ok) throw new AppError(c.error);
  const v = c.value;
  const [dupe] = await query<{ id: string }>("SELECT id FROM cx_ops_profile_groups WHERE project_id=$1 AND lower(name)=lower($2) AND id<>$3", [projectId, v.name, input.id ?? ""]);
  if (dupe) throw new AppError("A cluster with that name already exists.");
  if (v.isDefault) await query("UPDATE cx_ops_profile_groups SET is_default=false WHERE project_id=$1", [projectId]);
  if (input.id) {
    const colorSql = "color" in input && input.color !== undefined ? ",color=$9" : "";
    const params: unknown[] = [input.id, projectId, v.name, v.description, JSON.stringify(v.channelIds), JSON.stringify(v.sources), v.isDefault, JSON.stringify(v.topicIds)];
    if (colorSql) params.push(v.color);
    const r = await query(`UPDATE cx_ops_profile_groups SET name=$3,description=$4,channel_ids=$5::jsonb,sources=$6::jsonb,is_default=$7,topic_ids=$8::jsonb${colorSql},updated_at=now() WHERE id=$1 AND project_id=$2 RETURNING id`, params);
    if (!r.length) throw new AppError("Cluster not found.", 404);
    return input.id;
  }
  const id = randomUUID();
  await query("INSERT INTO cx_ops_profile_groups(id,project_id,name,description,channel_ids,sources,is_default,created_by,topic_ids,color) VALUES($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7,$8,$9::jsonb,$10)", [
    id, projectId, v.name, v.description, JSON.stringify(v.channelIds), JSON.stringify(v.sources), v.isDefault, userId, JSON.stringify(v.topicIds), v.color,
  ]);
  return id;
}

export async function setGroupColor(projectId: string, id: string, color: string) {
  if (!isHexColor(color)) throw new AppError("Color must be a hex value like #3e63dd.");
  const r = await query("UPDATE cx_ops_profile_groups SET color=$3, updated_at=now() WHERE id=$1 AND project_id=$2 RETURNING id", [id, projectId, color.toLowerCase()]);
  if (!r.length) throw new AppError("Cluster not found.", 404);
}

export async function deleteGroup(projectId: string, id: string) {
  await query("DELETE FROM cx_ops_profile_groups WHERE id=$1 AND project_id=$2", [id, projectId]);
}

/**
 * SQL condition limiting tickets (alias t) to a group: its channels, tickets created from its listening
 * sources, or tickets created from mentions of its topics.
 */
export function groupTicketSql(scope: { channelIds: string[]; sources: string[]; topicIds?: string[] }, p: (v: unknown) => string) {
  const parts: string[] = [];
  if (scope.channelIds.length) parts.push(`t.channel_id = ANY(${p(scope.channelIds)}::text[])`);
  if (scope.sources.length) parts.push(`(t.channel_id IS NULL AND t.channel_kind = ANY(${p(scope.sources)}::text[]))`);
  if (scope.topicIds?.length) parts.push(`t.id IN (SELECT mm.ticket_id FROM cx_mentions mm WHERE mm.ticket_id IS NOT NULL AND mm.topic_id = ANY(${p(scope.topicIds)}::text[]))`);
  return parts.length ? `(${parts.join(" OR ")})` : "false";
}

/** SQL condition limiting listening mentions (alias m) to a group: its topics or its listening sources. */
export function groupMentionSql(scope: { sources: string[]; topicIds?: string[] }, p: (v: unknown) => string) {
  const parts: string[] = [];
  if (scope.topicIds?.length) parts.push(`m.topic_id = ANY(${p(scope.topicIds)}::text[])`);
  if (scope.sources.length) parts.push(`m.source = ANY(${p(scope.sources)}::text[])`);
  return parts.length ? `(${parts.join(" OR ")})` : "false";
}
