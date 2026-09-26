"use client";

import { Check, Copy, Link2, Mail, Pencil, Save, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useRef, useState, useTransition } from "react";
import { addLinkAction, saveTemplateAction, updatePipelineAction } from "@/app/(app)/link-building/actions";
import { MERGE_FIELDS, OUTREACH_LABELS, OUTREACH_STATUSES, renderTemplate, type OutreachStatus, type PipelineRow } from "@/lib/backlinks/types";
import { cn } from "@/lib/utils";
import { AsBadge, DomainLink } from "@/components/seo/badges";
import { Dot } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { type Column, DataTable } from "@/components/ui/data-table";
import { Dialog } from "@/components/ui/dialog";
import { Callout } from "@/components/ui/feedback";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { Stars, shortDate } from "./bits";
import { useProspectMover } from "./lb-prospects";
import { ExportButton, useCsvExport } from "./table-tools";

const STATUS_DOT: Record<OutreachStatus, "neutral" | "info" | "brand" | "good" | "critical"> = {
  to_contact: "neutral",
  sent: "info",
  replied: "brand",
  acquired: "good",
  rejected: "critical",
};

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

type Template = { subject: string; body: string; senderName: string };

/* ------------------------------------------------------------------------------------------------
 * Template editor
 * ---------------------------------------------------------------------------------------------- */

export function TemplateEditor({ projectId, initial, ourSite }: { projectId: string; initial: Template; ourSite: string }) {
  const router = useRouter();
  const [t, setT] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, start] = useTransition();
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const dirty = t.subject !== initial.subject || t.body !== initial.body || t.senderName !== initial.senderName;
  const insert = (field: string) => {
    const el = bodyRef.current;
    if (!el) return setT((x) => ({ ...x, body: x.body + field }));
    const { selectionStart: a, selectionEnd: b } = el;
    const next = t.body.slice(0, a) + field + t.body.slice(b);
    setT((x) => ({ ...x, body: next }));
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(a + field.length, a + field.length);
    });
  };
  const preview = renderTemplate(`${t.body}${t.senderName ? `\n${t.senderName}` : ""}`, { domain: "example-blog.com", name: "Alex", ourSite });
  return (
    <Card>
      <CardHeader
        title="Email template"
        description="Used when you compose outreach emails. Merge fields are replaced per prospect."
        actions={
          <Button
            size="sm"
            variant="primary"
            loading={pending}
            disabled={!dirty}
            onClick={() =>
              start(async () => {
                const res = await saveTemplateAction(projectId, t);
                if (!res.ok) return setError(res.error);
                setError(null);
                setSaved(true);
                setTimeout(() => setSaved(false), 1800);
                router.refresh();
              })
            }
          >
            {saved ? <Check className="h-3.5 w-3.5" /> : <Save className="h-3.5 w-3.5" />} {saved ? "Saved" : "Save template"}
          </Button>
        }
      />
      <CardBody className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-3">
          {error && <Callout tone="critical">{error}</Callout>}
          <Field label="Subject" htmlFor="lb-subject">
            <Input id="lb-subject" value={t.subject} onChange={(e) => setT((x) => ({ ...x, subject: e.target.value }))} maxLength={200} />
          </Field>
          <div>
            <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
              <label htmlFor="lb-body" className="text-[12.5px] font-medium text-text-2">
                Body
              </label>
              <span className="flex flex-wrap gap-1">
                {MERGE_FIELDS.map((f) => (
                  <button key={f} type="button" onClick={() => insert(f)} className="rounded border border-border bg-surface-2 px-1.5 py-0.5 font-mono text-[11px] text-text-2 hover:border-brand hover:text-text" title={`Insert ${f}`}>
                    {f}
                  </button>
                ))}
              </span>
            </div>
            <Textarea id="lb-body" ref={bodyRef} value={t.body} onChange={(e) => setT((x) => ({ ...x, body: e.target.value }))} rows={11} maxLength={5000} className="font-mono text-[12.5px]" />
          </div>
          <Field label="Signature name" htmlFor="lb-sender" hint="Appended under the body.">
            <Input id="lb-sender" value={t.senderName} onChange={(e) => setT((x) => ({ ...x, senderName: e.target.value }))} maxLength={100} placeholder="Your name" />
          </Field>
        </div>
        <div>
          <div className="mb-1 text-[12.5px] font-medium text-text-2">Preview</div>
          <div className="rounded-md border border-border bg-surface-2 p-3 text-[13px]">
            <div className="mb-2 border-b border-border pb-2">
              <span className="text-text-3">Subject: </span>
              <span className="font-medium">{renderTemplate(t.subject, { domain: "example-blog.com", name: "Alex", ourSite })}</span>
            </div>
            <pre className="font-sans whitespace-pre-wrap text-text-2">{preview}</pre>
          </div>
          <p className="mt-2 text-[12px] text-text-3">
            {"{{domain}}"} = prospect domain · {"{{name}}"} = contact name (or “there”) · {"{{our_site}}"} = {ourSite}
          </p>
        </div>
      </CardBody>
    </Card>
  );
}

