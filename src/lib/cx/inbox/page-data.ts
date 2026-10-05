import { query } from "@/lib/db";
import { getClassificationTree } from "@/lib/cx/admin/fields";
import { queueAgents } from "@/lib/cx/admin/queue";
import { languageName } from "@/lib/cx/listening/sources";
import { scopeOptions } from "@/lib/cx/ops/scope";
import { getPrefs } from "./settings";
import { listAgents, listTags } from "./store";

/**
 * Data every Konnect-style stream page needs (server only): the card context (agents with presence, classification
 * tree, me, read-only), the user's view preferences, the Topic / Profile picker options and the More Filters options.
 */
export async function streamPageData(brand: { id: string; role: string }, user: { id: string; name?: string | null; email: string }) {
  const [agents, states, tree, prefs, scope, tags, langs] = await Promise.all([
    listAgents(brand.id),
    queueAgents(brand.id).catch(() => []),
    getClassificationTree(brand.id).catch(() => []),
    getPrefs(user.id),
    scopeOptions(brand.id),
    listTags(brand.id).catch(() => []),
    query<{ l: string }>("SELECT DISTINCT language AS l FROM cx_tickets WHERE project_id=$1 AND language IS NOT NULL UNION SELECT DISTINCT language FROM cx_mentions WHERE project_id=$1 AND language IS NOT NULL", [brand.id]).catch(() => []),
  ]);
  const ctx = {
    brand: brand.id,
    me: { id: user.id, name: user.name || user.email },
    agents,
    agentStates: states.map((a) => ({ id: a.id, name: a.name, status: a.status, statusName: a.statusName, paused: a.paused })),
    tree: tree.map((n) => ({ id: n.id, parentId: n.parentId, label: n.label, level: n.level, hidden: n.hidden })),
    readOnly: brand.role === "viewer",
  };
  const options = {
    assignees: [["none", "Unassigned"], ...agents.map((a) => [a.id, a.name] as [string, string])] as [string, string][],
    tags,
    languages: langs.map((r) => [r.l, languageName(r.l)] as [string, string]).sort((a, b) => a[1].localeCompare(b[1])),
    classifications: tree.filter((n) => !n.hidden).map((n) => [n.id, `${"– ".repeat(Math.max(0, n.level - 1))}${n.label}`] as [string, string]),
  };
  return { ctx, prefs, scope, options, states };
}
