/** Field model logic (pure, fixture-tested): validation, keys, classification paths, CSV import/export. */
import type { ClassificationNode, FieldDef, FieldType } from "../fields";

export const FIELD_TYPES: { value: FieldType; label: string }[] = [
  { value: "text", label: "Single line" },
  { value: "textarea", label: "Multiline (resizable)" },
  { value: "number", label: "Number" },
  { value: "date", label: "Date" },
  { value: "select", label: "Picklist" },
  { value: "multiselect", label: "Multi-select picklist" },
  { value: "checkbox", label: "Checkbox" },
  { value: "email", label: "Email" },
  { value: "phone", label: "Phone" },
  { value: "url", label: "URL" },
];

/** Built-in picklists (group "system"). Severity is separate from priority. */
export const SYSTEM_FIELDS = [
  { key: "severity", label: "Severity", options: ["Low", "Medium", "High", "Critical"] },
  { key: "commenter_type", label: "Commenter type", options: [] as string[] },
  { key: "commenter_level", label: "Commenter level", options: [] as string[] },
  { key: "conversation_type", label: "Conversation type", options: [] as string[] },
] as const;

export const fieldKey = (label: string) =>
  label.toLowerCase().normalize("NFKD").replace(/[^\p{L}\p{N}]+/gu, "_").replace(/^_+|_+$/g, "").slice(0, 48) || "field";

/** Custom Info masters are hierarchical: options are paths "Parent > Child > Leaf". */
export const OPTION_SEP = " > ";
export const optionPath = (o: string) => o.split(">").map((s) => s.trim()).filter(Boolean);

/** Validation of one value against its definition. Returns an error message or null. */
export function validateFieldValue(def: Pick<FieldDef, "label" | "type" | "options" | "required" | "validation">, v: unknown): string | null {
  const empty = v == null || v === "" || (Array.isArray(v) && !v.length) || (def.type === "checkbox" && v === false && def.required);
  if (empty) return def.required ? `${def.label} is required.` : null;
  const s = Array.isArray(v) ? v.map(String) : String(v);
  const text = Array.isArray(s) ? s.join(",") : s;
  switch (def.type) {
    case "number": if (!/^-?\d+(\.\d+)?$/.test(text.trim())) return `${def.label} must be a number.`; break;
    case "date": if (!/^\d{4}-\d{2}-\d{2}$/.test(text) || Number.isNaN(Date.parse(text))) return `${def.label} must be a date (YYYY-MM-DD).`; break;
    case "email": if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text)) return `${def.label} must be an email address.`; break;
    case "phone": if (!/^\+?[\d\s().-]{5,20}$/.test(text)) return `${def.label} must be a phone number.`; break;
    case "url": if (!/^https?:\/\/\S+\.\S+/.test(text)) return `${def.label} must be a URL starting with http(s)://.`; break;
    case "checkbox": if (typeof v !== "boolean" && !["true", "false"].includes(text)) return `${def.label} must be true or false.`; break;
    case "select": if (def.options.length && !def.options.includes(text)) return `${def.label}: "${text}" is not an allowed option.`; break;
    case "multiselect": {
      const vals = Array.isArray(s) ? s : text.split(",").map((x) => x.trim());
      const bad = def.options.length ? vals.filter((x) => !def.options.includes(x)) : [];
      if (bad.length) return `${def.label}: "${bad[0]}" is not an allowed option.`;
      break;
    }
  }
  const val = def.validation;
  if (val) {
    if (val.minLength != null && text.length < val.minLength) return `${def.label} needs at least ${val.minLength} characters.`;
    if (val.maxLength != null && text.length > val.maxLength) return `${def.label} allows at most ${val.maxLength} characters.`;
    if (val.regex) {
      let re: RegExp | null = null;
      try { re = new RegExp(`^(?:${val.regex})$`); } catch { re = null; }
      if (re && !re.test(text)) return `${def.label} has an invalid format.`;
    }
  }
  return null;
}

/** Validate a set of values; missing required fields count only when `complete` (full form submit). */
export function validateValues(defs: FieldDef[], values: Record<string, unknown>, complete = false) {
  const errors: Record<string, string> = {};
  for (const d of defs) {
    if (!(d.key in values) && !complete) continue;
    const e = validateFieldValue(d, values[d.key]);
    if (e) errors[d.key] = e;
  }
  return errors;
}

/** Coerce a raw value to the stored representation for its type. */
export function coerceValue(type: FieldType, v: unknown): unknown {
  if (v == null || v === "") return null;
  if (type === "number") return Number(v);
  if (type === "checkbox") return v === true || v === "true";
  if (type === "multiselect") return Array.isArray(v) ? v.map(String) : String(v).split(",").map((x) => x.trim()).filter(Boolean);
  return String(v).trim();
}

/** Path of labels from root to node ("Billing > Refund > Delayed"). */
export function classificationPath(nodes: Pick<ClassificationNode, "id" | "parentId" | "label">[], id: string) {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const out: string[] = [];
  for (let n = byId.get(id), guard = 0; n && guard < 10; n = n.parentId ? byId.get(n.parentId) : undefined, guard++) out.unshift(n.label);
  return out;
}

/** A classification selection is valid when every id exists and the list is one root→leaf chain. */
export function normalizeSelection(nodes: ClassificationNode[], ids: string[]) {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const known = ids.filter((i) => byId.has(i));
  // Expand the deepest id to its full chain (so selecting a leaf also selects its parents).
  const deepest = known.sort((a, b) => byId.get(b)!.level - byId.get(a)!.level)[0];
  const chain: string[] = [];
  for (let n = deepest ? byId.get(deepest) : undefined, g = 0; n && g < 10; n = n.parentId ? byId.get(n.parentId) : undefined, g++) chain.unshift(n.id);
  return chain;
}

