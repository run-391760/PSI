"use client";

import { CheckCircle2, Circle, CircleDot, Download, History, OctagonAlert, RotateCcw } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { restoreRevisionAction, setChecklistAction } from "@/app/(app)/optimizer/actions";
import { Badge } from "@/components/ui/badge";
import { Button, ButtonLink } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/input";
import { dateTimeLabel } from "@/lib/format";
import { bySeverity } from "@/lib/optimizer/analyze";
import { featureById } from "@/lib/optimizer/features";
import type { StepState } from "@/lib/optimizer/progress";
import type { Revision } from "@/lib/optimizer/store";
import type { Draft, Report } from "@/lib/optimizer/types";
import { cn } from "@/lib/utils";
import { flashScore } from "../score-flash";
import { fmt10, SeverityBadge, tone10 } from "../ui";

const MANUAL = [
  { key: "proofread", label: "Proofread by an editor" },
  { key: "facts", label: "Facts, figures and dates verified against primary sources" },
  { key: "expert", label: "Reviewed by a subject-matter expert" },
  { key: "legal", label: "Brand / legal / compliance approval (claims, rankings, accreditation)" },
  { key: "images", label: "Images are original or licensed, compressed and captioned" },
  { key: "links", label: "Links tested on the staging page" },
];

export function WorkflowSteps({ steps }: { steps: StepState[] }) {
  return (
    <Card>
      <CardHeader title="Pre-publish workflow" description="Where this draft is in the 10-step process." />
      <CardBody>
        <ol className="space-y-1.5">
          {steps.map((s) => (
            <li key={s.n} className={cn("flex items-start gap-2 rounded-md px-2 py-1.5", s.current && "bg-brand-soft")}>
              {s.done ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-good-ink" /> : s.current ? <CircleDot className="mt-0.5 h-4 w-4 shrink-0 text-brand-ink" /> : <Circle className="mt-0.5 h-4 w-4 shrink-0 text-text-3" />}
              <div className="min-w-0">
                <div className="text-[13px] font-medium text-text">
                  {s.n}. {s.label}
                </div>
                <div className="text-[12px] text-text-3">
                  {s.does} · <span className="text-text-2">{s.detail}</span>
                </div>
              </div>
            </li>
          ))}
        </ol>
      </CardBody>
    </Card>
  );
}

/** Pre-Publish SEO Checklist: every open critical/high finding (auto) plus editorial sign-offs (manual). */
export function Checklist({ draft, report }: { draft: Draft; report: Report }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  // Optimistic: the box ticks immediately; the server copy catches up on refresh.
  const [local, setLocal] = useState<Record<string, boolean>>({});
  const checks = { ...(draft.meta.checklist ?? {}), ...local };
  const auto = report.findings.filter((f) => f.severity === "critical" || f.severity === "high" || f.blocker).sort(bySeverity);
  const passedCritical = report.findings.filter((f) => f.status === "pass" && featureById(f.feature)?.priority === "critical");
  const toggle = async (key: string, value: boolean) => {
    setLocal((l) => ({ ...l, [key]: value }));
    setBusy(key);
    const r = await setChecklistAction(draft.id, key, value);
    setBusy(null);
    if (!r.ok) {
      setLocal((l) => ({ ...l, [key]: !value }));
      flashScore({ title: "Not saved", detail: r.error, error: true });
    }
    router.refresh();
  };
  const manualDone = MANUAL.filter((m) => checks[m.key]).length;
  return (
    <Card>
      <CardHeader title="Pre-publish SEO checklist" description={`${auto.length} open item${auto.length === 1 ? "" : "s"} from the audit · ${manualDone}/${MANUAL.length} editorial sign-offs`} />
      <CardBody className="space-y-4">
        <div>
          <div className="mb-1.5 text-[11.5px] font-semibold tracking-wide text-text-3 uppercase">From the audit (ticks itself when fixed)</div>
          <ul className="space-y-1">
            {auto.map((f) => {
              const def = featureById(f.feature)!;
              return (
                <li key={f.feature} className="flex items-start gap-2 text-[13px]">
                  <Checkbox checked={false} disabled aria-label={`${def.name}: open`} className="mt-0.5" />
                  <Link href={`/optimizer/${def.module}?doc=${draft.id}#${def.id}`} className="min-w-0 hover:text-link">
                    <span className="text-text">{def.name}</span> <SeverityBadge severity={f.severity} />
                    <span className="block text-[12px] text-text-3">{f.blocker ?? f.how ?? f.summary}</span>
                  </Link>
                </li>
              );
            })}
            {passedCritical.map((f) => (
              <li key={f.feature} className="flex items-center gap-2 text-[13px] text-text-3">
                <Checkbox checked readOnly disabled aria-label={`${featureById(f.feature)?.name}: done`} />
                {featureById(f.feature)?.name}
              </li>
            ))}
          </ul>
        </div>
        <div>
          <div className="mb-1.5 text-[11.5px] font-semibold tracking-wide text-text-3 uppercase">Editorial sign-off</div>
          <ul className="space-y-1">
            {MANUAL.map((m) => (
              <li key={m.key}>
                <label className="flex items-center gap-2 text-[13px] text-text">
                  <Checkbox checked={!!checks[m.key]} disabled={busy === m.key} onChange={(e) => toggle(m.key, e.target.checked)} />
                  {m.label}
                </label>
              </li>
            ))}
          </ul>
        </div>
      </CardBody>
    </Card>
  );
}

export function Blockers({ report, draftId }: { report: Report; draftId: string }) {
  return (
    <Card>
      <CardHeader title="Critical SEO errors / publication blockers" description="These prevent “Ready to publish” regardless of the overall score." />
      <CardBody>
        {report.blockers.length ? (
          <ul className="space-y-2">
            {report.blockers.map((b) => {
              const def = featureById(b.feature)!;
              return (
                <li key={b.feature} className="flex items-start gap-2 rounded-md border border-critical/30 bg-critical-soft px-3 py-2 text-[13px] text-critical-ink">
                  <OctagonAlert className="mt-0.5 h-4 w-4 shrink-0" />
                  <Link href={`/optimizer/${def.module}?doc=${draftId}#${def.id}`} className="hover:underline">
                    <b>{def.name}:</b> {b.message}
                  </Link>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="flex items-center gap-2 text-[13px] text-good-ink">
            <CheckCircle2 className="h-4 w-4" /> No publication blockers.
          </p>
        )}
      </CardBody>
    </Card>
  );
}

/** SEO Change History: every revision with its score; restore any earlier version. */
export function HistoryTable({ draftId, revisions }: { draftId: string; revisions: Revision[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const rows = [...revisions].reverse();
  return (
    <Card>
      <CardHeader title="SEO change history" description={`${revisions.length} revisions with the score after each change.`} actions={<History className="h-4 w-4 text-text-3" />} />
      <CardBody className="scroll-thin overflow-x-auto">
        <table className="w-full min-w-[560px] text-[12.5px]">
          <thead className="text-left text-text-3">
            <tr className="border-b border-border">
              <th className="py-1.5 pr-2 font-medium">When</th>
              <th className="py-1.5 pr-2 font-medium">Change</th>
              <th className="py-1.5 pr-2 text-right font-medium">Score</th>
              <th className="py-1.5 pr-2 text-right font-medium">Δ</th>
              <th className="py-1.5 font-medium" />
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const prev = rows[i + 1]?.score;
              const d = r.score != null && prev != null ? Math.round((r.score - prev) * 10) / 10 : null;
              return (
                <tr key={r.id} className="border-b border-border last:border-0">
                  <td className="py-1.5 pr-2 whitespace-nowrap text-text-3">{dateTimeLabel(r.createdAt)}</td>
                  <td className="py-1.5 pr-2 text-text">
                    {r.note} <span className="text-text-3">· {r.kind}</span>
                  </td>
                  <td className="py-1.5 pr-2 text-right">
                    <Badge tone={tone10(r.score)}>{fmt10(r.score)}</Badge>
                  </td>
                  <td className={cn("py-1.5 pr-2 text-right tabular-nums", d == null || d === 0 ? "text-text-3" : d > 0 ? "text-good-ink" : "text-critical-ink")}>{d == null ? "" : d > 0 ? `+${d}` : d}</td>
                  <td className="py-1.5 text-right">
                    {i > 0 && (
                      <Button
                        size="sm"
                        variant="ghost"
                        loading={busy === r.id}
                        onClick={async () => {
                          if (!confirm("Restore this version? The current version stays in the history.")) return;
                          setBusy(r.id);
                          const res = await restoreRevisionAction(draftId, r.id);
                          setBusy(null);
                          if (res.ok) flashScore({ title: "Restored", before: res.data.before, after: res.data.after, status: res.data.status });
                          else flashScore({ title: "Not restored", detail: res.error, error: true });
                          router.refresh();
                        }}
                      >
                        {busy !== r.id && <RotateCcw className="h-3.5 w-3.5" />} Restore
                      </Button>
                    )}
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

export function ExportCard({ draftId }: { draftId: string }) {
  return (
    <Card>
      <CardHeader title="Publish package" description="HTML with title, meta description, canonical, robots, Open Graph and JSON-LD — or Markdown with front matter — ready for your CMS." />
      <CardBody className="flex flex-wrap gap-2">
        <ButtonLink href={`/api/optimizer/${draftId}/export?format=html`} prefetch={false}>
          <Download className="h-4 w-4" /> HTML
        </ButtonLink>
        <ButtonLink href={`/api/optimizer/${draftId}/export?format=md`} prefetch={false}>
          <Download className="h-4 w-4" /> Markdown
        </ButtonLink>
      </CardBody>
    </Card>
  );
}
