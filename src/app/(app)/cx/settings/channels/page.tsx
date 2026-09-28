import type { Metadata } from "next";
import { headers } from "next/headers";
import { BrandSwitcher } from "@/components/cx/brand-switcher";
import { NoBrand } from "@/components/cx/inbox/ui";
import { Page, PageHeader } from "@/components/shell/page";
import { Badge } from "@/components/ui/badge";
import { requirePageUser } from "@/lib/auth";
import { cxContext } from "@/lib/cx/context";
import { listChannels } from "@/lib/cx/inbox/channels";
import { availableChannels } from "@/lib/cx/providers";
import { cardConfigured, CONNECT_CARDS, CONNECTORS, listConnectorChannels } from "@/lib/cx/admin/connectors";
import { ChannelsClient } from "./channels-client";
import { ConnectorsSection } from "./connectors-client";

export const metadata: Metadata = { title: "Channels" };

export default async function Page_({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requirePageUser();
  const sp = await searchParams;
  const { brand, switcher } = await cxContext(user.id, sp);
  const crumbs = [{ label: "CX" }, { label: "Settings" }, { label: "Channels" }];
  if (!brand) return <NoBrand title="Channels" breadcrumbs={crumbs} redirect="/cx/settings/channels" />;
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3200";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") || host.startsWith("127.") ? "http" : "https");
  const [channels, connectorRows] = await Promise.all([listChannels(brand.id), listConnectorChannels(brand.id)]);
  const env = {
    whatsappVerify: !!process.env.WHATSAPP_VERIFY_TOKEN,
    whatsappSend: !!process.env.WHATSAPP_TOKEN && !!process.env.WHATSAPP_PHONE_NUMBER_ID,
    metaVerify: !!process.env.META_VERIFY_TOKEN,
    metaSecret: !!process.env.META_APP_SECRET,
  };
  return (
    <Page>
      <PageHeader
        title="Channels"
        subject={brand.name}
        breadcrumbs={crumbs}
        description="Connect the channels your customers use. Email, live chat and web forms are built in and free; social and messaging channels need their platform's API."
        meta={
          <>
            <Badge tone="good">{channels.filter((c) => c.status !== "paused").length} active</Badge>
            <Badge>{channels.length} connected</Badge>
          </>
        }
        actions={<BrandSwitcher brands={switcher} current={brand.id} />}
      />
      <ChannelsClient brand={brand.id} origin={`${proto}://${host}`} channels={channels} available={availableChannels()} env={env} />
      <ConnectorsSection brand={brand.id} connectors={[...CONNECTORS]} cards={CONNECT_CARDS.map((c) => ({ ...c, configured: cardConfigured(c.env) }))} rows={connectorRows} />
    </Page>
  );
}
