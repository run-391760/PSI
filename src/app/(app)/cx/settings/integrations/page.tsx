import { Code2, ExternalLink, KeyRound, PlugZap, Send, Webhook } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { NetworkIcon } from "@/components/cx/network-icon";
import { ApiKeyMap } from "@/components/settings/api-key-map";
import { Page } from "@/components/shell/page";
import { Badge } from "@/components/ui/badge";
import { query } from "@/lib/db";
import { CHANNELS } from "@/lib/cx/channels";
import { credentialStatus } from "@/lib/integrations/registry";
import { networkName } from "@/lib/cx/admin/pure/settings";
import { settingsPage, SettingsHeader } from "../_admin/settings-page";

export const metadata: Metadata = { title: "Integrated Apps" };

function Block({ icon, title, action, children }: { icon: ReactNode; title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="rounded-lg border border-border bg-surface shadow-card">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3 sm:px-5">
        <h2 className="flex items-center gap-2 text-[15px] font-semibold text-text">{icon}{title}</h2>
        {action}
      </div>
      <div className="px-4 py-3 sm:px-5">{children}</div>
    </section>
  );
}
const more = (href: string, label: string) => <Link href={href} className="inline-flex items-center gap-1 text-[12.5px] text-link hover:underline">{label}<ExternalLink className="h-3 w-3" /></Link>;

