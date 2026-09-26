"use client";

import { CheckCircle2, ChevronRight, Download, Search } from "lucide-react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import type { Category, Severity } from "@/lib/site-audit/types";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { buttonClass } from "@/components/ui/button";
import { Checkbox, Select } from "@/components/ui/input";
import { Segmented } from "@/components/ui/tabs";
import { CountDelta, countUnit, SEV_PLURAL, SeverityIcon, shortUrl } from "./ui";

export type IssueItem = {
  id: string;
  title: string;
  severity: Severity;
  category: Category;
  scope: "page" | "link" | "site";
  count: number;
  pages: number;
  prev: number | null;
  why: string;
  how: string;
  samples: { url: string; detail: string }[];
};

const ORDER: Severity[] = ["error", "warning", "notice"];

/** Grouped, filterable, expandable issue list with "Why and how to fix it" and per-issue CSV export. */
export function IssuesList({ items, totalPages, exportBase, initialSeverity, initialCategory }: { items: IssueItem[]; totalPages: number; exportBase: string; initialSeverity?: string; initialCategory?: string }) {
  const pathname = usePathname();
  const search = useSearchParams();
  const [sev, setSev] = useState<"all" | Severity>((["error", "warning", "notice"].includes(initialSeverity ?? "") ? initialSeverity : "all") as "all" | Severity);
  const [cat, setCat] = useState(initialCategory ?? "all");
  const [q, setQ] = useState("");
  const [showPassed, setShowPassed] = useState(false);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const failing = items.filter((i) => i.count > 0);
  const counts = { error: 0, warning: 0, notice: 0 } as Record<Severity, number>;
  for (const i of failing) counts[i.severity] += i.count;
  const categories = [...new Set(items.map((i) => i.category))];
  const visible = useMemo(
    () =>
      items.filter(
        (i) =>
          (showPassed || i.count > 0) &&
          (sev === "all" || i.severity === sev) &&
          (cat === "all" || i.category === cat) &&
          (!q.trim() || `${i.title} ${i.category} ${i.id}`.toLowerCase().includes(q.trim().toLowerCase())),
      ),
    [items, showPassed, sev, cat, q],
  );
  const detailHref = (id: string) => {
    const p = new URLSearchParams(search.toString());
    p.set("tab", "issues");
    p.set("issue", id);
    return `${pathname}?${p.toString()}`;
  };
  const toggle = (id: string) =>
    setOpen((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3">
        <Segmented
          options={[
            { value: "all", label: `All (${(counts.error + counts.warning + counts.notice).toLocaleString()})` },
            { value: "error", label: `Errors (${counts.error.toLocaleString()})` },
            { value: "warning", label: `Warnings (${counts.warning.toLocaleString()})` },
            { value: "notice", label: `Notices (${counts.notice.toLocaleString()})` },
          ]}
          value={sev}
          onChange={setSev}
          className="scroll-thin max-w-full overflow-x-auto [&>button]:shrink-0 [&>button]:whitespace-nowrap"
        />
        <Select aria-label="Category" value={cat} onChange={(e) => setCat(e.target.value)} className="h-8 w-auto text-[12.5px]">
          <option value="all">All categories</option>
          {categories.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </Select>
        <div className="relative w-56 max-w-full">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2 text-text-3" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Filter issues"
            className="h-8 w-full rounded-md border border-border-strong bg-surface pr-2 pl-8 text-[13px] placeholder:text-text-3 focus:border-brand focus:ring-2 focus:ring-brand/20 focus:outline-none"
          />
        </div>
        <label className="inline-flex items-center gap-1.5 text-[12.5px] text-text-2">
          <Checkbox checked={showPassed} onChange={(e) => setShowPassed(e.target.checked)} />
          Show passed checks ({items.length - failing.length})
        </label>
        <a href={`${exportBase}&type=issues`} className={buttonClass("secondary", "sm", "ml-auto")}>
          <Download className="h-3.5 w-3.5" /> Export all issues
        </a>
      </div>
      {ORDER.map((s) => {
        const group = visible.filter((i) => i.severity === s);
        if (!group.length) return null;
        const failingHere = group.filter((i) => i.count > 0);
        return (
          <section key={s}>
            <h3 className="flex items-center gap-2 bg-surface-2 px-4 py-2 text-[12.5px] font-semibold text-text-2">
              <SeverityIcon severity={s} className="h-3.5 w-3.5" />
              {SEV_PLURAL[s]}
              <span className="font-normal text-text-3">
                · {failingHere.length} issue{failingHere.length === 1 ? "" : "s"} · {failingHere.reduce((a, i) => a + i.count, 0).toLocaleString()} instances
              </span>
            </h3>
            <ul className="divide-y divide-border">
              {group.map((i) => {
                const isOpen = open.has(i.id);
                const share = totalPages ? Math.round((i.pages / totalPages) * 1000) / 10 : 0;
                if (i.count === 0)
                  return (
                    <li key={i.id} className="flex items-center gap-3 px-4 py-2 text-[13px] text-text-3">
                      <CheckCircle2 className="h-4 w-4 shrink-0 text-good-ink" />
                      <span className="min-w-0 flex-1 truncate">{i.title}</span>
                      <span className="hidden text-[12px] sm:inline">{i.category}</span>
                      {i.prev ? <span className="text-[12px] text-good-ink">Fixed ({i.prev} before)</span> : <span className="text-[12px]">Passed</span>}
                    </li>
                  );
                return (
                  <li key={i.id}>
                    <div className="flex items-center gap-2 px-2 py-2.5 hover:bg-surface-2 sm:gap-3 sm:px-4">
                      <button type="button" onClick={() => toggle(i.id)} className="rounded p-0.5 text-text-3 hover:bg-surface-3 hover:text-text" aria-expanded={isOpen} aria-label={isOpen ? "Collapse" : "Why and how to fix it"}>
                        <ChevronRight className={cn("h-4 w-4 transition-transform", isOpen && "rotate-90")} />
                      </button>
                      <SeverityIcon severity={i.severity} />
                      <div className="min-w-0 flex-1">
                        <Link href={detailHref(i.id)} className="text-[13px] text-text hover:text-link hover:underline">
                          {i.title}
                        </Link>
                        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[12px] text-text-3">
                          <span>{i.category}</span>
                          {i.scope === "link" && <span>· on {i.pages.toLocaleString()} page{i.pages === 1 ? "" : "s"}</span>}
                        </div>
                      </div>
                      <div className="hidden w-32 shrink-0 md:block">
                        {i.scope !== "site" && (
                          <>
                            <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-3">
                              <div className="h-full rounded-full" style={{ width: `${Math.min(100, share)}%`, background: i.severity === "error" ? "var(--critical)" : i.severity === "warning" ? "var(--warning)" : "var(--link)" }} />
                            </div>
                            <div className="tabular mt-0.5 text-right text-[11.5px] text-text-3">{share}% of pages</div>
                          </>
                        )}
                      </div>
                      <div className="w-14 shrink-0 text-right">{i.prev != null ? i.prev === 0 ? <Badge tone="critical">New</Badge> : <CountDelta delta={i.count - i.prev} /> : null}</div>
                      <Link href={detailHref(i.id)} className="tabular w-[76px] shrink-0 text-right text-[13px] font-semibold text-text hover:text-link">
                        {countUnit(i.scope, i.scope === "page" ? i.pages || i.count : i.count)}
                      </Link>
                      <a href={`${exportBase}&type=issue&check=${i.id}`} className="hidden rounded p-1 text-text-3 hover:bg-surface-3 hover:text-text sm:block" title="Export affected URLs (CSV)" aria-label="Export CSV">
                        <Download className="h-3.5 w-3.5" />
                      </a>
                    </div>
                    {isOpen && (
                      <div className="grid gap-4 border-t border-border bg-surface-2/60 px-4 py-3 pl-10 lg:grid-cols-2 sm:pl-14">
                        <div className="text-[12.5px] leading-relaxed">
                          <div className="mb-1 font-semibold text-text">Why and how to fix it</div>
                          <p className="text-text-2">{i.why}</p>
                          <p className="mt-2 text-text-2">
                            <span className="font-medium text-text">How to fix: </span>
                            {i.how}
                          </p>
                        </div>
                        <div className="min-w-0 text-[12.5px]">
                          <div className="mb-1 font-semibold text-text">Affected {i.scope === "site" ? "resource" : "URLs"}</div>
                          <ul className="space-y-1.5">
                            {i.samples.map((smp, k) => (
                              <li key={k} className="min-w-0">
                                <a href={smp.url} target="_blank" rel="noopener noreferrer" className="block truncate text-link hover:underline" title={smp.url}>
                                  {shortUrl(smp.url)}
                                </a>
                                {smp.detail && <div className="truncate text-text-3" title={smp.detail}>{smp.detail}</div>}
                              </li>
                            ))}
                          </ul>
                          <div className="mt-2 flex flex-wrap gap-3">
                            <Link href={detailHref(i.id)} className="font-medium text-link hover:underline">
                              View all {i.count.toLocaleString()} →
                            </Link>
                            <a href={`${exportBase}&type=issue&check=${i.id}`} className="text-link hover:underline">
                              Export CSV
                            </a>
                          </div>
                        </div>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
      {!visible.length && <p className="px-4 py-12 text-center text-[13px] text-text-3">{failing.length ? "No issues match these filters." : "No issues found — every check passed."}</p>}
    </div>
  );
}
