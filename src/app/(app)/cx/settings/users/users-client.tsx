"use client";

import { CheckCircle2, Clock, Copy, Pencil, Plus, RefreshCw, ShieldCheck, Trash2, Upload, UserMinus, Users } from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, MenuItem } from "@/components/ui/dialog";
import { Callout, EmptyState } from "@/components/ui/feedback";
import { Checkbox, Input, Select, Textarea } from "@/components/ui/input";
import type { UserGroup, UserRow } from "@/lib/cx/admin/users";
import { GearMenu, KAvatar, KButton, KDate, KSection } from "../_admin/k-ui";
import { Field, FileButton, useRun } from "../_admin/ui";
import { addExistingUsersAction, changeUserRoleAction, deleteUserGroupAction, inviteUserAction, removeUserAction, revokeInviteAction, saveUserGroupAction, uploadUsersAction } from "./actions";

type Role = "admin" | "supervisor" | "agent" | "viewer";
type Opt = { id: string; name: string };
type Candidate = { id: string; name: string; email: string; brands: string };
type Props = { brand: string; me: string; users: UserRow[]; groups: UserGroup[]; roles: Opt[]; teams: Opt[]; candidates: Candidate[]; canEdit: boolean };
const ROLES: { value: Role; label: string }[] = [
  { value: "admin", label: "Admin" },
  { value: "supervisor", label: "Supervisor" },
  { value: "agent", label: "Agent" },
  { value: "viewer", label: "Viewer" },
];
const roleLabel = (r: string) => (r === "owner" ? "Super Admin (owner)" : ROLES.find((x) => x.value === r)?.label ?? r);

function CopyLink({ value }: { value: string }) {
  const [done, setDone] = useState(false);
  return (
    <div className="flex items-center gap-2">
      <code className="min-w-0 flex-1 truncate rounded-md border border-border bg-surface-2 px-2.5 py-1.5 text-[12px] text-text">{value}</code>
      <Button size="sm" onClick={() => navigator.clipboard?.writeText(value).then(() => { setDone(true); setTimeout(() => setDone(false), 1500); }).catch(() => {})}><Copy className="h-3.5 w-3.5" />{done ? "Copied" : "Copy"}</Button>
    </div>
  );
}

function RoleFields({ role, setRole, custom, setCustom, roles }: { role: Role; setRole: (r: Role) => void; custom: string; setCustom: (v: string) => void; roles: Opt[] }) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <Field label="Role"><Select value={role} onChange={(e) => setRole(e.target.value as Role)}>{ROLES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}</Select></Field>
      <Field label="Custom role (optional)" hint={roles.length ? "Overrides the role's page and action permissions." : "Create custom roles under Role settings."}>
        <Select value={custom} onChange={(e) => setCustom(e.target.value)} disabled={!roles.length}><option value="">None</option>{roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</Select>
      </Field>
    </div>
  );
}

