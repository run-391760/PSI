/**
 * Automation v2 (pure, fixture-tested). Automations run on ticket creation or on a customer reply.
 * Every active matching automation applies in position order; later ones override single-value actions
 * (assignee, status…), tags/fields merge, and "stop" ends processing.
 */
export type AutoField =
  | "channel" | "social_type" | "keyword" | "subject" | "intent" | "sentiment" | "language" | "email_domain"
  | "classification" | "field" | "length" | "business_hours" | "priority" | "severity" | "segment" | "contact_tag";
export type AutoOp = "is" | "is_not" | "contains" | "not_contains" | "eq" | "lt" | "gt" | "lte" | "gte" | "empty" | "not_empty";
export type AutoCondition = { field: AutoField; op: AutoOp; value: string; key?: string };
export type AutoActions = {
  assignee?: string | null;
  queue?: boolean;
  team?: string | null;
  priority?: "low" | "normal" | "high" | "urgent" | null;
  severity?: string | null;
  tags?: string[];
  classificationId?: string | null;
  fields?: Record<string, string>;
  reply?: string | null;
  note?: string | null;
  status?: string | null;
};
export type Automation = { id: string; name: string; trigger: "created" | "customer_reply"; social_type: string; position: number; active: boolean; stop: boolean; match: "all" | "any"; conditions: AutoCondition[]; actions: AutoActions };

export type AutoContext = {
  channel: string; subject: string; body: string; intent: string; sentiment: string; language: string; email?: string | null;
  classificationLabels?: string[]; classificationIds?: string[]; fields?: Record<string, unknown>; businessOpen?: boolean | null;
  priority?: string; severity?: string | null; segment?: string | null; contactTags?: string[];
};

export const TEXT_OPS: AutoOp[] = ["contains", "not_contains"];
export const SET_OPS: AutoOp[] = ["is", "is_not"];
export const NUM_OPS: AutoOp[] = ["eq", "lt", "gt", "lte", "gte"];
export const AUTO_FIELDS: { value: AutoField; label: string; ops: AutoOp[]; hint?: string }[] = [
  { value: "channel", label: "Channel", ops: SET_OPS },
  { value: "social_type", label: "Social type", ops: SET_OPS, hint: "public, private, custom" },
  { value: "keyword", label: "Subject or message", ops: TEXT_OPS },
  { value: "subject", label: "Subject", ops: TEXT_OPS },
  { value: "intent", label: "Intent", ops: SET_OPS },
  { value: "sentiment", label: "Sentiment", ops: SET_OPS },
  { value: "language", label: "Language", ops: SET_OPS },
  { value: "email_domain", label: "Sender email domain", ops: SET_OPS },
  { value: "classification", label: "Classification", ops: [...SET_OPS, "empty", "not_empty"] },
  { value: "field", label: "Additional / Custom info field", ops: [...SET_OPS, ...TEXT_OPS, "empty", "not_empty"] },
  { value: "length", label: "Message length (characters)", ops: NUM_OPS },
  { value: "business_hours", label: "Business hours", ops: ["is"], hint: "open or closed" },
  { value: "priority", label: "Priority", ops: SET_OPS },
  { value: "severity", label: "Severity", ops: [...SET_OPS, "empty"] },
  { value: "segment", label: "Customer segment", ops: [...SET_OPS, "empty"] },
  { value: "contact_tag", label: "Contact tag", ops: SET_OPS },
];
export const AUTO_OP_LABELS: Record<AutoOp, string> = {
  is: "is any of", is_not: "is none of", contains: "contains any of", not_contains: "contains none of",
  eq: "=", lt: "<", gt: ">", lte: "≤", gte: "≥", empty: "is empty", not_empty: "is set",
};

/** Private (1:1) vs public (social comments, reviews, mentions) vs custom (API/BYOC) channels. */
const PRIVATE = new Set(["email", "livechat", "webform", "whatsapp", "telegram", "sms", "phone", "dm", "messenger", "discord-dm"]);
const CUSTOM = new Set(["api", "byoc", "other"]);
export const socialType = (channel: string) => (PRIVATE.has(channel) ? "private" : CUSTOM.has(channel) ? "custom" : "public");

const list = (v: string) => v.split(",").map((x) => x.trim().toLowerCase()).filter(Boolean);
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const phrase = (text: string, p: string) => new RegExp(`(^|[^\\p{L}\\p{N}])${esc(p)}`, "iu").test(text);

