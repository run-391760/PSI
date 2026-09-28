/**
 * Field model contract (owned and implemented by the Admin package, WP2). Other packages import these
 * read-only; callers must still handle "no fields" (a brand that defined none).
 */
import { randomUUID } from "node:crypto";
import { query, transaction } from "@/lib/db";
import { AppError } from "@/lib/domain";
import { decryptSecret, encryptSecret } from "@/lib/secrets";
import { audit } from "./audit";
import { coerceValue, fieldKey, normalizeSelection, parseClassificationCsv, selectionSentiment, SYSTEM_FIELDS, validateValues, type ClassificationImportRow } from "./pure/fields";

export type FieldType = "text" | "textarea" | "number" | "date" | "select" | "multiselect" | "checkbox" | "email" | "phone" | "url";

export type ClassificationNode = { id: string; parentId: string | null; label: string; level: number; sentiment: "positive" | "neutral" | "negative" | null; hidden: boolean };

export type FieldDef = {
  id: string;
  key: string;
  label: string;
  scope: "ticket" | "contact";
  group: "additional_info" | "custom_info" | "system";
  type: FieldType;
  options: string[];
  required: boolean;
  validation: { regex?: string; minLength?: number; maxLength?: number } | null;
  encrypted: boolean;
  hidden: boolean;
  order: number;
};

type FieldRow = { id: string; key: string; label: string; scope: FieldDef["scope"]; grp: FieldDef["group"]; type: FieldType; options: string[]; required: boolean; validation: FieldDef["validation"]; encrypted: boolean; hidden: boolean; position: number };
const toDef = (r: FieldRow): FieldDef => ({ id: r.id, key: r.key, label: r.label, scope: r.scope, group: r.grp, type: r.type, options: r.options ?? [], required: r.required, validation: r.validation, encrypted: r.encrypted, hidden: r.hidden, order: r.position });

/** Field definitions for a brand (ticket and contact fields), system picklists included once configured. */
export async function getFieldDefs(projectId: string): Promise<FieldDef[]> {
  const rows = await query<FieldRow>("SELECT id,key,label,scope,grp,type,options,required,validation,encrypted,hidden,position FROM cx_admin_fields WHERE project_id=$1 ORDER BY grp, position, created_at", [projectId]);
  return rows.map(toDef);
}
/** Classification tree (flat list with parentId) for a brand. */
export async function getClassificationTree(projectId: string): Promise<ClassificationNode[]> {
  const rows = await query<{ id: string; parent_id: string | null; label: string; level: number; sentiment: ClassificationNode["sentiment"]; hidden: boolean }>(
    "SELECT id,parent_id,label,level,sentiment,hidden FROM cx_admin_classifications WHERE project_id=$1 ORDER BY level, position, label",
    [projectId],
  );
  return rows.map((r) => ({ id: r.id, parentId: r.parent_id, label: r.label, level: r.level, sentiment: r.sentiment, hidden: r.hidden }));
}