export function UsersClient({ brand, me, users, groups, roles, teams, candidates, canEdit }: Props) {
  const { run, busy, messages } = useRun();
  const [dlg, setDlg] = useState<null | "new" | "existing" | "upload" | { t: "role"; u: UserRow } | { t: "remove"; u: UserRow } | { t: "group"; g: UserGroup | null } | { t: "delgroup"; g: UserGroup }>(null);
  const members = users.filter((u) => u.userId);
  const nameOf = (id: string) => members.find((m) => m.userId === id)?.name ?? "Removed user";
  return (
    <div className="space-y-4">
      {messages}
      {!canEdit && <Callout tone="info">Your role can view users but not change them.</Callout>}
      <KSection
        title="Users"
        action={canEdit && (
          <>
            <KButton onClick={() => setDlg("upload")}><Upload className="h-3.5 w-3.5" />Upload users</KButton>
            <KButton onClick={() => setDlg("new")}><Plus className="h-3.5 w-3.5" />Add new user</KButton>
            <KButton variant="secondary" className="text-link" onClick={() => setDlg("existing")}>Add existing user</KButton>
          </>
        )}
      >
        <table className="hidden w-full table-fixed border-collapse text-left text-[13px] md:table">
          <thead>
            <tr className="border-b border-border text-[11.5px] font-semibold tracking-wide text-text uppercase">
              <th className="w-[28%] py-2 pr-3">Name</th><th className="w-[16%] py-2 pr-3">Role</th><th className="py-2 pr-3">Email</th><th className="w-[18%] py-2 pr-3">Created by</th><th className="w-12 py-2"><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className="border-b border-border last:border-0">
                <td className="py-2.5 pr-3"><div className="flex min-w-0 items-center gap-2.5"><KAvatar name={u.name} className="h-8 w-8" /><span className="truncate font-semibold text-text" title={u.name}>{u.name}{u.userId === me && <span className="ml-1 font-normal text-text-3">(you)</span>}</span></div></td>
                <td className="py-2.5 pr-3 text-text-2"><div>{roleLabel(u.role)}</div>{u.customRole && <div className="text-[11.5px] text-text-3">{u.customRole}</div>}</td>
                <td className="py-2.5 pr-3"><span className="inline-flex max-w-full items-center gap-1.5 text-text-2"><span className="truncate" title={u.email}>{u.email}</span>{u.verified ? <CheckCircle2 className="h-4 w-4 shrink-0 text-good-ink" aria-label="Account verified" /> : <Badge tone="warning"><Clock className="h-3 w-3" />Invite pending</Badge>}</span></td>
                <td className="py-2.5 pr-3 text-text-2"><div className="truncate">{u.createdBy ?? (u.owner ? "Brand owner" : "n/a")}</div><KDate iso={u.createdAt} /></td>
                <td className="py-2.5 text-right">{canEdit && !u.owner && <UserMenu u={u} me={me} onRole={() => setDlg({ t: "role", u })} onRemove={() => setDlg({ t: "remove", u })} onRevoke={() => run(`rv-${u.id}`, revokeInviteAction(brand, u.inviteId!), () => `Invite for ${u.email} revoked.`)} onResend={() => run(`rs-${u.id}`, inviteUserAction(brand, { email: u.email, role: u.role as Role, customRoleId: u.customRoleId }), (r) => (r.added ? `${u.email} added.` : r.emailed ? `New invite emailed to ${u.email}.` : `New invite link: ${r.link}`))} />}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <ul className="divide-y divide-border md:hidden">
          {users.map((u) => (
            <li key={u.id} className="flex items-start gap-2.5 py-2.5 text-[13px]">
              <KAvatar name={u.name} className="h-8 w-8" />
              <div className="min-w-0 flex-1">
                <div className="truncate font-semibold text-text">{u.name}</div>
                <div className="flex items-center gap-1 truncate text-text-2">{u.email}{u.verified ? <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-good-ink" aria-label="Account verified" /> : <Badge tone="warning">Pending</Badge>}</div>
                <div className="text-[12px] text-text-3">{roleLabel(u.role)}{u.customRole ? ` · ${u.customRole}` : ""} · <KDate iso={u.createdAt} time={false} /></div>
              </div>
              {canEdit && !u.owner && <UserMenu u={u} me={me} onRole={() => setDlg({ t: "role", u })} onRemove={() => setDlg({ t: "remove", u })} onRevoke={() => run(`rv-${u.id}`, revokeInviteAction(brand, u.inviteId!), () => `Invite for ${u.email} revoked.`)} onResend={() => run(`rs-${u.id}`, inviteUserAction(brand, { email: u.email, role: u.role as Role, customRoleId: u.customRoleId }), (r) => (r.added ? `${u.email} added.` : r.emailed ? `New invite emailed to ${u.email}.` : `New invite link: ${r.link}`))} />}
            </li>
          ))}
        </ul>
      </KSection>

      <KSection title="Users Group" action={canEdit && <KButton variant="secondary" className="text-link" onClick={() => setDlg({ t: "group", g: null })}><Plus className="h-3.5 w-3.5" />Add user group</KButton>}>
        {groups.length === 0 ? (
          <EmptyState icon={<Users className="h-5 w-5" />} title="Users Group" description="Named groups of users, for example “Admissions desk” or “Night shift”. Route a queue segment to a group under Admin → Queue & assignment → Segments." />
        ) : (
          <ul className="divide-y divide-border">
            {groups.map((g) => (
              <li key={g.id} className="flex flex-wrap items-start gap-3 py-3">
                <div className="min-w-0 flex-1">
                  <div className="text-[14px] font-semibold text-text">{g.name} <span className="text-[12px] font-normal text-text-3">{g.memberIds.length} member{g.memberIds.length === 1 ? "" : "s"}</span></div>
                  {g.description && <p className="text-[12.5px] text-text-2">{g.description}</p>}
                  <div className="mt-1.5 flex flex-wrap gap-1.5">{g.memberIds.map((id) => <span key={id} className="rounded bg-surface-3 px-1.5 py-0.5 text-[11.5px] font-semibold text-text-2">{nameOf(id)}</span>)}</div>
                </div>
                <div className="text-[12px] text-text-3">{g.creator ?? "n/a"} · <KDate iso={g.createdAt} /></div>
                {canEdit && (
                  <GearMenu label={`Actions for ${g.name}`}>
                    {(close) => (
                      <>
                        <MenuItem icon={<Pencil className="h-3.5 w-3.5" />} onClick={() => { close(); setDlg({ t: "group", g }); }}>Edit group</MenuItem>
                        <MenuItem danger icon={<Trash2 className="h-3.5 w-3.5" />} onClick={() => { close(); setDlg({ t: "delgroup", g }); }}>Delete group</MenuItem>
                      </>
                    )}
                  </GearMenu>
                )}
              </li>
            ))}
          </ul>
        )}
      </KSection>

      {dlg === "new" && <NewUserDialog brand={brand} roles={roles} teams={teams} onClose={() => setDlg(null)} />}
      {dlg === "existing" && <ExistingDialog brand={brand} roles={roles} candidates={candidates} onClose={() => setDlg(null)} />}
      {dlg === "upload" && <UploadDialog brand={brand} onClose={() => setDlg(null)} />}
      {dlg && typeof dlg === "object" && dlg.t === "role" && <RoleDialog brand={brand} u={dlg.u} roles={roles} onClose={() => setDlg(null)} />}
      {dlg && typeof dlg === "object" && dlg.t === "remove" && (
        <Dialog open onClose={() => setDlg(null)} size="sm" title="Remove user?" description="They lose access to this brand. Their past replies and notes stay."
          footer={<><Button onClick={() => setDlg(null)}>Cancel</Button><Button variant="danger" loading={busy === "rm"} onClick={async () => { await run("rm", removeUserAction(brand, dlg.u.userId!), () => `${dlg.u.email} removed.`); setDlg(null); }}>Remove</Button></>}>
          <p className="text-[13px] text-text-2">{dlg.u.name} ({dlg.u.email})</p>
        </Dialog>
      )}
      {dlg && typeof dlg === "object" && dlg.t === "group" && <GroupDialog brand={brand} g={dlg.g} members={members} onClose={() => setDlg(null)} />}
      {dlg && typeof dlg === "object" && dlg.t === "delgroup" && (
        <Dialog open onClose={() => setDlg(null)} size="sm" title="Delete user group?" description="Queue segments routed to it go back to any available agent."
          footer={<><Button onClick={() => setDlg(null)}>Cancel</Button><Button variant="danger" loading={busy === "dg"} onClick={async () => { await run("dg", deleteUserGroupAction(brand, dlg.g.id), () => `${dlg.g.name} deleted.`); setDlg(null); }}>Delete</Button></>}>
          <p className="text-[13px] text-text-2">{dlg.g.name}</p>
        </Dialog>
      )}
    </div>
  );
}

function UserMenu({ u, me, onRole, onRemove, onRevoke, onResend }: { u: UserRow; me: string; onRole: () => void; onRemove: () => void; onRevoke: () => void; onResend: () => void }) {
  return (
    <GearMenu label={`Actions for ${u.email}`}>
      {(close) =>
        u.inviteId ? (
          <>
            <MenuItem icon={<RefreshCw className="h-3.5 w-3.5" />} onClick={() => { close(); onResend(); }}>Resend invite</MenuItem>
            <MenuItem danger icon={<Trash2 className="h-3.5 w-3.5" />} onClick={() => { close(); onRevoke(); }}>Revoke invite</MenuItem>
          </>
        ) : (
          <>
            <MenuItem icon={<ShieldCheck className="h-3.5 w-3.5" />} onClick={() => { close(); onRole(); }}>Change role</MenuItem>
            {u.userId !== me && <MenuItem danger icon={<UserMinus className="h-3.5 w-3.5" />} onClick={() => { close(); onRemove(); }}>Remove</MenuItem>}
          </>
        )
      }
    </GearMenu>
  );
}

function NewUserDialog({ brand, roles, teams, onClose }: { brand: string; roles: Opt[]; teams: Opt[]; onClose: () => void }) {
  const { run, busy, messages } = useRun();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("agent");
  const [custom, setCustom] = useState("");
  const [team, setTeam] = useState("");
  const [link, setLink] = useState<{ url: string; emailed: boolean; err: string | null } | null>(null);
  return (
    <Dialog open onClose={onClose} title="Add new user" description="People who already have an account are added right away. Everyone else gets an invite link (valid 14 days) to create an account with this email and join."
      footer={link ? <Button variant="primary" onClick={onClose}>Done</Button> : <><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy === "inv"} onClick={async () => { const r = await run("inv", inviteUserAction(brand, { email, role, customRoleId: custom || null, teamId: team || null }), (d) => (d.added ? `${email} added to the brand.` : undefined)); if (r?.added) onClose(); else if (r?.link) setLink({ url: r.link, emailed: r.emailed, err: r.emailError }); }}>Add user</Button></>}>
      <div className="space-y-3">
        {messages}
        {link ? (
          <>
            <Callout tone={link.emailed ? "good" : "info"} title={link.emailed ? "Invite emailed" : "Share this invite link"}>{link.emailed ? `We emailed the link to ${email}. You can also share it yourself:` : `${link.err ?? "No email channel is connected."} Send this link to ${email}:`}</Callout>
            <CopyLink value={link.url} />
          </>
        ) : (
          <>
            <Field label="Email"><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@company.com" autoComplete="off" /></Field>
            <RoleFields role={role} setRole={setRole} custom={custom} setCustom={setCustom} roles={roles} />
            <Field label="Team (optional)"><Select value={team} onChange={(e) => setTeam(e.target.value)}><option value="">No team</option>{teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</Select></Field>
          </>
        )}
      </div>
    </Dialog>
  );
}

function ExistingDialog({ brand, roles, candidates, onClose }: { brand: string; roles: Opt[]; candidates: Candidate[]; onClose: () => void }) {
  const { run, busy, messages } = useRun();
  const [pick, setPick] = useState<string[]>([]);
  const [q, setQ] = useState("");
  const [role, setRole] = useState<Role>("agent");
  const [custom, setCustom] = useState("");
  const shown = candidates.filter((c) => !q || `${c.name} ${c.email} ${c.brands}`.toLowerCase().includes(q.toLowerCase()));
  return (
    <Dialog open onClose={onClose} size="lg" title="Add existing user" description="People who already work on your other brands."
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={!pick.length} loading={busy === "ex"} onClick={async () => { const n = await run("ex", addExistingUsersAction(brand, pick, role, custom || null), (d) => `${d} user${d === 1 ? "" : "s"} added.`); if (n) onClose(); }}>Add {pick.length || ""}</Button></>}>
      <div className="space-y-3">
        {messages}
        {candidates.length === 0 ? (
          <EmptyState title="Nobody to add yet" description="This lists members of the other brands you own or administer. Use Add new user to invite someone by email." />
        ) : (
          <>
            <Input aria-label="Search people" placeholder="Search people…" value={q} onChange={(e) => setQ(e.target.value)} />
            <ul className="scroll-thin max-h-64 divide-y divide-border overflow-y-auto rounded-md border border-border">
              {shown.map((c) => (
                <li key={c.id}>
                  <label className="flex cursor-pointer items-center gap-2.5 px-3 py-2 text-[13px]">
                    <Checkbox checked={pick.includes(c.id)} onChange={(e) => setPick((p) => (e.target.checked ? [...p, c.id] : p.filter((x) => x !== c.id)))} />
                    <span className="min-w-0 flex-1"><span className="block truncate font-semibold text-text">{c.name || c.email}</span><span className="block truncate text-[12px] text-text-3">{c.email} · {c.brands}</span></span>
                  </label>
                </li>
              ))}
            </ul>
            <RoleFields role={role} setRole={setRole} custom={custom} setCustom={setCustom} roles={roles} />
          </>
        )}
      </div>
    </Dialog>
  );
}