/* ------------------------------------------------------------------------------------------------
 * Dialogs
 * ---------------------------------------------------------------------------------------------- */

function ComposeDialog({ row, template, ourSite, onClose }: { row: PipelineRow; template: Template; ourSite: string; onClose: () => void }) {
  const vars = { domain: row.domain, name: row.contactName, ourSite };
  const subject = renderTemplate(template.subject, vars);
  const body = renderTemplate(`${template.body}${template.senderName ? `\n${template.senderName}` : ""}`, vars);
  const to = row.contactEmail;
  const [copied, setCopied] = useState(false);
  return (
    <Dialog
      open
      onClose={onClose}
      title={`Email ${row.domain}`}
      description="Copy the message into your email client. Nothing is sent from SynapseSEO."
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
          <Button
            onClick={async () => {
              if (await copyText(`${to ? `To: ${to}\n` : ""}Subject: ${subject}\n\n${body}`)) setCopied(true);
            }}
          >
            {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />} {copied ? "Copied" : "Copy email"}
          </Button>
          {to && (
            <a href={`mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`} className="inline-flex h-8.5 items-center gap-1.5 rounded-md bg-brand px-3.5 text-[13px] font-medium text-white hover:bg-brand-hover">
              <Mail className="h-4 w-4" /> Open in mail app
            </a>
          )}
        </>
      }
    >
      <div className="space-y-3 text-[13px]">
        {!to && <Callout tone="warning">No contact email yet — edit the prospect to add one, or find it on {row.domain}&apos;s contact page.</Callout>}
        <div className="grid grid-cols-[64px_1fr] items-center gap-2">
          <span className="text-text-3">To</span>
          <span className="truncate font-medium">{to || <span className="text-text-3">n/a</span>}</span>
          <span className="text-text-3">Subject</span>
          <span className="font-medium">{subject}</span>
        </div>
        <Textarea readOnly value={body} rows={12} className="font-mono text-[12.5px]" aria-label="Email body" />
      </div>
    </Dialog>
  );
}

function EditDialog({ projectId, row, onClose }: { projectId: string; row: PipelineRow; onClose: () => void }) {
  const router = useRouter();
  const [v, setV] = useState({ contactName: row.contactName, contactEmail: row.contactEmail, notes: row.notes });
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const save = () => {
    if (v.contactEmail.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.contactEmail.trim())) return setError("Enter a valid email address.");
    start(async () => {
      const res = await updatePipelineAction(projectId, row.domain, v);
      if (!res.ok) return setError(res.error);
      onClose();
      router.refresh();
    });
  };
  return (
    <Dialog
      open
      onClose={onClose}
      title={`Edit ${row.domain}`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" loading={pending} onClick={save}>
            Save
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        {error && <Callout tone="critical">{error}</Callout>}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Contact name" htmlFor="pl-name">
            <Input id="pl-name" value={v.contactName} onChange={(e) => setV((x) => ({ ...x, contactName: e.target.value }))} placeholder="Jane Doe" maxLength={120} />
          </Field>
          <Field label="Contact email" htmlFor="pl-email">
            <Input id="pl-email" type="email" value={v.contactEmail} onChange={(e) => setV((x) => ({ ...x, contactEmail: e.target.value }))} placeholder={`editor@${row.domain}`} maxLength={254} />
          </Field>
        </div>
        <Field label="Notes" htmlFor="pl-notes">
          <Textarea id="pl-notes" value={v.notes} onChange={(e) => setV((x) => ({ ...x, notes: e.target.value }))} rows={5} maxLength={4000} placeholder="Pitch angle, follow-up dates, what they asked for…" />
        </Field>
      </div>
    </Dialog>
  );
}

