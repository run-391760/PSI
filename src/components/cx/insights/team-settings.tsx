"use client";

import { Plus, Trash2, UserPlus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { deleteTeamAction, inviteMemberAction, removeMemberAction, saveHoursAction, saveSlaAction, saveTeamAction, updateMemberAction } from "@/app/(app)/cx/settings/team/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/ui/confirm";
import { Card, CardBody, CardFooter, CardHeader } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Callout, EmptyState } from "@/components/ui/feedback";
import { Checkbox, Field, Input, Select, Textarea } from "@/components/ui/input";
import { dateLabel } from "@/lib/format";
import type { DayHours, Holiday } from "@/lib/cx/insights/metrics";
import type { Member, Role, SlaPolicy, Team } from "@/lib/cx/insights/team";

const ROLE_OPTS: { value: Role; label: string; description: string }[] = [
  { value: "admin", label: "Admin", description: "Manage settings, team and all data" },
  { value: "supervisor", label: "Supervisor", description: "Assign tickets, review quality, see reports" },
  { value: "agent", label: "Agent", description: "Handle assigned conversations" },
  { value: "viewer", label: "Viewer", description: "Read-only access to reports" },
];
const ROLE_TONE: Record<Role, "brand" | "info" | "good" | "neutral"> = { admin: "brand", supervisor: "info", agent: "good", viewer: "neutral" };
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

type Res = { ok: true } | { ok: false; error: string };
function useRun() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const run = (fn: () => Promise<Res>, after?: () => void) =>
    start(async () => {
      setError(null);
      const r = await fn();
      if (!r.ok) setError(r.error);
      else {
        after?.();
        router.refresh();
      }
    });
  return { pending, error, run, setError };
}