/** Integrated Apps: what this brand has connected (profiles, publishing accounts, API tokens, webhooks, external APIs) and every server API key with the features it powers. */
export default async function IntegrationsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { el, ctx } = await settingsPage(await searchParams, { title: "Integrated Apps", path: "/cx/settings/integrations", perm: null });
  if (!ctx) return el;
  const id = ctx.brand.id;
  const [channels, pub, tokens, hooks, apis, alertsInt] = await Promise.all([
    query<{ kind: string; n: number; active: number; errors: number }>("SELECT kind, count(*)::int n, count(*) FILTER (WHERE status='active')::int active, count(*) FILTER (WHERE status='error' OR last_error IS NOT NULL)::int errors FROM cx_channels WHERE project_id=$1 GROUP BY kind ORDER BY kind", [id]),
    query<{ kind: string; label: string; updated_at: string }>("SELECT kind,label,updated_at FROM cx_pub_accounts WHERE project_id=$1 ORDER BY kind", [id]),
    query<{ n: number; last: string | null }>("SELECT count(*)::int n, max(last_used_at) last FROM cx_admin_api_tokens WHERE project_id=$1 AND revoked_at IS NULL", [id]),
    query<{ name: string; url: string; active: boolean; last_status: number | null }>("SELECT name,url,active,last_status FROM cx_admin_webhooks WHERE project_id=$1 ORDER BY created_at", [id]),
    query<{ name: string; active: boolean; target: string }>("SELECT name,active,target FROM cx_admin_external_apis WHERE project_id=$1 ORDER BY name", [id]),
    query<{ kind: string }>("SELECT kind FROM cx_admin_integrations WHERE project_id=$1 ORDER BY kind", [id]),
  ]);
  const b = (p: string) => `${p}?brand=${id}`;
  const host = (u: string) => { try { return new URL(u).host; } catch { return u; } };
  return (
    <Page>
      <SettingsHeader title="Integrated Apps" ctx={ctx} description="Everything connected to this brand, in one place. Manage each item on its own settings page." />
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Block icon={<PlugZap className="h-4 w-4 text-text-2" />} title="Connected profiles and connectors" action={more(b("/cx/settings/channels"), "Omni-Channel Setup")}>
          {channels.length ? (
            <ul className="divide-y divide-border text-[13px]">
              {channels.map((c) => (
                <li key={c.kind} className="flex items-center gap-2 py-2">
                  <NetworkIcon kind={c.kind} className="h-4 w-4 text-text-2" />
                  <span className="flex-1 text-text">{networkName(c.kind)}</span>
                  <span className="text-text-2">{c.n} profile{c.n === 1 ? "" : "s"}</span>
                  {c.errors ? <Badge tone="critical">{c.errors} error</Badge> : <Badge tone="good">{c.active} active</Badge>}
                </li>
              ))}
            </ul>
          ) : <p className="py-2 text-[13px] text-text-3">No profiles connected yet.</p>}
        </Block>
        <Block icon={<Send className="h-4 w-4 text-text-2" />} title="Publishing accounts" action={more(b("/cx/publishing"), "Publishing")}>
          {pub.length ? (
            <ul className="divide-y divide-border text-[13px]">
              {pub.map((a) => <li key={a.kind} className="flex items-center gap-2 py-2"><NetworkIcon kind={a.kind} className="h-4 w-4 text-text-2" /><span className="flex-1 text-text">{CHANNELS.find((c) => c.kind === a.kind)?.name ?? a.kind}</span><span className="truncate text-text-2">{a.label || "Connected"}</span></li>)}
            </ul>
          ) : <p className="py-2 text-[13px] text-text-3">No publishing accounts connected.</p>}
        </Block>
        <Block icon={<KeyRound className="h-4 w-4 text-text-2" />} title="API tokens" action={more(b("/cx/settings/api"), "API & webhooks")}>
          <p className="py-1 text-[13px] text-text-2">{tokens[0]?.n ? <>{tokens[0].n} active token{tokens[0].n === 1 ? "" : "s"} for the REST API at <code>/api/cx/v1</code>{tokens[0].last ? <> · last used {new Date(tokens[0].last).toISOString().slice(0, 10)}</> : " · never used"}.</> : "No API tokens. Create one to read and update tickets from other systems."}</p>
        </Block>
        <Block icon={<Webhook className="h-4 w-4 text-text-2" />} title="Outbound webhooks" action={more(b("/cx/settings/api"), "Manage")}>
          {hooks.length ? (
            <ul className="divide-y divide-border text-[13px]">
              {hooks.map((h, i) => <li key={i} className="flex items-center gap-2 py-2"><span className="min-w-0 flex-1 truncate text-text">{h.name || host(h.url)}</span><span className="truncate text-text-3">{host(h.url)}</span>{h.active ? <Badge tone={h.last_status && h.last_status >= 400 ? "critical" : "good"}>{h.last_status ? `HTTP ${h.last_status}` : "Active"}</Badge> : <Badge>Off</Badge>}</li>)}
            </ul>
          ) : <p className="py-2 text-[13px] text-text-3">No webhooks.</p>}
        </Block>
        <Block icon={<Code2 className="h-4 w-4 text-text-2" />} title="External APIs and alert channels" action={more(b("/cx/settings/api"), "Manage")}>
          {apis.length || alertsInt.length ? (
            <ul className="divide-y divide-border text-[13px]">
              {apis.map((a, i) => <li key={`a${i}`} className="flex items-center gap-2 py-2"><span className="flex-1 text-text">{a.name}</span><span className="text-text-3">enriches {a.target}s</span>{a.active ? <Badge tone="good">Active</Badge> : <Badge>Off</Badge>}</li>)}
              {alertsInt.map((a) => <li key={a.kind} className="flex items-center gap-2 py-2"><span className="flex-1 text-text capitalize">{a.kind}</span><span className="text-text-3">alert delivery</span><Badge tone="good">Connected</Badge></li>)}
            </ul>
          ) : <p className="py-2 text-[13px] text-text-3">No external lookups or alert channels configured.</p>}
        </Block>
        <div className="xl:col-span-2">
          <Block icon={<KeyRound className="h-4 w-4 text-text-2" />} title="API keys & where they're used" action={more("/settings?tab=integrations", "SEO Settings")}>
            <p className="mb-3 text-[12.5px] text-text-2">Server keys are set by your administrator and shared by the SEO and CX workspaces. Keys that CX uses come first.</p>
            <ApiKeyMap status={credentialStatus()} workspace="CX" brandId={id} />
          </Block>
        </div>
      </div>
    </Page>
  );
}