/** Sentiment of the most specific level that sets one. */
export function selectionSentiment(nodes: ClassificationNode[], chain: string[]) {
  for (let i = chain.length - 1; i >= 0; i--) {
    const n = nodes.find((x) => x.id === chain[i]);
    if (n?.sentiment) return n.sentiment;
  }
  return null;
}

// ---------------------------------------------------------------- CSV

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], cell = "", q = false;
  const s = text.replace(/^﻿/, "");
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      if (c === '"' && s[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') q = false;
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === "," || c === "\t" || c === ";") { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && s[i + 1] === "\n") i++;
      row.push(cell); cell = "";
      if (row.some((x) => x.trim())) rows.push(row.map((x) => x.trim()));
      row = [];
    } else cell += c;
  }
  row.push(cell);
  if (row.some((x) => x.trim())) rows.push(row.map((x) => x.trim()));
  return rows;
}

export const csvLine = (cells: (string | number | boolean | null | undefined)[]) =>
  cells.map((c) => { const v = c == null ? "" : String(c); return /[",\n;]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v; }).join(",");

/** Classification export: one row per node path: Level 1, Level 2, Level 3, Sentiment, Hidden. */
export function classificationsToCsv(nodes: ClassificationNode[]) {
  const lines = [csvLine(["Level 1", "Level 2", "Level 3", "Sentiment", "Hidden"])];
  const kids = (p: string | null) => nodes.filter((n) => n.parentId === p);
  const walk = (p: string | null, path: string[]) => {
    for (const n of kids(p)) {
      const full = [...path, n.label];
      lines.push(csvLine([full[0], full[1] ?? "", full[2] ?? "", n.sentiment ?? "", n.hidden ? "yes" : ""]));
      walk(n.id, full);
    }
  };
  walk(null, []);
  return lines.join("\n");
}

export type ClassificationImportRow = { path: string[]; sentiment: ClassificationNode["sentiment"]; hidden: boolean };
/** Parse an import sheet (header optional). Each row adds its path; the sentiment applies to its deepest level. */
export function parseClassificationCsv(text: string): ClassificationImportRow[] {
  const rows = parseCsv(text);
  if (rows[0] && /level/i.test(rows[0][0] ?? "")) rows.shift();
  const sentiments = ["positive", "neutral", "negative"];
  return rows
    .map((r) => {
      const path = r.slice(0, 3).map((x) => x.trim()).filter(Boolean).slice(0, 3);
      const s = (r[3] ?? "").toLowerCase();
      return { path, sentiment: (sentiments.includes(s) ? s : null) as ClassificationNode["sentiment"], hidden: /^(y|yes|true|1)$/i.test(r[4] ?? "") };
    })
    .filter((r) => r.path.length);
}

/** Field definitions sheet: Label, Key, Scope, Group, Type, Options (| separated), Required, Regex, Min, Max, Encrypted, Hidden. */
export const FIELD_CSV_HEADER = ["Label", "Key", "Scope", "Group", "Type", "Options", "Required", "Regex", "Min length", "Max length", "Encrypted", "Hidden"];
export function fieldsToCsv(defs: FieldDef[]) {
  return [csvLine(FIELD_CSV_HEADER), ...defs.map((d) => csvLine([d.label, d.key, d.scope, d.group, d.type, d.options.join(" | "), d.required, d.validation?.regex ?? "", d.validation?.minLength ?? "", d.validation?.maxLength ?? "", d.encrypted, d.hidden]))].join("\n");
}
export function parseFieldsCsv(text: string): Omit<FieldDef, "id" | "order">[] {
  const rows = parseCsv(text);
  if (rows[0] && /label/i.test(rows[0][0] ?? "")) rows.shift();
  const yes = (v?: string) => /^(y|yes|true|1)$/i.test(v ?? "");
  const types = FIELD_TYPES.map((t) => t.value);
  return rows
    .filter((r) => r[0])
    .map((r) => {
      const type = (types.includes(r[4] as FieldType) ? r[4] : "text") as FieldType;
      const min = r[8] ? Number(r[8]) : undefined, max = r[9] ? Number(r[9]) : undefined;
      const validation = r[7] || min != null || max != null ? { ...(r[7] ? { regex: r[7] } : {}), ...(min != null && !Number.isNaN(min) ? { minLength: min } : {}), ...(max != null && !Number.isNaN(max) ? { maxLength: max } : {}) } : null;
      return {
        label: r[0].slice(0, 80), key: fieldKey(r[1] || r[0]), scope: r[2] === "contact" ? "contact" : "ticket", group: r[3] === "custom_info" ? "custom_info" : r[3] === "system" ? "system" : "additional_info",
        type, options: (r[5] ?? "").split("|").map((x) => x.trim()).filter(Boolean), required: yes(r[6]), validation, encrypted: yes(r[10]), hidden: yes(r[11]),
      } as Omit<FieldDef, "id" | "order">;
    });
}

/** Custom Info master import: one option path per row ("Region, City, Branch" → "Region > City > Branch"). */
export function parseOptionsCsv(text: string) {
  return [...new Set(parseCsv(text).map((r) => r.filter(Boolean).join(OPTION_SEP)).filter(Boolean))];
}
