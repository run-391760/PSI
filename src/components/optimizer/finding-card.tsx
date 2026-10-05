"use client";

import { ChevronDown, ExternalLink, OctagonAlert } from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import type { FeatureDef } from "@/lib/optimizer/features";
import type { Finding } from "@/lib/optimizer/types";
import { cn } from "@/lib/utils";
import { FixActions } from "./fix-actions";
import { PRIORITY_TONE, SeverityBadge, SourceTags, StatusPill } from "./ui";

const DOT: Record<string, string> = { good: "bg-good", warning: "bg-warning", critical: "bg-critical", neutral: "bg-text-3" };

/**
 * One feature from the PDF with its finding: status, score, summary, evidence, why it matters,
 * how to fix and the fix-it buttons (AI Recommendations + Fix-It + One-Click Apply & Re-score).
 */
export function FindingCard({ def, finding, draftId, aiOn, defaultOpen }: { def: FeatureDef; finding: Finding; draftId: string; aiOn: boolean; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen ?? (finding.status === "fail" || !!finding.blocker));
  const [all, setAll] = useState(false);
  const items = finding.items ?? [];
  const shown = all ? items : items.slice(0, 8);
  const pct = finding.score == null ? null : Math.round(finding.score * 100);
  return (
    <section id={def.id} className={cn("rounded-lg border bg-surface shadow-card", finding.blocker ? "border-critical/40" : "border-border")}>
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="flex w-full items-start gap-3 px-4 py-3 text-left">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <h3 className="text-[14px] font-semibold text-text">{def.name}</h3>
            <Badge tone={PRIORITY_TONE[def.priority]} className="capitalize" title="Feature priority (PDF)">
              {def.priority}
            </Badge>
            <StatusPill status={finding.status} />
            <SeverityBadge severity={finding.severity} />
          </div>
          <p className="mt-1 text-[13px] text-text-2">{finding.summary}</p>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          {pct != null && (
            <div className="hidden w-24 sm:block">
              <div className="h-1.5 overflow-hidden rounded-full bg-surface-3">
                <div className="h-full rounded-full" style={{ width: `${pct}%`, background: pct >= 80 ? "var(--good)" : pct >= 50 ? "var(--warning)" : "var(--critical)" }} />
              </div>
              <div className="mt-0.5 text-right text-[11.5px] text-text-3 tabular-nums">{pct}%</div>
            </div>
          )}
          <ChevronDown className={cn("h-4 w-4 text-text-3 transition-transform", open && "rotate-180")} />
        </div>
      </button>
      {open && (
        <div className="space-y-3 border-t border-border px-4 py-3">
          {finding.blocker && (
            <div className="flex items-start gap-2 rounded-md border border-critical/30 bg-critical-soft px-3 py-2 text-[13px] text-critical-ink">
              <OctagonAlert className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                <b>Publication blocker:</b> {finding.blocker}
              </span>
            </div>
          )}
          {finding.metrics && (
            <div className="flex flex-wrap gap-x-6 gap-y-2">
              {finding.metrics.map((m) => (
                <div key={m.label}>
                  <div className="text-[11.5px] text-text-3">{m.label}</div>
                  <div className="text-[14px] font-semibold text-text tabular-nums">{m.value}</div>
                </div>
              ))}
            </div>
          )}
          {shown.length > 0 && (
            <ul className="space-y-1">
              {shown.map((it, i) => (
                <li key={i} className="flex items-start gap-2 text-[13px]">
                  <span className={cn("mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full", DOT[it.tone ?? "neutral"])} aria-hidden />
                  <span className="min-w-0 break-words">
                    <span className="text-text">{it.label}</span>
                    {it.detail && <span className="text-text-3"> — {it.detail}</span>}
                    {it.href && /^https?:/.test(it.href) && (
                      <a href={it.href} target="_blank" rel="noreferrer noopener" className="ml-1 inline-flex align-middle text-link" aria-label="Open">
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    )}
                  </span>
                </li>
              ))}
              {items.length > 8 && (
                <li>
                  <button type="button" onClick={() => setAll((a) => !a)} className="text-[12.5px] text-link hover:underline">
                    {all ? "Show less" : `Show all ${items.length}`}
                  </button>
                </li>
              )}
            </ul>
          )}
          {(finding.how || def.why) && finding.status !== "pass" && (
            <div className="grid gap-2 rounded-md bg-surface-2 px-3 py-2 text-[13px] sm:grid-cols-2">
              {finding.how && (
                <div>
                  <div className="text-[11.5px] font-semibold tracking-wide text-text-3 uppercase">How to fix</div>
                  <div className="text-text">{finding.how}</div>
                </div>
              )}
              <div>
                <div className="text-[11.5px] font-semibold tracking-wide text-text-3 uppercase">Why it matters</div>
                <div className="text-text-2">{def.why}</div>
              </div>
            </div>
          )}
          {finding.fixes && <FixActions draftId={draftId} feature={def.id} fixes={finding.fixes} aiOn={aiOn} />}
          <div className="flex flex-wrap items-center gap-2 text-[11.5px] text-text-3">
            <span>Evidence from</span>
            <SourceTags sources={finding.sources} />
            <span className="ml-auto">{def.description}</span>
          </div>
        </div>
      )}
    </section>
  );
}
