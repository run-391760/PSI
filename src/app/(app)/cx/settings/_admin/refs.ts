import "server-only";
import { CHANNELS } from "@/lib/cx/channels";
import { CONNECTORS } from "@/lib/cx/admin/connectors";
import { getClassificationTree, getFieldDefs } from "@/lib/cx/admin/fields";
import { classificationPath } from "@/lib/cx/admin/pure/fields";
import { getQueueSettings } from "@/lib/cx/admin/queue";
import { listAgents, listTeams } from "@/lib/cx/inbox/store";

/** Reference data for condition/action editors (automations, escalations, quick actions). */
export async function editorRefs(projectId: string, brands: { id: string; name: string }[]) {
  const [tree, defs, agents, teams, queue] = await Promise.all([getClassificationTree(projectId), getFieldDefs(projectId), listAgents(projectId), listTeams(projectId), getQueueSettings(projectId)]);
  const channels = [
    ...CHANNELS.filter((c) => c.uses.includes("inbox")).map((c) => ({ value: c.kind as string, label: c.name })),
    ...CONNECTORS.map((c) => ({ value: c.kind as string, label: c.name })),
  ].filter((c, i, a) => a.findIndex((x) => x.value === c.value) === i);
  return {
    channels,
    classifications: tree.filter((n) => !n.hidden).map((n) => ({ id: n.id, path: classificationPath(tree, n.id).join(" > ") })),
    fields: defs.filter((d) => !d.hidden && d.scope === "ticket").map((d) => ({ key: d.key, label: d.label })),
    segments: queue.segments.map((s) => s.name),
    agents: agents.map((a) => ({ id: a.id, name: a.name })),
    teams,
    brands: brands.map((b) => ({ id: b.id, name: b.name })),
  };
}
