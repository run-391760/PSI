import type { Metadata } from "next";
import { Page } from "@/components/shell/page";
import { getGroupDetails } from "@/lib/cx/admin/group";
import { settingsPage, SettingsHeader } from "../_admin/settings-page";
import { GroupClient } from "./group-client";

export const metadata: Metadata = { title: "Group Details" };

export default async function GroupPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { el, ctx } = await settingsPage(await searchParams, { title: "Group Details", path: "/cx/settings/group", perm: "page:settings.team" });
  if (!ctx) return el;
  const g = await getGroupDetails(ctx.brand.id);
  let zones: string[] = [];
  try {
    zones = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.("timeZone") ?? [];
  } catch {
    zones = [];
  }
  if (!zones.includes("UTC")) zones = ["UTC", ...zones];
  return (
    <Page>
      <SettingsHeader title="Group Details" ctx={ctx} description="This brand's identity across the CX workspace: name, logo, domain, region and time zone." />
      <GroupClient brand={ctx.brand.id} g={g} isOwner={ctx.brand.role === "owner"} canEdit={ctx.canEdit} zones={zones} />
    </Page>
  );
}
