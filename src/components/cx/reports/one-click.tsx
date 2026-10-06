"use client";

import { Download, FileSpreadsheet, Layers } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { exportNowAction } from "@/app/(app)/cx/reports/actions";
import { oneClickReportAction } from "@/app/(app)/cx/reports/one-click/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Callout } from "@/components/ui/feedback";
import { Field, Select } from "@/components/ui/input";
import { PERIODS, type Period } from "@/lib/cx/insights/export-defs";
import { ONE_CLICK_REPORTS, type OneClickChoice } from "@/lib/cx/reports/one-click-model";
import { cn } from "@/lib/utils";
import { downloadText } from "@/components/cx/insights/png-export";

type Msg = { tone: "good" | "critical"; text: string } | null;

function saveBase64(name: string, data: string, mime: string) {
  const url = URL.createObjectURL(new Blob([Uint8Array.from(atob(data), (c) => c.charCodeAt(0))], { type: mime }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/**
 * One-Click Report: pick Share of Voice, Sentiment Analysis, Ticketing (or all three) and download one XLSX
 * workbook for the filters in the URL, one sheet per widget. Plus the built-in Quick report ticket CSV.
 */
export function OneClickReport({
  brand,
  filters,
  summary,
  counts,
  downloadHref,
  hasData,
}: {
  brand: string;
  /** URL filters the workbook is built for (from, to, scope, media, basis, interval). */
  filters: Record<string, string>;
  summary: { period: string; scope: string; media: string; basis: string };
  counts: { conversations: number; tickets: number };
  downloadHref: string;
  hasData: boolean;
}) {
  const router = useRouter();
  const avail = (src: "conversations" | "tickets") => counts[src];
  const first = ONE_CLICK_REPORTS.find((r) => avail(r.source) > 0)?.id ?? "sov";
  const [choice, setChoice] = useState<OneClickChoice>(first);
  const [period, setPeriod] = useState<Period>("7");
  const [msg, setMsg] = useState<Msg>(null);
  const [quickMsg, setQuickMsg] = useState<Msg>(null);
  const [busy, setBusy] = useState<"xlsx" | "csv" | null>(null);
  /** Runs one download at a time; local state (not a transition) so a later router.refresh doesn't keep a spinner on. */
  const run = async (kind: "xlsx" | "csv", fn: () => Promise<void>) => {
    if (busy) return;
    setBusy(kind);
    try {
      await fn();
    } finally {
      setBusy(null);
    }
  };

  const options: { id: OneClickChoice; label: string; description: string; sheets: readonly string[]; count: number; unit: string }[] = [
    ...ONE_CLICK_REPORTS.map((r) => ({ id: r.id, label: r.label, description: r.description, sheets: r.sheets, count: avail(r.source), unit: r.source })),
    { id: "all", label: "All three reports", description: "Every widget of the three reports in one workbook, sheets prefixed by report.", sheets: ["SOV - …", "Sentiment - …", "Tickets - …"], count: counts.conversations + counts.tickets, unit: "records" },
  ];
  const selected = options.find((o) => o.id === choice)!;

  return (
    <div className="space-y-4">
      {hasData && (
        <Card>
          <CardHeader title="One-click report" description="Choose a report. The workbook uses the period, scope and media filters above, with one sheet per widget and a cover sheet listing the filters." />
          <CardBody className="space-y-4 pt-1">
            <div role="radiogroup" aria-label="Report" className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-4">
              {options.map((o) => {
                const on = o.id === choice;
                const none = o.count === 0;
                return (
                  <button
                    key={o.id}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    onClick={() => {
                      setChoice(o.id);
                      setMsg(null);
                    }}
                    className={cn("flex min-w-0 flex-col rounded-md border p-3 text-left transition-colors", on ? "border-brand bg-brand-soft" : "border-border bg-surface hover:bg-surface-2")}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <span className="flex min-w-0 items-center gap-1.5 text-[13.5px] font-semibold text-text">
                        {o.id === "all" ? <Layers className="h-4 w-4 shrink-0 text-text-3" /> : <FileSpreadsheet className="h-4 w-4 shrink-0 text-text-3" />}
                        <span className="truncate">{o.label}</span>
                      </span>
                      <span className={cn("mt-0.5 h-3.5 w-3.5 shrink-0 rounded-full border", on ? "border-brand bg-brand shadow-[inset_0_0_0_2px_var(--surface)]" : "border-border-strong")} aria-hidden />
                    </div>
                    <p className="mt-1 text-[12.5px] text-text-2">{o.description}</p>
                    <p className={cn("mt-2 text-[12px] tabular", none ? "text-warning-ink" : "text-text-3")}>
                      {none ? `No ${o.unit} in this period` : `${o.count.toLocaleString("en-US")} ${o.unit} in this period`}
                    </p>
                  </button>
                );
              })}
            </div>

            <div className="rounded-md border border-border bg-surface-2 p-3">
              <div className="mb-2 text-[12px] font-medium tracking-[0.06em] text-text-3 uppercase">Sheets in {selected.label}</div>
              <div className="flex flex-wrap gap-1">
                <Badge>Report (cover)</Badge>
                {selected.sheets.map((s) => (
                  <Badge key={s}>{s}</Badge>
                ))}
              </div>
            </div>

            <dl className="grid grid-cols-1 gap-x-6 gap-y-1 text-[13px] sm:grid-cols-2 xl:grid-cols-4">
              {[
                ["Period", summary.period],
                ["Scope", summary.scope],
                ["Media types", summary.media],
                ["Date basis", summary.basis],
              ].map(([k, v]) => (
                <div key={k} className="flex min-w-0 gap-2">
                  <dt className="shrink-0 text-text-3">{k}</dt>
                  <dd className="truncate font-medium text-text" title={v}>{v}</dd>
                </div>
              ))}
            </dl>

            {msg && <Callout tone={msg.tone}>{msg.text}</Callout>}
            <div className="flex flex-wrap items-center gap-3">
              <Button
                variant="primary"
                loading={busy === "xlsx"}
                disabled={selected.count === 0 || !!busy}
                onClick={() =>
                  run("xlsx", async () => {
                    setMsg(null);
                    const r = await oneClickReportAction(brand, choice, filters);
                    if (!r.ok) return void setMsg({ tone: "critical", text: r.error });
                    saveBase64(r.data.name, r.data.data, r.data.mime);
                    setMsg({ tone: "good", text: `Downloaded ${r.data.name} (${r.data.sheets.length} sheets).` });
                  })
                }
              >
                <Download className="h-4 w-4" /> Download XLSX
              </Button>
              {selected.count === 0 && <span className="text-[12.5px] text-text-3">Nothing to export for this report in the selected period and scope.</span>}
            </div>
          </CardBody>
        </Card>
      )}

      <Card>
        <CardHeader
          title="Quick report (CSV)"
          description="The built-in ticket dump: one row per ticket with status, channel, assignee and TAT columns. Uses fixed periods in UTC; the file is also kept in the Download centre's recent files."
        />
        <CardBody className="space-y-3 pt-1">
          {quickMsg && <Callout tone={quickMsg.tone}>{quickMsg.text}</Callout>}
          <div className="flex flex-wrap items-end gap-3">
            <Field label="Period" htmlFor="oc-quick-period" className="w-full sm:w-52">
              <Select id="oc-quick-period" value={period} onChange={(e) => setPeriod(e.target.value as Period)}>
                {PERIODS.map((p) => (
                  <option key={p.value} value={p.value}>{p.label}</option>
                ))}
              </Select>
            </Field>
            <Button
              loading={busy === "csv"}
              disabled={!!busy}
              onClick={() =>
                run("csv", async () => {
                  setQuickMsg(null);
                  const r = await exportNowAction(brand, "quick", period);
                  if (!r.ok) return void setQuickMsg({ tone: "critical", text: r.error });
                  downloadText(r.data.name, r.data.csv);
                  setQuickMsg({ tone: "good", text: `Exported ${r.data.rows.toLocaleString("en-US")} tickets.` });
                  router.refresh();
                })
              }
            >
              <Download className="h-4 w-4" /> Export CSV
            </Button>
            <Link href={downloadHref} className="pb-2 text-[13px] text-link hover:underline">
              Templates and schedules in the Download centre
            </Link>
          </div>
        </CardBody>
      </Card>
    </div>
  );
}
