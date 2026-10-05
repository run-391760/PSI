import { featureById, featuresOf, MODULES, PRIORITY_WEIGHT, WORKFLOW_STEPS } from "./features";
import type { Draft, ModuleId, Report, ResearchBundle } from "./types";

/** Where a draft is in the 10-step workflow (PDF page 3) and per-module scores for the dashboard. Pure. */

export type StepState = { n: number; label: string; does: string; done: boolean; current: boolean; detail: string };

export function workflowState(draft: Pick<Draft, "meta" | "status" | "score" | "baselineScore">, report: Report, bundle: ResearchBundle | null, revisionKinds: string[] = []): StepState[] {
  const fixes = revisionKinds.filter((k) => k === "fix").length;
  const crit = report.counts.critical;
  const done: Record<number, [boolean, string]> = {
    1: [!!draft.meta.brief, draft.meta.brief ? "Created from a brief" : "Optional: Content Planning tab"],
    2: [report.words >= 300, `${report.words.toLocaleString()} words`],
    3: [true, bundle?.research ? `Checks + research (${bundle.research.serpSource === "serp" ? "live SERP" : bundle.research.serpSource === "urls" ? "competitor URLs" : "autocomplete"})` : "Checks run on the draft; SERP research not run yet"],
    4: [report.overall != null, report.overall != null ? `${report.overall.toFixed(1)}/10` : "n/a"],
    5: [true, `${crit} critical · ${report.counts.high} high · ${report.counts.medium} medium · ${report.counts.low} low`],
    6: [fixes > 0 || !!bundle?.ai, bundle?.ai ? "Claude review available" : "Open the fix-it recommendations"],
    7: [fixes > 0, fixes ? `${fixes} fix${fixes === 1 ? "" : "es"} applied` : "No fixes applied yet"],
    8: [fixes > 0 && draft.baselineScore != null, draft.baselineScore != null && draft.score != null ? `${draft.baselineScore.toFixed(1)} → ${draft.score.toFixed(1)}` : "After applying fixes"],
    9: [!report.blockers.length && crit === 0, report.blockers.length ? `${report.blockers.length} blocker(s)` : crit ? `${crit} critical issue(s)` : "No blockers"],
    10: [draft.status === "published", draft.status === "published" ? "Published" : report.blockers.length ? "Blocked" : "Ready when you are"],
  };
  let currentSet = false;
  return WORKFLOW_STEPS.map((s) => {
    const [d, detail] = done[s.n];
    const current = !d && !currentSet && s.n !== 1;
    if (current) currentSet = true;
    return { n: s.n, label: s.label, does: s.does, done: d, current, detail };
  });
}

export type ModuleScore = { id: ModuleId; label: string; score: number | null; issues: number; critical: number; checks: number; measured: number };

const w = (feature: string) => PRIORITY_WEIGHT[featureById(feature)?.priority ?? "medium"];

export function moduleScores(report: Report): ModuleScore[] {
  return MODULES.map((m) => {
    const ids = new Set(featuresOf(m.id).filter((f) => f.kind === "check").map((f) => f.id));
    const fs = report.findings.filter((f) => ids.has(f.feature));
    const measured = fs.filter((f) => f.score != null);
    return {
      id: m.id,
      label: m.label,
      // Priority-weighted like the category scores (critical 3, high 2, medium 1).
      score: measured.length ? Math.round((measured.reduce((a, f) => a + w(f.feature) * f.score!, 0) / measured.reduce((a, f) => a + w(f.feature), 0)) * 100) / 10 : null,
      issues: fs.filter((f) => f.severity).length,
      critical: fs.filter((f) => f.severity === "critical").length,
      checks: fs.length,
      measured: measured.length,
    };
  });
}
