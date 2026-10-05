"use client";

import { BarChart3, Download, EyeOff, FileImage, MoreHorizontal, Sparkles, Table2, X } from "lucide-react";
import { type ReactNode, useRef, useState, useTransition } from "react";
import { reportInsightAction } from "@/app/(app)/cx/reports/actions";
import { Hideable } from "@/components/shell/hideable";
import { useUiPrefs } from "@/components/shell/ui-prefs";
import { downloadNodePng, slug } from "@/components/cx/insights/png-export";
import { Menu, MenuItem } from "@/components/ui/dialog";
import { InfoTip } from "@/components/ui/tooltip";
import { downloadCsv } from "@/lib/csv";
import { setPanel } from "@/lib/cx/ui/prefs-logic";
import { cn } from "@/lib/utils";
import { useReport } from "./context";

export type TableData = { columns: string[]; rows: (string | number | null)[][] };
export type InsightData = { metric: string; range: string; rows: { key: string; value: number | null }[]; total: number | null; previous: number | null };

/**
 * Report widget card: title, optional controls, and the "…" menu (download PNG, download CSV, view as table,
 * AI insight when an AI key is set, hide widget). Wrapped in <Hideable> so hidden widgets are listed by
 * <ShowHidden scope="cx-reports.<page>"> and collapse/hide also works from the hover control.
 */
export function Widget({
  id,
  title,
  info,
  actions,
  table,
  insight,
  children,
  className,
  bodyClassName,
  bare,
}: {
  /** Stable "<scope>.<name>" id, e.g. "cx-reports.sov.buzz". */
  id: string;
  title: ReactNode;
  info?: string;
  actions?: ReactNode;
  table?: TableData;
  insight?: InsightData;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
  /** No card chrome (tile rows): the menu floats at the top right. */
  bare?: boolean;
}) {
  const label = typeof title === "string" ? title : id.split(".").pop() ?? "Widget";
  const ref = useRef<HTMLDivElement>(null);
  const { brand, ai } = useReport();
  const { prefs, update } = useUiPrefs();
  const [view, setView] = useState<"chart" | "table">("chart");
  const [text, setText] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const png = () => ref.current && downloadNodePng(ref.current, `${slug(label)}.png`).catch((e) => setErr(String(e?.message ?? e)));
  const csv = () => table && downloadCsv(slug(label), [table.columns, ...table.rows]);
  const ask = () =>
    insight &&
    start(async () => {
      setErr(null);
      const r = await reportInsightAction(brand, { title: label, ...insight });
      if (r.ok) setText(r.data.text);
      else setErr(r.error);
    });
  const hide = () => update({ panels: setPanel(prefs.panels, id, "hidden", label) });

  const menu = (
    <Menu
      align="right"
      trigger={(open) => (
        <button type="button" className="flex h-7 w-8 items-center justify-center rounded-md border border-border bg-surface text-text-2 hover:bg-surface-3 hover:text-text" aria-label={`${label} options`} aria-expanded={open} data-no-export>
          <MoreHorizontal className="h-4 w-4" />
        </button>
      )}
    >
      {(close) => (
        <>
          <MenuItem icon={<FileImage className="h-4 w-4 text-text-3" />} onClick={() => (close(), png())}>Download PNG</MenuItem>
          {table && <MenuItem icon={<Download className="h-4 w-4 text-text-3" />} onClick={() => (close(), csv())}>Download CSV</MenuItem>}
          {table && (
            <MenuItem icon={view === "table" ? <BarChart3 className="h-4 w-4 text-text-3" /> : <Table2 className="h-4 w-4 text-text-3" />} onClick={() => (close(), setView((v) => (v === "table" ? "chart" : "table")))}>
              {view === "table" ? "View as chart" : "View as table"}
            </MenuItem>
          )}
          {ai && insight && <MenuItem icon={<Sparkles className="h-4 w-4 text-text-3" />} onClick={() => (close(), ask())}>AI insight</MenuItem>}
          <MenuItem icon={<EyeOff className="h-4 w-4 text-text-3" />} onClick={() => (close(), hide())}>Hide widget</MenuItem>
        </>
      )}
    </Menu>
  );

  const extra = (
    <>
      {(text || pending || err) && (
        <div className="mx-4 mb-3 rounded-md border border-border bg-surface-2 px-3 py-2 text-[12.5px] text-text-2" data-no-export>
          <div className="mb-1 flex items-center gap-1.5 font-medium text-text">
            <Sparkles className="h-3.5 w-3.5" /> {err ? "Couldn't do that" : "AI insight"}
            <button type="button" className="ml-auto rounded p-0.5 text-text-3 hover:text-text" onClick={() => (setText(null), setErr(null))} aria-label="Dismiss">
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          {pending ? "Reading the chart…" : err ?? text}
        </div>
      )}
    </>
  );
  const tableView = table && view === "table" && (
    <div className="max-h-[420px] overflow-auto">
      <table className="w-full text-[12.5px]">
        <thead className="sticky top-0 bg-surface">
          <tr className="border-b border-border text-left text-[11px] font-semibold tracking-wide text-text-3 uppercase">
            {table.columns.map((c, i) => <th key={i} className={cn("px-2 py-1.5 font-semibold", i > 0 && "text-right")}>{c}</th>)}
          </tr>
        </thead>
        <tbody>
          {table.rows.map((r, i) => (
            <tr key={i} className="border-b border-border last:border-0">
              {r.map((v, j) => <td key={j} className={cn("px-2 py-1.5 text-text-2", j > 0 && "text-right tabular", j === 0 && "text-text")}>{v == null ? "n/a" : typeof v === "number" ? v.toLocaleString("en-US") : v}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  if (bare)
    return (
      <Hideable id={id} label={label} className={cn("min-w-0", className)}>
        <div ref={ref} className="relative pt-4">
          <div className="mb-1.5 flex items-center justify-between gap-2">
            <h2 className="text-[14px] font-semibold text-text">{title}</h2>
            <div className="flex items-center gap-2">{actions}{menu}</div>
          </div>
          {extra}
          {tableView ? <div className="rounded-lg border border-border bg-surface p-3 shadow-card">{tableView}</div> : children}
        </div>
      </Hideable>
    );

  return (
    <Hideable id={id} label={label} className={cn("min-w-0", className)}>
      <section ref={ref} className="flex h-full min-w-0 flex-col rounded-lg border border-border bg-surface shadow-card">
        <header className="flex flex-wrap items-center gap-2 px-4 pt-3.5 pb-2">
          <h2 className="flex min-w-[10rem] flex-1 items-center gap-1.5 text-[15px] font-semibold text-text">
            <span className="truncate">{title}</span>
            {info && <InfoTip text={info} />}
          </h2>
          <div className="flex shrink-0 flex-wrap items-center gap-2" data-no-export>
            {actions}
            {menu}
          </div>
        </header>
        {extra}
        <div className={cn("min-w-0 flex-1 px-4 pb-4", bodyClassName)}>{tableView || children}</div>
      </section>
    </Hideable>
  );
}
