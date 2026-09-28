import { randomUUID } from "node:crypto";
import { z } from "zod";
import { query } from "@/lib/db";
import { AppError } from "@/lib/domain";
import { getFieldDefs, getTicketFields } from "@/lib/cx/admin/fields";
import { appOrigin } from "./surveys";
import { brandMailer } from "./mailer";
import { hoursCfg } from "./reports";
import { hms, replyTats, tat, type Basis } from "./reports-math";
import { EXPORT_COLUMNS, periodRange, toCsv, type ExportColumn, type ExportSource, type Period } from "./export-defs";

/** Download centre: export templates, ticket/message dumps with HH:MM:SS TAT, scheduled email exports (L29, L30, J6). */
export type Template = { id: string; name: string; source: ExportSource; columns: ExportColumn[]; basis: Basis; created_at: string; builtin?: boolean };
export type Schedule = { id: string; template_id: string; template: string; period: Period; cadence: "daily" | "weekly" | "monthly"; recipients: string[]; enabled: boolean; next_run_at: string; last_run_at: string | null; last_status: string | null };

export const templateInput = z.object({
  name: z.string().trim().min(1, "Name is required").max(100),
  source: z.enum(["tickets", "messages"]),
  basis: z.enum(["calendar", "business"]).default("calendar"),
  columns: z.array(z.object({ key: z.string().min(1).max(80), label: z.string().trim().min(1).max(80) })).min(1, "Pick at least one column").max(80),
});
export const scheduleInput = z.object({
  template_id: z.string().min(1),
  period: z.enum(["yesterday", "7", "30", "31", "month"]),
  cadence: z.enum(["daily", "weekly", "monthly"]),
  recipients: z.array(z.string().trim().email("Enter valid email addresses")).min(1, "Add at least one recipient").max(20),
});

/** The built-in quick report (not stored). */
export const QUICK_REPORT: Template = {
  id: "quick",
  name: "Quick report",
  source: "tickets",
  basis: "calendar",
  builtin: true,
  created_at: new Date(0).toISOString(),
  columns: ["number", "subject", "status", "priority", "channel", "agent", "contact", "created_at", "first_response_at", "resolved_at", "frt", "resolution_tat", "fr_breached", "res_breached", "csat"].map((key) => ({
    key,
    label: EXPORT_COLUMNS.tickets.find((c) => c.key === key)!.label,
  })),
};

export async function listTemplates(projectId: string): Promise<Template[]> {
  const rows = await query<Template>("SELECT id,name,source,columns,basis,created_at FROM cx_export_templates WHERE project_id=$1 ORDER BY created_at", [projectId]);
  return [QUICK_REPORT, ...rows];
}
export async function getTemplate(projectId: string, id: string) {
  if (id === "quick") return QUICK_REPORT;
  const [t] = await query<Template>("SELECT id,name,source,columns,basis,created_at FROM cx_export_templates WHERE id=$1 AND project_id=$2", [id, projectId]);
  if (!t) throw new AppError("Template not found.", 404);
  return t;
}
export async function saveTemplate(projectId: string, userId: string, raw: z.input<typeof templateInput>, id?: string) {
  const t = templateInput.parse(raw);
  if (id && id !== "quick") {
    await getTemplate(projectId, id);
    await query("UPDATE cx_export_templates SET name=$3,source=$4,columns=$5,basis=$6 WHERE id=$1 AND project_id=$2", [id, projectId, t.name, t.source, JSON.stringify(t.columns), t.basis]);
    return id;
  }
  const nid = randomUUID();
  await query("INSERT INTO cx_export_templates(id,project_id,name,source,columns,basis,created_by) VALUES($1,$2,$3,$4,$5,$6,$7)", [nid, projectId, t.name, t.source, JSON.stringify(t.columns), t.basis, userId]);
  return nid;
}
export async function deleteTemplate(projectId: string, id: string) {
  await query("DELETE FROM cx_export_templates WHERE id=$1 AND project_id=$2", [id, projectId]);
}

