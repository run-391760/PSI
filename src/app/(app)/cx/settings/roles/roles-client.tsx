"use client";

import { Download, Pencil, Plus, ShieldCheck, Trash2, Upload } from "lucide-react";
import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Callout, EmptyState } from "@/components/ui/feedback";
import { Input, Select, Textarea } from "@/components/ui/input";
import { MiniTable } from "@/components/ui/mini-table";
import type { AuditRow } from "@/lib/cx/admin/audit";
import { ACTION_PERMS, BUILT_IN, PAGE_PERMS } from "@/lib/cx/admin/pure/permissions";
import { csvLine } from "@/lib/cx/admin/pure/fields";
import type { CustomRole } from "@/lib/cx/admin/roles";
import { CheckRow, Field, FileButton, When, downloadText, useRun } from "../_admin/ui";
import { assignRoleAction, deleteRoleAction, importUsersAction, saveRoleAction, saveSecurityAction } from "./actions";

type RoleEdit = { id?: string; name: string; description: string; pages: string[]; actions: string[] };
const BASES = ["supervisor", "agent", "viewer"] as const;

export function RolesPanel({ brand, roles }: { brand: string; roles: CustomRole[] }) {
  const { run, busy, messages } = useRun();
  const [edit, setEdit] = useState<RoleEdit | null>(null);
  const groups = useMemo(() => [...new Set(ACTION_PERMS.map((a) => a.group))], []);
  const toggle = (list: string[], k: string, on: boolean) => (on ? [...new Set([...list, k])] : list.filter((x) => x !== k));
  return (
    <Card>
      <CardHeader title="Custom roles" description="A custom role replaces the built-in role's permissions for the members it's given to. Owners always keep full access."
        actions={<Button size="sm" variant="primary" onClick={() => setEdit({ name: "", description: "", pages: [...BUILT_IN.agent.pages], actions: [...BUILT_IN.agent.actions] })}><Plus className="h-3.5 w-3.5" />New role</Button>} />
      <CardBody>
        {messages}
        {roles.length ? (
          <ul className="divide-y divide-border">
            {roles.map((r) => (
              <li key={r.id} className="flex items-start gap-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <div className="text-[13px] font-medium text-text">{r.name} <Badge className="ml-1">{r.members} members</Badge></div>
                  {r.description && <p className="text-[12px] text-text-2">{r.description}</p>}
                  <p className="text-[12px] text-text-3">{r.pages.length} pages · {r.actions.length} actions</p>
                </div>
                <Button size="icon" variant="ghost" className="h-7 w-7" aria-label={`Edit ${r.name}`} onClick={() => setEdit({ id: r.id, name: r.name, description: r.description, pages: r.pages, actions: r.actions })}><Pencil className="h-3.5 w-3.5" /></Button>
                <Button size="icon" variant="ghost" className="h-7 w-7" aria-label={`Delete ${r.name}`} onClick={() => confirm(`Delete "${r.name}"? Its members fall back to their built-in role.`) && run("d", deleteRoleAction(brand, r.id))}><Trash2 className="h-3.5 w-3.5" /></Button>
              </li>
            ))}
          </ul>
        ) : <EmptyState icon={<ShieldCheck className="h-5 w-5" />} title="Only built-in roles" description="Admin, Supervisor, Agent and Viewer cover most teams. Create a custom role to fine-tune which pages and actions a group can use." />}
      </CardBody>
      <Dialog size="xl" open={!!edit} onClose={() => setEdit(null)} title={edit?.id ? `Edit ${edit.name}` : "New role"}
        footer={<><Button onClick={() => setEdit(null)}>Cancel</Button><Button variant="primary" loading={busy === "save"} onClick={async () => { if (edit && (await run("save", saveRoleAction(brand, edit)))) setEdit(null); }}>Save role</Button></>}>
        {edit && (
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Name"><Input autoFocus value={edit.name} maxLength={60} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></Field>
              <Field label="Start from">
                <Select value="" onChange={(e) => { const b = BUILT_IN[e.target.value as (typeof BASES)[number]]; if (b) setEdit({ ...edit, pages: [...b.pages], actions: [...b.actions] }); }}>
                  <option value="">Copy a built-in role…</option>{BASES.map((b) => <option key={b} value={b}>{b[0].toUpperCase() + b.slice(1)}</option>)}
                </Select>
              </Field>
              <Field label="Description" className="sm:col-span-2"><Textarea className="min-h-14" value={edit.description} maxLength={300} onChange={(e) => setEdit({ ...edit, description: e.target.value })} /></Field>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <fieldset>
                <legend className="mb-1.5 text-[12.5px] font-semibold text-text">Pages</legend>
                <div className="space-y-1.5">{PAGE_PERMS.map((p) => <CheckRow key={p.key} checked={edit.pages.includes(p.key)} onChange={(v) => setEdit({ ...edit, pages: toggle(edit.pages, p.key, v) })} label={p.label} />)}</div>
              </fieldset>
              <div className="space-y-3">
                {groups.map((g) => (
                  <fieldset key={g}>
                    <legend className="mb-1.5 text-[12.5px] font-semibold text-text">{g}</legend>
                    <div className="space-y-1.5">{ACTION_PERMS.filter((a) => a.group === g).map((a) => <CheckRow key={a.key} checked={edit.actions.includes(a.key)} onChange={(v) => setEdit({ ...edit, actions: toggle(edit.actions, a.key, v) })} label={a.label} />)}</div>
                  </fieldset>
                ))}
              </div>
            </div>
          </div>
        )}
      </Dialog>
    </Card>
  );
}