/** Classify a ticket: set classification path and field values (validates against definitions). Merges with stored values. */
export async function classifyTicket(projectId: string, ticketId: string, input: { classificationIds?: string[]; values?: Record<string, unknown> }, userId?: string): Promise<void> {
  const [t] = await query<{ id: string }>("SELECT id FROM cx_tickets WHERE id=$1 AND project_id=$2", [ticketId, projectId]);
  if (!t) throw new AppError("Ticket not found.", 404);
  const [defs, nodes, current] = await Promise.all([getFieldDefs(projectId), getClassificationTree(projectId), readTicketFields(ticketId)]);
  const ticketDefs = defs.filter((d) => d.scope === "ticket");
  const changes: string[] = [];
  let chain = current.classificationIds;
  if (input.classificationIds) {
    chain = normalizeSelection(nodes, input.classificationIds);
    if (input.classificationIds.length && !chain.length) throw new AppError("Unknown classification.");
    changes.push(`classification → ${chain.map((id) => nodes.find((n) => n.id === id)?.label).join(" > ") || "none"}`);
  }
  const plain = { ...current.plain }, secret = { ...current.secret };
  if (input.values) {
    const unknown = Object.keys(input.values).filter((k) => !ticketDefs.some((d) => d.key === k));
    if (unknown.length) throw new AppError(`Unknown field: ${unknown[0]}`);
    const errors = validateValues(ticketDefs, input.values);
    const first = Object.values(errors)[0];
    if (first) throw new AppError(first);
    for (const [k, v] of Object.entries(input.values)) {
      const d = ticketDefs.find((x) => x.key === k)!;
      const c = coerceValue(d.type, v);
      const target = d.encrypted ? secret : plain;
      if (c == null) delete target[k];
      else target[k] = c;
      changes.push(`${d.label} ${d.encrypted ? "updated (encrypted)" : `→ ${Array.isArray(c) ? c.join(", ") : String(c ?? "empty")}`}`);
    }
  }
  const sentiment = selectionSentiment(nodes, chain);
  const actor = userId ? (await query<{ name: string; email: string }>("SELECT name,email FROM users WHERE id=$1", [userId]))[0] : null;
  await transaction(async (q) => {
    await q(
      `INSERT INTO cx_admin_ticket_fields(ticket_id,project_id,classification_ids,field_values,values_enc,updated_by,updated_at) VALUES($1,$2,$3::jsonb,$4::jsonb,$5,$6,now())
       ON CONFLICT(ticket_id) DO UPDATE SET classification_ids=excluded.classification_ids, field_values=excluded.field_values, values_enc=excluded.values_enc, updated_by=excluded.updated_by, updated_at=now()`,
      [ticketId, projectId, JSON.stringify(chain), JSON.stringify(plain), Object.keys(secret).length ? encryptSecret(JSON.stringify(secret)) : null, userId ?? null],
    );
    if (changes.length)
      await q("INSERT INTO cx_inbox_events(id,ticket_id,actor,kind,detail) VALUES($1,$2,$3,'classify',$4)", [randomUUID(), ticketId, actor?.name || actor?.email || "Automation", changes.join("; ") + (sentiment ? ` (sentiment ${sentiment})` : "")]);
  });
}

async function readTicketFields(ticketId: string) {
  const [r] = await query<{ classification_ids: string[]; field_values: Record<string, unknown>; values_enc: string | null }>("SELECT classification_ids,field_values,values_enc FROM cx_admin_ticket_fields WHERE ticket_id=$1", [ticketId]);
  let secret: Record<string, unknown> = {};
  if (r?.values_enc) try { secret = JSON.parse(decryptSecret(r.values_enc)); } catch { secret = {}; }
  return { classificationIds: r?.classification_ids ?? [], plain: r?.field_values ?? {}, secret };
}

/** Stored classification + field values of a ticket. Encrypted fields come back masked unless `reveal` (log it with revealTicketField). */
export async function getTicketFields(ticketId: string, opts: { reveal?: boolean } = {}): Promise<{ classificationIds: string[]; values: Record<string, unknown> }> {
  const r = await readTicketFields(ticketId);
  const masked = Object.fromEntries(Object.keys(r.secret).map((k) => [k, opts.reveal ? r.secret[k] : "••••••"]));
  return { classificationIds: r.classificationIds, values: { ...r.plain, ...masked } };
}

/** Reveal one encrypted field value; the reveal is written to the audit log (I5/I11). */
export async function revealTicketField(projectId: string, ticketId: string, key: string, user: { id: string; name: string }) {
  const [t] = await query<{ number: number }>("SELECT number FROM cx_tickets WHERE id=$1 AND project_id=$2", [ticketId, projectId]);
  if (!t) throw new AppError("Ticket not found.", 404);
  const r = await readTicketFields(ticketId);
  await audit(projectId, user, "pii.reveal", `ticket #${t.number}`, `field ${key}`);
  return r.secret[key] ?? null;
}

