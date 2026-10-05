import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { FindingCard } from "@/components/optimizer/finding-card";
import { OptimizerEmpty, OptimizerHeader } from "@/components/optimizer/page-parts";
import { FixItList, SectionRewriter } from "@/components/optimizer/panels/ai";
import { BriefGenerator } from "@/components/optimizer/panels/planning";
import { BeforeAfter, IssuesTable, Recommendations } from "@/components/optimizer/panels/reporting";
import { SchemaPanel } from "@/components/optimizer/panels/schema";
import { AuthorForm, CtaForm, LinkCheckPanel, ResearchPanel, SerpPreview, SitePagesPanel, TechnicalForm } from "@/components/optimizer/panels/settings";
import { Blockers, Checklist, ExportCard, HistoryTable, WorkflowSteps } from "@/components/optimizer/panels/workflow";
import { ScoreCard } from "@/components/optimizer/score-card";
import { ScoreFlash } from "@/components/optimizer/score-flash";
import { Bar10 } from "@/components/optimizer/ui";
import { Grid, Page } from "@/components/shell/page";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody } from "@/components/ui/card";
import { featuresOf, moduleById } from "@/lib/optimizer/features";
import { moduleScores, workflowState } from "@/lib/optimizer/progress";
import { listBriefs } from "@/lib/optimizer/store";
import type { ModuleId } from "@/lib/optimizer/types";
import { loadOptimizer } from "../data";

export async function generateMetadata({ params }: PageProps<"/optimizer/[module]">): Promise<Metadata> {
  const m = moduleById((await params).module);
  return { title: m ? `${m.label} · Pre-Publish Optimizer` : "Pre-Publish Optimizer" };
}

export default async function OptimizerModulePage({ params, searchParams }: PageProps<"/optimizer/[module]">) {
  const { module } = await params;
  const mod = moduleById(module);
  if (!mod) notFound();
  const id = mod.id as ModuleId;
  const data = await loadOptimizer(await searchParams, { revisions: id === "workflow" || id === "reporting" });
  const basePath = `/optimizer/${id}`;
  const header = <OptimizerHeader data={data} title={mod.label} description={mod.description} basePath={basePath} />;

  if (id === "content-planning") {
    const briefs = await listBriefs(data.user.id);
    return (
      <Page>
        {header}
        <BriefGenerator briefs={briefs} aiOn={data.aiOn} serpOn={data.serpOn} defaultKeyword={data.draft?.keyword} />
        <ScoreFlash />
      </Page>
    );
  }

  const { draft, report, bundle } = data;
  if (!draft || !report || !bundle)
    return (
      <Page>
        {header}
        <OptimizerEmpty />
      </Page>
    );

  const checks = featuresOf(id).filter((f) => f.kind === "check");
  const score = moduleScores(report).find((m) => m.id === id)!;
  const findingOf = (fid: string) => report.findings.find((f) => f.feature === fid)!;

  const panels: Partial<Record<ModuleId, React.ReactNode>> = {
    "search-intent": <ResearchPanel draft={draft} research={bundle.research} serpOn={data.serpOn} />,
    "on-page": <SerpPreview draft={draft} />,
    eeat: <AuthorForm draft={draft} />,
    "links-ux": <LinkCheckPanel draftId={draft.id} links={bundle.links} />,
    "internal-linking": <SitePagesPanel draft={draft} />,
    conversion: <CtaForm draft={draft} />,
    schema: <SchemaPanel key={draft.updatedAt} draft={draft} />,
    technical: <TechnicalForm key={draft.updatedAt} draft={draft} live={bundle.live} />,
    ux: <TechnicalForm key={draft.updatedAt} draft={draft} live={bundle.live} />,
    workflow: (
      <div className="space-y-4">
        <Grid cols={2}>
          <WorkflowSteps steps={workflowState(draft, report, bundle, data.revisions.map((r) => r.kind))} />
          <div className="space-y-4">
            <Blockers report={report} draftId={draft.id} />
            <ExportCard draftId={draft.id} />
          </div>
        </Grid>
        <Checklist draft={draft} report={report} />
        <HistoryTable draftId={draft.id} revisions={data.revisions} />
      </div>
    ),
    reporting: (
      <div className="space-y-4">
        <Grid cols={2}>
          <ScoreCard report={report} draftId={draft.id} baseline={draft.baselineScore} />
          <BeforeAfter revisions={data.revisions} report={report} />
        </Grid>
        <Recommendations report={report} ai={data.aiStale ? null : bundle.ai} draftId={draft.id} />
        <Card>
          <CardBody className="pt-4">
            <IssuesTable report={report} draftId={draft.id} />
          </CardBody>
        </Card>
      </div>
    ),
    "ai-optimization": (
      <div className="space-y-4">
        <FixItList report={report} draftId={draft.id} aiOn={data.aiOn} />
        <SectionRewriter draft={draft} aiOn={data.aiOn} />
      </div>
    ),
  };

  return (
    <Page wide>
      {header}
      {checks.length > 0 && (
        <Card className="mb-4">
          <CardBody className="flex flex-wrap items-center gap-x-6 gap-y-2 pt-4">
            <div className="min-w-[200px] flex-1">
              <div className="text-[12px] text-text-3">{mod.label} score</div>
              <Bar10 value={score.score} className="max-w-sm" />
            </div>
            <div className="flex flex-wrap gap-1.5 text-[12px]">
              <Badge tone={score.critical ? "critical" : "neutral"}>{score.critical} critical</Badge>
              <Badge tone={score.issues ? "warning" : "good"}>{score.issues} issues</Badge>
              <Badge>
                {score.measured}/{score.checks} checks measured
              </Badge>
              <Badge tone="brand">Overall {report.overall?.toFixed(1) ?? "n/a"}/10</Badge>
            </div>
          </CardBody>
        </Card>
      )}
      {panels[id] && <div className="mb-4">{panels[id]}</div>}
      {checks.length > 0 && (
        <div className="space-y-3">
          {checks.map((def) => (
            <FindingCard key={def.id} def={def} finding={findingOf(def.id)} draftId={draft.id} aiOn={data.aiOn} />
          ))}
        </div>
      )}
      <ScoreFlash />
    </Page>
  );
}
