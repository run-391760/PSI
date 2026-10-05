"use client";

import { ChevronDown, ExternalLink, Info, Palette, Pause, Pencil, Play, Plus, RefreshCw, Trash2, Webhook } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { NetworkIcon } from "@/components/cx/network-icon";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, MenuItem } from "@/components/ui/dialog";
import { Callout, EmptyState } from "@/components/ui/feedback";
import type { ChannelRow } from "@/lib/cx/inbox/channels";
import type { Profile } from "@/lib/cx/admin/profiles";
import { PROFILE_NETWORKS, profileSections, profileState, type NetworkDef } from "@/lib/cx/admin/pure/settings";
import { cn } from "@/lib/utils";
import { ColorDialog, ColorDot, GearMenu, KAvatar, KButton, KDate } from "../_admin/k-ui";
import { useRun } from "../_admin/ui";
import { channelStatusAction, deleteChannelAction, profileColorAction, syncEmailAction } from "./actions";
import { ChannelDialog, ProfileDetails, WebhookEndpoints, type EditKind, type Env } from "./channels-client";
import { syncConnectorAction } from "./connector-actions";
import { ConnectorDialog, type ConnectorDef } from "./connectors-client";

export type ApiInfo = { kind: string; name: string; api: string; cost: string; costNote: string; env: string[]; setup: string; configured: boolean };
type Props = { brand: string; origin: string; env: Env; profiles: Profile[]; connectors: ConnectorDef[]; apiInfo: ApiInfo[]; canEdit: boolean };
type Open =
  | { t: "add" }
  | { t: "api"; info: ApiInfo }
  | { t: "channel"; kind: EditKind; profile?: Profile }
  | { t: "connector"; def: ConnectorDef; profile?: Profile }
  | { t: "details"; profile: Profile }
  | { t: "color"; profile: Profile }
  | { t: "delete"; profile: Profile }
  | null;

const INBOX_KINDS = ["email", "livechat", "webform", "whatsapp", "facebook", "instagram", "linkedin"];
const asRow = (p: Profile, brand: string): ChannelRow => ({ ...p, project_id: brand });

