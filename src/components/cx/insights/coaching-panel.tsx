"use client";

import { CheckCircle2, GraduationCap, Sparkles, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { assignCoachingAction, bulkAiScoreAction, coachingFlagAction } from "@/app/(app)/cx/quality/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Callout } from "@/components/ui/feedback";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { MiniTable } from "@/components/ui/mini-table";
import { dateLabel } from "@/lib/format";

type AgentRow = { id: string | null; name: string; n: number; avg: number | null; fatalRate: number | null; warnings: string[]; change: number | null; recommended: { id: string; name: string } | null; openSessions: number; completedSessions: number };
type Session = { id: string; agent: string | null; form: string | null; supervisor: string | null; assigned_by_name: string | null; notes: string; outcome: string; status: "assigned" | "completed"; due_at: string | null; completed_at: string | null; created_at: string };
const WARN: Record<string, string> = { declining: "Declining 3 weeks", below_pass: "Below pass 2 weeks" };

export function CoachingPanel({ brand, agents, sessions, forms, supervisors }: { brand: string; agents: AgentRow[]; sessions: Session[]; forms: { id: string; name: string }[]; supervisors: { id: string; name: string }[] }) {
  const router = useRouter();
  const [assign, setAssign] = useState<{ agentId: string; name: string; formId: string } | null>(null);
  const [notes, setNotes] = useState("");
  const [sup, setSup] = useState("");
  const [due, setDue] = useState("7");
  const [outcome, setOutcome] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, after?: () => void) =>
    start(async () => {
      const r = await fn();
      if (!r.ok) setError(r.error ?? "Failed");
      else {
        setError(null);
        after?.();
        router.refresh();
      }
    });
  const open = sessions.filter((s) => s.status === "assigned");
  const completed = sessions.filter((s) => s.status === "completed");
  return (
    <div className="space-y-4">
      {error && <Callout tone="critical">{error}</Callout>}
      <Card>
        <CardHeader title="Agent-wise coaching view" description="Last 90 days of evaluations. Early warnings flag agents whose weekly score fell 3 weeks in a row (10+ points) or stayed under the pass score for 2 weeks." />
        <CardBody className="pt-1">
          <MiniTable
            empty="No evaluated agents yet."
            columns={[{ header: "Agent" }, { header: "Reviewed", align: "right" }, { header: "Avg score", align: "right" }, { header: "Trend", align: "right" }, { header: "Early warning" }, { header: "Recommended form" }, { header: "Coaching", align: "right" }, { header: "" }]}
            rows={agents.map((a) => [
              <span key="n" className="font-medium text-text">{a.name}</span>,
              a.n,
              a.avg == null ? "n/a" : `${a.avg.toFixed(0)}%`,
              a.change == null ? "n/a" : `${a.change >= 0 ? "+" : ""}${a.change.toFixed(0)} pts`,
              a.warnings.length ? <span key="w" className="flex flex-wrap gap-1">{a.warnings.map((w) => <Badge key={w} tone="critical">{WARN[w] ?? w}</Badge>)}</span> : <span key="w" className="text-text-3">None</span>,
              a.recommended?.name ?? <span key="r" className="text-text-3">No coaching form</span>,
              `${a.openSessions} open · ${a.completedSessions} done`,
              a.id ? <Button key="b" size="sm" onClick={() => { setAssign({ agentId: a.id!, name: a.name, formId: a.recommended?.id ?? "" }); setNotes(a.warnings.length ? `Score trend: ${a.warnings.map((w) => WARN[w]).join(", ")}. ` : ""); }}><GraduationCap className="h-3.5 w-3.5" /> Assign</Button> : null,
            ])}
          />
        </CardBody>
      </Card>
      <Card>
        <CardHeader title={`Open coaching sessions (${open.length})`} description="Supervision: complete a session with its outcome." />
        <CardBody className="space-y-2 pt-1">
          {open.length === 0 && <p className="py-4 text-center text-[13px] text-text-3">No open coaching sessions.</p>}
          {open.map((s) => (
            <div key={s.id} className="rounded-md border border-border p-2.5">
              <div className="flex flex-wrap items-center gap-2 text-[13px]">
                <span className="font-medium text-text">{s.agent ?? "Unknown"}</span>
                {s.form && <Badge tone="info">{s.form}</Badge>}
                {s.supervisor && <span className="text-text-3">Supervisor: {s.supervisor}</span>}
                <span className="text-text-3">{s.due_at ? `due ${dateLabel(s.due_at)}` : `assigned ${dateLabel(s.created_at)}`}</span>
                <Button size="icon" variant="ghost" className="ml-auto" aria-label="Delete session" onClick={() => confirm("Delete this coaching session?") && run(() => coachingFlagAction(brand, s.id, "delete"))}><Trash2 className="h-4 w-4" /></Button>
              </div>
              <p className="mt-1 text-[13px] whitespace-pre-line text-text-2">{s.notes}</p>
              <div className="mt-2 flex gap-2">
                <Input aria-label="Outcome" value={outcome[s.id] ?? ""} onChange={(e) => setOutcome({ ...outcome, [s.id]: e.target.value })} placeholder="Outcome / agreed actions" className="h-8 min-w-0 flex-1" />
                <Button size="sm" disabled={pending} onClick={() => run(() => coachingFlagAction(brand, s.id, "complete", outcome[s.id] ?? ""))}><CheckCircle2 className="h-3.5 w-3.5" /> Complete</Button>
              </div>
            </div>
          ))}
        </CardBody>
      </Card>
      {completed.length > 0 && (
        <Card>
          <CardHeader title={`Completed coaching (${completed.length})`} />
          <CardBody className="pt-1">
            <MiniTable columns={[{ header: "Agent" }, { header: "Form" }, { header: "Outcome" }, { header: "Completed" }]} rows={completed.slice(0, 50).map((s) => [s.agent ?? "Unknown", s.form ?? "n/a", <span key="o" className="text-[12.5px]">{s.outcome || "n/a"}</span>, s.completed_at ? dateLabel(s.completed_at) : "n/a"])} />
          </CardBody>
        </Card>
      )}
      <Dialog
        open={!!assign}
        onClose={() => setAssign(null)}
        title={`Assign coaching to ${assign?.name ?? ""}`}
        footer={
          <>
            <Button onClick={() => setAssign(null)}>Cancel</Button>
            <Button variant="primary" loading={pending} onClick={() => assign && run(() => assignCoachingAction(brand, { agentId: assign.agentId, scorecardId: assign.formId || null, supervisorId: sup || null, notes, dueDays: Number(due) || null }), () => setAssign(null))}>Assign</Button>
          </>
        }
      >
        {assign && (
          <div className="space-y-3">
            <Field label="Coaching form" htmlFor="co-form">
              <Select id="co-form" value={assign.formId} onChange={(e) => setAssign({ ...assign, formId: e.target.value })}>
                <option value="">No form</option>
                {forms.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
              </Select>
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Supervisor" htmlFor="co-sup"><Select id="co-sup" value={sup} onChange={(e) => setSup(e.target.value)}><option value="">None</option>{supervisors.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</Select></Field>
              <Field label="Due in days" htmlFor="co-due"><Input id="co-due" type="number" min={1} max={90} value={due} onChange={(e) => setDue(e.target.value)} /></Field>
            </div>
            <Field label="What to cover" htmlFor="co-notes"><Textarea id="co-notes" rows={4} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
            <p className="text-[12px] text-text-3">The agent is notified in the app.</p>
          </div>
        )}
      </Dialog>
    </div>
  );
}

export function BulkAiScoreButton({ brand, queued }: { brand: string; queued: number }) {
  const router = useRouter();
  const [msg, setMsg] = useState<{ tone: "good" | "critical"; text: string } | null>(null);
  const [pending, start] = useTransition();
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        loading={pending}
        disabled={!queued}
        onClick={() =>
          start(async () => {
            const r = await bulkAiScoreAction(brand);
            if (!r.ok) return setMsg({ tone: "critical", text: r.error });
            const d = r.data;
            setMsg({ tone: "good", text: `AI scored ${d.scored} of ${d.considered} queued reviews${d.failed ? ` (${d.failed} failed)` : ""}. Average ${d.avg == null ? "n/a" : `${d.avg.toFixed(0)}%`}, ${d.below} below 80%. Drafts are ready for reviewers to confirm and submit.` });
            router.refresh();
          })
        }
      >
        <Sparkles className="h-4 w-4" /> AI auto-score queue
      </Button>
      {msg && <span className={msg.tone === "good" ? "text-[12.5px] text-good-ink" : "text-[12.5px] text-critical-ink"}>{msg.text}</span>}
    </div>
  );
}
