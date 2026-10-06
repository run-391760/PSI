"use client";

import { ArrowDown, ArrowUp, CalendarClock, Download, FileSpreadsheet, Pencil, Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { deleteTemplateAction, downloadFileAction, exportNowAction, saveScheduleAction, saveTemplateAction, scheduleFlagAction } from "@/app/(app)/cx/reports/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/ui/confirm";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Callout } from "@/components/ui/feedback";
import { Checkbox, Field, Input, Select } from "@/components/ui/input";
import { MiniTable } from "@/components/ui/mini-table";
import { EXPORT_COLUMNS, PERIODS, type ExportColumn, type ExportSource, type Period } from "@/lib/cx/insights/export-defs";
import { dateTimeLabel } from "@/lib/format";
import { downloadText } from "./png-export";

type Tpl = { id: string; name: string; source: ExportSource; columns: ExportColumn[]; basis: "calendar" | "business"; builtin?: boolean };
type Sched = { id: string; template: string; period: Period; cadence: string; recipients: string[]; enabled: boolean; next_run_at: string; last_run_at: string | null; last_status: string | null };
type FileRow = { id: string; name: string; rows: number; created_at: string; creator: string | null; bytes: number; schedule_id: string | null };

const periodLabel = (p: string) => PERIODS.find((x) => x.value === p)?.label ?? p;