function values(ctx: AutoContext, c: AutoCondition): string[] | number | null {
  switch (c.field) {
    case "channel": return [ctx.channel];
    case "social_type": return [socialType(ctx.channel)];
    case "keyword": return [`${ctx.subject}\n${ctx.body}`];
    case "subject": return [ctx.subject];
    case "intent": return [ctx.intent];
    case "sentiment": return [ctx.sentiment];
    case "language": return [ctx.language];
    case "email_domain": return [(ctx.email ?? "").split("@")[1] ?? ""];
    case "classification": return [...(ctx.classificationLabels ?? []), ...(ctx.classificationIds ?? [])];
    case "field": {
      const v = ctx.fields?.[c.key ?? ""];
      return v == null || v === "" ? [] : Array.isArray(v) ? v.map(String) : [String(v)];
    }
    case "length": return ctx.body.trim().length;
    case "business_hours": return ctx.businessOpen == null ? [] : [ctx.businessOpen ? "open" : "closed"];
    case "priority": return [ctx.priority ?? "normal"];
    case "severity": return ctx.severity ? [ctx.severity] : [];
    case "segment": return ctx.segment ? [ctx.segment] : [];
    case "contact_tag": return ctx.contactTags ?? [];
  }
}

export function matchAutoCondition(c: AutoCondition, ctx: AutoContext): boolean {
  const v = values(ctx, c);
  if (typeof v === "number") {
    const n = Number(c.value);
    if (Number.isNaN(n)) return false;
    return c.op === "eq" ? v === n : c.op === "lt" ? v < n : c.op === "gt" ? v > n : c.op === "lte" ? v <= n : c.op === "gte" ? v >= n : false;
  }
  const have = (v ?? []).map((x) => x.toLowerCase());
  if (c.op === "empty") return !have.filter(Boolean).length;
  if (c.op === "not_empty") return !!have.filter(Boolean).length;
  const want = list(c.value);
  if (!want.length) return true;
  switch (c.op) {
    case "is": return want.some((w) => have.includes(w));
    case "is_not": return !want.some((w) => have.includes(w));
    case "contains": return want.some((w) => have.some((h) => phrase(h, w)));
    case "not_contains": return !want.some((w) => have.some((h) => phrase(h, w)));
    default: return false;
  }
}

export function matchAutomation(a: Pick<Automation, "active" | "match" | "conditions" | "social_type">, ctx: AutoContext) {
  if (!a.active || !a.conditions.length) return false;
  if (a.social_type && a.social_type !== "any" && socialType(ctx.channel) !== a.social_type && a.social_type !== ctx.channel) return false;
  return a.match === "any" ? a.conditions.some((c) => matchAutoCondition(c, ctx)) : a.conditions.every((c) => matchAutoCondition(c, ctx));
}

export function evaluateAutomations(list: Automation[], ctx: AutoContext, trigger: Automation["trigger"]) {
  const out: AutoActions & { tags: string[]; fields: Record<string, string> } = { tags: [], fields: {} };
  const matched: string[] = [];
  for (const a of [...list].sort((x, y) => x.position - y.position)) {
    if (a.trigger !== trigger || !matchAutomation(a, ctx)) continue;
    matched.push(a.id);
    const x = a.actions;
    for (const k of ["assignee", "team", "priority", "severity", "classificationId", "reply", "note", "status"] as const) if (x[k]) (out as Record<string, unknown>)[k] = x[k];
    if (x.queue) out.queue = true;
    out.tags.push(...(x.tags ?? []));
    Object.assign(out.fields, x.fields ?? {});
    if (a.stop) break;
  }
  out.tags = [...new Set(out.tags.map((t) => t.trim().toLowerCase()).filter(Boolean))];
  if (out.assignee) out.queue = false;
  return { actions: out, matched };
}

/** Fill {{name}}, {{first_name}}, {{ticket}}, {{brand}}, {{field.<key>}} placeholders of an auto-reply. */
export function renderTemplate(body: string, v: { name?: string | null; ticket?: number; brand?: string; fields?: Record<string, unknown> }) {
  return body.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, k: string) => {
    if (k === "name") return v.name || "there";
    if (k === "first_name") return (v.name || "there").split(/\s+/)[0];
    if (k === "ticket") return v.ticket != null ? `#${v.ticket}` : "";
    if (k === "brand") return v.brand ?? "";
    if (k.startsWith("field.")) { const x = v.fields?.[k.slice(6)]; return x == null ? "" : Array.isArray(x) ? x.join(", ") : String(x); }
    return "";
  });
}
