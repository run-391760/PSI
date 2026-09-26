"use client";

import { Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { createRuleAction, updateRuleAction } from "@/app/(app)/alerts/actions";
import { ALERT_KINDS, alertKind, type AlertKind, type AlertRule, type Device, type Severity, type TagRef } from "@/lib/position-tracking/types";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Callout } from "@/components/ui/feedback";
import { Checkbox, Field, Input, Select } from "@/components/ui/input";

export type RuleProject = { id: string; name: string; domain: string; competitors: string[]; tags: TagRef[]; devices: Device[] };

type Draft = { projectId: string; name: string; kind: AlertKind; threshold: string; device: "" | Device; tagId: string; competitor: string; severity: Severity; enabled: boolean };

const blank = (projectId: string): Draft => ({ projectId, name: "", kind: "drop", threshold: String(alertKind("drop").defaultThreshold), device: "", tagId: "", competitor: "", severity: alertKind("drop").defaultSeverity, enabled: true });

export function RuleDialog({ open, onClose, projects, rule, defaultProject }: { open: boolean; onClose: () => void; projects: RuleProject[]; rule?: AlertRule | null; defaultProject?: string }) {
  const router = useRouter();
  const [draft, setDraft] = useState<Draft>(blank(defaultProject ?? projects[0]?.id ?? ""));
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  useEffect(() => {
    if (!open) return;
    setError(null);
    setDraft(
      rule
        ? { projectId: rule.projectId, name: rule.name, kind: rule.kind, threshold: String(rule.threshold), device: rule.device ?? "", tagId: rule.tagId ?? "", competitor: rule.competitor ?? "", severity: rule.severity, enabled: rule.enabled }
        : blank(defaultProject ?? projects[0]?.id ?? ""),
    );
  }, [open, rule, defaultProject, projects]);

  const project = projects.find((p) => p.id === draft.projectId);
  const kind = alertKind(draft.kind);
  const set = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }));
  const threshold = Number(draft.threshold);
  const thresholdError =
    kind.thresholdLabel && (!Number.isFinite(threshold) || threshold <= 0)
      ? "Enter a number greater than 0."
      : (draft.kind === "enter_top" || draft.kind === "leave_top") && (threshold > 100 || !Number.isInteger(threshold))
        ? "Use a whole number from 1 to 100."
        : (draft.kind === "drop" || draft.kind === "rise") && (threshold > 99 || !Number.isInteger(threshold))
          ? "Use a whole number from 1 to 99."
          : null;
  const preview = kind.describe(threshold || 0, draft.competitor || null);

  const submit = () =>
    start(async () => {
      setError(null);
      const input = {
        projectId: draft.projectId,
        name: draft.name.trim(),
        kind: draft.kind,
        threshold: kind.thresholdLabel ? threshold : 0,
        device: draft.device || null,
        tagId: draft.tagId || null,
        competitor: draft.kind === "overtaken" ? draft.competitor || null : null,
        severity: draft.severity,
        enabled: draft.enabled,
      };
      const res = rule ? await updateRuleAction(rule.id, input) : await createRuleAction(input);
      if (!res.ok) return setError(res.error);
      onClose();
      router.refresh();
    });

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={rule ? "Edit alert rule" : "New alert rule"}
      description="Rules are evaluated after every rank check; matches appear in Alerts and the bell."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" loading={pending} disabled={!project || Boolean(thresholdError)} onClick={submit}>
            {rule ? "Save rule" : "Create rule"}
          </Button>
        </>
      }
    >
      {!projects.length ? (
        <Callout tone="info">Set up Position Tracking for a project first — alert rules watch tracked keywords.</Callout>
      ) : (
        <div className="space-y-3.5">
          {error && <Callout tone="critical">{error}</Callout>}
          <Field label="Project" htmlFor="rule-project">
            <Select id="rule-project" value={draft.projectId} onChange={(e) => set({ projectId: e.target.value, tagId: "", competitor: "" })} disabled={Boolean(rule) || projects.length === 1}>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} ({p.domain})
                </option>
              ))}
            </Select>
          </Field>
          <div className="grid gap-3.5 sm:grid-cols-[1.4fr_1fr]">
            <Field label="Trigger" htmlFor="rule-kind">
              <Select
                id="rule-kind"
                value={draft.kind}
                onChange={(e) => {
                  const k = alertKind(e.target.value);
                  set({ kind: k.id, threshold: String(k.defaultThreshold), severity: k.defaultSeverity });
                }}
              >
                {ALERT_KINDS.map((k) => (
                  <option key={k.id} value={k.id}>
                    {k.label}
                  </option>
                ))}
              </Select>
            </Field>
            {kind.thresholdLabel ? (
              <Field label={kind.thresholdLabel} htmlFor="rule-threshold" error={thresholdError ?? undefined}>
                <Input id="rule-threshold" type="number" min={1} step={draft.kind === "visibility_change" ? "0.5" : "1"} value={draft.threshold} onChange={(e) => set({ threshold: e.target.value })} />
              </Field>
            ) : (
              <Field label="Competitor" htmlFor="rule-competitor">
                <Select id="rule-competitor" value={draft.competitor} onChange={(e) => set({ competitor: e.target.value })}>
                  <option value="">Any competitor</option>
                  {project?.competitors.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </Select>
              </Field>
            )}
          </div>
          <div className="grid gap-3.5 sm:grid-cols-3">
            <Field label="Keywords" htmlFor="rule-tag">
              <Select id="rule-tag" value={draft.tagId} onChange={(e) => set({ tagId: e.target.value })}>
                <option value="">All keywords</option>
                {project?.tags.map((t) => (
                  <option key={t.id} value={t.id}>
                    Tag: {t.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Device" htmlFor="rule-device">
              <Select id="rule-device" value={draft.device} onChange={(e) => set({ device: e.target.value as "" | Device })}>
                <option value="">All tracked devices</option>
                {(project?.devices ?? ["desktop", "mobile"]).map((d) => (
                  <option key={d} value={d}>
                    {d === "desktop" ? "Desktop" : "Mobile"}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Severity" htmlFor="rule-severity">
              <Select id="rule-severity" value={draft.severity} onChange={(e) => set({ severity: e.target.value as Severity })}>
                <option value="info">Info</option>
                <option value="success">Success</option>
                <option value="warning">Warning</option>
                <option value="critical">Critical</option>
              </Select>
            </Field>
          </div>
          <Field label="Name (optional)" htmlFor="rule-name" hint={`Defaults to “${preview}”.`}>
            <Input id="rule-name" value={draft.name} maxLength={80} onChange={(e) => set({ name: e.target.value })} placeholder={preview} />
          </Field>
          <label className="flex items-center gap-2 text-[13px] text-text-2">
            <Checkbox checked={draft.enabled} onChange={(e) => set({ enabled: e.target.checked })} /> Enabled
          </label>
        </div>
      )}
    </Dialog>
  );
}

export function NewRuleButton({ projects, defaultProject, variant = "primary", label = "New rule" }: { projects: RuleProject[]; defaultProject?: string; variant?: "primary" | "secondary"; label?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <span className="text-left">
      <Button variant={variant} onClick={() => setOpen(true)}>
        <Plus className="h-4 w-4" /> {label}
      </Button>
      <RuleDialog open={open} onClose={() => setOpen(false)} projects={projects} defaultProject={defaultProject} />
    </span>
  );
}