/** Ticket ids by classification (includes descendants) — for filters and reports in other packages. */
export async function ticketsWithClassification(projectId: string, classificationId: string) {
  const rows = await query<{ ticket_id: string }>("SELECT ticket_id FROM cx_admin_ticket_fields WHERE project_id=$1 AND classification_ids ? $2", [projectId, classificationId]);
  return rows.map((r) => r.ticket_id);
}

// ---------------------------------------------------------------- admin CRUD

export async function ensureSystemFields(projectId: string) {
  const [n] = await query<{ n: number }>("SELECT count(*)::int AS n FROM cx_admin_fields WHERE project_id=$1 AND grp='system'", [projectId]);
  if (n.n >= SYSTEM_FIELDS.length) return;
  for (const [i, f] of SYSTEM_FIELDS.entries())
    await query("INSERT INTO cx_admin_fields(id,project_id,key,label,scope,grp,type,options,position) VALUES($1,$2,$3,$4,'ticket','system','select',$5::jsonb,$6) ON CONFLICT DO NOTHING", [randomUUID(), projectId, f.key, f.label, JSON.stringify(f.options), i]);
}

export type FieldInput = Omit<FieldDef, "id" | "order" | "key"> & { id?: string; key?: string };
export async function saveField(projectId: string, f: FieldInput, actor?: { id: string; name: string }) {
  const label = f.label.trim().slice(0, 80);
  if (!label) throw new AppError("Give the field a label.");
  if (f.validation?.regex) try { new RegExp(f.validation.regex); } catch { throw new AppError("The validation pattern is not a valid regular expression."); }
  const options = [...new Set((f.options ?? []).map((o) => o.trim()).filter(Boolean))].slice(0, 2000);
  if ((f.type === "select" || f.type === "multiselect") && !options.length && f.group !== "system") throw new AppError("Add at least one option to a picklist.");
  const validation = f.validation && (f.validation.regex || f.validation.minLength != null || f.validation.maxLength != null) ? f.validation : null;
  if (f.id) {
    await query("UPDATE cx_admin_fields SET label=$3,type=$4,options=$5::jsonb,required=$6,validation=$7::jsonb,encrypted=$8,hidden=$9,scope=CASE WHEN grp='system' THEN scope ELSE $10 END WHERE id=$1 AND project_id=$2", [f.id, projectId, label, f.type, JSON.stringify(options), f.required, validation ? JSON.stringify(validation) : null, f.encrypted, f.hidden, f.scope]);
    await audit(projectId, actor ?? null, "field.update", label);
    return f.id;
  }
  const id = randomUUID();
  let key = fieldKey(f.key || label);
  const [dupe] = await query("SELECT 1 FROM cx_admin_fields WHERE project_id=$1 AND scope=$2 AND key=$3", [projectId, f.scope, key]);
  if (dupe) key = `${key}_${id.slice(0, 4)}`;
  await query(
    `INSERT INTO cx_admin_fields(id,project_id,key,label,scope,grp,type,options,required,validation,encrypted,hidden,position)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10::jsonb,$11,$12,(SELECT COALESCE(MAX(position),0)+1 FROM cx_admin_fields WHERE project_id=$2))`,
    [id, projectId, key, label, f.scope, f.group === "system" ? "additional_info" : f.group, f.type, JSON.stringify(options), f.required, validation ? JSON.stringify(validation) : null, f.encrypted, f.hidden],
  );
  await audit(projectId, actor ?? null, "field.create", label);
  return id;
}
export async function deleteField(projectId: string, id: string, actor?: { id: string; name: string }) {
  const [r] = await query<{ label: string }>("DELETE FROM cx_admin_fields WHERE id=$1 AND project_id=$2 AND grp<>'system' RETURNING label", [id, projectId]);
  if (r) await audit(projectId, actor ?? null, "field.delete", r.label);
}
export async function setFieldOptions(projectId: string, id: string, options: string[], mode: "replace" | "append") {
  const [f] = await query<{ options: string[] }>("SELECT options FROM cx_admin_fields WHERE id=$1 AND project_id=$2", [id, projectId]);
  if (!f) throw new AppError("Field not found.", 404);
  const next = [...new Set([...(mode === "append" ? f.options : []), ...options.map((o) => o.trim()).filter(Boolean)])].slice(0, 5000);
  await query("UPDATE cx_admin_fields SET options=$3::jsonb WHERE id=$1 AND project_id=$2", [id, projectId, JSON.stringify(next)]);
  return next.length;
}