type Member = { user_id: string; name: string; email: string; role: string; team_name: string | null; owner: boolean };
export function MembersPanel({ brand, members, roles, assigned }: { brand: string; members: Member[]; roles: CustomRole[]; assigned: Record<string, string> }) {
  const { run, messages } = useRun();
  const [report, setReport] = useState<{ added: number; skipped: string[]; errors: string[] } | null>(null);
  const template = [csvLine(["Email", "Role", "Team"]), csvLine(["priya@example.com", "agent", "Tier 1"]), csvLine(["arjun@example.com", "supervisor", ""])].join("\n");
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader title="Members and roles" description="Give members a custom role on top of their built-in role. Built-in roles and teams are managed under Team & SLAs." />
        <CardBody>
          {messages}
          <MiniTable
            columns={[{ header: "Member" }, { header: "Built-in role" }, { header: "Team" }, { header: "Custom role" }]}
            rows={members.map((m) => [
              <div key="n" className="min-w-36"><div className="font-medium text-text">{m.name}</div><div className="text-[12px] text-text-3">{m.email}</div></div>,
              <Badge key="r" tone={m.owner ? "brand" : "neutral"}>{m.owner ? "owner" : m.role}</Badge>,
              m.team_name ?? <span key="t" className="text-text-3">n/a</span>,
              m.owner ? <span key="c" className="text-[12px] text-text-3">Full access</span> : (
                <Select key="c" aria-label={`Custom role for ${m.name}`} className="h-7 w-44 text-[12.5px]" value={assigned[m.user_id] ?? ""} onChange={(e) => run("a", assignRoleAction(brand, m.user_id, e.target.value || null))}>
                  <option value="">None (built-in)</option>{roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                </Select>
              ),
            ])}
          />
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Bulk import" description="Upload a sheet with Email, Role and Team columns. Role can be admin, supervisor, agent, viewer or a custom role's name; missing teams are created. People need a SynapseSEO account first." />
        <CardBody className="flex flex-wrap gap-2">
          <Button size="sm" onClick={() => downloadText("members-template.csv", template)}><Download className="h-3.5 w-3.5" />Template</Button>
          <FileButton label={<><Upload className="h-3.5 w-3.5" />Import sheet</>} onText={async (t) => { const r = await run("imp", importUsersAction(brand, t)); if (r) setReport(r); }} />
        </CardBody>
        {report && (
          <CardBody>
            <Callout tone={report.skipped.length || report.errors.length ? "warning" : "good"} title={`${report.added} members added or updated`}>
              {[...report.errors, ...report.skipped].slice(0, 12).map((e) => <div key={e}>{e}</div>)}
            </Callout>
          </CardBody>
        )}
      </Card>
    </div>
  );
}

