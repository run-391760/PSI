import type { Metadata } from "next";
import { Page } from "@/components/shell/page";
import { Badge } from "@/components/ui/badge";
import { listSocialProfiles } from "@/lib/cx/admin/social-profiles";
import { settingsPage, SettingsHeader } from "../_admin/settings-page";
import { SocialClient } from "./social-client";

export const metadata: Metadata = { title: "More Social Profiles" };

export default async function SocialProfilesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { el, ctx } = await settingsPage(await searchParams, { title: "More Social Profiles", path: "/cx/settings/social-profiles", perm: null });
  if (!ctx) return el;
  const profiles = await listSocialProfiles(ctx.brand.id);
  const canEdit = ctx.canEdit && ctx.perms.includes("page:settings.channels");
  return (
    <Page>
      <SettingsHeader title="More Social Profiles" ctx={ctx} description="Public profiles tracked without login, such as competitors and partner pages."
        meta={<><Badge tone="good">{profiles.filter((p) => p.fetchable && p.active).length} tracked</Badge>{profiles.some((p) => !p.fetchable) && <Badge tone="warning">{profiles.filter((p) => !p.fetchable).length} need an API</Badge>}</>} />
      <SocialClient brand={ctx.brand.id} profiles={profiles} canEdit={canEdit} keys={{ reddit: !!process.env.REDDIT_CLIENT_ID && !!process.env.REDDIT_CLIENT_SECRET, youtube: !!process.env.YOUTUBE_API_KEY }} />
    </Page>
  );
}
