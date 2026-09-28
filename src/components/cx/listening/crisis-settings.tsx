"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { saveCrisisSettingsAction } from "@/app/(app)/cx/crisis/actions";
import { Button } from "@/components/ui/button";
import { Checkbox, Field, Input, Select } from "@/components/ui/input";

type S = { volumeZ: number; negativeZ: number; minMentions: number; baselineDays: number; windowHours: number; escalationOwner: string; notify: boolean };

/** Per-brand spike thresholds and escalation defaults. */
export function CrisisSettingsForm({ brandId, initial }: { brandId: string; initial: S }) {
  const router = useRouter();
  const [s, setS] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const set = <K extends keyof S>(k: K, v: S[K]) => setS((cur) => ({ ...cur, [k]: v }));
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    const r = await saveCrisisSettingsAction(brandId, s);
    setSaving(false);
    setMsg(r.ok ? { ok: true, text: "Saved." } : { ok: false, text: r.error });
    if (r.ok) router.refresh();
  };
  return (
    <form onSubmit={save} className="grid gap-3 px-4 pb-4">
      <div className="grid grid-cols-2 gap-3">
        <Field label="Volume z-score" htmlFor="c-vz" hint="Spike when volume ≥ this many SDs above baseline">
          <Input id="c-vz" type="number" step="0.5" min={1} max={10} value={s.volumeZ} onChange={(e) => set("volumeZ", Number(e.target.value))} />
        </Field>
        <Field label="Negative z-score" htmlFor="c-nz" hint="Same for negative mentions">
          <Input id="c-nz" type="number" step="0.5" min={1} max={10} value={s.negativeZ} onChange={(e) => set("negativeZ", Number(e.target.value))} />
        </Field>
        <Field label="Minimum mentions" htmlFor="c-min" hint="Ignore spikes smaller than this">
          <Input id="c-min" type="number" min={1} value={s.minMentions} onChange={(e) => set("minMentions", Number(e.target.value))} />
        </Field>
        <Field label="Window" htmlFor="c-win">
          <Select id="c-win" value={s.windowHours} onChange={(e) => set("windowHours", Number(e.target.value))}>
            {[1, 3, 6, 12, 24].map((h) => (
              <option key={h} value={h}>{h === 24 ? "24 hours" : `${h} hour${h > 1 ? "s" : ""}`}</option>
            ))}
          </Select>
        </Field>
        <Field label="Baseline (days)" htmlFor="c-base">
          <Input id="c-base" type="number" min={3} max={60} value={s.baselineDays} onChange={(e) => set("baselineDays", Number(e.target.value))} />
        </Field>
        <Field label="Escalation owner" htmlFor="c-owner" hint="Name or email set on new events">
          <Input id="c-owner" value={s.escalationOwner} maxLength={120} onChange={(e) => set("escalationOwner", e.target.value)} placeholder="PR lead" />
        </Field>
      </div>
      <label className="flex items-center gap-2 text-[13px]">
        <Checkbox checked={s.notify} onChange={(e) => set("notify", e.target.checked)} /> Send alerts (bell + Alerts page) for new and escalated events
      </label>
      <div className="flex items-center gap-3">
        <Button type="submit" variant="primary" loading={saving}>Save thresholds</Button>
        {msg && <span className={msg.ok ? "text-[12.5px] text-good-ink" : "text-[12.5px] text-critical-ink"}>{msg.text}</span>}
      </div>
    </form>
  );
}