type TicketRow = {
  id: string; number: number; subject: string; status: string; priority: string; channel_kind: string; agent: string | null; team: string | null; contact: string | null; contact_email: string | null;
  tags: string[]; sentiment: string | null; intent: string | null; language: string | null; created_at: string; first_response_at: string | null; resolved_at: string | null;
  first_response_due: string | null; resolution_due: string | null; csat: number | null; messages: number; updated_at: string;
};
const iso = (v: unknown) => (v == null ? "" : new Date(v as string).toISOString().replace("T", " ").slice(0, 19));
const breached = (due: string | null, done: string | null, now: number) => (!due ? "" : done ? (new Date(done) > new Date(due) ? "yes" : "no") : now > new Date(due).getTime() ? "yes" : "pending");

/** Builds the rows of an export for a date range (created_at for tickets, sent time for messages). */
export async function buildExport(projectId: string, tpl: Pick<Template, "source" | "columns" | "basis">, from: Date, to: Date, limit = 50000) {
  const cfg = tpl.basis === "business" ? await hoursCfg(projectId) : null;
  const now = Date.now();
  const header = tpl.columns.map((c) => c.label);
  if (tpl.source === "tickets") {
    const rows = await query<TicketRow>(
      `SELECT t.id,t.number,t.subject,t.status,t.priority,t.channel_kind,COALESCE(NULLIF(u.name,''),u.email) AS agent,t.team,COALESCE(NULLIF(c.name,''),c.email) AS contact,c.email AS contact_email,
              t.tags,t.sentiment,t.intent,t.language,t.created_at,t.first_response_at,t.resolved_at,t.first_response_due,t.resolution_due,t.csat,t.updated_at,
              (SELECT count(*)::int FROM cx_messages m WHERE m.ticket_id=t.id AND m.direction<>'note') AS messages
       FROM cx_tickets t LEFT JOIN users u ON u.id=t.assignee_id LEFT JOIN cx_contacts c ON c.id=t.contact_id
       WHERE t.project_id=$1 AND t.created_at >= $2 AND t.created_at < $3 ORDER BY t.created_at LIMIT $4`,
      [projectId, from, to, limit],
    );
    const fieldKeys = tpl.columns.filter((c) => c.key.startsWith("field:")).map((c) => c.key.slice(6));
    const fields = new Map<string, Record<string, unknown>>();
    if (fieldKeys.length) for (const r of rows.slice(0, 5000)) fields.set(r.id, (await getTicketFields(r.id)).values);
    const val = (r: TicketRow, key: string): string | number => {
      if (key.startsWith("field:")) {
        const v = fields.get(r.id)?.[key.slice(6)];
        return v == null ? "" : Array.isArray(v) ? v.join("; ") : String(v);
      }
      switch (key) {
        case "number": return r.number;
        case "subject": return r.subject;
        case "status": return r.status;
        case "priority": return r.priority;
        case "channel": return r.channel_kind;
        case "agent": return r.agent ?? "";
        case "team": return r.team ?? "";
        case "contact": return r.contact ?? "";
        case "contact_email": return r.contact_email ?? "";
        case "tags": return (r.tags ?? []).join("; ");
        case "sentiment": return r.sentiment ?? "";
        case "intent": return r.intent ?? "";
        case "language": return r.language ?? "";
        case "created_at": return iso(r.created_at);
        case "first_response_at": return iso(r.first_response_at);
        case "resolved_at": return iso(r.resolved_at);
        case "updated_at": return iso(r.updated_at);
        case "frt": return hms(tat(r.created_at, r.first_response_at, tpl.basis, cfg));
        case "resolution_tat": return hms(tat(r.created_at, r.resolved_at, tpl.basis, cfg));
        case "fr_due": return iso(r.first_response_due);
        case "res_due": return iso(r.resolution_due);
        case "fr_breached": return breached(r.first_response_due, r.first_response_at, now);
        case "res_breached": return breached(r.resolution_due, r.resolved_at, now);
        case "csat": return r.csat ?? "";
        case "messages": return r.messages;
        default: return "";
      }
    };
    return { header, rows: rows.map((r) => tpl.columns.map((c) => val(r, c.key))) };
  }
  const msgs = await query<{ id: string; ticket_id: string; number: number; subject: string; channel_kind: string; direction: "in" | "out" | "note"; author: string | null; author_user_id: string | null; body: string; created_at: string; delivery: string }>(
    `SELECT m.id,m.ticket_id,t.number,t.subject,t.channel_kind,m.direction,COALESCE(NULLIF(u.name,''),u.email,NULLIF(m.author_name,'')) AS author,m.author_user_id,m.body,m.created_at,m.delivery
     FROM cx_messages m JOIN cx_tickets t ON t.id=m.ticket_id LEFT JOIN users u ON u.id=m.author_user_id
     WHERE t.project_id=$1 AND m.created_at >= $2 AND m.created_at < $3 ORDER BY t.number, m.created_at LIMIT $4`,
    [projectId, from, to, limit],
  );
  // Reply TAT per outbound message (time since the first unanswered customer message).
  const replyAt = new Map<string, number>();
  for (const r of replyTats(msgs.map((m) => ({ ...m, author: m.id })), tpl.basis, cfg)) replyAt.set(r.agent!, r.seconds);
  const val = (m: (typeof msgs)[number], key: string): string | number => {
    switch (key) {
      case "number": return m.number;
      case "subject": return m.subject;
      case "channel": return m.channel_kind;
      case "direction": return m.direction === "in" ? "customer" : m.direction === "out" ? "agent" : "note";
      case "author": return m.author ?? "";
      case "body": return m.body.slice(0, 5000);
      case "created_at": return iso(m.created_at);
      case "delivery": return m.delivery;
      case "reply_tat": return hms(replyAt.get(m.id));
      default: return "";
    }
  };
  return { header, rows: msgs.map((m) => tpl.columns.map((c) => val(m, c.key))) };
}