export async function saveClassification(projectId: string, c: { id?: string; parentId: string | null; label: string; sentiment: ClassificationNode["sentiment"]; hidden: boolean }) {
  const label = c.label.trim().slice(0, 100);
  if (!label) throw new AppError("Enter a label.");
  let level = 1;
  if (c.parentId) {
    const [p] = await query<{ level: number }>("SELECT level FROM cx_admin_classifications WHERE id=$1 AND project_id=$2", [c.parentId, projectId]);
    if (!p) throw new AppError("Parent not found.", 404);
    if (p.level >= 3) throw new AppError("Classifications go three levels deep (parent → child → sub-child).");
    level = p.level + 1;
  }
  if (c.id) {
    await query("UPDATE cx_admin_classifications SET label=$3,sentiment=$4,hidden=$5 WHERE id=$1 AND project_id=$2", [c.id, projectId, label, c.sentiment, c.hidden]);
    // Hiding a branch hides its descendants from agents too.
    if (c.hidden) await query("UPDATE cx_admin_classifications SET hidden=true WHERE project_id=$1 AND (parent_id=$2 OR parent_id IN (SELECT id FROM cx_admin_classifications WHERE parent_id=$2))", [projectId, c.id]);
    return c.id;
  }
  const id = randomUUID();
  await query(
    "INSERT INTO cx_admin_classifications(id,project_id,parent_id,label,level,sentiment,hidden,position) VALUES($1,$2,$3,$4,$5,$6,$7,(SELECT COALESCE(MAX(position),0)+1 FROM cx_admin_classifications WHERE project_id=$2))",
    [id, projectId, c.parentId, label, level, c.sentiment, c.hidden],
  );
  return id;
}
export async function deleteClassification(projectId: string, id: string) {
  await query("DELETE FROM cx_admin_classifications WHERE id=$1 AND project_id=$2", [id, projectId]);
}

/** Import classification rows (paths); existing labels (case-insensitive, same parent) are reused. */
export async function importClassifications(projectId: string, rows: ClassificationImportRow[] | string) {
  const list = typeof rows === "string" ? parseClassificationCsv(rows) : rows;
  const nodes = await getClassificationTree(projectId);
  let created = 0;
  for (const r of list.slice(0, 5000)) {
    let parent: string | null = null;
    for (const [i, label] of r.path.entries()) {
      const last = i === r.path.length - 1;
      let n = nodes.find((x) => x.parentId === parent && x.label.toLowerCase() === label.toLowerCase());
      if (!n) {
        const id = await saveClassification(projectId, { parentId: parent, label, sentiment: last ? r.sentiment : null, hidden: last && r.hidden });
        n = { id, parentId: parent, label, level: i + 1, sentiment: last ? r.sentiment : null, hidden: last && r.hidden };
        nodes.push(n);
        created++;
      } else if (last && (r.sentiment !== n.sentiment || r.hidden !== n.hidden) && (r.sentiment || r.hidden)) {
        await query("UPDATE cx_admin_classifications SET sentiment=COALESCE($2,sentiment),hidden=$3 WHERE id=$1", [n.id, r.sentiment, r.hidden]);
      }
      parent = n.id;
    }
  }
  return { rows: list.length, created };
}

/** Counts of tickets per classification node (for the tree view). */
export async function classificationUsage(projectId: string) {
  const rows = await query<{ id: string; n: number }>(
    "SELECT c.value AS id, count(*)::int AS n FROM cx_admin_ticket_fields f, jsonb_array_elements_text(f.classification_ids) c WHERE f.project_id=$1 GROUP BY 1",
    [projectId],
  );
  return Object.fromEntries(rows.map((r) => [r.id, r.n])) as Record<string, number>;
}
