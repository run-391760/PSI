"use client";

import { Ban, Check, Copy, Download, Mail, Undo2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { updateRemoveAction } from "@/app/(app)/backlink-audit/actions";
import { REMOVE_STATUS_LABELS, type AuditDomainRow, type RemoveStatus } from "@/lib/backlinks/types";
import { dateLabel } from "@/lib/format";
import { cn } from "@/lib/utils";
import { DomainLink } from "@/components/seo/badges";
import { Button, buttonClass } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { type Column, DataTable } from "@/components/ui/data-table";
import { Callout } from "@/components/ui/feedback";
import { Input, Select, Textarea } from "@/components/ui/input";
import { Dialog } from "@/components/ui/dialog";
import { useListMover } from "./audit-table";
import { ExportButton, useCsvExport } from "./table-tools";
import { MarkerChips, ToxicityScore } from "./toxicity";

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export function removalEmail(row: { domain: string; sampleUrl: string }, site: { domain: string; name: string }) {
  return {
    subject: `Link removal request — ${row.domain}`,
    body: `Hi,

I'm reaching out on behalf of ${site.domain}. While reviewing our backlink profile we found links from ${row.domain} pointing to our website, for example on:
${row.sampleUrl}

We are cleaning up links we did not ask for, and we'd be grateful if you could remove them (or add rel="nofollow").

Thank you for your help,
${site.name}`,
  };
}

/* ------------------------------------------------------------------------------------------------
 * Remove list
 * ---------------------------------------------------------------------------------------------- */

function ContactCell({ projectId, row }: { projectId: string; row: AuditDomainRow }) {
  const router = useRouter();
  const [value, setValue] = useState(row.contact);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, start] = useTransition();
  const save = () => {
    if (value.trim() === row.contact) return;
    if (value.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())) {
      setError("Enter a valid email address.");
      return;
    }
    start(async () => {
      const res = await updateRemoveAction(projectId, row.domain, { contact: value.trim() });
      if (!res.ok) return setError(res.error);
      setError(null);
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
      router.refresh();
    });
  };
  return (
    <div className="min-w-[200px]">
      <div className="relative">
        <Input
          type="email"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onBlur={save}
          onKeyDown={(e) => e.key === "Enter" && (e.currentTarget as HTMLInputElement).blur()}
          placeholder={`webmaster@${row.domain}`}
          className={cn("h-7.5 pr-7 text-[12.5px]", error && "border-critical")}
          aria-label={`Contact email for ${row.domain}`}
          aria-invalid={!!error}
          disabled={pending}
        />
        {saved && <Check className="absolute top-1/2 right-2 h-3.5 w-3.5 -translate-y-1/2 text-good-ink" aria-label="Saved" />}
      </div>
      {error && <div className="mt-0.5 text-[11.5px] text-critical-ink">{error}</div>}
    </div>
  );
}

function StatusCell({ projectId, row }: { projectId: string; row: AuditDomainRow }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Select
      value={row.status}
      disabled={pending}
      onChange={(e) =>
        start(async () => {
          await updateRemoveAction(projectId, row.domain, { status: e.target.value as RemoveStatus });
          router.refresh();
        })
      }
      className={cn("h-7.5 w-36 text-[12.5px]", row.status === "removed" && "text-good-ink")}
      aria-label={`Outreach status for ${row.domain}`}
    >
      {(Object.keys(REMOVE_STATUS_LABELS) as RemoveStatus[]).map((s) => (
        <option key={s} value={s}>
          {REMOVE_STATUS_LABELS[s]}
        </option>
      ))}
    </Select>
  );
}

function EmailDialog({ row, site, onClose }: { row: AuditDomainRow; site: { domain: string; name: string }; onClose: () => void }) {
  const email = removalEmail(row, site);
  const [copied, setCopied] = useState<string | null>(null);
  const to = row.contact || `webmaster@${row.domain}`;
  return (
    <Dialog
      open
      onClose={onClose}
      title={`Removal request for ${row.domain}`}
      description="Copy the message into your email client. SynapseSEO never sends emails on your behalf."
      size="lg"
      footerStart={
        <Button
          onClick={async () => {
            if (await copyText(`To: ${to}\nSubject: ${email.subject}\n\n${email.body}`)) setCopied("all");
          }}
        >
          {copied === "all" ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />} {copied === "all" ? "Copied" : "Copy email"}
        </Button>
      }
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
          <a href={`mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(email.subject)}&body=${encodeURIComponent(email.body)}`} className={buttonClass("primary")}>
            <Mail className="h-4 w-4" /> Open in mail app
          </a>
        </>
      }
    >
      <div className="space-y-3 text-[13px]">
        <div className="grid grid-cols-[64px_1fr] items-center gap-2">
          <span className="text-text-3">To</span>
          <span className="truncate font-medium">{to}</span>
          <span className="text-text-3">Subject</span>
          <span className="font-medium">{email.subject}</span>
        </div>
        <Textarea readOnly value={email.body} rows={11} className="font-mono text-[12.5px]" aria-label="Email body" />
      </div>
    </Dialog>
  );
}

