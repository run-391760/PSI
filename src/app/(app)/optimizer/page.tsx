import { CheckCircle2, Circle, CircleDot } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { DraftEditor } from "@/components/optimizer/editor";
import { OptimizerEmpty, OptimizerHeader } from "@/components/optimizer/page-parts";
import { ScoreFlash } from "@/components/optimizer/score-flash";
import { Bar10, fmt10, SeverityBadge, tone10 } from "@/components/optimizer/ui";
import { Grid, Page } from "@/components/shell/page";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { timeAgo } from "@/lib/format";
import { bySeverity } from "@/lib/optimizer/analyze";
import { featureById } from "@/lib/optimizer/features";
import { moduleScores, workflowState } from "@/lib/optimizer/progress";
import { cn } from "@/lib/utils";
import { loadOptimizer } from "./data";

export const metadata: Metadata = { title: "Pre-Publish Optimizer" };

export default async function OptimizerDashboard({ searchParams }: PageProps<"/optimizer">) {
  const data = await loadOptimizer(await searchParams, { revisions: true });
  const { draft, report, bundle } = data;
  if (!draft || !report || !bundle)
    return (
      <Page>
        <OptimizerHeader data={data} title="Dashboard" description="AI Pre-Publish SEO & Content Optimizer: audit → explain → recommend → apply → re-score → publish." basePath="/optimizer" />
        <OptimizerEmpty />
      </Page>
    );
  const steps = workflowState(draft, report, bundle, data.revisions.map((r) => r.kind));
  const modules = moduleScores(report);
  const issues = report.findings.filter((f) => f.severity).sort(bySeverity).slice(0, 12);
  const q = `?doc=${draft.id}`;
  return (
    <Page wide>
      <OptimizerHeader data={data} title="Dashboard" description="Write or paste the article, watch the score, then work through the module tabs above." basePath="/optimizer" />
      <DraftEditor key={draft.id} draft={draft} bundle={bundle} others={data.others} />

      <Card className="mt-4">
        <CardHeader title="Workflow" description="Brief → write → audit → score → prioritize → optimize → apply → re-score → pre-publish check → publish" />
        <CardBody>
          <ol className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
            {steps.map((s) => (
              <li key={s.n} className={cn("rounded-md border px-3 py-2", s.current ? "border-brand bg-brand-soft" : "border-border")}>
                <div className="flex items-center gap-1.5 text-[13px] font-medium text-text">
                  {s.done ? <CheckCircle2 className="h-4 w-4 text-good-ink" /> : s.current ? <CircleDot className="h-4 w-4 text-brand-ink" /> : <Circle className="h-4 w-4 text-text-3" />}
                  {s.n}. {s.label}
                </div>
                <div className="mt-0.5 text-[12px] text-text-3">{s.detail}</div>
              </li>
            ))}
          </ol>
        </CardBody>
      </Card>

      <h2 className="mt-6 mb-2 text-[15px] font-semibold text-text">Modules</h2>
      <Grid cols={4}>
        {modules.map((m) => (
          <Link key={m.id} href={`/optimizer/${m.id}${q}`} className="rounded-lg border border-border bg-surface p-3 shadow-card hover:border-brand">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[13.5px] font-semibold text-text">{m.label}</span>
              {m.checks ? <Badge tone={tone10(m.score)}>{fmt10(m.score)}</Badge> : <Badge tone="brand">Tools</Badge>}
            </div>
            {m.checks ? (
              <>
                <Bar10 value={m.score} className="mt-2" />
                <div className="mt-1 text-[12px] text-text-3">
                  {m.issues ? `${m.issues} issue${m.issues === 1 ? "" : "s"}${m.critical ? `, ${m.critical} critical` : ""}` : "No issues"} · {m.measured}/{m.checks} checks measured
                </div>
              </>
            ) : (
              <div className="mt-2 text-[12px] text-text-3">{m.id === "workflow" ? "Checklist, blockers, history, publish" : m.id === "reporting" ? "Scores, severity, before vs after" : m.id === "ai-optimization" ? "Fix-it list, apply & re-score" : "Content briefs before writing"}</div>
            )}
          </Link>
        ))}
      </Grid>

      <Grid cols={2} className="mt-4">
        <Card>
          <CardHeader title="Priority issues" description="Most severe first. Open one to see the fix." href={`/optimizer/reporting${q}`} />
          <CardBody>
            {issues.length ? (
              <ul className="divide-y divide-border">
                {issues.map((f) => {
                  const def = featureById(f.feature)!;
                  return (
                    <li key={f.feature} className="py-2">
                      <Link href={`/optimizer/${def.module}${q}#${def.id}`} className="group block">
                        <div className="flex items-center gap-2">
                          <SeverityBadge severity={f.severity} />
                          <span className="text-[13px] font-medium text-text group-hover:text-link">{def.name}</span>
                        </div>
                        <div className="mt-0.5 text-[12.5px] text-text-2">{f.blocker ?? f.summary}</div>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="text-[13px] text-text-2">No open issues.</p>
            )}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="All drafts" description={`${data.drafts.length} draft${data.drafts.length === 1 ? "" : "s"}`} />
          <CardBody>
            <ul className="divide-y divide-border">
              {data.drafts.slice(0, 12).map((d) => (
                <li key={d.id} className="flex items-center gap-2 py-2">
                  <Link href={`/optimizer?doc=${d.id}`} className={cn("min-w-0 flex-1", d.id === draft.id && "font-medium")}>
                    <span className="block truncate text-[13px] text-text hover:text-link">{d.title || "Untitled draft"}</span>
                    <span className="block truncate text-[11.5px] text-text-3">
                      {d.keyword || "no keyword"} · {d.status} · {timeAgo(d.updatedAt)}
                    </span>
                  </Link>
                  {d.baselineScore != null && d.score != null && d.baselineScore !== d.score && <span className="text-[11.5px] text-text-3 tabular-nums">{d.baselineScore.toFixed(1)} →</span>}
                  <Badge tone={tone10(d.score)}>{fmt10(d.score)}</Badge>
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      </Grid>
      <ScoreFlash />
    </Page>
  );
}
