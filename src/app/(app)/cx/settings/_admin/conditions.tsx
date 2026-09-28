"use client";

import { Plus, X } from "lucide-react";
import { useId } from "react";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { AUTO_FIELDS, AUTO_OP_LABELS, type AutoCondition, type AutoField } from "@/lib/cx/admin/pure/automation";

export type ConditionContext = {
  channels: { value: string; label: string }[];
  classifications: { id: string; path: string }[];
  fields: { key: string; label: string }[];
  segments?: string[];
};

const SUGGEST: Partial<Record<AutoField, string[]>> = {
  social_type: ["public", "private", "custom"],
  sentiment: ["positive", "neutral", "negative", "mixed"],
  intent: ["question", "complaint", "praise", "request", "purchase", "cancel", "bug"],
  language: ["en", "hi", "gu", "es", "fr", "de"],
  business_hours: ["open", "closed"],
  priority: ["low", "normal", "high", "urgent"],
  severity: ["Low", "Medium", "High", "Critical"],
};

/** Editor for a list of automation-style conditions (automations, escalation matrix). */
export function ConditionsEditor({ value, onChange, ctx, fieldsAllowed }: { value: AutoCondition[]; onChange: (v: AutoCondition[]) => void; ctx: ConditionContext; fieldsAllowed?: AutoField[] }) {
  const id = useId();
  const fields = fieldsAllowed ? AUTO_FIELDS.filter((f) => fieldsAllowed.includes(f.value)) : AUTO_FIELDS;
  const set = (i: number, c: Partial<AutoCondition>) => onChange(value.map((x, j) => (j === i ? { ...x, ...c } : x)));
  const suggestions = (f: AutoField) => (f === "channel" ? ctx.channels.map((c) => c.value) : f === "segment" ? ctx.segments ?? [] : SUGGEST[f] ?? []);
  return (
    <div className="space-y-2">
      {value.map((c, i) => {
        const def = AUTO_FIELDS.find((f) => f.value === c.field) ?? AUTO_FIELDS[0];
        const noValue = c.op === "empty" || c.op === "not_empty";
        const listId = `${id}-${i}`;
        return (
          <div key={i} className="flex flex-wrap items-center gap-1.5 rounded-md border border-border bg-surface-2 p-1.5">
            <Select aria-label="Condition field" className="h-7.5 w-full sm:w-44" value={c.field} onChange={(e) => { const f = AUTO_FIELDS.find((x) => x.value === e.target.value)!; set(i, { field: f.value, op: f.ops[0], value: "", key: undefined }); }}>
              {fields.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
            </Select>
            {c.field === "field" && (
              <Select aria-label="Which field" className="h-7.5 w-full sm:w-40" value={c.key ?? ""} onChange={(e) => set(i, { key: e.target.value })}>
                <option value="">Choose field…</option>
                {ctx.fields.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
              </Select>
            )}
            <Select aria-label="Operator" className="h-7.5 w-[calc(50%-3px)] sm:w-36" value={c.op} onChange={(e) => set(i, { op: e.target.value as AutoCondition["op"] })}>
              {def.ops.map((o) => <option key={o} value={o}>{AUTO_OP_LABELS[o]}</option>)}
            </Select>
            {!noValue && (c.field === "classification" ? (
              <Select aria-label="Classification" className="h-7.5 min-w-0 flex-1" value={c.value} onChange={(e) => set(i, { value: e.target.value })}>
                <option value="">Choose…</option>
                {ctx.classifications.map((n) => <option key={n.id} value={n.id}>{n.path}</option>)}
              </Select>
            ) : (
              <>
                <Input aria-label="Value" className="h-7.5 min-w-0 flex-1" list={listId} value={c.value} placeholder={def.value === "length" ? "e.g. 500" : def.hint ?? "Comma-separated values"} onChange={(e) => set(i, { value: e.target.value })} />
                <datalist id={listId}>{suggestions(c.field).map((s) => <option key={s} value={s} />)}</datalist>
              </>
            ))}
            {noValue && <span className="flex-1" />}
            <Button size="icon" variant="ghost" className="h-7 w-7" aria-label="Remove condition" onClick={() => onChange(value.filter((_, j) => j !== i))}><X className="h-3.5 w-3.5" /></Button>
          </div>
        );
      })}
      <Button size="sm" variant="ghost" onClick={() => onChange([...value, { field: fields[0].value, op: fields[0].ops[0], value: "" }])}><Plus className="h-3.5 w-3.5" />Add condition</Button>
    </div>
  );
}