export function AddLinkDialog({ projectId, prospectDomain, onClose, prospects = [] }: { projectId: string; prospectDomain?: string; onClose: () => void; prospects?: string[] }) {
  const router = useRouter();
  const [url, setUrl] = useState(prospectDomain ? `https://${prospectDomain}/` : "");
  const [prospect, setProspect] = useState(prospectDomain ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const submit = () =>
    start(async () => {
      const res = await addLinkAction(projectId, { sourceUrl: url, prospectDomain: prospect || null });
      if (!res.ok) return setError(res.error);
      onClose();
      router.push(`/link-building?project=${projectId}&tab=monitor`);
      router.refresh();
    });
  return (
    <Dialog
      open
      onClose={onClose}
      title="Monitor an acquired link"
      description="We'll crawl the page now and daily to confirm it still links to your site."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" loading={pending} onClick={submit} disabled={!url.trim()}>
            <Link2 className="h-4 w-4" /> Start monitoring
          </Button>
        </>
      }
    >
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        {error && <Callout tone="critical">{error}</Callout>}
        <Field label="Page with the link (source URL)" htmlFor="al-url" hint="The exact page where your link was published.">
          <Input id="al-url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://example.com/blog/article" autoFocus />
        </Field>
        {prospects.length > 0 && (
          <Field label="Prospect (optional)" htmlFor="al-prospect" hint="Marks the prospect as “Link acquired”.">
            <Select id="al-prospect" value={prospect} onChange={(e) => setProspect(e.target.value)}>
              <option value="">None</option>
              {prospects.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </Select>
          </Field>
        )}
      </form>
    </Dialog>
  );
}

/* ------------------------------------------------------------------------------------------------
 * Pipeline table
 * ---------------------------------------------------------------------------------------------- */

function StatusSelect({ projectId, row, onAcquired }: { projectId: string; row: PipelineRow; onAcquired: (row: PipelineRow) => void }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <span className="inline-flex items-center gap-1.5">
      <Dot tone={STATUS_DOT[row.status]} />
      <Select
      value={row.status}
      disabled={pending}
      onChange={(e) => {
        const status = e.target.value as OutreachStatus;
        start(async () => {
          await updatePipelineAction(projectId, row.domain, { status });
          router.refresh();
          if (status === "acquired") onAcquired(row);
        });
      }}
      className="h-7.5 w-34 text-[12.5px] font-medium"
      aria-label={`Outreach status for ${row.domain}`}
    >
      {OUTREACH_STATUSES.map((s) => (
        <option key={s} value={s}>
          {OUTREACH_LABELS[s]}
        </option>
      ))}
      </Select>
    </span>
  );
}