export function SecurityPanel({ brand, settings }: { brand: string; settings: { piiMask: boolean; allowedDomains: string[]; statusRequiredWithReply: boolean } }) {
  const { run, busy, messages } = useRun();
  const [s, setS] = useState(settings);
  const [domains, setDomains] = useState(settings.allowedDomains.join("\n"));
  return (
    <Card>
      <CardHeader title="Security and privacy" />
      <CardBody className="space-y-4">
        {messages}
        <CheckRow checked={s.piiMask} onChange={(v) => setS({ ...s, piiMask: v })} label="Mask customer email addresses and phone numbers"
          hint="Members without “See unmasked email / phone” see j•••@gmail.com. Those with “Reveal masked data” can reveal one contact at a time; every reveal is written to the audit log." />
        <CheckRow checked={s.statusRequiredWithReply} onChange={(v) => setS({ ...s, statusRequiredWithReply: v })} label="Require a status with every reply" hint="Agents must pick the ticket's next status when they send a reply." />
        <Field label="Allowed email domains" hint="Escalations, forwards and new emails can only go to these domains, one per line. Leave empty to allow any domain.">
          <Textarea value={domains} onChange={(e) => setDomains(e.target.value)} placeholder={"yourcompany.com\npartner.com"} className="min-h-24 font-mono text-[12.5px]" />
        </Field>
        <div className="flex justify-end">
          <Button variant="primary" loading={busy === "save"} onClick={() => run("save", saveSecurityAction(brand, { ...s, allowedDomains: domains.split(/[\s,]+/).filter(Boolean) }), () => "Security settings saved.")}>Save</Button>
        </div>
      </CardBody>
    </Card>
  );
}

export function AuditPanel({ rows, members }: { rows: AuditRow[]; members: { user_id: string; name: string }[] }) {
  const [action, setAction] = useState("");
  const [actor, setActor] = useState("");
  const [q, setQ] = useState("");
  const kinds = useMemo(() => [...new Set(rows.map((r) => r.action.split(".")[0]))].sort(), [rows]);
  const shown = rows.filter((r) => (!action || r.action.startsWith(action)) && (!actor || r.actor_id === actor) && (!q || `${r.target} ${r.detail} ${r.actor_name}`.toLowerCase().includes(q.toLowerCase())));
  return (
    <Card>
      <CardHeader title="Audit log" description="Admin changes, imports, queue actions and data reveals, newest first (last 500)."
        actions={<Button size="sm" onClick={() => downloadText("audit-log.csv", [csvLine(["Time", "Who", "Action", "Target", "Detail"]), ...shown.map((r) => csvLine([r.created_at, r.actor_name, r.action, r.target, r.detail]))].join("\n"))}><Download className="h-3.5 w-3.5" />Export</Button>} />
      <CardBody>
        <div className="mb-3 flex flex-wrap gap-2">
          <Select aria-label="Action" className="h-7.5 w-40" value={action} onChange={(e) => setAction(e.target.value)}><option value="">All actions</option>{kinds.map((k) => <option key={k} value={k}>{k}</option>)}</Select>
          <Select aria-label="Who" className="h-7.5 w-44" value={actor} onChange={(e) => setActor(e.target.value)}><option value="">Anyone</option>{members.map((m) => <option key={m.user_id} value={m.user_id}>{m.name}</option>)}</Select>
          <Input aria-label="Search" className="h-7.5 min-w-0 flex-1 sm:max-w-60" placeholder="Search" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <MiniTable
          columns={[{ header: "When" }, { header: "Who" }, { header: "Action" }, { header: "Details" }]}
          empty="Nothing logged yet."
          rows={shown.slice(0, 300).map((r) => [
            <span key="w" className="whitespace-nowrap text-[12px] text-text-2"><When iso={r.created_at} /></span>,
            <span key="a" className="whitespace-nowrap">{r.actor_name}</span>,
            <code key="c" className="text-[12px]">{r.action}</code>,
            <div key="d" className="min-w-48 text-[12.5px]">{r.target}{r.detail && <div className="line-clamp-2 text-[12px] whitespace-pre-line text-text-3">{r.detail}</div>}</div>,
          ])}
        />
      </CardBody>
    </Card>
  );
}
