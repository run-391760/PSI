"use client";

import { ArrowDown, ArrowUp, FlaskConical, Pencil, Plus, Trash, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { deleteCannedAction, deleteRuleAction, moveRuleAction, saveCannedAction, saveRuleAction, testRulesAction, toggleRuleAction } from "@/app/(app)/cx/settings/automation/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Callout, EmptyState } from "@/components/ui/feedback";
import { Checkbox, Field, Input, Select, Textarea } from "@/components/ui/input";
import { CHANNELS } from "@/lib/cx/channels";
import type { RuleRow } from "@/lib/cx/inbox/automation";
import { OP_LABELS, RULE_FIELDS, type RuleCondition, type RuleField } from "@/lib/cx/inbox/rules";
import type { Agent, Canned } from "@/lib/cx/inbox/store";
import { Ago } from "./time";

const HINTS: Partial<Record<RuleField, string[]>> = {
  channel: [...CHANNELS.map((c) => c.kind), "phone", "other"],
  intent: ["complaint", "query", "feedback", "praise", "purchase", "cancellation", "spam", "other"],
  sentiment: ["positive", "neutral", "negative"],
  language: ["en", "hi", "gu", "ta", "ar", "zh", "ru"],
};
const fieldLabel = (f: string) => RULE_FIELDS.find((x) => x.value === f)?.label ?? f;

type Props = { brand: string; rules: RuleRow[]; canned: Canned[]; agents: Agent[]; teams: string[] };
type Draft = { id?: string; kind: "route" | "tag"; name: string; active: boolean; match: "all" | "any"; conditions: RuleCondition[]; team: string; assignee: string; priority: string; tags: string };

export function AutomationClient({ brand, rules, canned, agents, teams }: Props) {
  const router = useRouter();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [cannedDraft, setCannedDraft] = useState<{ id?: string; title: string; shortcut: string; body: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const run = async (p: Promise<{ ok: boolean; error?: string }>) => {
    setError(null);
    const r = await p;
    if (!r.ok) setError(r.error ?? "Failed");
    router.refresh();
    return r.ok;
  };
  const newDraft = (kind: "route" | "tag"): Draft => ({ kind, name: "", active: true, match: "all", conditions: [{ field: kind === "tag" ? "keyword" : "intent", op: kind === "tag" ? "contains" : "is", value: "" }], team: "", assignee: "", priority: "", tags: "" });
  const edit = (r: RuleRow): Draft => ({ id: r.id, kind: r.kind, name: r.name, active: r.active, match: r.match, conditions: r.conditions, team: r.actions.team ?? "", assignee: r.actions.assignee ?? "", priority: r.actions.priority ?? "", tags: (r.actions.tags ?? []).join(", ") });

  const list = (kind: "route" | "tag") => {
    const rs = rules.filter((r) => r.kind === kind);
    if (!rs.length) return <EmptyState title={kind === "route" ? "No routing rules" : "No tag rules"} description={kind === "route" ? "Example: intent is cancellation → team Retention, priority high." : "Example: message contains refund, money back → tag refund."} action={<Button size="sm" variant="primary" onClick={() => setDraft(newDraft(kind))}><Plus className="h-3.5 w-3.5" />Add rule</Button>} />;
    return (
      <ul className="divide-y divide-border">
        {rs.map((r, i) => (
          <li key={r.id} className="flex flex-wrap items-start gap-3 px-4 py-3">
            <Checkbox checked={r.active} onChange={(e) => run(toggleRuleAction(brand, r.id, e.target.checked))} aria-label={`Rule ${r.name} active`} className="mt-1" />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2 text-[13.5px] font-medium text-text">
                {kind === "route" && <span className="text-text-3 tabular-nums">{i + 1}.</span>}{r.name}{!r.active && <Badge>Off</Badge>}
              </div>
              <div className="mt-0.5 text-[12.5px] text-text-2">
                <span className="text-text-3">If {r.match === "all" ? "all" : "any"}: </span>
                {r.conditions.map((c, j) => <span key={j}>{j > 0 && <span className="text-text-3"> {r.match === "all" ? "and" : "or"} </span>}{fieldLabel(c.field).toLowerCase()} {OP_LABELS[c.op]} <b className="font-medium text-text">{c.value}</b></span>)}
              </div>
              <div className="mt-1 flex flex-wrap gap-1 text-[12px]">
                <span className="text-text-3">Then:</span>
                {r.actions.team && <Badge tone="info">team {r.actions.team}</Badge>}
                {r.actions.assignee && <Badge tone="info">assign {agents.find((a) => a.id === r.actions.assignee)?.name ?? "agent"}</Badge>}
                {r.actions.priority && <Badge tone="warning">priority {r.actions.priority}</Badge>}
                {(r.actions.tags ?? []).map((t) => <Badge key={t}>#{t}</Badge>)}
              </div>
            </div>
            <div className="flex items-start gap-3 max-sm:w-full max-sm:justify-between max-sm:pl-7">
            <div className="text-[12px] text-text-3 sm:text-right">
              <div className="tabular-nums">{r.hits} matches</div>
              {r.last_hit_at && <div>last <Ago iso={r.last_hit_at} /></div>}
            </div>
            <div className="flex gap-0.5">
              {kind === "route" && <><Button size="icon" variant="ghost" disabled={i === 0} onClick={() => run(moveRuleAction(brand, r.id, -1))} aria-label="Move up"><ArrowUp className="h-3.5 w-3.5" /></Button><Button size="icon" variant="ghost" disabled={i === rs.length - 1} onClick={() => run(moveRuleAction(brand, r.id, 1))} aria-label="Move down"><ArrowDown className="h-3.5 w-3.5" /></Button></>}
              <Button size="icon" variant="ghost" onClick={() => setDraft(edit(r))} aria-label="Edit rule"><Pencil className="h-3.5 w-3.5" /></Button>
              <Button size="icon" variant="ghost" onClick={() => run(deleteRuleAction(brand, r.id))} aria-label="Delete rule"><Trash className="h-3.5 w-3.5" /></Button>
            </div>
            </div>
          </li>
        ))}
      </ul>
    );
  };

  return (
    <div className="space-y-4">
      {error && <Callout tone="critical">{error}</Callout>}
      <Card>
        <CardHeader title="Routing rules" description="Checked top to bottom; the first matching rule sets team, assignee and priority (and may add tags)." actions={<Button size="sm" variant="primary" onClick={() => setDraft(newDraft("route"))}><Plus className="h-3.5 w-3.5" />Add rule</Button>} />
        {list("route")}
      </Card>
      <Card>
        <CardHeader title="Auto-tagging" description="Every matching rule adds its tags to the new ticket." actions={<Button size="sm" onClick={() => setDraft(newDraft("tag"))}><Plus className="h-3.5 w-3.5" />Add tag rule</Button>} />
        {list("tag")}
      </Card>
      <RuleTester brand={brand} rules={rules} />
      <Card id="canned">
        <CardHeader title="Canned responses" description="Reusable replies for the inbox composer. Placeholders: {{first_name}}, {{name}}, {{ticket}}, {{brand}}, {{agent}}." actions={<Button size="sm" onClick={() => setCannedDraft({ title: "", shortcut: "", body: "" })}><Plus className="h-3.5 w-3.5" />Add response</Button>} />
        {canned.length === 0 ? (
          <EmptyState title="No canned responses" description="Save answers to common questions and insert them in one click while replying." />
        ) : (
          <ul className="divide-y divide-border">
            {canned.map((c) => (
              <li key={c.id} className="flex items-start gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <div className="text-[13.5px] font-medium text-text">{c.title}{c.shortcut && <span className="ml-1.5 font-normal text-text-3">/{c.shortcut}</span>}</div>
                  <p className="mt-0.5 line-clamp-2 text-[12.5px] whitespace-pre-wrap text-text-2">{c.body}</p>
                </div>
                <span className="text-[12px] text-text-3 tabular-nums">used {c.uses}×</span>
                <Button size="icon" variant="ghost" onClick={() => setCannedDraft(c)} aria-label="Edit response"><Pencil className="h-3.5 w-3.5" /></Button>
                <Button size="icon" variant="ghost" onClick={() => run(deleteCannedAction(brand, c.id))} aria-label="Delete response"><Trash className="h-3.5 w-3.5" /></Button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {draft && <RuleDialog draft={draft} agents={agents} teams={teams} onClose={() => setDraft(null)} onSave={async (d) => {
        const ok = await run(saveRuleAction(brand, { id: d.id, kind: d.kind, name: d.name, active: d.active, match: d.match, conditions: d.conditions, actions: { team: d.team || null, assignee: d.assignee || null, priority: (d.priority || null) as never, tags: d.tags.split(",").map((t) => t.trim()).filter(Boolean) } }));
        if (ok) setDraft(null);
      }} error={error} />}
      {cannedDraft && (
        <Dialog open onClose={() => setCannedDraft(null)} title={cannedDraft.id ? "Edit canned response" : "New canned response"}
          footer={<><Button onClick={() => setCannedDraft(null)}>Cancel</Button><Button variant="primary" onClick={async () => { if (await run(saveCannedAction(brand, cannedDraft))) setCannedDraft(null); }}>Save</Button></>}>
          <div className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-[1fr_140px]">
              <Field label="Title" htmlFor="cn-t"><Input id="cn-t" value={cannedDraft.title} onChange={(e) => setCannedDraft({ ...cannedDraft, title: e.target.value })} placeholder="Refund policy" /></Field>
              <Field label="Shortcut" htmlFor="cn-s"><Input id="cn-s" value={cannedDraft.shortcut} onChange={(e) => setCannedDraft({ ...cannedDraft, shortcut: e.target.value })} placeholder="refund" /></Field>
            </div>
            <Field label="Text" htmlFor="cn-b" hint="{{first_name}}, {{name}}, {{ticket}}, {{brand}}, {{agent}} are filled in when inserted."><Textarea id="cn-b" rows={7} value={cannedDraft.body} onChange={(e) => setCannedDraft({ ...cannedDraft, body: e.target.value })} placeholder={"Hi {{first_name}},\n\nThanks for reaching out about ticket {{ticket}}…\n\n{{agent}}, {{brand}}"} /></Field>
            {error && <Callout tone="critical">{error}</Callout>}
          </div>
        </Dialog>
      )}
    </div>
  );
}

function RuleDialog({ draft, agents, teams, onClose, onSave, error }: { draft: Draft; agents: Agent[]; teams: string[]; onClose: () => void; onSave: (d: Draft) => void; error: string | null }) {
  const [d, setD] = useState(draft);
  const setCond = (i: number, c: Partial<RuleCondition>) => setD((x) => ({ ...x, conditions: x.conditions.map((y, j) => (j === i ? { ...y, ...c } : y)) }));
  return (
    <Dialog open onClose={onClose} size="lg" title={`${d.id ? "Edit" : "New"} ${d.kind === "route" ? "routing" : "auto-tag"} rule`}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" onClick={() => onSave(d)}>Save rule</Button></>}>
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
          <Field label="Name" htmlFor="r-n"><Input id="r-n" value={d.name} onChange={(e) => setD({ ...d, name: e.target.value })} placeholder={d.kind === "route" ? "Churn risk to Retention" : "Tag refunds"} /></Field>
          <label className="flex items-center gap-2 self-end pb-2 text-[13px] text-text"><Checkbox checked={d.active} onChange={(e) => setD({ ...d, active: e.target.checked })} />Active</label>
        </div>
        <div>
          <div className="mb-1.5 flex items-center gap-2 text-[13px] text-text">
            When
            <Select value={d.match} onChange={(e) => setD({ ...d, match: e.target.value as "all" | "any" })} className="h-7 w-auto text-[12.5px]" aria-label="Match mode"><option value="all">all</option><option value="any">any</option></Select>
            of these are true:
          </div>
          <div className="space-y-2">
            {d.conditions.map((c, i) => {
              const f = RULE_FIELDS.find((x) => x.value === c.field)!;
              return (
                <div key={i} className="flex flex-wrap items-start gap-1.5">
                  <Select value={c.field} onChange={(e) => { const nf = RULE_FIELDS.find((x) => x.value === e.target.value)!; setCond(i, { field: nf.value, op: nf.ops[0] }); }} className="h-8 w-auto text-[12.5px]" aria-label="Field">
                    {RULE_FIELDS.map((x) => <option key={x.value} value={x.value}>{x.label}</option>)}
                  </Select>
                  <Select value={c.op} onChange={(e) => setCond(i, { op: e.target.value as RuleCondition["op"] })} className="h-8 w-auto text-[12.5px]" aria-label="Operator">
                    {f.ops.map((o) => <option key={o} value={o}>{OP_LABELS[o]}</option>)}
                  </Select>
                  <div className="min-w-[180px] flex-1">
                    <Input value={c.value} onChange={(e) => setCond(i, { value: e.target.value })} placeholder={HINTS[c.field] ? "comma-separated" : "words or phrases, comma-separated"} className="h-8 text-[12.5px]" aria-label="Values" />
                    {HINTS[c.field] && <div className="mt-1 flex flex-wrap gap-1">{HINTS[c.field]!.map((h) => <button key={h} type="button" onClick={() => setCond(i, { value: c.value ? `${c.value}, ${h}` : h })} className="rounded bg-surface-3 px-1.5 text-[11px] text-text-2 hover:text-text">{h}</button>)}</div>}
                  </div>
                  <Button size="icon" variant="ghost" onClick={() => setD((x) => ({ ...x, conditions: x.conditions.filter((_, j) => j !== i) }))} aria-label="Remove condition" disabled={d.conditions.length === 1}><X className="h-3.5 w-3.5" /></Button>
                </div>
              );
            })}
            <Button size="sm" variant="ghost" onClick={() => setD((x) => ({ ...x, conditions: [...x.conditions, { field: "keyword", op: "contains", value: "" }] }))}><Plus className="h-3.5 w-3.5" />Add condition</Button>
          </div>
        </div>
        <div>
          <div className="mb-1.5 text-[13px] text-text">Then:</div>
          {d.kind === "route" ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Team" htmlFor="r-team"><Input id="r-team" list="r-teams" value={d.team} onChange={(e) => setD({ ...d, team: e.target.value })} placeholder="e.g. Billing" /><datalist id="r-teams">{teams.map((t) => <option key={t} value={t} />)}</datalist></Field>
              <Field label="Assign to" htmlFor="r-as"><Select id="r-as" value={d.assignee} onChange={(e) => setD({ ...d, assignee: e.target.value })}><option value="">Nobody (queue)</option>{agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</Select></Field>
              <Field label="Priority" htmlFor="r-pr"><Select id="r-pr" value={d.priority} onChange={(e) => setD({ ...d, priority: e.target.value })}><option value="">Keep default</option>{["urgent", "high", "normal", "low"].map((p) => <option key={p} value={p}>{p}</option>)}</Select></Field>
              <Field label="Add tags" htmlFor="r-tg"><Input id="r-tg" value={d.tags} onChange={(e) => setD({ ...d, tags: e.target.value })} placeholder="vip, churn" /></Field>
            </div>
          ) : (
            <Field label="Add tags" htmlFor="r-tg2"><Input id="r-tg2" value={d.tags} onChange={(e) => setD({ ...d, tags: e.target.value })} placeholder="refund, billing" /></Field>
          )}
        </div>
        {error && <Callout tone="critical">{error}</Callout>}
      </div>
    </Dialog>
  );
}

function RuleTester({ brand, rules }: { brand: string; rules: RuleRow[] }) {
  const [s, setS] = useState({ channel: "email", subject: "", body: "", email: "" });
  const [res, setRes] = useState<{ matched: string[]; actions: { team: string | null; assignee: string | null; priority: string | null; tags: string[] }; analysis: { sentiment: string; intent: string; language: string } } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  return (
    <Card>
      <CardHeader title="Test rules" description="Paste a sample message to see what the active rules would do." />
      <CardBody className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-[160px_1fr_1fr]">
          <Field label="Channel" htmlFor="t-ch"><Select id="t-ch" value={s.channel} onChange={(e) => setS({ ...s, channel: e.target.value })}>{[...CHANNELS.map((c) => [c.kind, c.name]), ["phone", "Phone"]].map(([k, n]) => <option key={k} value={k}>{n}</option>)}</Select></Field>
          <Field label="Subject" htmlFor="t-su"><Input id="t-su" value={s.subject} onChange={(e) => setS({ ...s, subject: e.target.value })} /></Field>
          <Field label="Sender email" htmlFor="t-em"><Input id="t-em" value={s.email} onChange={(e) => setS({ ...s, email: e.target.value })} /></Field>
        </div>
        <Field label="Message" htmlFor="t-bo"><Textarea id="t-bo" rows={3} value={s.body} onChange={(e) => setS({ ...s, body: e.target.value })} placeholder="I want to cancel my subscription, the app keeps crashing." /></Field>
        <div className="flex items-center gap-3">
          <Button size="sm" onClick={async () => { setErr(null); const r = await testRulesAction(brand, rules.filter((x) => x.active), s); if (r.ok) setRes(r.data as never); else setErr(r.error); }} disabled={!s.subject && !s.body}><FlaskConical className="h-3.5 w-3.5" />Run test</Button>
          {err && <span className="text-[12.5px] text-critical-ink">{err}</span>}
        </div>
        {res && (
          <div className="rounded-md border border-border bg-surface-2 p-3 text-[12.5px]">
            <div className="text-text-2">Detected: sentiment <b className="text-text">{res.analysis.sentiment}</b> · intent <b className="text-text">{res.analysis.intent}</b> · language <b className="text-text">{res.analysis.language}</b></div>
            <div className="mt-1 text-text-2">Matched: {res.matched.length ? res.matched.map((id) => rules.find((r) => r.id === id)?.name).join(", ") : <span className="text-text-3">no rule</span>}</div>
            <div className="mt-1 text-text-2">Result: team <b className="text-text">{res.actions.team ?? "none"}</b> · priority <b className="text-text">{res.actions.priority ?? "default"}</b> · tags <b className="text-text">{res.actions.tags.join(", ") || "none"}</b></div>
          </div>
        )}
      </CardBody>
    </Card>
  );
}
