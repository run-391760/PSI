import type { Metadata } from "next";
import Link from "next/link";
import { Page } from "@/components/shell/page";
import { currentIp, getIpSettings } from "@/lib/cx/admin/ip";
import { settingsPage, SettingsHeader } from "../../_admin/settings-page";
import { IpClient } from "./ip-client";

export const metadata: Metadata = { title: "IP whitelisting" };

export default async function IpPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { el, ctx } = await settingsPage(await searchParams, { title: "IP whitelisting", path: "/cx/settings/users/ip", perm: "page:settings.roles" });
  if (!ctx) return el;
  const [s, ip] = await Promise.all([getIpSettings(ctx.brand.id, true), currentIp()]);
  return (
    <Page>
      <SettingsHeader title="IP whitelisting" ctx={{ ...ctx, crumbs: [...ctx.crumbs.slice(0, 2), { label: "Users", href: `/cx/settings/users?brand=${ctx.brand.id}` }, { label: "IP whitelisting" }] }}
        description={<>Limit who can open this brand by network. {s.updatedAt && <>Last changed by {s.updatedBy ?? "n/a"}. </>}<Link href={`/cx/settings/users?brand=${ctx.brand.id}`} className="text-link hover:underline">Back to Users</Link></>} />
      <IpClient brand={ctx.brand.id} enabled={s.enabled} cidrs={s.cidrs} currentIp={ip} isOwner={ctx.brand.role === "owner"} canEdit={ctx.canEdit} />
    </Page>
  );
}
