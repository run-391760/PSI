"use client";

import { Pencil, Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { createStarterScorecardAction, deleteScorecardAction, saveScorecardAction } from "@/app/(app)/cx/quality/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Callout, EmptyState } from "@/components/ui/feedback";
import { Checkbox, Field, Input, Select } from "@/components/ui/input";
import type { QaSection, ResponseType } from "@/lib/cx/insights/metrics";
import type { Scorecard } from "@/lib/cx/insights/quality";

const uid = () => Math.random().toString(36).slice(2, 9);
type Draft = { id?: string; name: string; description: string; pass_score: number; active: boolean; sections: QaSection[]; form_type: "evaluation" | "coaching"; team_id: string | null; due_days: number | null; auto_accept: boolean; tags: string[] };
const blank = (form_type: Draft["form_type"] = "evaluation"): Draft => ({ name: "", description: "", pass_score: 80, active: true, form_type, team_id: null, due_days: null, auto_accept: false, tags: [], sections: [{ id: uid(), name: "Section 1", criteria: [{ id: uid(), label: "", weight: 10, type: form_type === "coaching" ? "input" : "yesno" }] }] });
const TYPES: { value: ResponseType; label: string }[] = [
  { value: "yesno", label: "Yes / Partly / No" },
  { value: "scale", label: "Scale" },
  { value: "scale_text", label: "Scale + comment" },
  { value: "input", label: "Text input (not scored)" },
  { value: "auto", label: "Auto-scale (from ticket)" },
];
const AUTO: { value: "frt" | "resolution" | "csat" | "sentiment"; label: string; unit: string; def: number }[] = [
  { value: "frt", label: "First response time", unit: "target hours", def: 1 },
  { value: "resolution", label: "Resolution time", unit: "target hours", def: 24 },
  { value: "csat", label: "Customer CSAT", unit: "target (1–5)", def: 4 },
  { value: "sentiment", label: "Ticket sentiment", unit: "", def: 0 },
];

export function ScorecardsPanel({ brand, scorecards, teams = [] }: { brand: string; scorecards: Scorecard[]; teams?: { id: string; name: string }[] }) {
  const router = useRouter();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, after?: () => void) =>
    start(async () => {
      setError(null);
      const r = await fn();
      if (!r.ok) setError(r.error ?? "Failed");
      else {
        after?.();
        router.refresh();
      }
    });
  const totalWeight = (d: Draft) => d.sections.reduce((s, x) => s + x.criteria.filter((c) => !c.fatal && c.type !== "input").reduce((a, c) => a + (Number(c.weight) || 0), 0), 0);
  const [tagText, setTagText] = useState("");
  const openDraft = (d: Draft) => {
    setDraft(d);
    setTagText(d.tags.join(", "));
  };
  const setSection = (i: number, p: Partial<QaSection>) => draft && setDraft({ ...draft, sections: draft.sections.map((s, j) => (j === i ? { ...s, ...p } : s)) });

  return (
    <Card>
      <CardHeader
        title={`Forms (${scorecards.length})`}
        description="Evaluation forms score conversations with weighted criteria (a fatal “No” sets the review to 0%). Coaching forms structure coaching sessions."
        actions={
          <span className="flex gap-1.5">
            <Button variant="primary" size="sm" onClick={() => openDraft(blank())}>
              <Plus className="h-3.5 w-3.5" /> Evaluation form
            </Button>
            <Button size="sm" onClick={() => openDraft(blank("coaching"))}>
              <Plus className="h-3.5 w-3.5" /> Coaching form
            </Button>
          </span>
        }
      />
      <CardBody className="pt-1">
        {error && !draft && <Callout tone="critical" className="mb-3">{error}</Callout>}
        {scorecards.length === 0 ? (
          <EmptyState
            title="No scorecards yet"
            description="Create your own or start from an editable template covering opening, resolution, communication and compliance."
            action={
              <div className="flex flex-wrap justify-center gap-2">
                <Button variant="primary" loading={pending} onClick={() => run(() => createStarterScorecardAction(brand))}>Use starter template</Button>
                <Button onClick={() => openDraft(blank())}>Build from scratch</Button>
              </div>
            }
          />
        ) : (
          <div className="divide-y divide-border">
            {scorecards.map((s) => {
              const crit = s.sections.flatMap((x) => x.criteria);
              return (
                <div key={s.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 font-medium text-text">
                      {s.name} <Badge tone={s.form_type === "coaching" ? "info" : "neutral"}>{s.form_type === "coaching" ? "Coaching" : "Evaluation"}</Badge> {!s.active && <Badge tone="warning">Inactive</Badge>}
                      {s.tags?.map((t) => <Badge key={t}>{t}</Badge>)}
                    </div>
                    <div className="text-[12px] text-text-3">
                      {s.sections.length} sections · {crit.length} criteria · {crit.filter((c) => c.fatal).length} fatal · pass at {s.pass_score}% · {s.reviews ?? 0} reviews
                      {s.team_id ? ` · group: ${teams.find((t) => t.id === s.team_id)?.name ?? "deleted"}` : ""}{s.due_days ? ` · due in ${s.due_days}d${s.auto_accept ? ", auto-accept" : ""}` : ""}
                    </div>
                  </div>
                  <div className="flex gap-1">
                    <Button size="sm" onClick={() => openDraft({ id: s.id, name: s.name, description: s.description, pass_score: s.pass_score, active: s.active, sections: s.sections, form_type: s.form_type ?? "evaluation", team_id: s.team_id ?? null, due_days: s.due_days ?? null, auto_accept: !!s.auto_accept, tags: s.tags ?? [] })}>
                      <Pencil className="h-3.5 w-3.5" /> Edit
                    </Button>
                    <Button size="icon" variant="ghost" aria-label={`Delete ${s.name}`} onClick={() => confirm(`Delete scorecard ${s.name}? Existing reviews keep their scores.`) && run(() => deleteScorecardAction(brand, s.id))}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardBody>
      <Dialog
        open={!!draft}
        onClose={() => setDraft(null)}
        size="xl"
        title={draft?.id ? `Edit ${draft.form_type} form` : `New ${draft?.form_type ?? "evaluation"} form`}
        description={draft ? `Total weight of scored criteria: ${totalWeight(draft)} (scores are normalized, so weights need not add up to 100).` : undefined}
        footer={
          <>
            <Button onClick={() => setDraft(null)}>Cancel</Button>
            <Button variant="primary" loading={pending} onClick={() => draft && run(() => saveScorecardAction(brand, { ...draft, tags: tagText.split(",").map((t) => t.trim()).filter(Boolean) }, draft.id), () => setDraft(null))}>Save form</Button>
          </>
        }
      >
        {draft && (
          <div className="space-y-3">
            {error && <Callout tone="critical">{error}</Callout>}
            <div className="grid gap-3 sm:grid-cols-[1fr_1fr_120px]">
              <Field label="Name" htmlFor="sc-name"><Input id="sc-name" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} /></Field>
              <Field label="Description" htmlFor="sc-desc"><Input id="sc-desc" value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} /></Field>
              <Field label="Pass score %" htmlFor="sc-pass"><Input id="sc-pass" type="number" min={0} max={100} value={draft.pass_score} onChange={(e) => setDraft({ ...draft, pass_score: Number(e.target.value) })} /></Field>
            </div>
            <div className="grid gap-3 sm:grid-cols-4">
              <Field label="Form type" htmlFor="sc-type">
                <Select id="sc-type" value={draft.form_type} onChange={(e) => setDraft({ ...draft, form_type: e.target.value as Draft["form_type"] })}>
                  <option value="evaluation">Evaluation</option>
                  <option value="coaching">Coaching</option>
                </Select>
              </Field>
              <Field label="User group" htmlFor="sc-team" hint="Sampling only picks this group's tickets">
                <Select id="sc-team" value={draft.team_id ?? ""} onChange={(e) => setDraft({ ...draft, team_id: e.target.value || null })}>
                  <option value="">All agents</option>
                  {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </Select>
              </Field>
              <Field label="Due in (days)" htmlFor="sc-due" hint="Agent accepts or disputes by then">
                <Input id="sc-due" type="number" min={1} max={90} value={draft.due_days ?? ""} onChange={(e) => setDraft({ ...draft, due_days: e.target.value ? Number(e.target.value) : null })} placeholder="No deadline" />
              </Field>
              <Field label="Tags" htmlFor="sc-tags" hint="Comma-separated">
                <Input id="sc-tags" value={tagText} onChange={(e) => setTagText(e.target.value)} placeholder="onboarding, email" />
              </Field>
            </div>
            <div className="flex flex-wrap gap-4">
              <label className="flex items-center gap-2 text-[13px] text-text"><Checkbox checked={draft.active} onChange={(e) => setDraft({ ...draft, active: e.target.checked })} /> Active (available for new reviews)</label>
              <label className="flex items-center gap-2 text-[13px] text-text"><Checkbox checked={draft.auto_accept} disabled={!draft.due_days} onChange={(e) => setDraft({ ...draft, auto_accept: e.target.checked })} /> Auto-accept when the due date passes</label>
            </div>
            {draft.sections.map((s, i) => (
              <div key={s.id} className="rounded-md border border-border p-3">
                <div className="mb-2 flex items-center gap-2">
                  <Input aria-label="Section name" value={s.name} onChange={(e) => setSection(i, { name: e.target.value })} className="font-semibold" />
                  <Button variant="ghost" size="icon" aria-label="Remove section" onClick={() => setDraft({ ...draft, sections: draft.sections.filter((_, j) => j !== i) })}><Trash2 className="h-4 w-4" /></Button>
                </div>
                <div className="space-y-2">
                  {s.criteria.map((c, k) => {
                    const setC = (p: Partial<typeof c>) => setSection(i, { criteria: s.criteria.map((x, j) => (j === k ? { ...x, ...p } : x)) });
                    return (
                      <div key={c.id} className="flex flex-wrap items-center gap-2">
                        <Input aria-label="Criterion" placeholder="Criterion (e.g. Verifies the customer's identity)" value={c.label} onChange={(e) => setC({ label: e.target.value })} className="min-w-0 flex-1 basis-60" />
                        <Select aria-label="Response type" value={c.type ?? "yesno"} onChange={(e) => { const type = e.target.value as ResponseType; setC({ type, fatal: type === "yesno" ? c.fatal : false, scaleMax: type.startsWith("scale") ? c.scaleMax ?? 5 : undefined, auto: type === "auto" ? c.auto ?? { metric: "frt", target: 1 } : undefined }); }} className="h-8 w-44">
                          {TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                        </Select>
                        {(c.type === "scale" || c.type === "scale_text") && (
                          <label className="flex items-center gap-1 text-[12.5px] text-text-2">1 to<Input type="number" min={2} max={10} aria-label="Scale maximum" value={c.scaleMax ?? 5} onChange={(e) => setC({ scaleMax: Math.min(10, Math.max(2, Number(e.target.value) || 5)) })} className="h-8 w-14" /></label>
                        )}
                        {c.type === "auto" && (
                          <>
                            <Select aria-label="Auto metric" value={c.auto?.metric ?? "frt"} onChange={(e) => { const m = AUTO.find((x) => x.value === e.target.value)!; setC({ auto: { metric: m.value, target: m.def } }); }} className="h-8 w-40">
                              {AUTO.map((a) => <option key={a.value} value={a.value}>{a.label}</option>)}
                            </Select>
                            {c.auto?.metric !== "sentiment" && <Input type="number" min={0} step="0.5" aria-label={AUTO.find((a) => a.value === (c.auto?.metric ?? "frt"))?.unit} title={AUTO.find((a) => a.value === (c.auto?.metric ?? "frt"))?.unit} value={c.auto?.target ?? 1} onChange={(e) => setC({ auto: { metric: c.auto?.metric ?? "frt", target: Number(e.target.value) } })} className="h-8 w-16" />}
                          </>
                        )}
                        {c.type !== "input" && (
                          <label className="flex items-center gap-1 text-[12.5px] text-text-2">
                            Weight
                            <Input type="number" min={0} max={100} aria-label="Weight" value={c.fatal ? 0 : c.weight} disabled={c.fatal} onChange={(e) => setC({ weight: Number(e.target.value) })} className="h-8 w-16" />
                          </label>
                        )}
                        {(c.type ?? "yesno") === "yesno" && <label className="flex items-center gap-1.5 text-[12.5px] text-text-2"><Checkbox checked={!!c.fatal} onChange={(e) => setC({ fatal: e.target.checked, weight: e.target.checked ? 0 : 10 })} /> Fatal</label>}
                        <Button variant="ghost" size="icon" aria-label="Remove criterion" onClick={() => setSection(i, { criteria: s.criteria.filter((_, j) => j !== k) })}><Trash2 className="h-4 w-4" /></Button>
                      </div>
                    );
                  })}
                  <Button size="sm" variant="ghost" onClick={() => setSection(i, { criteria: [...s.criteria, { id: uid(), label: "", weight: 10, type: draft.form_type === "coaching" ? "input" : "yesno" }] })}><Plus className="h-3.5 w-3.5" /> Criterion</Button>
                </div>
              </div>
            ))}
            <Button size="sm" onClick={() => setDraft({ ...draft, sections: [...draft.sections, { id: uid(), name: `Section ${draft.sections.length + 1}`, criteria: [{ id: uid(), label: "", weight: 10 }] }] })}><Plus className="h-3.5 w-3.5" /> Add section</Button>
          </div>
        )}
      </Dialog>
    </Card>
  );
}
