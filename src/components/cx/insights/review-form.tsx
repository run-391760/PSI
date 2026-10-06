"use client";

import { Sparkles, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { acceptReviewAction, aiPrescoreAction, deleteReviewAction, disputeAction, resolveDisputeAction, saveReviewAction } from "@/app/(app)/cx/quality/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/ui/confirm";
import { Card, CardBody, CardFooter, CardHeader } from "@/components/ui/card";
import { Callout } from "@/components/ui/feedback";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { ScoreRing } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import { scaleFraction, scoreReview, type QaAnswers, type QaCriterion, type QaSection } from "@/lib/cx/insights/metrics";
import { STATUS_META } from "./qa-panels";

const CHOICES: { v: number | null; label: string }[] = [
  { v: 1, label: "Yes" },
  { v: 0.5, label: "Partly" },
  { v: 0, label: "No" },
  { v: null, label: "N/A" },
];

type Props = {
  brand: string;
  review: {
    id: string; status: string; answers: QaAnswers; comment: string; coaching: string; dispute_reason: string | null; dispute_response: string | null;
    ai_suggestion: { answers: QaAnswers; notes: Record<string, string>; summary: string } | null;
    text_answers: Record<string, string>; tags: string[]; supervisor_id: string | null; due_at: string | null; accepted_at: string | null; auto_accepted: boolean;
  };
  sections: QaSection[];
  passScore: number;
  ai: boolean;
  supervisors: { id: string; name: string }[];
};

const isScale = (c: QaCriterion) => c.type === "scale" || c.type === "scale_text";
const scored = (c: QaCriterion) => c.type !== "input" && c.type !== "auto";
/** Stored answers are 0–1 fractions; scale criteria are edited as points 1..max. */
function toRaw(sections: QaSection[], stored: QaAnswers) {
  const out: QaAnswers = {};
  for (const c of sections.flatMap((s) => s.criteria)) {
    if (!(c.id in stored) || c.type === "input") continue;
    const v = stored[c.id];
    out[c.id] = v != null && isScale(c) ? Math.round(1 + v * ((c.scaleMax ?? 5) - 1)) : v;
  }
  return out;
}
function toFractions(sections: QaSection[], raw: QaAnswers, stored: QaAnswers) {
  const out: QaAnswers = {};
  for (const c of sections.flatMap((s) => s.criteria)) {
    if (c.type === "auto") {
      if (stored[c.id] != null) out[c.id] = stored[c.id];
      continue;
    }
    const v = raw[c.id];
    if (v == null) continue;
    out[c.id] = isScale(c) ? scaleFraction(v, c.scaleMax ?? 5) : v;
  }
  return out;
}

export function ReviewForm({ brand, review, sections, passScore, ai, supervisors }: Props) {
  const router = useRouter();
  const [answers, setAnswers] = useState<QaAnswers>(() => toRaw(sections, review.answers ?? {}));
  const [texts, setTexts] = useState<Record<string, string>>(review.text_answers ?? {});
  const [tags, setTags] = useState((review.tags ?? []).join(", "));
  const [supervisor, setSupervisor] = useState(review.supervisor_id ?? "");
  const [comment, setComment] = useState(review.comment);
  const [coaching, setCoaching] = useState(review.coaching);
  const [suggestion, setSuggestion] = useState(review.ai_suggestion);
  const [reason, setReason] = useState("");
  const [response, setResponse] = useState("");
  const [msg, setMsg] = useState<{ tone: "good" | "critical"; text: string } | null>(null);
  const [pending, start] = useTransition();
  const { confirm, confirmDialog } = useConfirm();
  const live = useMemo(() => scoreReview(sections, toFractions(sections, answers, review.answers ?? {})), [sections, answers, review.answers]);
  const total = sections.reduce((s, x) => s + x.criteria.filter(scored).length, 0);
  const answered = sections.flatMap((x) => x.criteria).filter((c) => scored(c) && c.id in answers).length;
  const payload = (submit: boolean) => ({ answers, comment, coaching, submit, texts, tags: tags.split(",").map((t) => t.trim()).filter(Boolean), supervisorId: supervisor || null });
  const locked = review.status === "disputed";
  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, ok: string, after?: () => void) =>
    start(async () => {
      const r = await fn();
      setMsg(r.ok ? { tone: "good", text: ok } : { tone: "critical", text: r.error ?? "Failed" });
      if (r.ok) {
        after?.();
        router.refresh();
      }
    });
  const color = live.score == null ? "var(--text-3)" : live.fatal || live.score < passScore * 0.75 ? "var(--critical)" : live.score < passScore ? "var(--warning)" : "var(--good)";

  return (
    <div className="space-y-4">
      <Card>
        <CardBody className="flex flex-wrap items-center gap-4 py-4">
          <ScoreRing value={live.score ?? 0} color={color} label={live.score == null ? "n/a" : `${live.score.toFixed(0)}%`} sub={live.fatal ? "fatal" : `pass ${passScore}%`} size={88} />
          <div className="min-w-0 flex-1 space-y-1 text-[13px]">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={STATUS_META[review.status]?.tone}>{STATUS_META[review.status]?.label ?? review.status}</Badge>
              <span className="text-text-2">{answered} of {total} criteria answered</span>
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-text-3">
              {live.bySection.map((s) => (
                <span key={s.id}>{s.name}: <span className="font-medium text-text">{s.score == null ? "n/a" : `${s.score.toFixed(0)}%`}</span></span>
              ))}
            </div>
          </div>
          {ai ? (
            <Button loading={pending} onClick={() => start(async () => { const r = await aiPrescoreAction(brand, review.id); if (r.ok) { setSuggestion(r.data); setMsg({ tone: "good", text: "AI suggestions ready. Review and apply them." }); } else setMsg({ tone: "critical", text: r.error }); })}>
              <Sparkles className="h-4 w-4" /> AI pre-score
            </Button>
          ) : (
            <span className="max-w-56 text-[12px] text-text-3">AI pre-scoring needs an AI key (Anthropic, OpenAI or Gemini). Manual scoring works now.</span>
          )}
        </CardBody>
      </Card>
      {msg && <Callout tone={msg.tone}>{msg.text}</Callout>}
      {suggestion && (
        <Callout
          title="AI suggestion"
          action={<Button size="sm" disabled={locked} onClick={() => setAnswers({ ...answers, ...toRaw(sections, suggestion.answers) })}>Apply all</Button>}
        >
          {suggestion.summary || "Suggested answers are shown next to each criterion."}
        </Callout>
      )}
      {review.status === "disputed" && (
        <Callout tone="warning" title="Disputed">
          {review.dispute_reason}
        </Callout>
      )}
      {review.dispute_response && review.status !== "disputed" && <Callout title="Dispute response">{review.dispute_response}</Callout>}
      {(review.status === "submitted" || review.status === "resolved") && (
        <Callout
          tone={review.accepted_at ? "good" : "info"}
          title={review.accepted_at ? (review.auto_accepted ? "Auto-accepted" : "Accepted by the agent") : "Awaiting agent feedback"}
          action={!review.accepted_at ? <Button size="sm" disabled={pending} onClick={() => run(() => acceptReviewAction(brand, review.id), "Review accepted.")}>Accept</Button> : undefined}
        >
          {review.accepted_at ? `On ${review.accepted_at.slice(0, 10)}.` : `The agent can accept this evaluation or dispute it with remarks${review.due_at ? ` by ${review.due_at.slice(0, 10)}` : ""}.`}
        </Callout>
      )}
      {sections.map((s) => (
        <Card key={s.id}>
          <CardHeader title={s.name} />
          <CardBody className="space-y-2.5 pt-1">
            {s.criteria.map((c) => {
              const a = c.id in answers ? answers[c.id] : undefined;
              const sug = suggestion?.answers[c.id];
              return (
                <div key={c.id} className="flex flex-wrap items-start justify-between gap-2 border-b border-border pb-2.5 last:border-0 last:pb-0">
                  <div className="min-w-0 flex-1 basis-60">
                    <div className="text-[13px] text-text">
                      {c.label} {c.fatal ? <Badge tone="critical">Fatal</Badge> : c.type === "input" ? <span className="text-[12px] text-text-3">· not scored</span> : <span className="text-[12px] text-text-3">· weight {c.weight}</span>}
                    </div>
                    {suggestion && sug !== undefined && scored(c) && (
                      <div className="mt-0.5 text-[12px] text-text-3">
                        AI: <span className="font-medium text-text-2">{isScale(c) ? (sug == null ? "N/A" : Math.round(1 + sug * ((c.scaleMax ?? 5) - 1))) : CHOICES.find((x) => x.v === sug)?.label}</span>
                        {suggestion.notes[c.id] ? ` — ${suggestion.notes[c.id]}` : ""}
                      </div>
                    )}
                  </div>
                  {c.type === "input" ? (
                    <Textarea aria-label={c.label} rows={2} value={texts[c.id] ?? ""} disabled={locked} onChange={(e) => setTexts({ ...texts, [c.id]: e.target.value })} className="basis-full" placeholder="Notes" />
                  ) : c.type === "auto" ? (
                    <span className="rounded-md bg-surface-3 px-2.5 py-1 text-[12.5px] text-text-2" title="Computed from the ticket when the review is saved">
                      Auto: {review.answers?.[c.id] == null ? "computed on save" : `${Math.round((review.answers[c.id] as number) * 100)}%`}
                    </span>
                  ) : isScale(c) ? (
                    <div className="flex basis-full flex-col items-end gap-1.5 sm:basis-auto">
                      <div role="radiogroup" aria-label={c.label} className="flex flex-wrap overflow-hidden rounded-md border border-border-strong">
                        {[...Array.from({ length: c.scaleMax ?? 5 }, (_, i) => i + 1), null].map((v) => (
                          <button key={String(v)} type="button" role="radio" aria-checked={a === v} disabled={locked} onClick={() => setAnswers({ ...answers, [c.id]: v })}
                            className={cn("min-w-8 border-r border-border-strong px-2 py-1 text-[12.5px] font-medium last:border-r-0 disabled:opacity-60", a === v ? "bg-brand-soft text-text" : "bg-surface text-text-2 hover:bg-surface-3")}>
                            {v ?? "N/A"}
                          </button>
                        ))}
                      </div>
                      {c.type === "scale_text" && <Input aria-label={`Comment for ${c.label}`} value={texts[c.id] ?? ""} disabled={locked} onChange={(e) => setTexts({ ...texts, [c.id]: e.target.value })} placeholder="Comment (required)" className="h-8 w-full sm:w-64" />}
                    </div>
                  ) : (
                  <div role="radiogroup" aria-label={c.label} className="flex overflow-hidden rounded-md border border-border-strong">
                      {CHOICES.filter((x) => !(c.fatal && x.v === 0.5)).map((x) => (
                        <button
                          key={String(x.v)}
                          type="button"
                          role="radio"
                          aria-checked={a === x.v}
                          disabled={locked}
                          onClick={() => setAnswers({ ...answers, [c.id]: x.v })}
                          className={cn(
                            "border-r border-border-strong px-2.5 py-1 text-[12.5px] font-medium last:border-r-0 disabled:opacity-60",
                            a === x.v ? (x.v === 1 ? "bg-good-soft text-good-ink" : x.v === 0 ? "bg-critical-soft text-critical-ink" : x.v === 0.5 ? "bg-warning-soft text-warning-ink" : "bg-surface-3 text-text") : "bg-surface text-text-2 hover:bg-surface-3",
                          )}
                        >
                          {x.label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </CardBody>
        </Card>
      ))}
      <Card>
        <CardHeader title="Feedback & coaching" />
        <CardBody className="space-y-3 pt-1">
          <Field label="Review comment" htmlFor="rv-comment"><Textarea id="rv-comment" rows={3} value={comment} disabled={locked} onChange={(e) => setComment(e.target.value)} /></Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Assessment tags" htmlFor="rv-tags" hint="Comma-separated"><Input id="rv-tags" value={tags} disabled={locked} onChange={(e) => setTags(e.target.value)} placeholder="tone, product-knowledge" /></Field>
            <Field label="Supervisor" htmlFor="rv-sup">
              <Select id="rv-sup" value={supervisor} disabled={locked} onChange={(e) => setSupervisor(e.target.value)}>
                <option value="">None</option>
                {supervisors.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
              </Select>
            </Field>
          </div>
          <Field label="Coaching notes for the agent" htmlFor="rv-coach"><Textarea id="rv-coach" rows={3} value={coaching} disabled={locked} onChange={(e) => setCoaching(e.target.value)} placeholder="What to keep doing, what to change, resources…" /></Field>
        </CardBody>
        <CardFooter className="flex flex-wrap items-center justify-end gap-2">
          <Button variant="ghost" className="mr-auto" disabled={pending} onClick={async () => (await confirm({ title: "Delete this review?" })) && run(() => deleteReviewAction(brand, review.id), "Deleted", () => router.push(`/cx/quality?brand=${brand}&tab=queue`))}>
            <Trash2 className="h-4 w-4" /> Delete
          </Button>
          {!locked && (
            <>
              <Button disabled={pending} onClick={() => run(() => saveReviewAction(brand, review.id, payload(false)), "Draft saved.")}>Save draft</Button>
              <Button variant="primary" loading={pending} onClick={() => run(() => saveReviewAction(brand, review.id, payload(true)), "Review submitted.")}>Submit review</Button>
            </>
          )}
        </CardFooter>
      </Card>
      {(review.status === "submitted" || review.status === "resolved") && (
        <Card>
          <CardHeader title="Dispute this review" description="Agents (or supervisors on their behalf) can ask for a re-review with a reason." />
          <CardBody className="space-y-2 pt-1">
            <Textarea aria-label="Dispute reason" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. The customer asked not to be addressed by name." />
            <Button disabled={pending || !reason.trim()} onClick={() => run(() => disputeAction(brand, review.id, reason), "Dispute opened.", () => setReason(""))}>Open dispute</Button>
          </CardBody>
        </Card>
      )}
      {review.status === "disputed" && (
        <Card>
          <CardHeader title="Resolve dispute" description="Explain the decision. To change the score, resolve first, then edit and resubmit." />
          <CardBody className="space-y-2 pt-1">
            <Textarea aria-label="Dispute response" rows={2} value={response} onChange={(e) => setResponse(e.target.value)} />
            <Button variant="primary" disabled={pending || !response.trim()} onClick={() => run(() => resolveDisputeAction(brand, review.id, response), "Dispute resolved.", () => setResponse(""))}>Resolve</Button>
          </CardBody>
        </Card>
      )}
      {confirmDialog}
    </div>
  );
}
