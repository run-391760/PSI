"use client";

import { FolderTree, Pencil, Plus, Star, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { deleteGroupAction, saveGroupAction } from "@/app/(app)/cx/settings/profile-groups/actions";
import { ChannelIcon, channelLabel } from "@/components/cx/inbox/ui";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Callout, EmptyState } from "@/components/ui/feedback";
import { Checkbox, Field, Input, Textarea } from "@/components/ui/input";
import type { ProfileGroup } from "@/lib/cx/ops/groups";
import { num } from "@/lib/format";

type Ch = { id: string; kind: string; name: string; status: string; tickets: number };
type Src = { id: string; label: string; mentions: number };

export function ProfileGroupsClient({ brand, canEdit, groups, channels, sources }: { brand: string; canEdit: boolean; groups: ProfileGroup[]; channels: Ch[]; sources: Src[] }) {
  const router = useRouter();
  const [editing, setEditing] = useState<ProfileGroup | "new" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const chName = (id: string) => channels.find((c) => c.id === id);
  return (
    <div className="space-y-4">
      {!canEdit && <Callout tone="info">Only brand admins and supervisors can create or change profile groups. You can still use them as filters.</Callout>}
      {error && <Callout tone="critical">{error}</Callout>}
      <Card>
        <CardHeader title="Groups" description="The default group is applied when the inbox opens without a group selected." actions={canEdit && <Button size="sm" variant="primary" onClick={() => setEditing("new")} disabled={!channels.length && !sources.length}><Plus className="h-3.5 w-3.5" />New group</Button>} />
        <CardBody className="pt-0">
          {groups.length === 0 ? (
            <EmptyState icon={<FolderTree className="h-5 w-5" />} title="No profile groups yet" description={channels.length ? "Create a group such as “Overall” with every profile, or one per team or campus." : "Connect channels first (email, live chat, web form, social), then group them here."}
              action={channels.length ? (canEdit ? <Button variant="primary" onClick={() => setEditing("new")}><Plus className="h-3.5 w-3.5" />Create a group</Button> : undefined) : <Link href={`/cx/settings/channels?brand=${brand}`} className="text-[13px] text-link hover:underline">Connect a channel →</Link>} />
          ) : (
            <ul className="divide-y divide-border">
              {groups.map((g) => (
                <li key={g.id} className="flex flex-wrap items-start gap-3 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[14px] font-semibold text-text">{g.name}</span>
                      {g.isDefault && <Badge tone="brand"><Star className="mr-0.5 inline h-3 w-3" />Default</Badge>}
                      <span className="text-[12px] text-text-3">{g.channelIds.length} profile{g.channelIds.length === 1 ? "" : "s"}{g.sources.length ? ` · ${g.sources.length} listening source${g.sources.length === 1 ? "" : "s"}` : ""}</span>
                    </div>
                    {g.description && <p className="mt-0.5 text-[12.5px] text-text-2">{g.description}</p>}
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      {g.channelIds.map((id) => { const c = chName(id); return c ? <span key={id} className="inline-flex items-center gap-1 rounded border border-border bg-surface-2 px-1.5 py-0.5 text-[11.5px] text-text-2"><ChannelIcon kind={c.kind} className="h-3 w-3" />{c.name}</span> : null; })}
                      {g.sources.map((s) => <span key={s} className="rounded border border-dashed border-border-strong px-1.5 py-0.5 text-[11.5px] text-text-2">{sources.find((x) => x.id === s)?.label ?? s}</span>)}
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <Link href={`/cx/inbox?brand=${brand}&group=${g.id}`} className="rounded px-2 py-1 text-[12.5px] text-link hover:bg-surface-3">Open in inbox</Link>
                    {canEdit && <button onClick={() => setEditing(g)} className="rounded p-1.5 text-text-3 hover:bg-surface-3 hover:text-text" aria-label={`Edit ${g.name}`}><Pencil className="h-3.5 w-3.5" /></button>}
                    {canEdit && <button onClick={async () => { if (!confirm(`Delete the profile group “${g.name}”? Profiles and tickets are not affected.`)) return; const r = await deleteGroupAction(brand, g.id); if (!r.ok) setError(r.error); router.refresh(); }} className="rounded p-1.5 text-text-3 hover:bg-surface-3 hover:text-critical-ink" aria-label={`Delete ${g.name}`}><Trash2 className="h-3.5 w-3.5" /></button>}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>
      {editing && <GroupDialog brand={brand} group={editing === "new" ? null : editing} channels={channels} sources={sources} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); router.refresh(); }} />}
    </div>
  );
}

function GroupDialog({ brand, group, channels, sources, onClose, onSaved }: { brand: string; group: ProfileGroup | null; channels: Ch[]; sources: Src[]; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(group?.name ?? "");
  const [description, setDescription] = useState(group?.description ?? "");
  const [isDefault, setDefault] = useState(group?.isDefault ?? false);
  const [chs, setChs] = useState<Set<string>>(new Set(group?.channelIds ?? []));
  const [srcs, setSrcs] = useState<Set<string>>(new Set(group?.sources ?? []));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const toggle = (set: Set<string>, v: string, fn: (s: Set<string>) => void) => { const n = new Set(set); if (n.has(v)) n.delete(v); else n.add(v); fn(n); };
  return (
    <Dialog open onClose={onClose} size="lg" title={group ? `Edit “${group.name}”` : "New profile group"}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={busy} onClick={async () => {
        setBusy(true); setError(null);
        const r = await saveGroupAction(brand, { id: group?.id, name, description, isDefault, channelIds: [...chs], sources: [...srcs] });
        setBusy(false);
        if (r.ok) onSaved(); else setError(r.error);
      }}>{busy ? "Saving…" : "Save group"}</Button></>}>
      <div className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
          <Field label="Name" htmlFor="pg-name"><Input id="pg-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Overall, Admissions, Campus A" maxLength={60} autoFocus /></Field>
          <label className="flex h-9 items-center gap-2 text-[13px] text-text"><Checkbox checked={isDefault} onChange={(e) => setDefault(e.target.checked)} />Default group</label>
        </div>
        <Field label="Description (optional)" htmlFor="pg-desc"><Textarea id="pg-desc" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} /></Field>
        <div>
          <div className="mb-1 flex items-center justify-between text-[12.5px] font-medium text-text-2">
            <span>Connected profiles ({chs.size} of {channels.length})</span>
            {channels.length > 0 && <button type="button" className="text-[12px] text-link hover:underline" onClick={() => setChs(chs.size === channels.length ? new Set() : new Set(channels.map((c) => c.id)))}>{chs.size === channels.length ? "Select none" : "Select all"}</button>}
          </div>
          {channels.length === 0 ? <p className="text-[12.5px] text-text-3">No channels connected yet.</p> : (
            <ul className="grid gap-1 sm:grid-cols-2">
              {channels.map((c) => (
                <li key={c.id}>
                  <label className="flex items-center gap-2 rounded-md border border-border px-2 py-1.5 text-[12.5px] hover:bg-surface-2">
                    <Checkbox checked={chs.has(c.id)} onChange={() => toggle(chs, c.id, setChs)} />
                    <ChannelIcon kind={c.kind} className="text-text-3" />
                    <span className="min-w-0 flex-1 truncate text-text">{c.name}<span className="text-text-3"> · {channelLabel(c.kind)}</span></span>
                    <span className="text-[11.5px] text-text-3 tabular-nums">{num(c.tickets)}</span>
                    {c.status !== "active" && <Badge tone={c.status === "error" ? "critical" : "neutral"}>{c.status}</Badge>}
                  </label>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div>
          <div className="mb-1 text-[12.5px] font-medium text-text-2">Listening sources <span className="font-normal text-text-3">(tickets created from these mentions)</span></div>
          <ul className="grid grid-cols-2 gap-1 sm:grid-cols-3">
            {sources.map((s) => (
              <li key={s.id}>
                <label className="flex items-center gap-2 rounded-md border border-border px-2 py-1.5 text-[12.5px] hover:bg-surface-2">
                  <Checkbox checked={srcs.has(s.id)} onChange={() => toggle(srcs, s.id, setSrcs)} />
                  <span className="min-w-0 flex-1 truncate text-text">{s.label}</span>
                  <span className="text-[11.5px] text-text-3 tabular-nums">{num(s.mentions)}</span>
                </label>
              </li>
            ))}
          </ul>
        </div>
        {error && <Callout tone="critical">{error}</Callout>}
      </div>
    </Dialog>
  );
}