export function MembersPanel({ brand, members, teams }: { brand: string; members: Member[]; teams: Team[] }) {
  const { pending, error, run, setError } = useRun();
  const { confirm, confirmDialog } = useConfirm();
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("agent");
  const [team, setTeam] = useState("");
  return (
    <Card>
      <CardHeader
        title={`Members (${members.length})`}
        description="Invite existing SynapseSEO users by email and give them a role. Agents can be assigned tickets and appear in reports."
        actions={
          <Button variant="primary" size="sm" onClick={() => { setError(null); setOpen(true); }}>
            <UserPlus className="h-3.5 w-3.5" /> Invite
          </Button>
        }
      />
      <CardBody className="pt-1">
        {error && !open && <Callout tone="critical" className="mb-3">{error}</Callout>}
        <div className="scroll-thin overflow-x-auto">
          <table className="w-full min-w-[560px] text-[13px]">
            <thead>
              <tr className="border-b border-border text-left text-[11.5px] text-text-3">
                <th className="py-1.5 font-medium">Member</th>
                <th className="py-1.5 font-medium">Role</th>
                <th className="py-1.5 font-medium">Team</th>
                <th className="py-1.5 font-medium">Since</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {members.map((m) => (
                <tr key={m.id} className="border-b border-border last:border-0">
                  <td className="py-2 pr-3">
                    <div className="font-medium text-text">{m.name || m.email}</div>
                    <div className="text-[12px] text-text-3">{m.email}</div>
                  </td>
                  <td className="py-2 pr-3">
                    {m.owner ? (
                      <Badge tone="brand">Owner · Admin</Badge>
                    ) : (
                      <Select aria-label="Role" value={m.role} disabled={pending} onChange={(e) => run(() => updateMemberAction(brand, m.user_id, { role: e.target.value as Role }))} className="h-7 w-32">
                        {ROLE_OPTS.map((r) => (
                          <option key={r.value} value={r.value}>{r.label}</option>
                        ))}
                      </Select>
                    )}
                  </td>
                  <td className="py-2 pr-3">
                    <Select aria-label="Team" value={m.team_id ?? ""} disabled={pending} onChange={(e) => run(() => updateMemberAction(brand, m.user_id, { teamId: e.target.value || null }))} className="h-7 w-36">
                      <option value="">No team</option>
                      {teams.map((t) => (
                        <option key={t.id} value={t.id}>{t.name}</option>
                      ))}
                    </Select>
                  </td>
                  <td className="py-2 pr-3 text-text-2">{dateLabel(m.created_at)}</td>
                  <td className="py-2 text-right">
                    {!m.owner && (
                      <Button variant="ghost" size="icon" aria-label={`Remove ${m.email}`} disabled={pending} onClick={async () => (await confirm({ title: `Remove ${m.email} from this brand?`, description: "They lose access to this brand's CX workspace.", confirmLabel: "Remove" })) && run(() => removeMemberAction(brand, m.user_id))}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardBody>
      <CardFooter>
        <div className="grid gap-1 text-[12px] text-text-3 sm:grid-cols-2">
          {ROLE_OPTS.map((r) => (
            <div key={r.value}>
              <Badge tone={ROLE_TONE[r.value]}>{r.label}</Badge> {r.description}
            </div>
          ))}
        </div>
      </CardFooter>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="Invite a team member"
        description="They need a SynapseSEO account already; invitations use the email they signed up with."
        error={error}
        onSubmit={() => email.trim() && !pending && run(() => inviteMemberAction(brand, email, role, team || null), () => { setOpen(false); setEmail(""); })}
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" variant="primary" loading={pending} disabled={pending || !email.trim()}>
              Invite
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <Field label="Email" htmlFor="invite-email">
            <Input id="invite-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="agent@company.com" autoFocus />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Role" htmlFor="invite-role" hint={ROLE_OPTS.find((r) => r.value === role)?.description}>
              <Select id="invite-role" value={role} onChange={(e) => setRole(e.target.value as Role)}>
                {ROLE_OPTS.map((r) => (
                  <option key={r.value} value={r.value}>{r.label}</option>
                ))}
              </Select>
            </Field>
            <Field label="Team" htmlFor="invite-team">
              <Select id="invite-team" value={team} onChange={(e) => setTeam(e.target.value)}>
                <option value="">No team</option>
                {teams.map((t) => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </Select>
            </Field>
          </div>
        </div>
      </Dialog>
      {confirmDialog}
    </Card>
  );
}

export function TeamsPanel({ brand, teams }: { brand: string; teams: Team[] }) {
  const { pending, error, run, setError } = useRun();
  const { confirm, confirmDialog } = useConfirm();
  const [edit, setEdit] = useState<{ id?: string; name: string; description: string } | null>(null);
  return (
    <Card>
      <CardHeader
        title={`Teams (${teams.length})`}
        description="Group agents (e.g. Billing, Tier 2, Social). Tickets can be routed to a team."
        actions={
          <Button variant="primary" size="sm" onClick={() => { setError(null); setEdit({ name: "", description: "" }); }}>
            <Plus className="h-3.5 w-3.5" /> New team
          </Button>
        }
      />
      <CardBody className="pt-1">
        {error && !edit && <Callout tone="critical" className="mb-3">{error}</Callout>}
        {teams.length === 0 ? (
          <EmptyState title="No teams yet" description="Create teams to organize agents and route conversations." />
        ) : (
          <div className="divide-y divide-border">
            {teams.map((t) => (
              <div key={t.id} className="flex items-center justify-between gap-3 py-2.5">
                <div className="min-w-0">
                  <div className="font-medium text-text">{t.name}</div>
                  <div className="truncate text-[12px] text-text-3">{t.description || "No description"} · {t.members} member{t.members === 1 ? "" : "s"}</div>
                </div>
                <div className="flex shrink-0 gap-1">
                  <Button size="sm" onClick={() => { setError(null); setEdit({ id: t.id, name: t.name, description: t.description }); }}>Edit</Button>
                  <Button variant="ghost" size="icon" aria-label={`Delete ${t.name}`} disabled={pending} onClick={async () => (await confirm({ title: `Delete the team “${t.name}”?`, description: "Its members stay in the brand." })) && run(() => deleteTeamAction(brand, t.id))}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardBody>
      <Dialog
        open={!!edit}
        onClose={() => setEdit(null)}
        title={edit?.id ? "Edit team" : "New team"}
        size="sm"
        error={error}
        onSubmit={() => edit && !pending && run(() => saveTeamAction(brand, edit), () => setEdit(null))}
        footer={
          <>
            <Button variant="ghost" onClick={() => setEdit(null)}>Cancel</Button>
            <Button type="submit" variant="primary" loading={pending}>Save</Button>
          </>
        }
      >
        {edit && (
          <div className="space-y-3">
            <Field label="Name" htmlFor="team-name">
              <Input id="team-name" value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} autoFocus />
            </Field>
            <Field label="Description" htmlFor="team-desc">
              <Textarea id="team-desc" rows={3} value={edit.description} onChange={(e) => setEdit({ ...edit, description: e.target.value })} />
            </Field>
          </div>
        )}
      </Dialog>
      {confirmDialog}
    </Card>
  );
}

const TIMEZONES = (() => {
  try {
    return (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.("timeZone") ?? ["UTC"];
  } catch {
    return ["UTC"];
  }
})();

export function HoursPanel({ brand, timezone, hours, holidays }: { brand: string; timezone: string; hours: DayHours[]; holidays: Holiday[] }) {
  const { pending, error, run } = useRun();
  const [tz, setTz] = useState(timezone);
  const [h, setH] = useState(hours);
  const [hol, setHol] = useState(holidays);
  const [saved, setSaved] = useState(false);
  const set = (i: number, patch: Partial<DayHours>) => setH(h.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const order = [1, 2, 3, 4, 5, 6, 0];
  return (
    <Card>
      <CardHeader title="Business hours & holidays" description="SLA policies that use business hours only count time inside these hours, skipping holidays." />
      <CardBody className="space-y-4 pt-1">
        {error && <Callout tone="critical">{error}</Callout>}
        {saved && !error && <Callout tone="good">Business hours saved.</Callout>}
        <Field label="Timezone" htmlFor="bh-tz" className="max-w-xs">
          <Select id="bh-tz" value={tz} onChange={(e) => setTz(e.target.value)}>
            {(TIMEZONES.includes(tz) ? TIMEZONES : [tz, ...TIMEZONES]).map((z) => (
              <option key={z} value={z}>{z}</option>
            ))}
          </Select>
        </Field>
        <div className="divide-y divide-border rounded-md border border-border">
          {order.map((d) => {
            const i = h.findIndex((x) => x.day === d);
            const x = h[i];
            return (
              <div key={d} className="flex flex-wrap items-center gap-3 px-3 py-2">
                <label className="flex w-32 items-center gap-2 text-[13px] font-medium text-text">
                  <Checkbox checked={x.open} onChange={(e) => set(i, { open: e.target.checked })} /> {DAYS[d]}
                </label>
                {x.open ? (
                  <div className="flex items-center gap-2 text-[13px] text-text-2">
                    <Input type="time" aria-label={`${DAYS[d]} opens`} value={x.start} onChange={(e) => set(i, { start: e.target.value })} className="h-8 w-28" />
                    to
                    <Input type="time" aria-label={`${DAYS[d]} closes`} value={x.end} onChange={(e) => set(i, { end: e.target.value })} className="h-8 w-28" />
                  </div>
                ) : (
                  <span className="text-[13px] text-text-3">Closed</span>
                )}
              </div>
            );
          })}
        </div>
        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <div className="text-[13px] font-semibold text-text">Holidays</div>
            <Button size="sm" onClick={() => setHol([...hol, { date: new Date().toISOString().slice(0, 10), name: "" }])}>
              <Plus className="h-3.5 w-3.5" /> Add holiday
            </Button>
          </div>
          {hol.length === 0 ? (
            <p className="text-[13px] text-text-3">No holidays. SLA clocks run on every open day.</p>
          ) : (
            <div className="space-y-2">
              {hol.map((x, i) => (
                <div key={i} className="flex flex-wrap items-center gap-2">
                  <Input type="date" aria-label="Holiday date" value={x.date} onChange={(e) => setHol(hol.map((y, j) => (j === i ? { ...y, date: e.target.value } : y)))} className="h-8 w-40" />
                  <Input aria-label="Holiday name" placeholder="Name (e.g. New Year)" value={x.name} onChange={(e) => setHol(hol.map((y, j) => (j === i ? { ...y, name: e.target.value } : y)))} className="h-8 min-w-0 flex-1" />
                  <Button variant="ghost" size="icon" aria-label="Remove holiday" onClick={() => setHol(hol.filter((_, j) => j !== i))}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>
      </CardBody>
      <CardFooter className="flex justify-end">
        <Button variant="primary" loading={pending} onClick={() => { setSaved(false); run(() => saveHoursAction(brand, { timezone: tz, hours: h, holidays: hol }), () => setSaved(true)); }}>
          Save hours
        </Button>
      </CardFooter>
    </Card>
  );
}

const PRIOS = [
  { value: "urgent", label: "Urgent", tone: "critical" },
  { value: "high", label: "High", tone: "serious" },
  { value: "normal", label: "Normal", tone: "info" },
  { value: "low", label: "Low", tone: "neutral" },
] as const;
const UNITS = [
  { value: 1, label: "minutes" },
  { value: 60, label: "hours" },
  { value: 1440, label: "days" },
];
const split = (m: number | null) => {
  if (m == null) return { n: "", u: 60 };
  const u = m % 1440 === 0 ? 1440 : m % 60 === 0 ? 60 : 1;
  return { n: String(m / u), u };
};

export function SlaPanel({ brand, policies, stats }: { brand: string; policies: SlaPolicy[]; stats: Record<string, { rate: number | null; met: number; breached: number; pending: number }> }) {
  const { pending, error, run } = useRun();
  const [saved, setSaved] = useState(false);
  const [rows, setRows] = useState(() =>
    PRIOS.map((p) => {
      const x = policies.find((y) => y.priority === p.value);
      return { priority: p.value, fr: split(x?.first_response_minutes ?? null), rs: split(x?.resolution_minutes ?? null), bh: x?.business_hours ?? true };
    }),
  );
  const toMin = (x: { n: string; u: number }) => (x.n.trim() === "" ? null : Math.round(Number(x.n) * x.u));
  const upd = (i: number, patch: Partial<(typeof rows)[number]>) => setRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const target = (i: number, key: "fr" | "rs") => (
    <div className="flex items-center gap-1.5">
      <Input type="number" min={1} step="any" aria-label={`${key === "fr" ? "First response" : "Resolution"} target`} placeholder="None" value={rows[i][key].n} onChange={(e) => upd(i, { [key]: { ...rows[i][key], n: e.target.value } })} className="h-8 w-24" />
      <Select aria-label="Unit" value={rows[i][key].u} onChange={(e) => upd(i, { [key]: { ...rows[i][key], u: Number(e.target.value) } })} className="h-8 w-26">
        {UNITS.map((u) => (
          <option key={u.value} value={u.value}>{u.label}</option>
        ))}
      </Select>
    </div>
  );
  return (
    <Card>
      <CardHeader title="SLA policies" description="Targets per ticket priority. The inbox sets due times on new tickets from these policies; compliance below is measured on the last 30 days of tickets." />
      <CardBody className="pt-1">
        {error && <Callout tone="critical" className="mb-3">{error}</Callout>}
        {saved && !error && <Callout tone="good" className="mb-3">SLA policies saved.</Callout>}
        <div className="scroll-thin overflow-x-auto">
          <table className="w-full min-w-[720px] text-[13px]">
            <thead>
              <tr className="border-b border-border text-left text-[11.5px] text-text-3">
                <th className="py-1.5 font-medium">Priority</th>
                <th className="py-1.5 font-medium">First response within</th>
                <th className="py-1.5 font-medium">Resolve within</th>
                <th className="py-1.5 font-medium">Clock</th>
                <th className="py-1.5 text-right font-medium">Compliance (30d)</th>
              </tr>
            </thead>
            <tbody>
              {PRIOS.map((p, i) => {
                const s = stats[p.value];
                return (
                  <tr key={p.value} className="border-b border-border last:border-0">
                    <td className="py-2 pr-3"><Badge tone={p.tone}>{p.label}</Badge></td>
                    <td className="py-2 pr-3">{target(i, "fr")}</td>
                    <td className="py-2 pr-3">{target(i, "rs")}</td>
                    <td className="py-2 pr-3">
                      <Select aria-label="Clock" value={rows[i].bh ? "bh" : "cal"} onChange={(e) => upd(i, { bh: e.target.value === "bh" })} className="h-8 w-36">
                        <option value="bh">Business hours</option>
                        <option value="cal">Calendar (24/7)</option>
                      </Select>
                    </td>
                    <td className="py-2 text-right">
                      {s?.rate != null ? (
                        <span title={`${s.met} met · ${s.breached} breached · ${s.pending} pending`}>
                          <span className="font-semibold text-text">{s.rate.toFixed(0)}%</span> <span className="text-[12px] text-text-3">({s.met}/{s.met + s.breached})</span>
                        </span>
                      ) : (
                        <span className="text-text-3">n/a</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </CardBody>
      <CardFooter className="flex justify-end">
        <Button
          variant="primary"
          loading={pending}
          onClick={() => {
            setSaved(false);
            run(() => saveSlaAction(brand, rows.map((r) => ({ priority: r.priority, first_response_minutes: toMin(r.fr), resolution_minutes: toMin(r.rs), business_hours: r.bh }))), () => setSaved(true));
          }}
        >
          Save policies
        </Button>
      </CardFooter>
    </Card>
  );
}
