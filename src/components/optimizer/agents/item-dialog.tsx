"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Tabs } from "@/components/ui/tabs";
import { type CallRecord, type DecisionRow, itemDef, type ItemResult, type LedgerRow, type StageId, STAGES, type StageRecord } from "@/lib/optimizer/agents/types";
import { CONFIDENCE_TONE, confidenceText, deltaText, OUTCOME, pct, Quotes, score01, StageIcon, valueText } from "./parts";

/** Drill-down of one score-card output: the final value and what each of the four agents was given and returned. */
export function ItemDialog({ item, onClose }: { item: ItemResult | null; onClose: () => void }) {
  return (
    <Dialog
      open={!!item}
      onClose={onClose}
      size="xl"
      title={item ? `${item.label}: agent trail` : ""}
      description={item ? itemDef(item.id).description : undefined}
      footer={
        <Button type="button" variant="ghost" onClick={onClose}>
          Close
        </Button>
      }
    >
      {item && <Body item={item} />}
    </Dialog>
  );
}

function Body({ item }: { item: ItemResult }) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="Engine" value={valueText(item.kind, item.engine)} />
        <Stat label="Agent-verified" value={valueText(item.kind, item.final)} strong />
        <Stat label="Change" value={deltaText(item.kind, item.delta, item.changed)} />
        <Stat label="Agreement" value={pct(item.agreement)} badge={<Badge tone={CONFIDENCE_TONE[item.confidence]}>{confidenceText(item.confidence)}</Badge>} />
      </div>
      <div className="rounded-md bg-surface-2 px-3 py-2 text-[13px] text-text">
        {item.rationale}
        <div className="mt-1 text-[11.5px] text-text-3">{item.rationaleSource === "ai" ? "Rationale written by the finalizer agent from verified facts only." : "Rule-based rationale (computed from the verified results)."}</div>
      </div>
      {item.kind === "recommendation" && item.text && (
        <div className="rounded-md bg-brand-soft px-3 py-2 text-[13px] text-brand-ink">
          <b>Recommendation:</b> {item.text}
        </div>
      )}
      <Tabs
        variant="pill"
        tabs={STAGES.map((s) => ({
          id: s.id,
          label: (
            <span className="inline-flex items-center gap-1">
              <StageIcon status={item.stages[s.id].status} className="h-3.5 w-3.5" />
              {s.label}
            </span>
          ),
          content: <StagePanel item={item} stage={s.id} record={item.stages[s.id]} />,
        }))}
      />
    </div>
  );
}

function Stat({ label, value, strong, badge }: { label: string; value: string; strong?: boolean; badge?: React.ReactNode }) {
  return (
    <div className="min-w-0 rounded-md border border-border px-2.5 py-1.5">
      <div className="text-[11.5px] text-text-3">{label}</div>
      <div className={strong ? "truncate text-[15px] font-semibold text-text tabular-nums" : "truncate text-[14px] text-text tabular-nums"} title={value}>
        {value}
      </div>
      {badge && <div className="mt-0.5">{badge}</div>}
    </div>
  );
}

function CallLine({ c }: { c: CallRecord }) {
  return (
    <li className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[12px] text-text-2">
      <Badge tone={c.ok ? "neutral" : "critical"}>{c.role === "tie-break" ? "Tie-break" : c.ok ? "AI call" : "Failed call"}</Badge>
      <span className="text-text">{c.providerLabel}</span>
      {c.model && <span className="text-text-3">{c.model}</span>}
      <span className="tabular-nums">{(c.latencyMs / 1000).toFixed(1)}s</span>
      {c.attempts > 1 && <span>{c.attempts} attempts</span>}
      <span className="tabular-nums">{c.inputTokens != null || c.outputTokens != null ? `${c.inputTokens ?? "?"} in / ${c.outputTokens ?? "?"} out tokens` : "tokens not reported"}</span>
      {c.error && <span className="text-critical-ink">{c.error}</span>}
    </li>
  );
}

const DESCRIBE: Record<StageId, string> = {
  analyst: "Assesses each check against the draft and quotes the evidence verbatim.",
  reviewer: "Sees only the analyst's claims and quotes (not its reasoning) and accepts or rejects each one.",
  verifier: "Code checks every quote against the draft and keeps the engine score unless both agents agree with verified evidence (max ±0.25). An AI tie-break only settles how far when both move the same way.",
  finalizer: "Code re-applies the engine's weights, caps and blocker rules; an AI writes the rationale, rejected if it states anything not in the verified facts.",
};

function StagePanel({ item, stage, record }: { item: ItemResult; stage: StageId; record: StageRecord }) {
  return (
    <div className="space-y-3 pt-3">
      <p className="text-[12.5px] text-text-3">{DESCRIBE[stage]}</p>
      {record.calls.length > 0 ? <ul className="space-y-1">{record.calls.map((c, i) => <CallLine key={i} c={c} />)}</ul> : stage === "verifier" ? <p className="text-[12px] text-text-3">No AI call: deterministic verification only.</p> : null}
      {record.error && <div className="rounded-md bg-critical-soft px-3 py-2 text-[12.5px] text-critical-ink">{record.error}</div>}
      {record.notes.length > 0 && (
        <ul className="list-disc space-y-0.5 pl-5 text-[12.5px] text-text-2">
          {record.notes.map((n, i) => (
            <li key={i}>{n}</li>
          ))}
        </ul>
      )}
      {record.status === "pending" || record.status === "skipped" ? null : item.ledger ? (
        <LedgerView rows={item.ledger} stage={stage} />
      ) : item.decisions ? (
        <DecisionView rows={item.decisions} stage={stage} />
      ) : null}
      {stage === "finalizer" && typeof record.input.facts === "string" && record.input.facts && (
        <div>
          <div className="mb-1 text-[12px] font-medium text-text">Verified facts given to the finalizer</div>
          <pre className="max-h-48 overflow-auto rounded-md bg-surface-2 p-2.5 text-[11.5px] whitespace-pre-wrap text-text-2">{record.input.facts}</pre>
        </div>
      )}
      <details className="rounded-md border border-border">
        <summary className="cursor-pointer px-3 py-1.5 text-[12px] text-text-2">Raw stage input and output</summary>
        <pre className="max-h-72 overflow-auto border-t border-border p-2.5 text-[11px] whitespace-pre-wrap break-words text-text-2">{JSON.stringify({ input: record.input, output: record.output }, null, 2)}</pre>
      </details>
    </div>
  );
}

