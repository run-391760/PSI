import type { Metadata } from "next";
import { headers } from "next/headers";
import { Page } from "@/components/shell/page";
import { Badge } from "@/components/ui/badge";
import { TabsNav } from "@/components/ui/tabs";
import { listTokens } from "@/lib/cx/admin/api";
import { listExternalApis, listWebhooks, recentDeliveries } from "@/lib/cx/admin/webhooks";
import { AdminHeader, adminPage, tabHref } from "../_admin/shell";
import { ApiDocsPanel, ExternalApisPanel, TokensPanel, WebhooksPanel } from "./api-client";

export const metadata: Metadata = { title: "API & webhooks" };
const PATH = "/cx/settings/api";

export default async function ApiPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { el, ctx } = await adminPage(await searchParams, { title: "API & webhooks", path: PATH, perm: "page:settings.api" });
  if (!ctx) return el;
  const { brand } = ctx;
  const tab = ctx.tab ?? "tokens";
  const h = await headers();
  const origin = process.env.APP_URL?.replace(/\/$/, "") || `${h.get("x-forwarded-proto") ?? "http"}://${h.get("host") ?? "localhost"}`;
  const base = `${origin}/api/cx/v1`;
  const [tokens, hooks, apis] = await Promise.all([listTokens(brand.id), listWebhooks(brand.id), listExternalApis(brand.id)]);
  return (
    <Page>
      <AdminHeader
        title="API & webhooks" brand={brand} switcher={ctx.switcher} crumbs={ctx.crumbs}
        description="A REST API for tickets, messages, classifications and fields; signed webhooks for events; and External APIs that bring your own systems' data into tickets."
        meta={<><Badge tone="info">{tokens.filter((t) => !t.revoked_at).length} active tokens</Badge><Badge>{hooks.filter((w) => w.active).length} webhooks</Badge><Badge>{apis.length} External APIs</Badge></>}
      />
      <TabsNav className="mb-4" items={[
        { href: tabHref(PATH, brand.id, "tokens"), label: "Tokens" },
        { href: tabHref(PATH, brand.id, "webhooks"), label: "Webhooks", count: hooks.length },
        { href: tabHref(PATH, brand.id, "external"), label: "External APIs", count: apis.length },
        { href: tabHref(PATH, brand.id, "docs"), label: "Reference" },
      ]} />
      {tab === "webhooks" ? <WebhooksPanel brand={brand.id} hooks={hooks} deliveries={await recentDeliveries(brand.id, 50)} />
        : tab === "external" ? <ExternalApisPanel brand={brand.id} apis={apis} />
        : tab === "docs" ? <ApiDocsPanel base={base} />
        : <TokensPanel brand={brand.id} tokens={tokens} base={base} />}
    </Page>
  );
}