const TEMPLATE = "email,role,team\nagent.one@example.com,agent,Support\nlead@example.com,supervisor,\n";
function UploadDialog({ brand, onClose }: { brand: string; onClose: () => void }) {
  const { run, busy, messages } = useRun();
  const [csv, setCsv] = useState("");
  const [result, setResult] = useState<{ added: number; invited: number; skipped: string[]; errors: string[] } | null>(null);
  return (
    <Dialog open onClose={onClose} size="lg" title="Upload users" description="CSV with columns email, role (admin, supervisor, agent, viewer or a custom role name) and team (created when missing). Accounts are added; other emails get invites."
      footer={result ? <Button variant="primary" onClick={onClose}>Done</Button> : <><Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={!csv.trim()} loading={busy === "up"} onClick={async () => { const r = await run("up", uploadUsersAction(brand, csv)); if (r) setResult(r); }}>Upload</Button></>}>
      <div className="space-y-3">
        {messages}
        {result ? (
          <>
            <Callout tone="good" title="Upload finished">{result.added} added · {result.invited} invited{result.skipped.length ? ` · ${result.skipped.length} skipped` : ""}</Callout>
            {[...result.errors, ...result.skipped].length > 0 && <ul className="list-disc space-y-0.5 pl-5 text-[12.5px] text-text-2">{[...result.errors, ...result.skipped].slice(0, 20).map((e) => <li key={e}>{e}</li>)}</ul>}
            <p className="text-[12.5px] text-text-3">Invitees appear in the table as “Invite pending”. Use Resend invite from the gear menu to get a link to share.</p>
          </>
        ) : (
          <>
            <div className="flex flex-wrap gap-2">
              <FileButton label={<><Upload className="h-3.5 w-3.5" />Choose CSV file</>} onText={setCsv} />
              <Button size="sm" variant="ghost" onClick={() => setCsv(TEMPLATE)}>Use template</Button>
            </div>
            <Textarea aria-label="CSV" rows={8} value={csv} onChange={(e) => setCsv(e.target.value)} placeholder={TEMPLATE} className="font-mono text-[12px]" />
          </>
        )}
      </div>
    </Dialog>
  );
}

