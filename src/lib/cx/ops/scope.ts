import { query } from "@/lib/db";
import { isListenSource, sourceLabel } from "@/lib/cx/listening/sources";
import { isEmptyScope, resolveScopeWith, sourceProfileId, type ClusterOption, type ProfileOption, type ResolvedScope, type ScopeOptions, type ScopeValue, type TopicOption } from "./scope-model";

export * from "./scope-model";

/**
 * Server side of the Topic / Profile scope (see scope-model.ts for the value type and SQL helpers).
 *
 *   const options = await scopeOptions(brand.id);               // pass to <ScopePicker options>
 *   const scope = scopeFromParams(sp);                          // ?scope=
 *   const r = await resolveScope(brand.id, scope, options);     // { all, channelIds, topicIds, sourceKinds }
 *   const params: unknown[] = [brand.id];
 *   const where = ticketScopeSql(r, binder(params), "t");       // "true" when the scope is empty
 *   await query(`SELECT … FROM cx_tickets t WHERE t.project_id=$1 AND ${where}`, params);
 */

type ClusterRow = { j: { id: string; name: string; channel_ids?: unknown; sources?: unknown; topic_ids?: unknown; is_default?: boolean } };
const strs = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

/**
 * Everything the picker can offer for a brand, from real records only:
 * - clusters: profile groups (incl. their topics when the cluster table stores `topic_ids`)
 * - topics: listening topics
 * - profiles: connected channels, then the listening sources the brand actually uses (in topics,
 *   clusters, stored mentions or source-created tickets)
 */
export async function scopeOptions(projectId: string): Promise<ScopeOptions> {
  const [clusterRows, topicRows, channelRows, sourceRows] = await Promise.all([
    // to_jsonb keeps this working before/after a `topic_ids` column is added to the cluster table.
    query<ClusterRow>("SELECT to_jsonb(g) AS j FROM cx_ops_profile_groups g WHERE g.project_id=$1 ORDER BY g.is_default DESC, lower(g.name)", [projectId]),
    query<{ id: string; name: string; kind: string; active: boolean; sources: unknown }>("SELECT id,name,kind,active,sources FROM cx_topics WHERE project_id=$1 ORDER BY lower(name)", [projectId]),
    query<{ id: string; name: string; kind: string; status: string }>("SELECT id,name,kind,status FROM cx_channels WHERE project_id=$1 ORDER BY kind, lower(name)", [projectId]),
    query<{ s: string }>(
      `SELECT DISTINCT source AS s FROM cx_mentions WHERE project_id=$1
       UNION SELECT DISTINCT channel_kind AS s FROM cx_tickets WHERE project_id=$1 AND channel_id IS NULL`,
      [projectId],
    ),
  ]);
  const clusters: ClusterOption[] = clusterRows.map(({ j }) => ({ id: j.id, name: j.name || "Untitled cluster", channelIds: strs(j.channel_ids), sources: strs(j.sources), topicIds: strs(j.topic_ids), isDefault: !!j.is_default }));
  const topics: TopicOption[] = topicRows.map((t) => ({ id: t.id, name: t.name, kind: t.kind, active: t.active }));
  const used = new Set<string>([...sourceRows.map((r) => r.s), ...topicRows.flatMap((t) => strs(t.sources)), ...clusters.flatMap((c) => c.sources)]);
  const sources = [...used].filter(isListenSource).sort((a, b) => sourceLabel(a).localeCompare(sourceLabel(b)));
  const profiles: ProfileOption[] = [
    ...channelRows.map((c) => ({ id: c.id, name: c.name, network: c.kind, type: "channel" as const, status: c.status })),
    ...sources.map((s) => ({ id: sourceProfileId(s), name: sourceLabel(s), network: s, type: "source" as const })),
  ];
  return { clusters, topics, profiles };
}

/** Flatten a scope for SQL. Pass `options` when you already loaded them for the picker. */
export async function resolveScope(projectId: string, scope: ScopeValue, options?: ScopeOptions): Promise<ResolvedScope> {
  if (isEmptyScope(scope)) return { all: true, channelIds: [], topicIds: [], sourceKinds: [] };
  return resolveScopeWith(scope, options ?? (await scopeOptions(projectId)));
}
