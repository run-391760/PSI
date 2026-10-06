import type { Metadata } from "next";
import { Badge } from "@/components/ui/badge";
import { Page } from "@/components/shell/page";
import { CHANNELS } from "@/lib/cx/channels";
import { CONNECT_CARDS, CONNECTORS, cardConfigured } from "@/lib/cx/admin/connectors";
import { listProfiles } from "@/lib/cx/admin/profiles";
import { pickWhatsAppSender } from "@/lib/cx/providers";
import { requestOrigin, settingsPage, SettingsHeader } from "../_admin/settings-page";
import { ProfilesClient, type ApiInfo } from "./profiles-client";

export const metadata: Metadata = { title: "Omni-Channel Setup" };

/** Omni-Channel Setup: every connected profile, grouped by network, with ADD PROFILE for every connect flow. */
export default async function ChannelsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { el, ctx } = await settingsPage(await searchParams, { title: "Omni-Channel Setup", path: "/cx/settings/channels", perm: "page:settings.channels" });
  if (!ctx) return el;
  const [profiles, origin] = await Promise.all([listProfiles(ctx.brand.id), requestOrigin()]);
  // Replies go out from each WhatsApp profile's own phone number id (WHATSAPP_PHONE_NUMBER_ID is the fallback),
  // and Meta API calls only need the Page token; META_APP_SECRET + META_VERIFY_TOKEN are for webhooks.
  const whatsapp = profiles.filter((p) => p.kind === "whatsapp");
  const env = {
    whatsappVerify: !!process.env.WHATSAPP_VERIFY_TOKEN,
    whatsappSend: whatsapp.length
      ? whatsapp.every((p) => !!pickWhatsAppSender({ phoneId: p.config?.accountId ?? null, token: p.has_secret ? "stored" : null }, process.env))
      : !!pickWhatsAppSender(null, process.env),
    metaVerify: !!process.env.META_VERIFY_TOKEN,
    metaSecret: !!process.env.META_APP_SECRET,
  };
  const apiInfo: ApiInfo[] = ["x", "youtube", "gbp"].map((kind) => {
    const c = CHANNELS.find((x) => x.kind === kind);
    const card = CONNECT_CARDS.find((x) => x.kind === kind);
    const envVars = [...(card?.env ?? c?.env ?? [])];
    return { kind, name: c?.name ?? card?.name ?? kind, api: card?.api ?? c?.api ?? "", cost: card?.cost ?? c?.cost ?? "free-approval", costNote: card?.costNote ?? c?.costNote ?? "", env: envVars, setup: c?.setup ?? "", configured: envVars.length > 0 && cardConfigured(envVars) };
  });
  const active = profiles.filter((p) => p.status === "active" && !p.last_error).length;
  return (
    <Page>
      <SettingsHeader
        title="Omni-Channel Setup"
        ctx={ctx}
        description="The profiles your team answers from. Conversations from them arrive in Tickets; each profile's color identifies it in reports and filters."
        meta={<><Badge tone="good">{active} active</Badge><Badge>{profiles.length} profile{profiles.length === 1 ? "" : "s"}</Badge></>}
      />
      <ProfilesClient
        brand={ctx.brand.id}
        origin={origin}
        env={env}
        profiles={profiles}
        connectors={CONNECTORS.map((c) => ({ ...c }))}
        apiInfo={apiInfo}
        canEdit={ctx.canEdit}
      />
    </Page>
  );
}
