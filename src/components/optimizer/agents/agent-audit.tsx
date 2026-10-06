"use client";

import { Bot, ChevronRight, Play, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { cancelAgentAuditAction, startAgentAuditAction } from "@/app/(app)/optimizer/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { useConfirm } from "@/components/ui/confirm";
import { Callout } from "@/components/ui/feedback";
import { Bar } from "@/components/ui/progress";
import { dateTimeLabel, duration, timeAgo } from "@/lib/format";
import { type AgentPlan, type AgentRunView, ITEMS, type ItemResult, type RunProgress, type RunStatus, STAGES } from "@/lib/optimizer/agents/types";
import { cn } from "@/lib/utils";
import { fmt10 } from "../ui";
import { ItemDialog } from "./item-dialog";
import { CONFIDENCE_TONE, confidenceText, deltaText, pct, StageIcon, valueText } from "./parts";

type Props = { draftId: string; latest: AgentRunView | null; lastDone: AgentRunView | null; stale: boolean; plan: AgentPlan };
type Live = { id: string; status: RunStatus; progress: RunProgress; error: string | null };

const ACTIVE: RunStatus[] = ["queued", "running"];

/**
 * "Agent-verified score" card: starts the four-agent audit (Analyst → Reviewer → Verifier → Finalizer
 * for each of the 13 score-card outputs), shows its live item × stage grid, then the verified values
 * next to the engine's with a drill-down per output.
 */
export function AgentAudit({ draftId, latest, lastDone, stale, plan }: Props) {
  const router = useRouter();
  const { confirm, confirmDialog } = useConfirm();
  const [live, setLive] = useState<Live | null>(latest && ACTIVE.includes(latest.status) ? { id: latest.id, status: latest.status, progress: latest.progress, error: null } : null);
  const [starting, setStarting] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<ItemResult | null>(null);
  const finished = useRef<string | null>(null);
  const liveId = live?.id ?? null;

  // A run started elsewhere (another tab) shows up after a refresh.
  const [seen, setSeen] = useState(latest?.id);
  if (latest?.id !== seen) {
    setSeen(latest?.id);
    if (latest && ACTIVE.includes(latest.status)) setLive({ id: latest.id, status: latest.status, progress: latest.progress, error: null });
  }

  useEffect(() => {
    if (!liveId) return;
    let alive = true;
    const tick = async () => {
      try {
        const res = await fetch(`/api/optimizer/agents/${liveId}`, { cache: "no-store" });
        if (!res.ok) return;
        const next = (await res.json()) as Live;
        if (!alive) return;
        setLive(next);
        if (!ACTIVE.includes(next.status) && finished.current !== liveId) {
          finished.current = liveId;
          router.refresh();
        }
      } catch {
        /* transient network error: try again on the next tick */
      }
    };
    const t = setInterval(tick, 1500);
    tick();
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [liveId, router]);

  const running = !!live && ACTIVE.includes(live.status);

  const start = async () => {
    setError(null);
    const ok = await confirm({
      title: "Run the agent audit?",
      description: (
        <>
          Four agents check each of the 13 score-card outputs: about <b>{plan.minCalls}–{plan.maxCalls} AI calls</b> (tie-breaks only when the analyst and reviewer disagree on how far a score should move), at most 4 at a time, on {plan.providers.join(", ")}. {plan.independentReviewer ? "The reviewer runs on a different provider than the analyst." : "Only one AI provider is configured, so the reviewer uses the same provider with an independent prompt."} It runs in the background and usually takes a few minutes; usage is billed to your AI keys.
        </>
      ),
      confirmLabel: "Run agent audit",
      tone: "primary",
    });
    if (!ok) return;
    setStarting(true);
    const res = await startAgentAuditAction(draftId);
    setStarting(false);
    if (!res.ok) return setError(res.error);
    finished.current = null;
    setLive({ id: res.data.runId, status: "queued", progress: { grid: Object.fromEntries(ITEMS.map((i) => [i.id, { analyst: "pending", reviewer: "pending", verifier: "pending", finalizer: "pending" }])) as RunProgress["grid"], done: 0, total: ITEMS.length * 4, message: "Waiting for a worker" }, error: null });
  };

  const cancel = async () => {
    if (!live) return;
    setCancelling(true);
    const res = await cancelAgentAuditAction(live.id);
    setCancelling(false);
    if (!res.ok) return setError(res.error);
    setLive(null);
    router.refresh();
  };

  const lastEnded = latest && !ACTIVE.includes(latest.status) && latest.status !== "done" && latest.id !== lastDone?.id ? latest : null;
  const summary = lastDone?.summary ?? null;

  return (
    <Card>
      <CardHeader
        title={
          <span className="inline-flex items-center gap-1.5">
            <ShieldCheck className="h-4 w-4 text-brand-ink" /> Agent-verified score
          </span>
        }
        description="Analyst → Reviewer → Verifier → Finalizer for each of the 13 score-card outputs. The engine's measurements stay the ground truth: a check moves (max ±0.25) only when two agents agree and their quotes are found in the draft."
        info="Numbers never come from an AI alone. The verifier checks every quoted passage against the draft (claims with invented quotes are dropped) and the finalizer re-applies the engine's own weights, caps and blocker rules. Each output gets a confidence from how far the agents agreed."
        actions={
          running ? (
            <Button size="sm" variant="ghost" onClick={cancel} loading={cancelling}>
              Cancel
            </Button>
          ) : (
            <Button size="sm" variant={lastDone ? "secondary" : "primary"} onClick={start} loading={starting} disabled={!plan.configured}>
              <Play className="h-3.5 w-3.5" /> {lastDone ? "Run again" : "Run agent audit"}
            </Button>
          )
        }
      />
      <CardBody className="space-y-4">
        {error && <Callout tone="critical">{error}</Callout>}
        {!plan.configured && (
          <Callout tone="warning" title="Add an AI key to run the agent audit">
            The agents need an AI provider (Anthropic, OpenAI, Gemini or Sarvam). Add a key in{" "}
            <Link href="/settings?tab=integrations" className="text-link hover:underline">
              Settings → Integrations
            </Link>
            . Until then the score shown everywhere is the engine's deterministic score; no agent output is produced or simulated.
          </Callout>
        )}
        {running && live && <Progress live={live} />}
        {lastEnded && !running && (
          <Callout tone={lastEnded.status === "failed" ? "critical" : "info"} title={lastEnded.status === "failed" ? "The last agent audit failed" : "The last agent audit was cancelled"}>
            {lastEnded.error ?? `Stopped ${timeAgo(lastEnded.finishedAt ?? lastEnded.createdAt)}.`}
            {lastDone ? " The results below are from the previous completed run." : ""}
          </Callout>
        )}
        {lastDone && summary ? (
          <div className={cn("space-y-3", running && "opacity-60")}>
            {running && <div className="text-[12px] text-text-3">Previous run ({dateTimeLabel(lastDone.finishedAt ?? lastDone.createdAt)}):</div>}
            {stale && (
              <Callout tone="warning" title="Out of date">
                The draft or its research changed after this audit ({timeAgo(lastDone.finishedAt ?? lastDone.createdAt)}), so these agent-verified values describe an earlier version and the score card shows the engine score. Run the audit again to verify the current draft.
              </Callout>
            )}
            <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
              <Tile label="Verified overall" value={`${fmt10(summary.final.overall)}/10`} sub={`Engine ${fmt10(summary.engine.overall)}`} />
              <Tile label="Agreement" value={pct(summary.agreement)} sub={<Badge tone={CONFIDENCE_TONE[summary.confidence]}>{confidenceText(summary.confidence)}</Badge>} />
              <Tile label="Checks adjusted" value={String(summary.adjustedChecks)} sub={`${summary.droppedClaims} claim${summary.droppedClaims === 1 ? "" : "s"} dropped (invented quotes)`} />
              <Tile label="AI calls" value={String(summary.calls)} sub={`${summary.failedCalls ? `${summary.failedCalls} failed · ` : ""}${duration(Math.round(summary.durationMs / 1000))}${summary.inputTokens != null ? ` · ${(summary.inputTokens + (summary.outputTokens ?? 0)).toLocaleString()} tokens` : ""}`} />
            </div>
            <Results items={lastDone.items} onOpen={setOpen} />
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-text-3">
              <span className="inline-flex items-center gap-1">
                <Bot className="h-3.5 w-3.5" /> {summary.providers.join(", ") || "n/a"}
              </span>
              <span>{summary.independentReviewer ? "Reviewer on a different provider" : "Reviewer on the same provider (independent prompt)"}</span>
              <span>Finished {dateTimeLabel(lastDone.finishedAt ?? lastDone.createdAt)}</span>
            </div>
            {summary.warnings.length > 0 && (
              <ul className="list-disc space-y-0.5 pl-5 text-[12px] text-text-2">
                {summary.warnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            )}
          </div>
        ) : (
          !running &&
          plan.configured && <p className="text-[13px] text-text-2">No agent audit yet. The scores on this page come from the deterministic engine; run the audit to have four agents verify each of them against the draft.</p>
        )}
      </CardBody>
      <ItemDialog item={open} onClose={() => setOpen(null)} />
      {confirmDialog}
    </Card>
  );
}

function Tile({ label, value, sub }: { label: string; value: string; sub?: React.ReactNode }) {
  return (
    <div className="min-w-0 rounded-md border border-border px-3 py-2">
      <div className="text-[11.5px] text-text-3">{label}</div>
      <div className="text-[18px] leading-tight font-semibold text-text tabular-nums">{value}</div>
      {sub && <div className="mt-0.5 truncate text-[11.5px] text-text-3">{sub}</div>}
    </div>
  );
}

const GRID = "grid grid-cols-[minmax(0,1fr)_repeat(4,2.25rem)] items-center gap-x-1 sm:grid-cols-[minmax(0,1fr)_repeat(4,5rem)]";

/** Live 13 × 4 grid while the job runs. */
function Progress({ live }: { live: Live }) {
  const p = live.progress;
  const share = p.total ? Math.round((p.done / p.total) * 100) : 0;
  return (
    <div className="space-y-3" role="status" aria-live="polite">
      <div>
        <div className="flex flex-wrap items-baseline justify-between gap-2 text-[13px]">
          <span className="font-medium text-text">{live.status === "queued" ? "Waiting for a worker…" : "Agents at work"}</span>
          <span className="text-text-3 tabular-nums">
            {p.done} of {p.total} stages · {share}%
          </span>
        </div>
        <Bar value={live.status === "queued" ? 2 : Math.max(3, share)} className="mt-1.5 h-2" color="var(--brand)" />
        <div className="mt-1 truncate text-[12px] text-text-3">{p.message}</div>
      </div>
      <div className="rounded-md border border-border">
        <div className={cn(GRID, "border-b border-border px-3 py-1.5 text-[11px] text-text-3")}>
          <span>Output</span>
          {STAGES.map((s) => (
            <span key={s.id} className="truncate text-center" title={s.does}>
              <span className="hidden sm:inline">{s.label}</span>
              <span className="sm:hidden">{s.label.slice(0, 3)}</span>
            </span>
          ))}
        </div>
        <ul className="divide-y divide-border">
          {ITEMS.map((it) => (
            <li key={it.id} className={cn(GRID, "px-3 py-1.5")}>
              <span className="truncate text-[12.5px] text-text">{it.label}</span>
              {STAGES.map((s) => (
                <span key={s.id} className="flex justify-center">
                  <StageIcon status={p.grid[it.id]?.[s.id] ?? "pending"} />
                </span>
              ))}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

/** Finalized values next to the engine values; each row opens the agent trail. */
function Results({ items, onOpen }: { items: ItemResult[]; onOpen: (i: ItemResult) => void }) {
  return (
    <div className="rounded-md border border-border">
      <div className="hidden grid-cols-[minmax(0,1.4fr)_5.5rem_5.5rem_4rem_6.5rem_4.5rem_6rem_1rem] gap-x-2 border-b border-border px-3 py-1.5 text-[11px] text-text-3 md:grid">
        <span>Output</span>
        <span className="text-right">Engine</span>
        <span className="text-right">Verified</span>
        <span className="text-right">Δ</span>
        <span>Confidence</span>
        <span className="text-right">Agreement</span>
        <span>Stages</span>
        <span />
      </div>
      <ul className="divide-y divide-border">
        {items.map((it) => {
          const textual = it.kind === "status" || it.kind === "recommendation";
          return (
            <li key={it.id}>
              <button type="button" onClick={() => onOpen(it)} className="group grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2 gap-y-1 px-3 py-2 text-left hover:bg-surface-2 md:grid-cols-[minmax(0,1.4fr)_5.5rem_5.5rem_4rem_6.5rem_4.5rem_6rem_1rem]">
                <span className="min-w-0 text-[13px] font-medium text-text group-hover:text-link">
                  {it.label}
                  {textual && it.final != null && <span className="block truncate text-[12px] font-normal text-text-2">{valueText(it.kind, it.final)}</span>}
                </span>
                <span className="hidden text-right text-[12.5px] text-text-3 tabular-nums md:block">{textual ? (it.changed ? <span className="block truncate" title={valueText(it.kind, it.engine)}>{valueText(it.kind, it.engine)}</span> : "same") : valueText(it.kind, it.engine)}</span>
                <span className="hidden text-right text-[13px] font-semibold text-text tabular-nums md:block">{textual ? <Badge tone={it.changed ? "brand" : "neutral"}>{it.changed ? "changed" : "kept"}</Badge> : valueText(it.kind, it.final)}</span>
                <span className={cn("hidden text-right text-[12.5px] tabular-nums md:block", it.changed ? "text-text" : "text-text-3")}>{textual ? "" : deltaText(it.kind, it.delta, it.changed)}</span>
                <span className="hidden md:block">
                  <Badge tone={CONFIDENCE_TONE[it.confidence]}>{it.confidence === "none" ? "n/a" : it.confidence}</Badge>
                </span>
                <span className="hidden text-right text-[12.5px] text-text-2 tabular-nums md:block">{pct(it.agreement)}</span>
                <span className="hidden gap-1 md:flex">
                  {STAGES.map((s) => (
                    <StageIcon key={s.id} status={it.stages[s.id].status} className="h-3.5 w-3.5" />
                  ))}
                </span>
                <ChevronRight className="h-4 w-4 text-text-3" />
                {/* Phone layout: values on a second line. */}
                <span className="col-span-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-text-2 tabular-nums md:hidden">
                  {!textual && (
                    <span>
                      {valueText(it.kind, it.engine)} → <b className="text-text">{valueText(it.kind, it.final)}</b> ({deltaText(it.kind, it.delta, it.changed)})
                    </span>
                  )}
                  {textual && <span>{it.changed ? `changed from ${valueText(it.kind, it.engine)}` : "same as the engine"}</span>}
                  <Badge tone={CONFIDENCE_TONE[it.confidence]}>{confidenceText(it.confidence)}</Badge>
                  <span>agreement {pct(it.agreement)}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