export function PipelineTable({ projectId, rows, template, ourSite, monitored }: { projectId: string; rows: PipelineRow[]; template: Template; ourSite: string; monitored: string[] }) {
  const [status, setStatus] = useState<"" | OutreachStatus>("");
  const [compose, setCompose] = useState<PipelineRow | null>(null);
  const [edit, setEdit] = useState<PipelineRow | null>(null);
  const [addLink, setAddLink] = useState<PipelineRow | null>(null);
  const { move, pending, error } = useProspectMover(projectId);
  const counts = useMemo(() => {
    const c = Object.fromEntries(OUTREACH_STATUSES.map((s) => [s, 0])) as Record<OutreachStatus, number>;
    for (const r of rows) c[r.status]++;
    return c;
  }, [rows]);
  const filtered = status ? rows.filter((r) => r.status === status) : rows;
  const monitoredSet = new Set(monitored);
  const columns: Column<PipelineRow>[] = [
    {
      key: "domain",
      header: "Prospect",
      render: (r) => (
        <div className="min-w-[200px]">
          <DomainLink domain={r.domain} />
          <div className="mt-0.5 flex items-center gap-2">
            <Stars value={r.rating} reason={r.reason} size={12} />
            <AsBadge score={r.authorityScore} />
          </div>
        </div>
      ),
    },
    {
      key: "contact",
      header: "Contact",
      sortValue: (r) => r.contactEmail,
      render: (r) =>
        r.contactEmail || r.contactName ? (
          <div className="max-w-[220px] text-[12.5px]">
            <div className="truncate text-text">{r.contactName || "—"}</div>
            <div className="truncate text-text-3">{r.contactEmail || "No email"}</div>
          </div>
        ) : (
          <button type="button" onClick={() => setEdit(r)} className="text-[12.5px] text-link hover:underline">
            + Add contact
          </button>
        ),
    },
    { key: "status", header: "Status", sortValue: (r) => OUTREACH_STATUSES.indexOf(r.status), render: (r) => <StatusSelect projectId={projectId} row={r} onAcquired={(row) => !monitoredSet.has(row.domain) && setAddLink(row)} /> },
    {
      key: "notes",
      header: "Notes",
      sortable: false,
      render: (r) => (
        <button type="button" onClick={() => setEdit(r)} className="block max-w-[240px] truncate text-left text-[12.5px] text-text-2 hover:text-text" title={r.notes || "Add notes"}>
          {r.notes || <span className="text-text-3">Add notes…</span>}
        </button>
      ),
    },
    { key: "updatedAt", header: "Updated", align: "right", render: (r) => <span className="whitespace-nowrap text-text-2">{shortDate(r.updatedAt)}</span> },
    {
      key: "actions",
      header: "",
      sortable: false,
      render: (r) => (
        <span className="inline-flex items-center gap-1">
          <Button size="sm" onClick={() => setCompose(r)}>
            <Mail className="h-3.5 w-3.5" /> Email
          </Button>
          {r.status === "acquired" && !monitoredSet.has(r.domain) && (
            <Button size="sm" variant="ghost" onClick={() => setAddLink(r)} title="Monitor the acquired link">
              <Link2 className="h-3.5 w-3.5" /> Monitor
            </Button>
          )}
          <button type="button" onClick={() => setEdit(r)} className="inline-flex h-7 w-7 items-center justify-center rounded-md text-text-3 hover:bg-surface-3 hover:text-text" aria-label={`Edit ${r.domain}`}>
            <Pencil className="h-3.5 w-3.5" />
          </button>
          <button type="button" disabled={pending} onClick={() => move([r.domain], null)} className="inline-flex h-7 w-7 items-center justify-center rounded-md text-text-3 hover:bg-surface-3 hover:text-critical-ink" aria-label={`Remove ${r.domain} from the pipeline`} title="Back to prospects">
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </span>
      ),
    },
  ];
  const { onRowsChange, exportCsv } = useCsvExport<PipelineRow>(`${ourSite}-outreach`, ["Domain", "Rating", "Authority Score", "Status", "Contact name", "Contact email", "Notes", "Updated"], (r) => [r.domain, r.rating, r.authorityScore, OUTREACH_LABELS[r.status], r.contactName, r.contactEmail, r.notes, r.updatedAt]);
  return (
    <div>
      {error && (
        <Callout tone="critical" className="mx-4 mb-3">
          {error}
        </Callout>
      )}
      <div className="grid grid-cols-2 gap-2 px-4 pb-3 sm:grid-cols-3 lg:grid-cols-6">
        <button type="button" onClick={() => setStatus("")} className={cn("rounded-md border px-3 py-2 text-left", !status ? "border-brand bg-brand-soft/60" : "border-border hover:bg-surface-2")}>
          <div className="text-[12px] text-text-2">All</div>
          <div className="tabular text-[18px] font-semibold">{rows.length}</div>
        </button>
        {OUTREACH_STATUSES.map((s) => (
          <button key={s} type="button" onClick={() => setStatus(s)} className={cn("rounded-md border px-3 py-2 text-left", status === s ? "border-brand bg-brand-soft/60" : "border-border hover:bg-surface-2")}>
            <div className="text-[12px] text-text-2">{OUTREACH_LABELS[s]}</div>
            <div className={cn("tabular text-[18px] font-semibold", s === "acquired" && "text-good-ink", s === "rejected" && "text-critical-ink")}>{counts[s]}</div>
          </button>
        ))}
      </div>
      <DataTable
        rows={filtered}
        columns={columns}
        rowKey={(r) => r.domain}
        defaultSort={{ key: "updatedAt", dir: "desc" }}
        searchable
        searchPlaceholder="Filter by domain or contact"
        searchText={(r) => `${r.domain} ${r.contactName} ${r.contactEmail} ${r.notes}`}
        onRowsChange={onRowsChange}
        toolbar={
          <div className="flex flex-1 items-center">
            <ExportButton onClick={exportCsv} className="ml-auto" />
          </div>
        }
        emptyText={rows.length ? "No prospects with this status." : "Nothing in progress yet. Move prospects here from the Prospects tab."}
      />
      {compose && <ComposeDialog row={compose} template={template} ourSite={ourSite} onClose={() => setCompose(null)} />}
      {edit && <EditDialog projectId={projectId} row={edit} onClose={() => setEdit(null)} />}
      {addLink && <AddLinkDialog projectId={projectId} prospectDomain={addLink.domain} onClose={() => setAddLink(null)} />}
    </div>
  );
}