export function ProfilesClient({ brand, origin, env, profiles, connectors, apiInfo, canEdit }: Props) {
  const router = useRouter();
  const sp = useSearchParams();
  const [open, setOpen] = useState<Open>(null);
  const [collapsed, setCollapsed] = useState(false);
  const { run, busy, messages } = useRun();
  const sections = profileSections(profiles);

  // ?add=<kind> (from All Apps) opens the matching connect flow once.
  const addParam = sp.get("add");
  useEffect(() => {
    if (!addParam || !canEdit) return;
    const net = PROFILE_NETWORKS.find((n) => n.kind === addParam);
    if (net) startAdd(net);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [addParam]);

  function startAdd(n: NetworkDef) {
    if (n.connect === "inbox" && INBOX_KINDS.includes(n.kind)) setOpen({ t: "channel", kind: n.kind as EditKind });
    else if (n.connect === "connector") {
      const def = connectors.find((c) => c.kind === n.kind);
      if (def) setOpen({ t: "connector", def });
    } else {
      const info = apiInfo.find((a) => a.kind === n.kind);
      if (info) setOpen({ t: "api", info });
    }
  }
  function edit(p: Profile) {
    if (INBOX_KINDS.includes(p.kind)) setOpen({ t: "channel", kind: p.kind as EditKind, profile: p });
    else {
      const def = connectors.find((c) => c.kind === p.kind);
      if (def) setOpen({ t: "connector", def, profile: p });
    }
  }
  function reconnect(p: Profile) {
    if (p.kind === "email") return run(`r-${p.id}`, syncEmailAction(brand, p.id), (d) => `${p.name}: ${d.imported} new tickets, ${d.threaded} replies threaded.`);
    if (connectors.some((c) => c.kind === p.kind)) return run(`r-${p.id}`, syncConnectorAction(brand, p.id), (d: { created: number; threaded: number }) => `${p.name}: ${d.created} new tickets, ${d.threaded} replies threaded.`);
    if (p.status === "error" || p.last_error) return run(`r-${p.id}`, channelStatusAction(brand, p.id, "active"), () => `${p.name} reactivated. Re-enter the access token if replies keep failing.`).then(() => edit(p));
    edit(p);
  }
  const closeAndRefresh = () => { setOpen(null); router.refresh(); };

  return (
    <div className="space-y-4">
      <section className="rounded-lg border border-border bg-surface shadow-card">
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 sm:px-5">
          <button type="button" onClick={() => setCollapsed((c) => !c)} aria-expanded={!collapsed} className="flex items-center gap-2 text-[12px] font-semibold tracking-[0.08em] text-text-2 uppercase hover:text-text">
            <ChevronDown className={cn("h-4 w-4 transition-transform", collapsed && "-rotate-90")} />
            Profiles with login credentials
            <span className="font-normal tracking-normal text-text-3 normal-case">({profiles.length})</span>
          </button>
          {canEdit && <KButton onClick={() => setOpen({ t: "add" })}><Plus className="h-3.5 w-3.5" />Add profile</KButton>}
        </div>
        {!collapsed && (
          <div className="space-y-4 px-3 pb-4 sm:px-5">
            {messages}
            {!canEdit && <Callout tone="info">Your role can view profiles but not change them.</Callout>}
            {sections.length === 0 ? (
              <EmptyState icon={<Plus className="h-5 w-5" />} title="No profiles connected yet" description="Add the mailboxes, chat widgets, forms and social accounts your customers use. Email, live chat, web forms, Telegram, Discord and Discourse are free to connect." action={canEdit ? <KButton onClick={() => setOpen({ t: "add" })}><Plus className="h-3.5 w-3.5" />Add profile</KButton> : undefined} />
            ) : (
              sections.map((s) => (
                <div key={s.kind} className="rounded-lg bg-surface-2 p-3 sm:p-4">
                  <div className="mb-3 flex items-center justify-between gap-2">
                    <h3 className="flex items-center gap-2 text-[15px] font-semibold text-text"><NetworkIcon kind={s.kind} className="h-4.5 w-4.5" />{s.name}</h3>
                    <span className="text-[13px] font-semibold text-text">{s.items.length} Profile{s.items.length === 1 ? "" : "s"}</span>
                  </div>
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-2 2xl:grid-cols-3">
                    {s.items.map((p) => {
                      const st = profileState(p);
                      return (
                        <article key={p.id} className="min-w-0 rounded-md border border-border bg-surface p-3 shadow-card">
                          <div className="flex items-start gap-3 border-b border-border pb-3">
                            <KAvatar name={p.name} />
                            <div className="min-w-0 flex-1">
                              <div className="truncate text-[13.5px] font-semibold text-text" title={p.name}>{p.name}</div>
                              <div className="truncate text-[12.5px] text-text-2" title={p.handle}>{p.handle || "n/a"}</div>
                            </div>
                            <span className={cn("shrink-0 pt-0.5 text-[12.5px] font-semibold", st.tone === "good" ? "text-good-ink" : st.tone === "critical" ? "text-critical-ink" : "text-text-3")} title={p.last_error ?? undefined}>{st.label}</span>
                            <GearMenu label={`Actions for ${p.name}`}>
                              {(close) => (
                                <>
                                  {canEdit && <MenuItem icon={<Pencil className="h-3.5 w-3.5" />} onClick={() => { close(); edit(p); }}>Edit</MenuItem>}
                                  {canEdit && <MenuItem icon={p.status === "paused" ? <Play className="h-3.5 w-3.5" /> : <Pause className="h-3.5 w-3.5" />} onClick={() => { close(); run(`p-${p.id}`, channelStatusAction(brand, p.id, p.status === "paused" ? "active" : "paused"), () => `${p.name} ${p.status === "paused" ? "resumed" : "paused"}.`); }}>{p.status === "paused" ? "Resume" : "Pause"}</MenuItem>}
                                  {canEdit && <MenuItem icon={<RefreshCw className="h-3.5 w-3.5" />} onClick={() => { close(); reconnect(p); }}>Reconnect</MenuItem>}
                                  <MenuItem icon={<Info className="h-3.5 w-3.5" />} onClick={() => { close(); setOpen({ t: "details", profile: p }); }}>Details & embed</MenuItem>
                                  {canEdit && <MenuItem icon={<Palette className="h-3.5 w-3.5" />} onClick={() => { close(); setOpen({ t: "color", profile: p }); }}>Change color</MenuItem>}
                                  {canEdit && <MenuItem danger icon={<Trash2 className="h-3.5 w-3.5" />} onClick={() => { close(); setOpen({ t: "delete", profile: p }); }}>Delete</MenuItem>}
                                </>
                              )}
                            </GearMenu>
                          </div>
                          <dl className="grid grid-cols-[1fr_1.3fr_auto] gap-x-3 pt-2.5 text-[12.5px]">
                            <dt className="font-semibold text-text">Created by</dt>
                            <dt className="font-semibold text-text">Created On</dt>
                            <dt className="text-right font-semibold text-text">Color</dt>
                            <dd className="truncate text-text-2" title={p.creator ?? undefined}>{p.creator ?? "n/a"}</dd>
                            <dd className="text-text-2"><KDate iso={p.created_at} /></dd>
                            <dd className="flex justify-end pt-1"><ColorDot color={p.color} label={`Color ${p.color}`} /></dd>
                          </dl>
                          {busy?.endsWith(p.id) && <p className="mt-2 text-[12px] text-text-3">Working…</p>}
                        </article>
                      );
                    })}
                  </div>
                </div>
              ))
            )}
          </div>
        )}
      </section>

      <details className="group rounded-lg border border-border bg-surface shadow-card">
        <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 text-[12px] font-semibold tracking-[0.08em] text-text-2 uppercase sm:px-5">
          <ChevronDown className="h-4 w-4 -rotate-90 transition-transform group-open:rotate-0" />
          <Webhook className="h-4 w-4" />Messaging webhook endpoints
        </summary>
        <div className="px-4 pb-4 sm:px-5"><WebhookEndpoints origin={origin} env={env} /></div>
      </details>

      {open?.t === "add" && (
        <Dialog open onClose={() => setOpen(null)} size="lg" title="Add profile" description="Pick the network. Built-in channels and free connectors work right away; others need the platform's API keys on the server.">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {PROFILE_NETWORKS.map((n) => {
              const info = apiInfo.find((a) => a.kind === n.kind);
              const count = profiles.filter((p) => p.kind === n.kind).length;
              const tag = n.connect === "api" ? (info?.configured ? <Badge tone="info">Keys set</Badge> : <Badge tone={info?.cost === "paid" ? "warning" : "neutral"}>{info?.cost === "paid" ? "Paid API" : "Needs API"}</Badge>) : <Badge tone="good">{n.connect === "connector" ? "Free connector" : n.group === "owned" ? "Built in" : "Connect"}</Badge>;
              return (
                <button key={n.kind} type="button" onClick={() => startAdd(n)} className="flex items-center gap-3 rounded-md border border-border p-3 text-left hover:border-link hover:bg-surface-2">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-surface-3 text-text"><NetworkIcon kind={n.kind} className="h-4.5 w-4.5" /></span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[13.5px] font-semibold text-text">{n.name}</span>
                    <span className="block text-[12px] text-text-3">{count ? `${count} connected` : "Not connected"}</span>
                  </span>
                  {tag}
                </button>
              );
            })}
          </div>
        </Dialog>
      )}
      {open?.t === "api" && (
        <Dialog open onClose={() => setOpen(null)} title={`${open.info.name} needs its API`} description={open.info.api}
          footer={<><Button onClick={() => setOpen({ t: "add" })}>Back</Button><Link href={`/cx/settings/apps?brand=${brand}`} className="inline-flex h-8.5 items-center gap-1.5 rounded-md bg-brand px-3.5 text-[13px] font-medium text-white hover:bg-brand-hover">All Apps<ExternalLink className="h-3.5 w-3.5" /></Link></>}>
          <div className="space-y-3 text-[13px]">
            <Callout tone={open.info.configured ? "info" : "warning"} title={open.info.configured ? "Server keys are set" : "Not available yet"}>
              {open.info.configured ? "The keys are configured, but inbox ingestion for this network isn't built yet. Its posts and analytics are available where the Publishing and Social analytics modules support it." : "Ask your administrator to add these server variables, then come back to connect the profile."}
            </Callout>
            <dl className="space-y-1.5">
              <div className="flex gap-2"><dt className="w-14 shrink-0 text-text-3">Cost</dt><dd className="text-text">{open.info.costNote}</dd></div>
              {open.info.env.length > 0 && <div className="flex gap-2"><dt className="w-14 shrink-0 text-text-3">Env</dt><dd className="font-mono text-[12px] break-all text-text-2">{open.info.env.join(", ")}</dd></div>}
              <div className="flex gap-2"><dt className="w-14 shrink-0 text-text-3">Setup</dt><dd className="text-text-2">{open.info.setup}</dd></div>
            </dl>
          </div>
        </Dialog>
      )}
      {open?.t === "channel" && (
        <>
          <ChannelDialog brand={brand} kind={open.kind} channel={open.profile ? asRow(open.profile, brand) : undefined} onClose={closeAndRefresh} />
        </>
      )}
      {open?.t === "connector" && (
        <ConnectorDialog brand={brand} def={open.def} onClose={closeAndRefresh}
          initial={open.profile ? { id: open.profile.id, kind: open.profile.kind, name: open.profile.name, channelId: String(open.profile.config.channelId ?? ""), base: String(open.profile.config.base ?? ""), username: String(open.profile.config.username ?? "") } : undefined} />
      )}
      {open?.t === "details" && (
        <Dialog open onClose={() => setOpen(null)} size="lg" title={open.profile.name} description={`${PROFILE_NETWORKS.find((n) => n.kind === open.profile.kind)?.name ?? open.profile.kind} · ${open.profile.tickets} tickets · ${open.profile.open} open`}>
          <ProfileDetails c={asRow(open.profile, brand)} brand={brand} origin={origin} />
        </Dialog>
      )}
      {open?.t === "color" && (
        <ColorDialog open title={`Color for ${open.profile.name}`} value={open.profile.color} busy={busy === "color"} onClose={() => setOpen(null)}
          onSave={async (c) => { await run("color", profileColorAction(brand, open.profile.id, c), () => "Color saved."); setOpen(null); }} />
      )}
      {open?.t === "delete" && (
        <Dialog open onClose={() => setOpen(null)} size="sm" title="Delete profile?" description="Existing tickets stay in the inbox; new messages from this profile stop arriving. Clusters drop it."
          footer={<><Button onClick={() => setOpen(null)}>Cancel</Button><Button variant="danger" loading={busy === "del"} onClick={async () => { await run("del", deleteChannelAction(brand, open.profile.id), () => `${open.profile.name} deleted.`); setOpen(null); }}>Delete</Button></>}>
          <p className="text-[13px] text-text-2">{open.profile.name}</p>
        </Dialog>
      )}
    </div>
  );
}
