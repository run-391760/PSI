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
import { Checkbox, Field, Input } from "@/components/ui/input";
import type { QaSection } from "@/lib/cx/insights/metrics";
import type { Scorecard } from "@/lib/cx/insights/quality";

const uid = () => Math.random().toString(36).slice(2, 9);
type Draft = { id?: string; name: string; description: string; pass_score: number; active: boolean; sections: QaSection[] };
const blank = (): Draft => ({ name: "", description: "", pass_score: 80, active: true, sections: [{ id: uid(), name: "Section 1", criteria: [{ id: uid(), label: "", weight: 10 }] }] });

export function ScorecardsPanel({ brand, scorecards }: { brand: string; scorecards: Scorecard[] }) {
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
  const totalWeight = (d: Draft) => d.sections.reduce((s, x) => s + x.criteria.filter((c) => !c.fatal).reduce((a, c) => a + (Number(c.weight) || 0), 0), 0);
  const setSection = (i: number, p: Partial<QaSection>) => draft && setDraft({ ...draft, sections: draft.sections.map((s, j) => (j === i ? { ...s, ...p } : s)) });

  return (
    <Card>
      <CardHeader
        title={`Scorecards (${scorecards.length})`}
        description="Weighted criteria grouped in sections. A fatal error (answered “No”) sets the whole review to 0%."
        actions={
          <Button variant="primary" size="sm" onClick={() => setDraft(blank())}>
            <Plus className="h-3.5 w-3.5" /> New scorecard
          </Button>
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
                <Button onClick={() => setDraft(blank())}>Build from scratch</Button>
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
                      {s.name} {!s.active && <Badge tone="warning">Inactive</Badge>}
                    </div>
                    <div className="text-[12px] text-text-3">
                      {s.sections.length} sections · {crit.length} criteria · {crit.filter((c) => c.fatal).length} fatal · pass at {s.pass_score}% · {s.reviews ?? 0} reviews
                    </div>
                  </div>
                  <div className="flex gap-1">
                    <Button size="sm" onClick={() => setDraft({ id: s.id, name: s.name, description: s.description, pass_score: s.pass_score, active: s.active, sections: s.sections })}>
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
        title={draft?.id ? "Edit scorecard" : "New scorecard"}
        description={draft ? `Total weight of scored criteria: ${totalWeight(draft)} (scores are normalized, so weights need not add up to 100).` : undefined}
        footer={
          <>
            <Button onClick={() => setDraft(null)}>Cancel</Button>
            <Button variant="primary" loading={pending} onClick={() => draft && run(() => saveScorecardAction(brand, draft, draft.id), () => setDraft(null))}>Save scorecard</Button>
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
            <label className="flex items-center gap-2 text-[13px] text-text"><Checkbox checked={draft.active} onChange={(e) => setDraft({ ...draft, active: e.target.checked })} /> Active (available for new reviews)</label>
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
                        <label className="flex items-center gap-1 text-[12.5px] text-text-2">
                          Weight
                          <Input type="number" min={0} max={100} aria-label="Weight" value={c.fatal ? 0 : c.weight} disabled={c.fatal} onChange={(e) => setC({ weight: Number(e.target.value) })} className="h-8 w-16" />
                        </label>
                        <label className="flex items-center gap-1.5 text-[12.5px] text-text-2"><Checkbox checked={!!c.fatal} onChange={(e) => setC({ fatal: e.target.checked, weight: e.target.checked ? 0 : 10 })} /> Fatal</label>
                        <Button variant="ghost" size="icon" aria-label="Remove criterion" onClick={() => setSection(i, { criteria: s.criteria.filter((_, j) => j !== k) })}><Trash2 className="h-4 w-4" /></Button>
                      </div>
                    );
                  })}
                  <Button size="sm" variant="ghost" onClick={() => setSection(i, { criteria: [...s.criteria, { id: uid(), label: "", weight: 10 }] })}><Plus className="h-3.5 w-3.5" /> Criterion</Button>
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
