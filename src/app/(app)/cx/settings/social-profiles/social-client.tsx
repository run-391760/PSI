"use client";

import { ExternalLink, Palette, Pause, Pencil, Play, Plus, RefreshCw, Trash2, UserSearch } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { NetworkIcon } from "@/components/cx/network-icon";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm";
import { Dialog, MenuItem } from "@/components/ui/dialog";
import { Callout, EmptyState } from "@/components/ui/feedback";
import { Input, Select } from "@/components/ui/input";
import type { SocialProfile } from "@/lib/cx/admin/social-profiles";
import { SOCIAL_NETWORKS, SOCIAL_RELATIONS, parseSocialHandle, socialNetwork } from "@/lib/cx/admin/pure/settings";
import { cn } from "@/lib/utils";
import { ColorDialog, ColorDot, GearMenu, KAvatar, KButton, KDate, KSection, runOk } from "../_admin/k-ui";
import { Field, useRun } from "../_admin/ui";
import { deleteSocialProfileAction, fetchSocialProfileAction, saveSocialProfileAction, socialProfileActiveAction, socialProfileColorAction } from "./actions";

const relLabel = (r: string) => SOCIAL_RELATIONS.find((x) => x.id === r)?.label ?? r;

/** More Social Profiles: per-network sections of public profiles tracked without login. */
export function SocialClient({ brand, profiles, keys, canEdit }: { brand: string; profiles: SocialProfile[]; keys: { reddit: boolean; youtube: boolean }; canEdit: boolean }) {
  const { run, busy, error, setError, messages } = useRun();
  const [dlg, setDlgState] = useState<null | { t: "edit"; p: SocialProfile | null } | { t: "color"; p: SocialProfile } | { t: "del"; p: SocialProfile }>(null);
  const setDlg = (d: typeof dlg) => { if (d) setError(null); setDlgState(d); };
  const networks = SOCIAL_NETWORKS.filter((n) => profiles.some((p) => p.network === n.id));
  return (
    <div className="space-y-4">
      {messages}
      <KSection title="Public profiles (no login)" upper action={canEdit && <KButton onClick={() => setDlg({ t: "edit", p: null })}><Plus className="h-3.5 w-3.5" />Add profile</KButton>}>
        <p className="-mt-1 mb-3 text-[12.5px] text-text-2">Competitors, partners and influencers you follow without their credentials. Bluesky, Mastodon, YouTube and Hacker News profiles are read for free with every listening run and their posts appear in Mentions; the others are saved and marked as needing that network&apos;s API.</p>
        {profiles.length === 0 ? (
          <EmptyState icon={<UserSearch className="h-5 w-5" />} title="No public profiles tracked" description="Add a competitor's Bluesky handle, YouTube channel or Mastodon account to see what they post next to your own mentions." action={canEdit ? <KButton onClick={() => setDlg({ t: "edit", p: null })}><Plus className="h-3.5 w-3.5" />Add profile</KButton> : undefined} />
        ) : (
          <div className="space-y-4">
            {networks.map((n) => {
              const items = profiles.filter((p) => p.network === n.id);
              return (
                <div key={n.id} className="rounded-lg bg-surface-2 p-3 sm:p-4">
                  <div className="mb-3 flex items-center justify-between gap-2">
                    <h3 className="flex items-center gap-2 text-[15px] font-semibold text-text"><NetworkIcon kind={n.id} className="h-4.5 w-4.5" />{n.name}{n.access !== "free" && <Badge tone={n.access === "keyed" ? "info" : "warning"}>{n.access === "keyed" ? "Needs keys" : "Needs API"}</Badge>}</h3>
                    <span className="text-[13px] font-semibold text-text">{items.length} Profile{items.length === 1 ? "" : "s"}</span>
                  </div>
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-2 2xl:grid-cols-3">
                    {items.map((p) => {
                      const state = !p.fetchable ? { label: "Needs API", cls: "text-warning-ink" } : p.lastError ? { label: "Error", cls: "text-critical-ink" } : !p.active ? { label: "Paused", cls: "text-text-3" } : { label: "Tracking", cls: "text-good-ink" };
                      return (
                        <article key={p.id} className="min-w-0 rounded-md border border-border bg-surface p-3 shadow-card">
                          <div className="flex items-start gap-3 border-b border-border pb-3">
                            <KAvatar name={p.name} />
                            <div className="min-w-0 flex-1">
                              <div className="truncate text-[13.5px] font-semibold text-text" title={p.name}>{p.name}</div>
                              <a href={p.url} target="_blank" rel="noreferrer" className="inline-flex max-w-full items-center gap-1 truncate text-[12.5px] text-link hover:underline">{p.handle}<ExternalLink className="h-3 w-3 shrink-0" /></a>
                              <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11.5px] text-text-3"><Badge>{relLabel(p.relation)}</Badge>{p.fetchable && <span>{p.posts} posts · {p.lastFetchedAt ? <>checked <KDate iso={p.lastFetchedAt} /></> : "not fetched yet"}</span>}</div>
                            </div>
                            <span className={cn("shrink-0 pt-0.5 text-[12.5px] font-semibold", state.cls)} title={p.lastError ?? p.needs ?? undefined}>{state.label}</span>
                            {canEdit && (
                              <GearMenu label={`Actions for ${p.name}`}>
                                {(close) => (
                                  <>
                                    <MenuItem icon={<Pencil className="h-3.5 w-3.5" />} onClick={() => { close(); setDlg({ t: "edit", p }); }}>Edit</MenuItem>
                                    {p.fetchable && <MenuItem icon={<RefreshCw className="h-3.5 w-3.5" />} onClick={() => { close(); run(`f-${p.id}`, fetchSocialProfileAction(brand, p.id), (r) => `${p.name}: ${r.fetched} posts read, ${r.inserted} new.`); }}>Fetch now</MenuItem>}
                                    <MenuItem icon={p.active ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />} onClick={() => { close(); run(`a-${p.id}`, socialProfileActiveAction(brand, p.id, !p.active)); }}>{p.active ? "Pause" : "Resume"}</MenuItem>
                                    <MenuItem icon={<Palette className="h-3.5 w-3.5" />} onClick={() => { close(); setDlg({ t: "color", p }); }}>Change color</MenuItem>
                                    <MenuItem danger icon={<Trash2 className="h-3.5 w-3.5" />} onClick={() => { close(); setDlg({ t: "del", p }); }}>Delete</MenuItem>
                                  </>
                                )}
                              </GearMenu>
                            )}
                          </div>
                          {(p.lastError || (!p.fetchable && p.needs)) && <p className={cn("pt-2 text-[12px]", p.lastError ? "text-critical-ink" : "text-text-3")}>{p.lastError ?? p.needs}</p>}
                          <dl className="grid grid-cols-[1fr_1.3fr_auto] gap-x-3 pt-2.5 text-[12.5px]">
                            <dt className="font-semibold text-text">Created by</dt><dt className="font-semibold text-text">Created On</dt><dt className="text-right font-semibold text-text">Color</dt>
                            <dd className="truncate text-text-2">{p.creator ?? "n/a"}</dd><dd className="text-text-2"><KDate iso={p.createdAt} /></dd><dd className="flex justify-end pt-1"><ColorDot color={p.color} label={`Color ${p.color}`} /></dd>
                          </dl>
                        </article>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )}
        {profiles.some((p) => p.posts > 0) && <p className="mt-3 text-[12.5px] text-text-3">Their posts are stored as mentions without a topic. <Link href={`/cx/listening?brand=${brand}`} className="text-link hover:underline">Open Mentions →</Link></p>}
      </KSection>
      {dlg?.t === "edit" && <ProfileDialog brand={brand} p={dlg.p} keys={keys} onClose={() => setDlg(null)} />}
      {dlg?.t === "color" && <ColorDialog open title={`Color for ${dlg.p.name}`} value={dlg.p.color} busy={busy === "color"} error={error} onClose={() => setDlg(null)} onSave={async (c) => { if (await runOk(run, "color", socialProfileColorAction(brand, dlg.p.id, c), () => "Color saved.")) setDlg(null); }} />}
      {dlg?.t === "del" && (
        <ConfirmDialog open onCancel={() => setDlg(null)} title={`Stop tracking ${dlg.p.name}?`} confirmLabel="Stop tracking" busy={busy === "del"} error={error}
          description={<>{dlg.p.handle} is removed from this list. Posts already collected stay in Mentions.</>}
          onConfirm={async () => { if (await runOk(run, "del", deleteSocialProfileAction(brand, dlg.p.id), () => `${dlg.p.name} removed.`)) setDlg(null); }} />
      )}
    </div>
  );
}

function ProfileDialog({ brand, p, keys, onClose }: { brand: string; p: SocialProfile | null; keys: { reddit: boolean; youtube: boolean }; onClose: () => void }) {
  const { run, busy, error } = useRun();
  const [network, setNetwork] = useState(p?.network ?? "bluesky");
  const [handle, setHandle] = useState(p?.handle ?? "");
  const [name, setName] = useState(p?.name ?? "");
  const [relation, setRelation] = useState(p?.relation ?? "competitor");
  const net = socialNetwork(network)!;
  const parsed = handle.trim() ? parseSocialHandle(network, handle) : null;
  const keyed = network === "reddit" ? keys.reddit : network === "youtube" ? keys.youtube || /^UC[\w-]{22}$/.test(handle.trim()) : true;
  return (
    <Dialog open onClose={onClose} title={p ? "Edit public profile" : "Add public profile"} error={error}
      onSubmit={async () => { if (busy !== "save" && (await runOk(run, "save", saveSocialProfileAction(brand, { id: p?.id, network, handle, name, relation }), (d) => (d.fetched ? `Saved. ${d.fetched.fetched} recent posts read, ${d.fetched.inserted} new.` : d.fetchError ? `Saved. ${d.fetchError}` : "Saved.")))) onClose(); }}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button type="submit" variant="primary" loading={busy === "save"}>Save</Button></>}>
      <div className="space-y-3">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Network"><Select value={network} onChange={(e) => setNetwork(e.target.value)}>{SOCIAL_NETWORKS.map((n) => <option key={n.id} value={n.id}>{n.name}{n.access === "api" ? " (needs API)" : ""}</option>)}</Select></Field>
          <Field label="Relation"><Select value={relation} onChange={(e) => setRelation(e.target.value)}>{SOCIAL_RELATIONS.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}</Select></Field>
        </div>
        <Field label="Handle or profile URL" hint={parsed ? (parsed.ok ? `Saved as ${parsed.handle}` : parsed.error) : undefined}><Input autoFocus value={handle} onChange={(e) => setHandle(e.target.value)} placeholder={net.placeholder} autoComplete="off" /></Field>
        <Field label="Display name (optional)"><Input value={name} maxLength={80} onChange={(e) => setName(e.target.value)} placeholder="e.g. Competitor Inc" /></Field>
        <Callout tone={net.access === "free" && keyed ? "good" : net.access === "api" ? "warning" : keyed ? "good" : "info"} title={net.access === "free" && keyed ? "Free: fetched with listening" : net.access === "api" ? "Needs an API" : keyed ? "Ready" : "Needs keys"}>{net.note}</Callout>
      </div>
    </Dialog>
  );
}