export async function fieldColumns(projectId: string) {
  const defs = await getFieldDefs(projectId).catch(() => []);
  return defs.filter((d) => d.scope === "ticket" && !d.hidden && !d.encrypted).map((d) => ({ key: `field:${d.key}`, label: d.label }));
}

/** Runs a template for a period and stores the file in the download centre. */
export async function runExport(projectId: string, userId: string | null, templateId: string, period: Period, scheduleId: string | null = null, now = new Date()) {
  const tpl = await getTemplate(projectId, templateId);
  const { from, to, label } = periodRange(period, now);
  const { header, rows } = await buildExport(projectId, tpl, from, to);
  const csv = toCsv([header, ...rows]);
  const id = randomUUID();
  const name = `${tpl.name} – ${label}.csv`;
  await query("INSERT INTO cx_export_files(id,project_id,name,rows,csv,schedule_id,created_by) VALUES($1,$2,$3,$4,$5,$6,$7)", [id, projectId, name, rows.length, csv, scheduleId, userId]);
  await query("DELETE FROM cx_export_files WHERE project_id=$1 AND id NOT IN (SELECT id FROM cx_export_files WHERE project_id=$1 ORDER BY created_at DESC LIMIT 60)", [projectId]);
  return { id, name, rows: rows.length, csv };
}

export async function listFiles(projectId: string) {
  return query<{ id: string; name: string; rows: number; created_at: string; schedule_id: string | null; creator: string | null; bytes: number }>(
    `SELECT f.id,f.name,f.rows,f.created_at,f.schedule_id,COALESCE(NULLIF(u.name,''),u.email) AS creator,length(f.csv) AS bytes
     FROM cx_export_files f LEFT JOIN users u ON u.id=f.created_by WHERE f.project_id=$1 ORDER BY f.created_at DESC LIMIT 60`,
    [projectId],
  );
}
export async function getFile(projectId: string, id: string) {
  const [f] = await query<{ name: string; csv: string }>("SELECT name,csv FROM cx_export_files WHERE id=$1 AND project_id=$2", [id, projectId]);
  if (!f) throw new AppError("File not found.", 404);
  return f;
}

