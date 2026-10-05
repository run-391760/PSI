"use client";

import Link from "next/link";
import { TrendChart } from "@/components/charts/trend-chart";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { type Column, DataTable } from "@/components/ui/data-table";
import { dateTimeLabel } from "@/lib/format";
import { CATEGORIES, featureById, moduleById } from "@/lib/optimizer/features";
import type { Revision } from "@/lib/optimizer/store";
import type { AiReview, CategoryId, Finding, Report } from "@/lib/optimizer/types";
import { fmt10, SeverityBadge, StatusPill, tone10 } from "../ui";

type Row = Finding & { name: string; module: string; moduleId: string; category: string; priority: string };

const SEV_ORDER: Record<string, number> = { critical: 4, high: 3, medium: 2, low: 1 };

/** Issue Severity Engine table: every check with status, severity, score and the recommendation (CSV export). */
export function IssuesTable({ report, draftId }: { report: Report; draftId: string }) {
  const rows: Row[] = report.findings.map((f) => {
    const def = featureById(f.feature)!;
    return { ...f, name: def.name, module: moduleById(def.module)?.label ?? def.module, moduleId: def.module, category: CATEGORIES.find((c) => c.id === def.category)?.short ?? "", priority: def.priority };
  });
  const columns: Column<Row>[] = [
    { key: "name", header: "Check", sortValue: (r) => r.name, render: (r) => <Link href={`/optimizer/${r.moduleId}?doc=${draftId}#${r.feature}`} className="text-link hover:underline">{r.name}</Link>, csv: (r) => r.name },
    { key: "module", header: "Module", sortValue: (r) => r.module, hideOnMobile: true },
    { key: "category", header: "Category", sortValue: (r) => r.category, hideOnMobile: true },
    { key: "severity", header: "Severity", sortValue: (r) => SEV_ORDER[r.severity ?? ""] ?? 0, render: (r) => <SeverityBadge severity={r.severity} />, csv: (r) => r.severity ?? "" },
    { key: "status", header: "Status", sortValue: (r) => r.status, render: (r) => <StatusPill status={r.status} />, csv: (r) => r.status },
    { key: "score", header: "Score", align: "right", sortValue: (r) => r.score ?? -1, render: (r) => (r.score == null ? "n/a" : `${Math.round(r.score * 100)}%`), csv: (r) => (r.score == null ? "" : Math.round(r.score * 100)) },
    { key: "summary", header: "Finding", sortable: false, render: (r) => <span className="text-text-2">{r.blocker ? <b className="text-critical-ink">Blocker: </b> : null}{r.summary}</span>, csv: (r) => `${r.blocker ? `BLOCKER: ${r.blocker} ` : ""}${r.summary}` },
    { key: "how", header: "Recommendation", exportOnly: true, csv: (r) => r.how ?? "" },
  ];
  return <DataTable rows={rows} columns={columns} rowKey={(r) => r.feature} defaultSort={{ key: "severity", dir: "desc" }} searchable searchPlaceholder="Filter checks" exportName="pre-publish-audit" pageSize={25} dense />;
}

/** AI Recommendations: what to fix, why it matters and how — from the audit and (when run) Claude. */
export function Recommendations({ report, ai, draftId }: { report: Report; ai: AiReview | null; draftId: string }) {
  const recs = report.findings.filter((f) => f.severity && (f.how || f.blocker)).sort((a, b) => (SEV_ORDER[b.severity!] ?? 0) - (SEV_ORDER[a.severity!] ?? 0)).slice(0, 10);
  return (
    <Card>
      <CardHeader title="AI recommendations" description="What to fix, why it matters and how to improve it — most impactful first." />
      <CardBody className="space-y-3">
        {ai && ai.recommendations.length > 0 && (
          <div>
            <div className="mb-1 text-[11.5px] font-semibold tracking-wide text-text-3 uppercase">From Claude's review</div>
            <ol className="space-y-2">
              {ai.recommendations.map((r, i) => (
                <li key={i} className="rounded-md bg-brand-soft px-3 py-2 text-[13px]">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <SeverityBadge severity={r.priority} />
                    <Link href={`/optimizer/${r.module}?doc=${draftId}`} className="font-medium text-text hover:text-link">
                      {r.title}
                    </Link>
                  </div>
                  <div className="mt-0.5 text-text-2">
                    <b className="text-text">Why:</b> {r.why}
                  </div>
                  <div className="text-text-2">
                    <b className="text-text">How:</b> {r.how}
                  </div>
                </li>
              ))}
            </ol>
          </div>
        )}
        <ol className="space-y-2">
          {recs.map((f) => {
            const def = featureById(f.feature)!;
            return (
              <li key={f.feature} className="rounded-md border border-border px-3 py-2 text-[13px]">
                <div className="flex flex-wrap items-center gap-1.5">
                  <SeverityBadge severity={f.severity} />
                  <Link href={`/optimizer/${def.module}?doc=${draftId}#${def.id}`} className="font-medium text-text hover:text-link">
                    {def.name}
                  </Link>
                </div>
                <div className="mt-0.5 text-text-2">
                  <b className="text-text">What:</b> {f.blocker ?? f.summary}
                </div>
                <div className="text-text-2">
                  <b className="text-text">Why:</b> {def.why}
                </div>
                {f.how && (
                  <div className="text-text-2">
                    <b className="text-text">How:</b> {f.how}
                  </div>
                )}
              </li>
            );
          })}
        </ol>
      </CardBody>
    </Card>
  );
}

/** Before vs After Score: the score over revisions and category change from the first audit. */
export function BeforeAfter({ revisions, report }: { revisions: Revision[]; report: Report }) {
  const scored = revisions.filter((r) => r.score != null);
  const first = scored[0];
  const data = scored.map((r, i) => ({ x: `${i + 1}. ${dateTimeLabel(r.createdAt)}`, score: r.score }));
  const firstCats = (first?.summary.categories ?? {}) as Partial<Record<CategoryId, number | null>>;
  return (
    <Card>
      <CardHeader title="Before vs after" description={first ? `First audit ${fmt10(first.score)} → now ${fmt10(report.overall)}` : "No history yet"} />
      <CardBody className="space-y-4">
        {data.length >= 2 ? <TrendChart data={data} xKey="x" xFormat="raw" yFormat="number" yDomain={[0, 10]} series={[{ key: "score", label: "Overall score" }]} height={200} /> : <p className="text-[13px] text-text-3">Apply a fix or edit the draft to see the score change over time.</p>}
        <table className="w-full text-[12.5px]">
          <thead className="text-left text-text-3">
            <tr className="border-b border-border">
              <th className="py-1.5 font-medium">Category</th>
              <th className="py-1.5 text-right font-medium">Before</th>
              <th className="py-1.5 text-right font-medium">After</th>
            </tr>
          </thead>
          <tbody>
            {CATEGORIES.map((c) => {
              const before = firstCats[c.id] ?? null;
              const after = report.categories.find((x) => x.id === c.id)?.score ?? null;
              return (
                <tr key={c.id} className="border-b border-border last:border-0">
                  <td className="py-1.5 text-text">
                    {c.short} <span className="text-text-3">({Math.round(c.weight * 100)}%)</span>
                  </td>
                  <td className="py-1.5 text-right">
                    <Badge tone={tone10(before)}>{fmt10(before)}</Badge>
                  </td>
                  <td className="py-1.5 text-right">
                    <Badge tone={tone10(after)}>{fmt10(after)}</Badge>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </CardBody>
    </Card>
  );
}