function LedgerView({ rows, stage }: { rows: LedgerRow[]; stage: StageId }) {
  const shown = stage === "analyst" || stage === "reviewer" ? rows.filter((r) => r.engine != null) : rows;
  return (
    <ul className="divide-y divide-border rounded-md border border-border">
      {shown.map((r) => (
        <li key={r.feature} className="px-3 py-2">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-[13px] font-medium text-text">{r.name}</span>
            <span className="text-[11.5px] text-text-3">{r.priority}</span>
            <span className="ml-auto flex flex-wrap items-center gap-1.5 text-[12px] tabular-nums">
              {stage === "analyst" && (
                <>
                  <span className="text-text-3">engine {score01(r.engine)}</span>
                  {r.analystVerdict ? <Badge tone={r.analystVerdict === "agree" ? "good" : "brand"}>{r.analystVerdict === "agree" ? "Agrees" : `Proposes ${score01(r.analyst)}`}</Badge> : <Badge>Not assessed</Badge>}
                </>
              )}
              {stage === "reviewer" && (r.reviewerDecision ? <Badge tone={r.reviewerDecision === "accept" ? "good" : "warning"}>{r.reviewerDecision === "accept" ? "Accepted" : "Rejected"} · own {score01(r.reviewer)}</Badge> : <Badge>No review</Badge>)}
              {(stage === "verifier" || stage === "finalizer") && (
                <>
                  <span className="text-text-3">
                    {score01(r.engine)} → <b className="text-text">{score01(r.final)}</b>
                  </span>
                  <Badge tone={OUTCOME[r.outcome].tone} title={OUTCOME[r.outcome].help}>
                    {OUTCOME[r.outcome].label}
                  </Badge>
                </>
              )}
            </span>
          </div>
          {stage === "analyst" && (
            <>
              {r.analystReason && <p className="mt-0.5 text-[12.5px] text-text-2">{r.analystReason}</p>}
              <Quotes quotes={r.analystQuotes} />
            </>
          )}
          {stage === "reviewer" && (
            <>
              {r.reviewerReason && <p className="mt-0.5 text-[12.5px] text-text-2">{r.reviewerReason}</p>}
              <Quotes quotes={r.reviewerQuotes} />
            </>
          )}
          {stage === "verifier" && (
            <>
              <p className="mt-0.5 text-[12px] text-text-3">
                {OUTCOME[r.outcome].help}
                {r.tieBreak != null && ` Tie-break: ${score01(r.tieBreak)}${r.tieBreakReason ? ` (${r.tieBreakReason})` : ""}.`}
              </p>
              <Quotes quotes={r.analystQuotes} />
            </>
          )}
        </li>
      ))}
    </ul>
  );
}

function DecisionView({ rows, stage }: { rows: DecisionRow[]; stage: StageId }) {
  if (!rows.length) return <p className="text-[12.5px] text-text-3">Nothing to classify.</p>;
  return (
    <ul className="divide-y divide-border rounded-md border border-border">
      {rows.map((r) => (
        <li key={r.feature} className="px-3 py-2">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-[13px] font-medium text-text">{r.name}</span>
            <span className="ml-auto flex flex-wrap gap-1.5">
              {stage === "analyst" && <Badge tone={r.analyst ? "brand" : "neutral"}>{r.analyst ?? "No claim"}</Badge>}
              {stage === "reviewer" && <Badge tone={r.reviewerDecision === "accept" ? "good" : r.reviewerDecision === "reject" ? "warning" : "neutral"}>{r.reviewerDecision === "accept" ? "Accepted" : r.reviewerDecision === "reject" ? "Rejected" : "No review"}</Badge>}
              {(stage === "verifier" || stage === "finalizer") && (
                <>
                  <Badge>Final: {r.final}</Badge>
                  <Badge tone={r.matches ? "good" : "warning"}>{r.matches ? "Agents agree" : r.consensus ? "Agents disagree with the rule" : "Not confirmed"}</Badge>
                </>
              )}
            </span>
          </div>
          {stage === "analyst" && (
            <>
              {r.analystReason && <p className="mt-0.5 text-[12.5px] text-text-2">{r.analystReason}</p>}
              <Quotes quotes={r.analystQuotes} />
            </>
          )}
          {stage === "reviewer" && r.reviewerReason && <p className="mt-0.5 text-[12.5px] text-text-2">{r.reviewerReason}</p>}
          {stage === "verifier" && <Quotes quotes={r.analystQuotes} />}
        </li>
      ))}
    </ul>
  );
}