// ------------------------------------------------------------- schedules

export async function listSchedules(projectId: string) {
  const rows = await query<Schedule & { template_name: string | null }>(
    `SELECT s.*, t.name AS template_name FROM cx_export_schedules s LEFT JOIN cx_export_templates t ON t.id=s.template_id WHERE s.project_id=$1 ORDER BY s.created_at`,
    [projectId],
  );
  return rows.map((r) => ({ ...r, template: r.template_name ?? "Deleted template", next_run_at: new Date(r.next_run_at).toISOString(), last_run_at: r.last_run_at ? new Date(r.last_run_at).toISOString() : null }));
}

/** Next run: tomorrow 06:00 UTC (daily), next Monday (weekly) or the 1st of next month (monthly). */
export function nextRun(cadence: Schedule["cadence"], from = new Date()) {
  const d = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate(), 6));
  if (cadence === "monthly") return new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth() + 1, 1, 6));
  d.setUTCDate(d.getUTCDate() + 1);
  if (cadence === "weekly") while (d.getUTCDay() !== 1) d.setUTCDate(d.getUTCDate() + 1);
  return d;
}

export async function saveSchedule(projectId: string, userId: string, raw: z.input<typeof scheduleInput>) {
  const s = scheduleInput.parse(raw);
  if (s.template_id === "quick") throw new AppError("Save the quick report as a template first, then schedule it.", 400);
  await getTemplate(projectId, s.template_id);
  const id = randomUUID();
  await query("INSERT INTO cx_export_schedules(id,project_id,template_id,period,cadence,recipients,next_run_at,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8)", [
    id, projectId, s.template_id, s.period, s.cadence, JSON.stringify(s.recipients), nextRun(s.cadence), userId,
  ]);
  return id;
}
export async function deleteSchedule(projectId: string, id: string) {
  await query("DELETE FROM cx_export_schedules WHERE id=$1 AND project_id=$2", [id, projectId]);
}
export async function toggleSchedule(projectId: string, id: string, enabled: boolean) {
  await query("UPDATE cx_export_schedules SET enabled=$3 WHERE id=$1 AND project_id=$2", [id, projectId, enabled]);
}

/** Runs due schedules: stores the file and emails it (CSV attached) through the brand mailbox. */
export async function runDueSchedules(projectId: string, now = new Date()) {
  const due = await query<Schedule & { created_by: string | null }>("SELECT * FROM cx_export_schedules WHERE project_id=$1 AND enabled AND next_run_at <= $2", [projectId, now]);
  if (!due.length) return { ran: 0 };
  const mailer = await brandMailer(projectId);
  let ran = 0;
  for (const s of due) {
    let status = "";
    try {
      const f = await runExport(projectId, s.created_by, s.template_id, s.period, s.id, now);
      if (mailer) {
        const link = appOrigin() ? `${appOrigin()}/cx/reports?brand=${projectId}&tab=downloads` : "the Download centre in CX → Reports";
        for (const to of s.recipients)
          await mailer.send({ to, subject: f.name.replace(/\.csv$/, ""), text: `Your scheduled export is attached (${f.rows} rows).\n\nAll exports: ${link}`, attachments: [{ filename: f.name, content: f.csv, contentType: "text/csv" }] });
        status = `Sent ${f.rows} rows to ${s.recipients.length} recipient(s)`;
      } else status = `Saved ${f.rows} rows (no email channel connected, not emailed)`;
    } catch (e) {
      status = `Failed: ${e instanceof Error ? e.message.slice(0, 200) : "error"}`;
    }
    await query("UPDATE cx_export_schedules SET last_run_at=$2, last_status=$3, next_run_at=$4 WHERE id=$1", [s.id, now, status, nextRun(s.cadence, now)]);
    ran++;
  }
  return { ran };
}