export function DownloadCentre({ brand, templates, schedules, files, fieldColumns, mailbox }: { brand: string; templates: Tpl[]; schedules: Sched[]; files: FileRow[]; fieldColumns: ExportColumn[]; mailbox: boolean }) {
  const router = useRouter();
  const [tplId, setTplId] = useState(templates[0]?.id ?? "quick");
  const [period, setPeriod] = useState<Period>("7");
  const [edit, setEdit] = useState<Tpl | null>(null);
  const [sched, setSched] = useState(false);
  const [msg, setMsg] = useState<{ tone: "good" | "critical"; text: string } | null>(null);
  const [pending, start] = useTransition();
  const { confirm, confirmDialog } = useConfirm();
  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, ok?: string, after?: () => void) =>
    start(async () => {
      const r = await fn();
      setMsg(r.ok ? (ok ? { tone: "good", text: ok } : null) : { tone: "critical", text: r.error ?? "Failed" });
      if (r.ok) {
        after?.();
        router.refresh();
      }
    });

  return (
    <div className="space-y-4">
      {msg && <Callout tone={msg.tone}>{msg.text}</Callout>}
      <Card>
        <CardHeader title="Export now" description="Ticket or message dump for a period. TAT columns are HH:MM:SS; times are UTC. Up to 50,000 rows." />
        <CardBody className="flex flex-wrap items-end gap-3 pt-1">
          <Field label="Template" htmlFor="dl-tpl" className="min-w-52 flex-1">
            <Select id="dl-tpl" value={tplId} onChange={(e) => setTplId(e.target.value)}>
              {templates.map((t) => <option key={t.id} value={t.id}>{t.name} ({t.source})</option>)}
            </Select>
          </Field>
          <Field label="Period" htmlFor="dl-period" className="w-44">
            <Select id="dl-period" value={period} onChange={(e) => setPeriod(e.target.value as Period)}>
              {PERIODS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
            </Select>
          </Field>
          <Button
            variant="primary"
            loading={pending}
            onClick={() =>
              start(async () => {
                const r = await exportNowAction(brand, tplId, period);
                if (!r.ok) return setMsg({ tone: "critical", text: r.error });
                downloadText(r.data.name, r.data.csv);
                setMsg({ tone: "good", text: `Exported ${r.data.rows.toLocaleString("en-US")} rows. The file is also kept in Recent files.` });
                router.refresh();
              })
            }
          >
            <Download className="h-4 w-4" /> Export CSV
          </Button>
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title={`Templates (${templates.length})`}
          description="Pick columns, rename headers and choose calendar or business-hours TAT."
          actions={<Button size="sm" variant="primary" onClick={() => setEdit({ id: "", name: "", source: "tickets", basis: "calendar", columns: EXPORT_COLUMNS.tickets.slice(0, 8) })}><Plus className="h-3.5 w-3.5" /> New template</Button>}
        />
        <CardBody className="pt-1">
          <MiniTable
            columns={[{ header: "Name" }, { header: "Data" }, { header: "Columns", align: "right" }, { header: "TAT basis" }, { header: "", align: "right" }]}
            rows={templates.map((t) => [
              <span key="n" className="font-medium text-text">{t.name} {t.builtin && <Badge>Built-in</Badge>}</span>,
              t.source,
              t.columns.length,
              t.basis === "business" ? "Business hours" : "Calendar",
              <span key="a" className="inline-flex gap-1">
                <Button size="sm" onClick={() => setEdit(t.builtin ? { ...t, id: "", name: `${t.name} (copy)` } : t)}><Pencil className="h-3.5 w-3.5" /> {t.builtin ? "Customize" : "Edit"}</Button>
                {!t.builtin && <Button size="icon" variant="ghost" aria-label={`Delete ${t.name}`} onClick={async () => (await confirm({ title: `Delete the template “${t.name}”?`, description: "Its scheduled exports are deleted too." })) && run(() => deleteTemplateAction(brand, t.id))}><Trash2 className="h-4 w-4" /></Button>}
              </span>,
            ])}
          />
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title={`Scheduled exports (${schedules.length})`}
          description={mailbox ? "Emailed with the CSV attached through your brand mailbox, and kept in Recent files." : "No email channel is connected: scheduled files are saved in Recent files only. Connect an email channel to deliver them."}
          actions={<Button size="sm" onClick={() => setSched(true)} disabled={!templates.some((t) => !t.builtin)}><CalendarClock className="h-3.5 w-3.5" /> Schedule</Button>}
        />
        <CardBody className="pt-1">
          <MiniTable
            empty={templates.some((t) => !t.builtin) ? "No scheduled exports." : "Save a template first, then schedule it."}
            columns={[{ header: "Template" }, { header: "Data" }, { header: "Every" }, { header: "Recipients" }, { header: "Next run" }, { header: "Last result" }, { header: "", align: "right" }]}
            rows={schedules.map((s) => [
              <span key="t" className="font-medium text-text">{s.template}</span>,
              periodLabel(s.period),
              s.cadence === "daily" ? "Day" : s.cadence === "weekly" ? "Monday" : "1st of month",
              <span key="r" className="text-[12px]">{s.recipients.join(", ")}</span>,
              s.enabled ? dateTimeLabel(s.next_run_at) : <Badge key="p" tone="warning">Paused</Badge>,
              <span key="l" className="text-[12px] text-text-2">{s.last_status ?? "Not run yet"}</span>,
              <span key="a" className="inline-flex gap-1">
                <Button size="sm" variant="ghost" onClick={() => run(() => scheduleFlagAction(brand, s.id, s.enabled ? "pause" : "resume"))}>{s.enabled ? "Pause" : "Resume"}</Button>
                <Button size="icon" variant="ghost" aria-label="Delete schedule" onClick={async () => (await confirm({ title: "Delete this scheduled export?", description: `${s.template} is no longer exported on this schedule.` })) && run(() => scheduleFlagAction(brand, s.id, "delete"))}><Trash2 className="h-4 w-4" /></Button>
              </span>,
            ])}
          />
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Recent files" description="The last 60 exports (manual and scheduled)." />
        <CardBody className="pt-1">
          <MiniTable
            empty="No exports yet."
            columns={[{ header: "File" }, { header: "Rows", align: "right" }, { header: "Size", align: "right" }, { header: "Created" }, { header: "By" }, { header: "", align: "right" }]}
            rows={files.map((f) => [
              <span key="n" className="inline-flex items-center gap-1.5 font-medium text-text"><FileSpreadsheet className="h-4 w-4 text-text-3" />{f.name}</span>,
              f.rows.toLocaleString("en-US"),
              f.bytes > 1e6 ? `${(f.bytes / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(f.bytes / 1e3))} KB`,
              dateTimeLabel(f.created_at),
              f.schedule_id ? "Schedule" : (f.creator ?? "n/a"),
              <Button key="d" size="sm" onClick={() => start(async () => { const r = await downloadFileAction(brand, f.id); if (r.ok) downloadText(r.data.name, r.data.csv); else setMsg({ tone: "critical", text: r.error }); })}><Download className="h-3.5 w-3.5" /> Download</Button>,
            ])}
          />
        </CardBody>
      </Card>

      {edit && <TemplateEditor brand={brand} initial={edit} fieldColumns={fieldColumns} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); router.refresh(); }} />}
      {confirmDialog}
      {sched && <ScheduleDialog brand={brand} templates={templates.filter((t) => !t.builtin)} onClose={() => setSched(false)} onSaved={() => { setSched(false); setMsg({ tone: "good", text: "Schedule saved." }); router.refresh(); }} />}
    </div>
  );
}

