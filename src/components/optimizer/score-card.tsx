import { Lightbulb, OctagonAlert } from "lucide-react";
import Link from "next/link";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { ScoreRing } from "@/components/ui/progress";
import { CATEGORIES, featureById } from "@/lib/optimizer/features";
import type { Report } from "@/lib/optimizer/types";
import { Bar10, color10, fmt10, PublishBadge } from "./ui";

/** Headline score card (PDF page 4): overall /10, category scores with weights, issue counts, status, top recommendation. */
export function ScoreCard({ report, draftId, baseline, compact }: { report: Report; draftId: string; baseline: number | null; compact?: boolean }) {
  const delta = baseline != null && report.overall != null ? Math.round((report.overall - baseline) * 10) / 10 : null;
  const moduleOf = (feature: string) => featureById(feature)?.module;
  const href = (feature: string) => `/optimizer/${moduleOf(feature)}?doc=${draftId}#${feature}`;
  const partial = report.categories.filter((c) => c.score == null);
  return (
    <Card>
      <CardHeader title="Pre-publish SEO score" description="Weighted across the eight categories; blockers decide whether it can be published." info="Search Intent 20%, Content Quality 20%, Topical Coverage 15%, On-Page 15%, E-E-A-T 10%, SERP/AI 10%, Linking/UX/Conversion 5%, Technical/Schema 5%. A technically optimized article cannot score highly if it fails search intent or the reader." />
      <CardBody className="space-y-4">
        <div className="flex flex-wrap items-center gap-4">
          <ScoreRing value={(report.overall ?? 0) * 10} label={fmt10(report.overall)} sub="out of 10" size={compact ? 92 : 108} color={color10(report.overall)} />
          <div className="min-w-0 flex-1 space-y-1.5">
            <PublishBadge status={report.status} />
            <div className="text-[12.5px] text-text-2">
              Publish readiness <b className="text-text tabular-nums">{report.readiness}%</b>
              {delta != null && delta !== 0 && (
                <span className={delta > 0 ? "ml-2 text-good-ink" : "ml-2 text-critical-ink"}>
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
