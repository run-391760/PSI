import type { Metadata } from "next";
import Link from "next/link";
import { NetworkIcon } from "@/components/cx/network-icon";
import { Page } from "@/components/shell/page";
import { Badge } from "@/components/ui/badge";
import { TabsNav } from "@/components/ui/tabs";
import { query } from "@/lib/db";
import { CHANNELS, type ChannelKind } from "@/lib/cx/channels";
import { channelAvailable } from "@/lib/cx/providers";
import { CONNECT_CARDS, CONNECTORS, cardConfigured } from "@/lib/cx/admin/connectors";
import { PROFILE_NETWORKS } from "@/lib/cx/admin/pure/settings";
import { settingsPage, SettingsHeader } from "../_admin/settings-page";

export const metadata: Metadata = { title: "All Apps" };

type App = { kind: string; name: string; uses: string[]; api: string; cost: "free" | "free-approval" | "paid"; costNote: string; env: string[]; setup: string; ready: boolean };
const USES = [
  { id: "all", label: "All" },
  { id: "inbox", label: "Inbox" },
  { id: "listening", label: "Listening" },
  { id: "publishing", label: "Publishing" },
  { id: "analytics", label: "Analytics" },
  { id: "free", label: "Free" },
] as const;

/** All Apps: the catalogue of every channel and app with its API, cost and this brand's connect state. */
export default async function AppsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const { el, ctx } = await settingsPage(sp, { title: "All Apps", path: "/cx/settings/apps", perm: null });
  if (!ctx) return el;
  const id = ctx.brand.id;
  const use = typeof sp.use === "string" && USES.some((u) => u.id === sp.use) ? sp.use : "all";
  const [counts, pub, sources] = await Promise.all([
    query<{ kind: string; n: number }>("SELECT kind, count(*)::int n FROM cx_channels WHERE project_id=$1 GROUP BY kind", [id]),
    query<{ kind: string }>("SELECT kind FROM cx_pub_accounts WHERE project_id=$1", [id]),
    query<{ s: string }>("SELECT DISTINCT jsonb_array_elements_text(sources) s FROM cx_topics WHERE project_id=$1 UNION SELECT DISTINCT source FROM cx_mentions WHERE project_id=$1", [id]),
  ]);
  const apps: App[] = [
    ...CHANNELS.map((c) => ({ kind: c.kind, name: c.name, uses: c.uses as string[], api: c.api, cost: c.cost, costNote: c.costNote, env: c.env, setup: c.setup, ready: channelAvailable(c.kind as ChannelKind) })),
    ...CONNECT_CARDS.filter((c) => !CHANNELS.some((x) => x.kind === c.kind)).map((c) => ({ kind: c.kind, name: c.name, uses: c.kind === "telephony" ? ["inbox", "analytics"] : ["publishing", "inbox"], api: c.api, cost: c.cost as App["cost"], costNote: c.costNote, env: [...c.env], setup: "Ask your administrator to add the server keys.", ready: cardConfigured(c.env) })),
  ];
  for (const c of CONNECTORS) {
    const a = apps.find((x) => x.kind === c.kind);
    if (a) Object.assign(a, { setup: c.setup, ready: true });
  }
  const state = (a: App) => {
    const n = counts.find((c) => c.kind === a.kind)?.n ?? 0;
    if (n) return { tone: "good" as const, label: `${n} connected` };
    if (pub.some((p) => p.kind === a.kind)) return { tone: "good" as const, label: "Publishing connected" };
    if (sources.some((s) => s.s === a.kind)) return { tone: "good" as const, label: "Used by listening" };
    if (["email", "livechat", "webform"].includes(a.kind)) return { tone: "info" as const, label: "Built in" };
    if (a.ready) return { tone: "info" as const, label: "Ready to connect" };
    return { tone: "neutral" as const, label: "Needs API keys" };
  };
  const action = (a: App) => {
    const net = PROFILE_NETWORKS.find((n) => n.kind === a.kind && n.connect !== "api");
    if (net) return <Link href={`/cx/settings/channels?brand=${id}&add=${a.kind}`} className="text-[12.5px] font-medium text-link hover:underline">Add profile →</Link>;
    if (a.uses.includes("listening")) return <Link href={`/cx/listening/topics?brand=${id}`} className="text-[12.5px] font-medium text-link hover:underline">Use in a topic →</Link>;
    if (a.uses.includes("publishing")) return <Link href={`/cx/publishing?brand=${id}`} className="text-[12.5px] font-medium text-link hover:underline">Publishing →</Link>;
    return null;
  };
  const shown = apps.filter((a) => use === "all" || (use === "free" ? a.cost === "free" : a.uses.includes(use)));
  return (
    <Page>
      <SettingsHeader title="All Apps" ctx={ctx} description="Every channel and app the CX workspace supports, the API behind it, what it costs and whether this brand uses it."
        meta={<><Badge tone="good">{apps.filter((a) => state(a).tone === "good").length} in use</Badge><Badge>{apps.length} apps</Badge></>} />
      <TabsNav param="use" className="mb-4" items={USES.map((u) => ({ href: `/cx/settings/apps?brand=${id}${u.id === "all" ? "" : `&use=${u.id}`}`, label: u.label, count: u.id === "all" ? apps.length : apps.filter((a) => (u.id === "free" ? a.cost === "free" : a.uses.includes(u.id))).length }))} />
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 2xl:grid-cols-3">
        {shown.map((a) => {
          const s = state(a);
          return (
            <article key={a.kind} className="flex min-w-0 flex-col rounded-lg border border-border bg-surface p-4 shadow-card">
              <div className="flex items-start gap-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-surface-3 text-text"><NetworkIcon kind={a.kind} className="h-4.5 w-4.5" /></span>
                <div className="min-w-0 flex-1">
                  <h2 className="text-[14px] font-semibold text-text">{a.name}</h2>
                  <div className="mt-1 flex flex-wrap gap-1">{a.uses.map((u) => <span key={u} className="rounded bg-surface-3 px-1.5 py-0.5 text-[11px] text-text-2 capitalize">{u}</span>)}</div>
                </div>
                <Badge tone={s.tone}>{s.label}</Badge>
              </div>
              <dl className="mt-3 space-y-1 text-[12.5px]">
                <div className="flex gap-2"><dt className="w-10 shrink-0 text-text-3">API</dt><dd className="text-text">{a.api}</dd></div>
                <div className="flex gap-2"><dt className="w-10 shrink-0 text-text-3">Cost</dt><dd className="text-text"><Badge tone={a.cost === "free" ? "good" : a.cost === "paid" ? "warning" : "info"} className="mr-1">{a.cost === "free" ? "Free" : a.cost === "paid" ? "Paid" : "Free · approval"}</Badge>{a.costNote !== "Free" && a.costNote}</dd></div>
                {a.env.length > 0 && <div className="flex gap-2"><dt className="w-10 shrink-0 text-text-3">Env</dt><dd className="font-mono text-[11px] break-all text-text-2">{a.env.join(", ")}</dd></div>}
              </dl>
              <p className="mt-2 flex-1 text-[12.5px] text-text-2">{a.setup}</p>
              <div className="mt-3">{action(a)}</div>
            </article>
          );
        })}
      </div>
    </Page>
  );
}
