"use client";

import { Play, RefreshCw, Settings2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { type FormEvent, useEffect, useId, useState, useTransition } from "react";
import { runAuditAction, saveAuditSetupAction } from "@/app/(app)/backlink-audit/actions";
import { DATABASES } from "@/lib/domain";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Callout } from "@/components/ui/feedback";
import { Checkbox, Field, Input, Select } from "@/components/ui/input";

export type AuditSetupValues = { brandTerms: string[]; country: string; weekly: boolean };

type FormState = { pending: boolean; error: string | null };

/**
 * Backlink Audit setup: brand terms, target country and the weekly re-audit schedule. With
 * `onStateChange` the form leaves its submit button and error out, so a Dialog footer can render
 * them (`form={formId}`).
 */
export function AuditSetupForm({
  projectId,
  initial,
  submitLabel = "Start Backlink Audit",
  onDone,
  formId,
  onStateChange,
}: {
  projectId: string;
  initial: AuditSetupValues;
  submitLabel?: string;
  onDone?: () => void;
  formId?: string;
  onStateChange?: (s: FormState) => void;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  useEffect(() => onStateChange?.({ pending, error }), [pending, error, onStateChange]);
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (pending) return;
    const f = new FormData(e.currentTarget);
    const brandTerms = String(f.get("brand") || "")
      .split(/[\n,]/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (brandTerms.length > 20) return setError("Add at most 20 brand terms.");
    start(async () => {
      const res = await saveAuditSetupAction(projectId, { brandTerms, country: String(f.get("country") || "US"), weekly: f.get("weekly") === "on" });
      if (!res.ok) return setError(res.error);
      setError(null);
      onDone?.();
      router.refresh();
    });
  };
  return (
    <form id={formId} onSubmit={submit} className="space-y-4">
      {error && !onStateChange && <Callout tone="critical">{error}</Callout>}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Brand terms" htmlFor="bla-brand" hint="Comma separated. Links whose anchors use your brand are treated as natural.">
          <Input id="bla-brand" name="brand" defaultValue={initial.brandTerms.join(", ")} placeholder="Acme, Acme Corp" maxLength={1800} />
        </Field>
        <Field label="Target country" htmlFor="bla-country" hint="Links from unrelated countries get a “Geo mismatch” marker.">
          <Select id="bla-country" name="country" defaultValue={initial.country}>
            {DATABASES.map((d) => (
              <option key={d.code} value={d.code}>
                {d.flag} {d.name}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <label className="flex cursor-pointer items-start gap-2 text-[13px] text-text-2">
        <Checkbox name="weekly" defaultChecked={initial.weekly} className="mt-0.5" />
        <span>
          <span className="font-medium text-text">Re-audit weekly</span> and alert me when new toxic domains start linking to the site.
        </span>
      </label>
      {!onStateChange && (
        <div className="flex justify-end">
          <Button type="submit" variant="primary" loading={pending}>
            <Play className="h-3.5 w-3.5" /> {submitLabel}
          </Button>
        </div>
      )}
    </form>
  );
}

export function AuditSettingsButton({ projectId, initial }: { projectId: string; initial: AuditSetupValues }) {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<FormState>({ pending: false, error: null });
  const formId = useId();
  const close = () => {
    setOpen(false);
    setState({ pending: false, error: null });
  };
  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <Settings2 className="h-4 w-4" /> Settings
      </Button>
      <Dialog
        open={open}
        onClose={close}
        title="Backlink Audit settings"
        description="Saving re-runs the audit with the new settings."
        size="lg"
        dismissible={!state.pending}
        error={state.error}
        footer={
          <>
            <Button type="button" variant="ghost" onClick={close} disabled={state.pending}>
              Cancel
            </Button>
            <Button type="submit" form={formId} variant="primary" loading={state.pending}>
              <Play className="h-3.5 w-3.5" /> Save and re-run
            </Button>
          </>
        }
      >
        <AuditSetupForm projectId={projectId} initial={initial} formId={formId} onStateChange={setState} onDone={close} />
      </Dialog>
    </>
  );
}

export function RunAuditButton({ projectId, disabled }: { projectId: string; disabled?: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <span className="inline-flex flex-col items-end">
      <Button
        variant="primary"
        loading={pending}
        disabled={disabled}
        onClick={() =>
          start(async () => {
            const res = await runAuditAction(projectId);
            if (!res.ok) setError(res.error);
            else {
              setError(null);
              router.refresh();
            }
          })
        }
      >
        {!pending && <RefreshCw className="h-4 w-4" />} {disabled ? "Audit running…" : "Re-run audit"}
      </Button>
      {error && <span className="mt-1 text-[12px] text-critical-ink">{error}</span>}
    </span>
  );
}
