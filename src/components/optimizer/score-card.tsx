import { Lightbulb, OctagonAlert, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { ScoreRing } from "@/components/ui/progress";
import { Tooltip } from "@/components/ui/tooltip";
import type { VerifiedScore } from "@/lib/optimizer/agents/types";
import { CATEGORIES, featureById } from "@/lib/optimizer/features";
import type { Report } from "@/lib/optimizer/types";
import { Bar10, color10, fmt10, PublishBadge } from "./ui";

/**
 * Headline score card (PDF page 4): overall /10, category scores with weights, issue counts, status, top
 * recommendation. With a current agent audit (`verified`, not stale) it shows the agent-verified values
 * and says so; otherwise the engine's deterministic score, labelled "Engine score".
 */
export function ScoreCard({ report: engine, draftId, baseline, compact, verified }: { report: Report; draftId: string; baseline: number | null; compact?: boolean; verified?: VerifiedScore | null }) {
  const agent = verified && !verified.stale ? verified : null;
  const report: Report = agent ? { ...engine, ...agent.final } : engine;
  // Before-vs-after compares engine scores (the baseline is an engine score).
  const delta = baseline != null && engine.overall != null ? Math.round((engine.overall - baseline) * 10) / 10 : null;
  const moduleOf = (feature: string) => featureById(feature)?.module;
  const href = (feature: string) => `/optimizer/${moduleOf(feature)}?doc=${draftId}#${feature}`;
  const partial = report.categories.filter((c) => c.score == null);
  return (
    <Card>
      <CardHeader
        title="Pre-publish SEO score"
        description="Weighted across the eight categories; blockers decide whether it can be published."
        info="Search Intent 20%, Content Quality 20%, Topical Coverage 15%, On-Page 15%, E-E-A-T 10%, SERP/AI 10%, Linking/UX/Conversion 5%, Technical/Schema 5%. A technically optimized article cannot score highly if it fails search intent or the reader."
        actions={
          agent ? (
            agent.confidence === "low" ? (
              <Tooltip content={`The agent audit only partly verified these values (confidence: low): agent stages failed or disagreed, so many checks keep their engine scores. Engine score: ${fmt10(agent.engineOverall)}. See the agent audit for details.`}>
                <Badge tone="warning">
                  <ShieldCheck className="h-3 w-3" /> Partly verified
                </Badge>
              </Tooltip>
            ) : (
              <Tooltip content={`Verified by the four-agent audit (confidence: ${agent.confidence === "none" ? "n/a" : agent.confidence}). Engine score: ${fmt10(agent.engineOverall)}.`}>
                <Badge tone="good">
                  <ShieldCheck className="h-3 w-3" /> Agent-verified
                </Badge>
              </Tooltip>
            )
          ) : (
            <Tooltip content={verified?.stale ? "The draft, its research or the engine's result changed since the last agent audit, so its values are not used. Run the agent audit again to verify this version." : "Deterministic engine score from the 58 checks. Run the agent audit to have it verified."}>
              <Badge>{verified?.stale ? "Engine score · audit out of date" : "Engine score"}</Badge>
            </Tooltip>
          )
        }
      />
      <CardBody className="space-y-4">
        <div className="flex flex-wrap items-center gap-4">
          <ScoreRing value={(report.overall ?? 0) * 10} label={fmt10(report.overall)} sub="out of 10" size={compact ? 92 : 108} color={color10(report.overall)} />
          <div className="min-w-0 flex-1 space-y-1.5">
            <PublishBadge status={report.status} />
            {agent && (
              <div className="text-[12px] text-text-3">
                Engine score <b className="text-text-2 tabular-nums">{fmt10(agent.engineOverall)}</b> · agent audit confidence {agent.confidence === "none" ? "n/a" : agent.confidence}
              </div>
            )}
            <div className="text-[12.5px] text-text-2">
              Publish readiness <b className="text-text tabular-nums">{report.readiness}%</b>
              {delta != null && delta !== 0 && (
                <span className={delta > 0 ? "ml-2 text-good-ink" : "ml-2 text-critical-ink"}>
                  {agent ? "engine " : ""}
                  {delta > 0 ? "+" : ""}
                  {delta} since the first audit ({baseline!.toFixed(1)})
                </span>
              )}
            </div>
            <div className="flex flex-wrap gap-1.5 text-[12px]">
              <span className="rounded bg-critical-soft px-1.5 text-critical-ink">{report.counts.critical} critical</span>
              <span className="rounded bg-serious-soft px-1.5 text-serious-ink">{report.counts.high} high</span>
              <span className="rounded bg-warning-soft px-1.5 text-warning-ink">{report.counts.medium} medium</span>
              <span className="rounded bg-surface-3 px-1.5 text-text-2">{report.counts.low} low</span>
              <span className="rounded bg-good-soft px-1.5 text-good-ink">{report.counts.passed} passed</span>
            </div>
          </div>
        </div>
        {report.cap && <div className="rounded-md bg-warning-soft px-3 py-2 text-[12.5px] text-warning-ink">{report.cap.reason} (weighted score {fmt10(report.weighted)})</div>}
        <ul className="space-y-2">
          {CATEGORIES.map((c) => {
            const s = report.categories.find((x) => x.id === c.id)!;
            return (
              <li key={c.id}>
                <div className="flex items-baseline justify-between gap-2 text-[12.5px]">
                  <span className="text-text">{c.short}</span>
                  <span className="text-text-3">
                    {Math.round(c.weight * 100)}% · {s.measured}/{s.checks} checks
                  </span>
                </div>
                <Bar10 value={s.score} />
              </li>
            );
          })}
        </ul>
        {partial.length > 0 && <p className="text-[12px] text-text-3">Not scored yet: {partial.map((p) => p.label).join(", ")} — run SERP research to measure them. The overall score uses the categories that could be measured.</p>}
        {report.blockers.length > 0 && (
          <div className="rounded-md border border-critical/30 bg-critical-soft px-3 py-2">
            <div className="mb-1 flex items-center gap-1.5 text-[12.5px] font-semibold text-critical-ink">
              <OctagonAlert className="h-4 w-4" /> {report.blockers.length} publication blocker{report.blockers.length === 1 ? "" : "s"}
            </div>
            <ul className="space-y-0.5 text-[12.5px] text-critical-ink">
              {report.blockers.map((b) => (
                <li key={b.feature}>
                  <Link href={href(b.feature)} className="hover:underline">
                    {b.message}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        )}
        {report.topRecommendation && (
          <Link href={href(report.topRecommendation.feature)} className="flex items-start gap-2 rounded-md bg-brand-soft px-3 py-2 text-[12.5px] text-brand-ink hover:underline">
            <Lightbulb className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              <b>Top recommendation ({featureById(report.topRecommendation.feature)?.name}):</b> {report.topRecommendation.text}
            </span>
          </Link>
        )}
      </CardBody>
    </Card>
  );
}
