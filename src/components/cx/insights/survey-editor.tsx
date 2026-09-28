"use client";

import { Pencil, Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { saveSurveyAction } from "@/app/(app)/cx/surveys/actions";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Callout } from "@/components/ui/feedback";
import { Checkbox, Field, Input, Select, Textarea } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { Question, Survey, SurveyKind } from "@/lib/cx/insights/surveys";

const KINDS: { value: SurveyKind; label: string; description: string; q: string }[] = [
  { value: "csat", label: "CSAT", description: "1–5 satisfaction rating after a conversation", q: "How satisfied were you with the support you received?" },
  { value: "nps", label: "NPS", description: "0–10 likelihood to recommend", q: "How likely are you to recommend us to a friend or colleague?" },
  { value: "custom", label: "Custom", description: "Your own questions: ratings, choices and text", q: "" },
];
const QTYPES = [
  { value: "rating5", label: "Rating 1–5" },
  { value: "nps", label: "Scale 0–10" },
  { value: "choice", label: "Multiple choice" },
  { value: "text", label: "Free text" },
];
const qid = () => `q${Math.random().toString(36).slice(2, 8)}`;

export function SurveyEditor({ brand, survey }: { brand: string; survey?: Survey }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<SurveyKind>(survey?.kind ?? "csat");
  const [name, setName] = useState(survey?.name ?? "");
  const [question, setQuestion] = useState(survey?.question ?? KINDS[0].q);
  const [questions, setQuestions] = useState<Question[]>(survey?.questions ?? []);
  const [thanks, setThanks] = useState(survey?.thank_you ?? "Thank you for your feedback!");
  const [autoSend, setAutoSend] = useState(survey?.auto_send ?? false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const upd = (i: number, p: Partial<Question>) => setQuestions(questions.map((q, j) => (j === i ? { ...q, ...p } : q)));

  const save = () =>
    start(async () => {
      const r = await saveSurveyAction(brand, { name, kind, question, questions: kind === "custom" ? questions : [], thank_you: thanks, status: survey?.status ?? "active", auto_send: autoSend }, survey?.id);
      if (!r.ok) return setError(r.error);
      setOpen(false);
      if (survey) router.refresh();
      else router.push(`/cx/surveys/${r.data.id}?brand=${brand}`);
    });

  return (
    <>
      {survey ? (
        <Button onClick={() => setOpen(true)}>
          <Pencil className="h-4 w-4" /> Edit
        </Button>
      ) : (
        <Button variant="primary" onClick={() => setOpen(true)}>
          <Plus className="h-4 w-4" /> New survey
        </Button>
      )}
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        size="lg"
        title={survey ? "Edit survey" : "New survey"}
        footer={
          <>
            <Button onClick={() => setOpen(false)}>Cancel</Button>
            <Button variant="primary" loading={pending} disabled={!name.trim()} onClick={save}>
              {survey ? "Save" : "Create survey"}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          {error && <Callout tone="critical">{error}</Callout>}
          {!survey && (
            <div className="grid gap-2 sm:grid-cols-3">
              {KINDS.map((k) => (
                <button
                  key={k.value}
                  type="button"
                  onClick={() => {
                    setKind(k.value);
                    setQuestion(k.q);
                    if (k.value === "custom" && !questions.length) setQuestions([{ id: qid(), label: "How would you rate your experience?", type: "rating5", required: true }]);
                  }}
                  className={cn("rounded-md border px-3 py-2 text-left", kind === k.value ? "border-brand bg-brand-soft" : "border-border hover:bg-surface-2")}
                >
                  <div className="text-[13px] font-semibold text-text">{k.label}</div>
                  <div className="text-[12px] text-text-3">{k.description}</div>
                </button>
              ))}
            </div>
          )}
          <Field label="Survey name" htmlFor="sv-name" hint="Internal name, not shown to customers.">
            <Input id="sv-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Post-ticket CSAT" />
          </Field>
          <Field label={kind === "custom" ? "Intro text (optional)" : "Question"} htmlFor="sv-q">
            <Input id="sv-q" value={question} onChange={(e) => setQuestion(e.target.value)} />
          </Field>
          {kind === "custom" && (
            <div className="space-y-2">
              <div className="text-[12.5px] font-semibold text-text">Questions</div>
              {questions.map((q, i) => (
                <div key={q.id} className="space-y-2 rounded-md border border-border p-2.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <Input aria-label="Question text" value={q.label} onChange={(e) => upd(i, { label: e.target.value })} placeholder="Question" className="min-w-0 flex-1" />
                    <Select aria-label="Question type" value={q.type} onChange={(e) => upd(i, { type: e.target.value as Question["type"], options: e.target.value === "choice" ? q.options ?? ["Yes", "No"] : undefined })} className="w-40">
                      {QTYPES.map((t) => (
                        <option key={t.value} value={t.value}>{t.label}</option>
                      ))}
                    </Select>
                    <label className="flex items-center gap-1.5 text-[12.5px] text-text-2">
                      <Checkbox checked={!!q.required} onChange={(e) => upd(i, { required: e.target.checked })} /> Required
                    </label>
                    <Button variant="ghost" size="icon" aria-label="Remove question" onClick={() => setQuestions(questions.filter((_, j) => j !== i))}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                  {q.type === "choice" && (
                    <Input aria-label="Options" value={(q.options ?? []).join(", ")} onChange={(e) => upd(i, { options: e.target.value.split(",").map((x) => x.trim()).filter(Boolean) })} placeholder="Options, comma separated" />
                  )}
                </div>
              ))}
              <Button size="sm" onClick={() => setQuestions([...questions, { id: qid(), label: "", type: "text" }])}>
                <Plus className="h-3.5 w-3.5" /> Add question
              </Button>
            </div>
          )}
          <Field label="Thank-you message" htmlFor="sv-thanks">
            <Textarea id="sv-thanks" rows={2} value={thanks} onChange={(e) => setThanks(e.target.value)} />
          </Field>
          <label className="flex items-start gap-2 text-[13px] text-text">
            <Checkbox className="mt-0.5" checked={autoSend} onChange={(e) => setAutoSend(e.target.checked)} />
            <span>
              Auto-send after a ticket is solved
              <span className="block text-[12px] text-text-3">Creates a personal survey link for every solved ticket (hourly). Answers to CSAT links update the ticket&apos;s CSAT.</span>
            </span>
          </label>
        </div>
      </Dialog>
    </>
  );
}
