/**
 * Routing and auto-tagging rules (pure, fixture-tested). Route rules: the first active matching rule
 * (by position) applies its actions. Tag rules: every active matching rule adds its tags.
 */
export type RuleField = "channel" | "keyword" | "subject" | "intent" | "sentiment" | "language" | "email_domain";
export type RuleOp = "is" | "is_not" | "contains" | "not_contains";
export type RuleCondition = { field: RuleField; op: RuleOp; value: string };
export type RuleActions = { team?: string | null; assignee?: string | null; priority?: "low" | "normal" | "high" | "urgent" | null; tags?: string[] };
export type Rule = { id: string; kind: "route" | "tag"; name: string; position: number; active: boolean; match: "all" | "any"; conditions: RuleCondition[]; actions: RuleActions };
export type RuleContext = { channel: string; subject: string; body: string; intent: string; sentiment: string; language: string; email?: string | null };

export const RULE_FIELDS: { value: RuleField; label: string; ops: RuleOp[] }[] = [
  { value: "channel", label: "Channel", ops: ["is", "is_not"] },
  { value: "keyword", label: "Subject or message", ops: ["contains", "not_contains"] },
  { value: "subject", label: "Subject", ops: ["contains", "not_contains"] },
  { value: "intent", label: "Intent", ops: ["is", "is_not"] },
  { value: "sentiment", label: "Sentiment", ops: ["is", "is_not"] },
  { value: "language", label: "Language", ops: ["is", "is_not"] },
  { value: "email_domain", label: "Sender email domain", ops: ["is", "is_not"] },
];
export const OP_LABELS: Record<RuleOp, string> = { is: "is any of", is_not: "is none of", contains: "contains any of", not_contains: "contains none of" };

const list = (v: string) => v.split(",").map((x) => x.trim().toLowerCase()).filter(Boolean);
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** Whole-word, case-insensitive phrase match (so "refund" matches "Refund!" but not "refunded" is ok via prefix). */
export function containsPhrase(text: string, phrase: string) {
  return new RegExp(`(^|[^\\p{L}\\p{N}])${escape(phrase)}`, "iu").test(text);
}

function fieldValue(ctx: RuleContext, field: RuleField) {
  switch (field) {
    case "channel": return ctx.channel;
    case "subject": return ctx.subject;
    case "keyword": return `${ctx.subject}\n${ctx.body}`;
    case "intent": return ctx.intent;
    case "sentiment": return ctx.sentiment;
    case "language": return ctx.language;
    case "email_domain": return (ctx.email ?? "").split("@")[1] ?? "";
  }
}

export function matchCondition(c: RuleCondition, ctx: RuleContext) {
  const values = list(c.value);
  if (!values.length) return true;
  const v = String(fieldValue(ctx, c.field) ?? "").toLowerCase();
  switch (c.op) {
    case "is": return values.includes(v);
    case "is_not": return !values.includes(v);
    case "contains": return values.some((p) => containsPhrase(v, p));
    case "not_contains": return !values.some((p) => containsPhrase(v, p));
  }
}

export function matchRule(rule: Pick<Rule, "active" | "match" | "conditions">, ctx: RuleContext) {
  if (!rule.active) return false;
  if (!rule.conditions.length) return false;
  return rule.match === "any" ? rule.conditions.some((c) => matchCondition(c, ctx)) : rule.conditions.every((c) => matchCondition(c, ctx));
}

export function evaluateRules(rules: Rule[], ctx: RuleContext): { actions: Required<RuleActions>; matched: string[] } {
  const actions: Required<RuleActions> = { team: null, assignee: null, priority: null, tags: [] };
  const matched: string[] = [];
  const sorted = [...rules].sort((a, b) => a.position - b.position);
  const route = sorted.find((r) => r.kind === "route" && matchRule(r, ctx));
  if (route) {
    matched.push(route.id);
    actions.team = route.actions.team || null;
    actions.assignee = route.actions.assignee || null;
    actions.priority = route.actions.priority || null;
    actions.tags.push(...(route.actions.tags ?? []));
  }
  for (const r of sorted) if (r.kind === "tag" && matchRule(r, ctx)) {
    matched.push(r.id);
    actions.tags.push(...(r.actions.tags ?? []));
  }
  actions.tags = [...new Set(actions.tags.map((t) => t.trim().toLowerCase()).filter(Boolean))];
  return { actions, matched };
}