export function RemoveTable({ projectId, rows, site }: { projectId: string; rows: AuditDomainRow[]; site: { domain: string; name: string } }) {
  const { move, pending, error } = useListMover(projectId);
  const [emailFor, setEmailFor] = useState<AuditDomainRow | null>(null);
  const [status, setStatus] = useState<"" | RemoveStatus>("");
  const counts = useMemo(() => {
    const c = Object.fromEntries(Object.keys(REMOVE_STATUS_LABELS).map((k) => [k, 0])) as Record<RemoveStatus, number>;
    for (const r of rows) c[r.status]++;
    return c;
  }, [rows]);
  const filtered = status ? rows.filter((r) => r.status === status) : rows;
  const columns: Column<AuditDomainRow>[] = [
    {
      key: "domain",
      header: "Domain",
      render: (r) => (
        <div className="min-w-[180px]">
          <DomainLink domain={r.domain} />
          <div className="mt-1">
            <MarkerChips markers={r.markers} max={2} />
          </div>
        </div>
      ),
    },
    { key: "toxicity", header: "Toxicity", render: (r) => <ToxicityScore score={r.toxicity} /> },
    { key: "contact", header: "Contact email", sortable: false, render: (r) => <ContactCell key={r.contact} projectId={projectId} row={r} /> },
    { key: "status", header: "Status", sortValue: (r) => r.status, render: (r) => <StatusCell projectId={projectId} row={r} /> },
    { key: "listedAt", header: "Added", align: "right", render: (r) => <span className="whitespace-nowrap text-text-2">{r.listedAt ? dateLabel(r.listedAt) : "n/a"}</span> },
    {
      key: "actions",
      header: "",
      sortable: false,
      render: (r) => (
        <span className="inline-flex items-center gap-1">
          <Button size="sm" variant="secondary" onClick={() => setEmailFor(r)}>
            <Mail className="h-3.5 w-3.5" /> Email
          </Button>
          <Button size="sm" variant="ghost" disabled={pending} onClick={() => move([r.domain], "disavow")} title="Move to Disavow list">
            <Ban className="h-3.5 w-3.5" /> Disavow
          </Button>
          <Button size="sm" variant="ghost" disabled={pending} onClick={() => move([r.domain], null)} title="Restore to review list" aria-label={`Restore ${r.domain}`}>
            <Undo2 className="h-3.5 w-3.5" />
          </Button>
        </span>
      ),
    },
  ];
  const { onRowsChange, exportCsv } = useCsvExport<AuditDomainRow>(`${site.domain}-removal-list`, ["Domain", "Toxicity", "Contact", "Status", "Sample URL", "Markers", "Added"], (r) => [r.domain, r.toxicity, r.contact, REMOVE_STATUS_LABELS[r.status], r.sampleUrl, r.markers.join("; "), r.listedAt]);
  return (
    <div>
      {error && (
        <Callout tone="critical" className="mx-4 mb-3">
          {error}
        </Callout>
      )}
      <div className="flex flex-wrap gap-1.5 px-4 pb-3">
        <button type="button" onClick={() => setStatus("")} className={cn("rounded-full border px-2.5 py-1 text-[12px]", !status ? "border-brand bg-brand-soft text-brand-ink" : "border-border text-text-2 hover:bg-surface-3")}>
          All · {rows.length}
        </button>
        {(Object.keys(REMOVE_STATUS_LABELS) as RemoveStatus[]).map((s) => (
          <button key={s} type="button" onClick={() => setStatus(s)} className={cn("rounded-full border px-2.5 py-1 text-[12px]", status === s ? "border-brand bg-brand-soft text-brand-ink" : "border-border text-text-2 hover:bg-surface-3")}>
            {REMOVE_STATUS_LABELS[s]} · {counts[s]}
          </button>
        ))}
      </div>
      <DataTable
        rows={filtered}
        columns={columns}
        rowKey={(r) => r.domain}
        defaultSort={{ key: "toxicity", dir: "desc" }}
        onRowsChange={onRowsChange}
        toolbar={
          <div className="flex flex-1 items-center">
            <ExportButton onClick={exportCsv} className="ml-auto" />
          </div>
        }
        emptyText={rows.length ? "No domains with this status." : "Your removal list is empty. Move domains here from the Audit tab to track outreach to site owners."}
      />
      {emailFor && <EmailDialog row={emailFor} site={site} onClose={() => setEmailFor(null)} />}
    </div>
  );
}

