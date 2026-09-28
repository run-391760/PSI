"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { saveFormulaAction } from "@/app/(app)/cx/analytics/actions";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { ER_METRICS, formulaText, type ErFormula } from "@/lib/cx/listening/social";

/** Engagement-rate formula editor: a weight per metric and a denominator. */
export function ErFormulaForm({ brandId, initial }: { brandId: string; initial: ErFormula }) {
  const router = useRouter();
  const [f, setF] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    const r = await saveFormulaAction(brandId, f);
    setSaving(false);
    setMsg(r.ok ? "Saved." : r.error);
    if (r.ok) router.refresh();
  };
  return (
    <form onSubmit={save} className="grid gap-3">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        {ER_METRICS.map((m) => (
          <label key={m} className="grid gap-1 text-[12px] text-text-2">
            <span className="capitalize">{m} ×</span>
            <Input type="number" min={0} max={100} step="0.5" value={f.weights[m]} onChange={(e) => setF({ ...f, weights: { ...f.weights, [m]: Math.max(0, Number(e.target.value) || 0) } })} />
          </label>
        ))}
        <label className="grid gap-1 text-[12px] text-text-2">
          <span>Divide by</span>
          <Select value={f.denominator} onChange={(e) => setF({ ...f, denominator: e.target.value as ErFormula["denominator"] })}>
            <option value="followers">Followers</option>
            <option value="views">Views / impressions</option>
            <option value="none">Nothing (engagements)</option>
          </Select>
        </label>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <code className="rounded bg-surface-3 px-2 py-1 text-[12px] text-text-2">{formulaText(f)}</code>
        <Button type="submit" size="sm" variant="secondary" loading={saving}>Save formula</Button>
        {msg && <span className="text-[12.5px] text-text-2">{msg}</span>}
      </div>
    </form>
  );
}
