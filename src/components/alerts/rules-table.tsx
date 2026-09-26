"use client";

import { BellRing, Pencil, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { deleteRuleAction, toggleRuleAction } from "@/app/(app)/alerts/actions";
import { timeAgo } from "@/lib/format";
import { alertKind, type AlertRule } from "@/lib/position-tracking/types";
import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/ui/data-table";
import { Callout, EmptyState } from "@/components/ui/feedback";
import { RuleDialog, type RuleProject } from "./rule-dialog";
import { SeverityBadge } from "./severity";

export function Toggle({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors disabled:opacity-50 ${checked ? "bg-brand" : "bg-border-strong"}`}
    >
      <span className={`inline-block h-4 w-4 rounded-full bg-white shadow transition-transform ${checked ? "translate-x-4.5" : "translate-x-0.5"}`} />
    </button>
  );
}

export function RulesTable({ rules, projects, showProject = true, emptyAction }: { rules: AlertRule[]; projects: RuleProject[]; showProject?: boolean; emptyAction?: React.ReactNode }) {
  const router = useRouter();
  const [editing, setEditing] = useState<AlertRule | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<{ ok: boolean; error?: string }>) =>
    start(async () => {
      setError(null);
      const res = await fn();
      if (!res.ok) setError(res.error ?? "Something went wrong.");
      router.refresh();
    });

  if (!rules.length)
    return (
      <EmptyState
        icon={<BellRing className="h-5 w-5" />}
        title="No alert rules yet"
        description="Get notified when keywords enter or leave the top positions, move sharply, when a competitor overtakes you, or when visibility shifts."
        action={emptyAction}
      />
    );

  return (
    <>
      {error && (
        <Callout tone="critical" className="mx-4 mb-3">
          {error}
        </Callout>
      )}
      <DataTable
        rows={rules}
        rowKey={(r) => r.id}
        exportName="alert-rules"
        columns={[
          {
            key: "enabled",
            header: "On",
            width: "56px",
            sortValue: (r) => (r.enabled ? 1 : 0),
            render: (r) => <Toggle checked={r.enabled} disabled={pending} label={`${r.enabled ? "Disable" : "Enable"} ${r.name}`} onChange={(v) => run(() => toggleRuleAction(r.id, v))} />,
          },
          {
            key: "name",
            header: "Rule",
            sortValue: (r) => r.name,
            render: (r) => (
              <div className="min-w-[200px]">
                <div className={r.enabled ? "font-medium text-text" : "font-medium text-text-3"}>{r.name}</div>
                {r.name !== alertKind(r.kind).describe(r.threshold, r.competitor) && <div className="text-[12px] text-text-3">{alertKind(r.kind).describe(r.threshold, r.competitor)}</div>}
              </div>
            ),
          },
          ...(showProject
            ? [
                {
                  key: "project",
                  header: "Project",
                  sortValue: (r: AlertRule) => r.projectName,
                  render: (r: AlertRule) => (
                    <Link href={`/position-tracking?project=${r.projectId}&tab=settings`} className="text-link hover:underline">
                      {r.projectName}
                    </Link>
                  ),
                  csv: (r: AlertRule) => r.projectName,
                },
              ]
            : []),
          { key: "scope", header: "Scope", sortable: false, render: (r) => <span className="text-[12.5px] text-text-2">{[r.tagName ? `Tag “${r.tagName}”` : "All keywords", r.device ? (r.device === "desktop" ? "Desktop" : "Mobile") : "All devices"].join(" · ")}</span>, csv: (r) => `${r.tagName ?? "All keywords"} / ${r.device ?? "All devices"}` },
          { key: "severity", header: "Severity", render: (r) => <SeverityBadge severity={r.severity} /> },
          { key: "triggerCount", header: "Triggered", align: "right", info: "Keyword matches since the rule was created." },
          { key: "lastTriggeredAt", header: "Last alert", sortValue: (r) => r.lastTriggeredAt ?? "", render: (r) => (r.lastTriggeredAt ? timeAgo(r.lastTriggeredAt) : <span className="text-text-3">never</span>) },
          {
            key: "actions",
            header: "",
            sortable: false,
            noExport: true,
            align: "right",
            render: (r) => (
              <span className="inline-flex gap-1">
                <Button size="icon" variant="ghost" className="h-7 w-7" aria-label={`Edit ${r.name}`} title="Edit" onClick={() => setEditing(r)}>
                  <Pencil className="h-3.5 w-3.5" />
                </Button>
                <Button size="icon" variant="ghost" className="h-7 w-7 text-critical-ink" aria-label={`Delete ${r.name}`} title="Delete" onClick={() => confirm(`Delete the rule “${r.name}”?`) && run(() => deleteRuleAction(r.id))}>
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </span>
            ),
          },
        ]}
      />
      <RuleDialog open={Boolean(editing)} onClose={() => setEditing(null)} projects={projects} rule={editing} />
    </>
  );
}