function RoleDialog({ brand, u, roles, onClose }: { brand: string; u: UserRow; roles: Opt[]; onClose: () => void }) {
  const { run, busy, messages } = useRun();
  const [role, setRole] = useState<Role>((u.role === "owner" ? "admin" : u.role) as Role);
  const [custom, setCustom] = useState(u.customRoleId ?? "");
  return (
    <Dialog open onClose={onClose} title={`Change role: ${u.name}`}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy === "role"} onClick={async () => { await run("role", changeUserRoleAction(brand, u.userId!, role, custom || null), () => "Role updated."); onClose(); }}>Save</Button></>}>
      <div className="space-y-3">{messages}<RoleFields role={role} setRole={setRole} custom={custom} setCustom={setCustom} roles={roles} /></div>
    </Dialog>
  );
}

function GroupDialog({ brand, g, members, onClose }: { brand: string; g: UserGroup | null; members: UserRow[]; onClose: () => void }) {
  const { run, busy, messages } = useRun();
  const [name, setName] = useState(g?.name ?? "");
  const [description, setDescription] = useState(g?.description ?? "");
  const [ids, setIds] = useState<string[]>(g?.memberIds ?? []);
  return (
    <Dialog open onClose={onClose} title={g ? "Edit user group" : "Add user group"}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy === "grp"} onClick={async () => { const r = await run("grp", saveUserGroupAction(brand, { id: g?.id, name, description, memberIds: ids }), () => (g ? "Group updated." : "Group created.")); if (r) onClose(); }}>Save</Button></>}>
      <div className="space-y-3">
        {messages}
        <Field label="Name"><Input value={name} maxLength={60} onChange={(e) => setName(e.target.value)} placeholder="e.g. Admissions desk" /></Field>
        <Field label="Description (optional)"><Input value={description} maxLength={300} onChange={(e) => setDescription(e.target.value)} /></Field>
        <div>
          <div className="mb-1 text-[12.5px] font-medium text-text">Members</div>
          <ul className="scroll-thin max-h-56 divide-y divide-border overflow-y-auto rounded-md border border-border">
            {members.map((m) => (
              <li key={m.userId}>
                <label className="flex cursor-pointer items-center gap-2.5 px-3 py-2 text-[13px]">
                  <Checkbox checked={ids.includes(m.userId!)} onChange={(e) => setIds((x) => (e.target.checked ? [...x, m.userId!] : x.filter((y) => y !== m.userId)))} />
                  <span className="min-w-0 flex-1 truncate"><span className="font-semibold text-text">{m.name}</span> <span className="text-text-3">{m.email}</span></span>
                </label>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </Dialog>
  );
}
