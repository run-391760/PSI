"use client";

import { CheckCircle2 } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/feedback";
import { Textarea } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { Question, SurveyKind } from "@/lib/cx/insights/surveys";

function Scale({ min, max, value, onChange, labels, name }: { min: number; max: number; value: number | null; onChange: (v: number) => void; labels: [string, string]; name: string }) {
  const n = max - min + 1;
  return (
    <div>
      <div role="radiogroup" aria-label={name} className={cn("grid gap-1.5", n === 11 ? "grid-cols-6 sm:grid-cols-11" : "grid-cols-5")}>
        {Array.from({ length: n }, (_, i) => min + i).map((v) => (
          <button
            key={v}
            type="button"
            role="radio"
            aria-checked={value === v}
            onClick={() => onChange(v)}
            className={cn("h-11 rounded-md border text-[15px] font-semibold transition-colors", value === v ? "border-brand bg-brand text-white" : "border-border-strong bg-surface text-text hover:bg-surface-3")}
          >
            {v}
          </button>
        ))}
      </div>
      <div className="mt-1.5 flex justify-between text-[12px] text-text-3">
        <span>{labels[0]}</span>
        <span>{labels[1]}</span>
      </div>
    </div>
  );
}

export function PublicSurveyForm({ id, kind, question, questions, token }: { id: string; kind: SurveyKind; question: string; questions: Question[]; token?: string }) {
  const [score, setScore] = useState<number | null>(null);
  const [answers, setAnswers] = useState<Record<string, string | number>>({});
  const [comment, setComment] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);

  if (done)
    return (
      <div className="py-8 text-center">
        <CheckCircle2 className="mx-auto mb-3 h-10 w-10 text-good-ink" />
        <p className="text-[16px] font-semibold text-text">{done}</p>
      </div>
    );

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await fetch(`/api/cx/surveys/${id}/responses`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token, score, answers, comment }) });
      const d = (await r.json().catch(() => ({}))) as { ok?: boolean; error?: string; thankYou?: string };
      if (!r.ok || !d.ok) setError(d.error ?? "Something went wrong. Please try again.");
      else setDone(d.thankYou || "Thank you!");
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      className="space-y-6"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      {kind === "csat" && (
        <fieldset>
          <legend className="mb-3 text-[16px] font-semibold text-text">{question}</legend>
          <Scale name={question} min={1} max={5} value={score} onChange={setScore} labels={["Very dissatisfied", "Very satisfied"]} />
        </fieldset>
      )}
      {kind === "nps" && (
        <fieldset>
          <legend className="mb-3 text-[16px] font-semibold text-text">{question}</legend>
          <Scale name={question} min={0} max={10} value={score} onChange={setScore} labels={["Not at all likely", "Extremely likely"]} />
        </fieldset>
      )}
      {kind === "custom" && (
        <>
          {question && <p className="text-[14px] text-text-2">{question}</p>}
          {questions.map((q) => (
            <fieldset key={q.id}>
              <legend className="mb-2 text-[15px] font-semibold text-text">
                {q.label} {q.required && <span className="text-critical-ink">*</span>}
              </legend>
              {q.type === "rating5" && <Scale name={q.label} min={1} max={5} value={(answers[q.id] as number) ?? null} onChange={(v) => setAnswers({ ...answers, [q.id]: v })} labels={["Poor", "Excellent"]} />}
              {q.type === "nps" && <Scale name={q.label} min={0} max={10} value={(answers[q.id] as number) ?? null} onChange={(v) => setAnswers({ ...answers, [q.id]: v })} labels={["Not likely", "Very likely"]} />}
              {q.type === "text" && <Textarea rows={3} aria-label={q.label} value={(answers[q.id] as string) ?? ""} onChange={(e) => setAnswers({ ...answers, [q.id]: e.target.value })} />}
              {q.type === "choice" && (
                <div className="space-y-1.5">
                  {(q.options ?? []).map((o) => (
                    <label key={o} className="flex cursor-pointer items-center gap-2 rounded-md border border-border px-3 py-2 text-[14px] text-text hover:bg-surface-2">
                      <input type="radio" name={q.id} checked={answers[q.id] === o} onChange={() => setAnswers({ ...answers, [q.id]: o })} className="accent-[var(--brand)]" /> {o}
                    </label>
                  ))}
                </div>
              )}
            </fieldset>
          ))}
        </>
      )}
      <div>
        <label htmlFor="sv-comment" className="mb-1.5 block text-[14px] font-medium text-text">
          Anything else you&apos;d like to tell us? <span className="font-normal text-text-3">(optional)</span>
        </label>
        <Textarea id="sv-comment" rows={3} value={comment} onChange={(e) => setComment(e.target.value)} maxLength={4000} />
      </div>
      {error && <Callout tone="critical">{error}</Callout>}
      <Button type="submit" variant="primary" size="lg" className="w-full" loading={busy} disabled={kind !== "custom" && score == null}>
        Submit feedback
      </Button>
    </form>
  );
}