function TemplateEditor({ brand, initial, fieldColumns, onClose, onSaved }: { brand: string; initial: Tpl; fieldColumns: ExportColumn[]; onClose: () => void; onSaved: () => void }) {
  const [t, setT] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const available = [...EXPORT_COLUMNS[t.source], ...(t.source === "tickets" ? fieldColumns : [])];
  const chosen = new Set(t.columns.map((c) => c.key));
  const move = (i: number, d: number) => {
    const c = [...t.columns];
    const j = i + d;
    if (j < 0 || j >= c.length) return;
    [c[i], c[j]] = [c[j], c[i]];
    setT({ ...t, columns: c });
  };
  return (
    <Dialog
      open
      onClose={onClose}
      size="xl"
      title={t.id ? "Edit template" : "New export template"}
      error={error}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={pending} onClick={() => start(async () => { const r = await saveTemplateAction(brand, { name: t.name, source: t.source, basis: t.basis, columns: t.columns }, t.id || undefined); if (r.ok) onSaved(); else setError(r.error); })}>Save template</Button>
        </>
      }
    >
      <div className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Name" htmlFor="tp-name"><Input id="tp-name" autoFocus value={t.name} onChange={(e) => setT({ ...t, name: e.target.value })} placeholder="e.g. Daily agent dump" /></Field>
          <Field label="Data" htmlFor="tp-src">
            <Select id="tp-src" value={t.source} onChange={(e) => { const source = e.target.value as ExportSource; setT({ ...t, source, columns: EXPORT_COLUMNS[source].slice(0, 6) }); }}>
              <option value="tickets">Tickets (one row per ticket)</option>
              <option value="messages">Messages (one row per message)</option>
            </Select>
          </Field>
          <Field label="TAT basis" htmlFor="tp-basis">
            <Select id="tp-basis" value={t.basis} onChange={(e) => setT({ ...t, basis: e.target.value as Tpl["basis"] })}>
              <option value="calendar">Calendar hours</option>
              <option value="business">Business hours (Team &amp; SLAs)</option>
            </Select>
          </Field>
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
          <div>
            <div className="mb-1.5 text-[12.5px] font-semibold text-text">Available columns</div>
            <div className="scroll-thin max-h-72 space-y-1 overflow-auto rounded-md border border-border p-2">
              {available.map((c) => (
                <label key={c.key} className="flex items-center gap-2 text-[13px] text-text">
                  <Checkbox checked={chosen.has(c.key)} onChange={(e) => setT({ ...t, columns: e.target.checked ? [...t.columns, c] : t.columns.filter((x) => x.key !== c.key) })} /> {c.label}
                </label>
              ))}
            </div>
          </div>
          <div>
            <div className="mb-1.5 text-[12.5px] font-semibold text-text">Column order and headers ({t.columns.length})</div>
            <div className="scroll-thin max-h-72 space-y-1.5 overflow-auto">
              {t.columns.map((c, i) => (
                <div key={c.key} className="flex items-center gap-1">
                  <Input aria-label={`Header for ${c.key}`} value={c.label} onChange={(e) => setT({ ...t, columns: t.columns.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)) })} className="h-8 min-w-0 flex-1" />
                  <Button size="icon" variant="ghost" aria-label="Move up" onClick={() => move(i, -1)} disabled={i === 0}><ArrowUp className="h-3.5 w-3.5" /></Button>
                  <Button size="icon" variant="ghost" aria-label="Move down" onClick={() => move(i, 1)} disabled={i === t.columns.length - 1}><ArrowDown className="h-3.5 w-3.5" /></Button>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </Dialog>
  );
}

function ScheduleDialog({ brand, templates, onClose, onSaved }: { brand: string; templates: Tpl[]; onClose: () => void; onSaved: () => void }) {
  const [templateId, setTemplateId] = useState(templates[0]?.id ?? "");
  const [period, setPeriod] = useState<Period>("yesterday");
  const [cadence, setCadence] = useState<"daily" | "weekly" | "monthly">("daily");
  const [recipients, setRecipients] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <Dialog
      open
      onClose={onClose}
      title="Schedule an export"
      description="Runs at 06:00 UTC."
      error={error}
      onSubmit={() => !pending && start(async () => { const r = await saveScheduleAction(brand, { template_id: templateId, period: period === "today" ? "yesterday" : period, cadence, recipients: recipients.split(/[\s,;]+/).filter(Boolean) }); if (r.ok) onSaved(); else setError(r.error); })}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" loading={pending}>Save schedule</Button>
        </>
      }
    >
      <div className="space-y-3">
        <Field label="Template" htmlFor="sc-tpl"><Select id="sc-tpl" value={templateId} onChange={(e) => setTemplateId(e.target.value)}>{templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</Select></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Data period" htmlFor="sc-period"><Select id="sc-period" value={period} onChange={(e) => setPeriod(e.target.value as Period)}>{PERIODS.filter((p) => p.value !== "today").map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}</Select></Field>
          <Field label="Send" htmlFor="sc-cad"><Select id="sc-cad" value={cadence} onChange={(e) => setCadence(e.target.value as typeof cadence)}><option value="daily">Every day</option><option value="weekly">Every Monday</option><option value="monthly">1st of each month</option></Select></Field>
        </div>
        <Field label="Recipients" htmlFor="sc-to" hint="Comma-separated email addresses"><Input id="sc-to" value={recipients} onChange={(e) => setRecipients(e.target.value)} placeholder="lead@example.com, ops@example.com" /></Field>
      </div>
    </Dialog>
  );
}
