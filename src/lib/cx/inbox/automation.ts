import { randomUUID } from "node:crypto";
import { query } from "@/lib/db";
import { AppError } from "@/lib/domain";
import { RULE_FIELDS, type Rule, type RuleActions, type RuleCondition } from "./rules";
import { iso, PRIORITIES, type Canned } from "./store";

/** Routing / auto-tag rules and canned responses CRUD (server only, project-scoped). */
export type RuleRow = Rule & { hits: number; last_hit_at: string | null };

export async function listRules(projectId: string) {
  const rows = await query<RuleRow>("SELECT id,kind,name,position,active,match,conditions,actions,hits,last_hit_at FROM cx_inbox_rules WHERE project_id=$1 ORDER BY kind, position, created_at", [projectId]);
  return rows.map((r) => ({ ...r, last_hit_at: iso(r.last_hit_at) }));
}

export type RuleInput = { id?: string; kind: "route" | "tag"; name: string; active: boolean; match: "all" | "any"; conditions: RuleCondition[]; actions: RuleActions };
function validate(r: RuleInput) {
  if (!r.name.trim()) throw new AppError("Give the rule a name.");
  const conditions = r.conditions
    .filter((c) => c.value.trim())
    .map((c) => {
      const f = RULE_FIELDS.find((x) => x.value === c.field);
      if (!f || !f.ops.includes(c.op)) throw new AppError("Invalid condition.");
      return { field: c.field, op: c.op, value: c.value.trim().slice(0, 500) };
    });
  if (!conditions.length) throw new AppError("Add at least one condition with a value.");
  const tags = [...new Set((r.actions.tags ?? []).map((t) => t.trim().toLowerCase()).filter(Boolean))].slice(0, 20);
  const actions: RuleActions = r.kind === "tag" ? { tags } : { team: r.actions.team?.trim() || null, assignee: r.actions.assignee || null, priority: r.actions.priority && PRIORITIES.includes(r.actions.priority) ? r.actions.priority : null, tags };
  if (r.kind === "tag" && !tags.length) throw new AppError("Add at least one tag.");
  if (r.kind === "route" && !actions.team && !actions.assignee && !actions.priority && !tags.length) throw new AppError("Choose at least one action.");
  return { conditions, actions };
}

export async function saveRule(projectId: string, r: RuleInput) {
  const { conditions, actions } = validate(r);
  if (r.id) {
    await query("UPDATE cx_inbox_rules SET name=$3,active=$4,match=$5,conditions=$6::jsonb,actions=$7::jsonb WHERE id=$1 AND project_id=$2", [r.id, projectId, r.name.trim().slice(0, 120), r.active, r.match, JSON.stringify(conditions), JSON.stringify(actions)]);
    return r.id;
  }
  const id = randomUUID();
  await query(
    "INSERT INTO cx_inbox_rules(id,project_id,kind,name,position,active,match,conditions,actions) VALUES($1,$2,$3,$4,(SELECT COALESCE(MAX(position),0)+1 FROM cx_inbox_rules WHERE project_id=$2 AND kind=$3),$5,$6,$7::jsonb,$8::jsonb)",
    [id, projectId, r.kind, r.name.trim().slice(0, 120), r.active, r.match, JSON.stringify(conditions), JSON.stringify(actions)],
  );
  return id;
}
export async function deleteRule(projectId: string, id: string) {
  await query("DELETE FROM cx_inbox_rules WHERE id=$1 AND project_id=$2", [id, projectId]);
}
export async function toggleRule(projectId: string, id: string, active: boolean) {
  await query("UPDATE cx_inbox_rules SET active=$3 WHERE id=$1 AND project_id=$2", [id, projectId, active]);
}
export async function moveRule(projectId: string, id: string, dir: -1 | 1) {
  const [r] = await query<{ kind: string; position: number }>("SELECT kind,position FROM cx_inbox_rules WHERE id=$1 AND project_id=$2", [id, projectId]);
  if (!r) return;
  const [other] = await query<{ id: string; position: number }>(
    `SELECT id,position FROM cx_inbox_rules WHERE project_id=$1 AND kind=$2 AND position ${dir < 0 ? "<" : ">"} $3 ORDER BY position ${dir < 0 ? "DESC" : "ASC"} LIMIT 1`,
    [projectId, r.kind, r.position],
  );
  if (!other) return;
  await query("UPDATE cx_inbox_rules SET position=$2 WHERE id=$1", [id, other.position]);
  await query("UPDATE cx_inbox_rules SET position=$2 WHERE id=$1", [other.id, r.position]);
}

export async function saveCanned(projectId: string, c: { id?: string; title: string; shortcut: string; body: string }) {
  const title = c.title.trim().slice(0, 120), body = c.body.trim().slice(0, 10_000), shortcut = c.shortcut.trim().replace(/^\//, "").replace(/\s+/g, "-").toLowerCase().slice(0, 40);
  if (!title || !body) throw new AppError("Title and text are required.");
  if (c.id) await query("UPDATE cx_inbox_canned SET title=$3,shortcut=$4,body=$5 WHERE id=$1 AND project_id=$2", [c.id, projectId, title, shortcut, body]);
  else await query("INSERT INTO cx_inbox_canned(id,project_id,title,shortcut,body) VALUES($1,$2,$3,$4,$5)", [randomUUID(), projectId, title, shortcut, body]);
}
export async function deleteCanned(projectId: string, id: string) {
  await query("DELETE FROM cx_inbox_canned WHERE id=$1 AND project_id=$2", [id, projectId]);
}
export async function useCanned(projectId: string, id: string) {
  await query("UPDATE cx_inbox_canned SET uses=uses+1 WHERE id=$1 AND project_id=$2", [id, projectId]);
}
export type { Canned };