/* ------------------------------------------------------------------------------------------------
 * Disavow list
 * ---------------------------------------------------------------------------------------------- */

export function DisavowPanel({ projectId, rows, fileText, domain }: { projectId: string; rows: AuditDomainRow[]; fileText: string; domain: string }) {
  const { move, pending, error } = useListMover(projectId);
  const [copied, setCopied] = useState(false);
  const columns: Column<AuditDomainRow>[] = [
    { key: "domain", header: "Domain", render: (r) => <DomainLink domain={r.domain} /> },
    { key: "toxicity", header: "Toxicity", render: (r) => <ToxicityScore score={r.toxicity} /> },
    { key: "markers", header: "Markers", sortValue: (r) => r.markers.length, render: (r) => <MarkerChips markers={r.markers} max={2} /> },
    { key: "listedAt", header: "Added", align: "right", render: (r) => <span className="whitespace-nowrap text-text-2">{r.listedAt ? dateLabel(r.listedAt) : "n/a"}</span> },
    {
      key: "actions",
      header: "",
      sortable: false,
      render: (r) => (
        <Button size="sm" variant="ghost" disabled={pending} onClick={() => move([r.domain], null)}>
          <Undo2 className="h-3.5 w-3.5" /> Restore
        </Button>
      ),
    },
  ];
  return (
    <div className="grid gap-4 xl:grid-cols-[1.4fr_1fr]">
      <Card>
        <CardHeader title="Disavowed domains" description={`${rows.length} domain${rows.length === 1 ? "" : "s"} in disavow.txt`} />
        {error && (
          <Callout tone="critical" className="mx-4 mb-3">
            {error}
          </Callout>
        )}
        <DataTable
          rows={rows}
          columns={columns}
          rowKey={(r) => r.domain}
          defaultSort={{ key: "toxicity", dir: "desc" }}
          selectable
          selectionActions={(selected, clear) => (
            <Button size="sm" disabled={pending} onClick={() => move(selected.map((r) => r.domain), null, clear)}>
              <Undo2 className="h-3.5 w-3.5" /> Restore
            </Button>
          )}
          emptyText="No domains in the disavow list yet. Select toxic domains in the Audit tab and choose Disavow."
        />
      </Card>
      <Card className="self-start">
        <CardHeader
          title="disavow.txt"
          description="Google Search Console format"
          actions={
            <>
              <Button
                size="sm"
                onClick={async () => {
                  if (await copyText(fileText)) {
                    setCopied(true);
                    setTimeout(() => setCopied(false), 1500);
                  }
                }}
              >
                {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />} Copy
              </Button>
              <a href={`/api/backlinks/disavow?project=${projectId}`} download={`disavow-${domain}.txt`} className={cn("inline-flex h-7 items-center gap-1.5 rounded-md bg-brand px-2.5 text-[12.5px] font-medium text-white hover:bg-brand-hover", !rows.length && "pointer-events-none opacity-50")} aria-disabled={!rows.length}>
                <Download className="h-3.5 w-3.5" /> Download
              </a>
            </>
          }
        />
        <CardBody>
          <Textarea readOnly value={fileText} rows={14} className="font-mono text-[12px] leading-snug" aria-label="disavow.txt preview" />
          <ol className="mt-3 list-decimal space-y-1 pl-5 text-[12.5px] text-text-2">
            <li>Download the file (UTF-8 plain text, one <code>domain:</code> line per site).</li>
            <li>
              Open{" "}
              <a href="https://search.google.com/search-console/disavow-links" target="_blank" rel="noopener noreferrer" className="text-link hover:underline">
                Google&apos;s Disavow links tool
              </a>{" "}
              and pick the property for {domain}.
            </li>
            <li>Upload the file; it replaces any previously uploaded list.</li>
          </ol>
        </CardBody>
      </Card>
    </div>
  );
}
