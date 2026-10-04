import { KeyRound } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { BrandSwitcher } from "@/components/cx/brand-switcher";
import { Avatar, NoBrand } from "@/components/cx/inbox/ui";
import { NameForm, PrefsForm, SignatureForm } from "@/components/cx/ops/profile-forms";
import { Page, PageHeader } from "@/components/shell/page";
import { Badge, type Tone } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { requirePageUser } from "@/lib/auth";
import { cxContext, type CxRole } from "@/lib/cx/context";
import { getPrefs } from "@/lib/cx/inbox/settings";
import { getSignature } from "@/lib/cx/inbox/workspace";
import { getNotifyPrefs, profileData } from "@/lib/cx/ops/profile";
import { dateLabel } from "@/lib/format";

export const metadata: Metadata = { title: "My profile" };

const ROLE_LABEL: Record<CxRole, string> = { owner: "Owner", admin: "Admin", supervisor: "Supervisor", agent: "Agent", viewer: "Viewer" };
const ROLE_TONE: Record<CxRole, Tone> = { owner: "brand", admin: "info", supervisor: "info", agent: "neutral", viewer: "neutral" };
const ROLE_HINT: Record<CxRole, string> = {
  owner: "Owns this brand: full access; paid API calls count against your budget.",
  admin: "Manage settings, team and all data.",
  supervisor: "Assign tickets, review quality, see reports.",
  agent: "Handle assigned conversations.",
  viewer: "Read-only access to reports.",
};

export default async function ProfilePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requirePageUser();
  const sp = await searchParams;
  const { brand, switcher } = await cxContext(user.id, sp);
  const crumbs = [{ label: "CX" }, { label: "My profile" }];
  if (!brand) return <NoBrand title="My profile" breadcrumbs={crumbs} redirect="/cx/profile" />;

  const [profile, signature, notify, inbox] = await Promise.all([profileData(user.id), getSignature(brand.id, user.id), getNotifyPrefs(user.id), getPrefs(user.id)]);
  const current = profile.memberships.find((m) => m.id === brand.id);

  return (
    <Page>
      <PageHeader
        title="My profile"
        subject={profile.name || profile.email}
        breadcrumbs={crumbs}
        description="Your name, email signature and notification preferences across the CX workspace."
        actions={<BrandSwitcher brands={switcher} current={brand.id} />}
      />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0 space-y-4">
          <Card>
            <CardHeader title="Account" description="How teammates see you on tickets, notes and tasks." actions={<ButtonLink href="/settings" size="sm" variant="secondary"><KeyRound className="h-3.5 w-3.5" /> Change password</ButtonLink>} />
            <CardBody>
              <NameForm name={profile.name} email={profile.email} />
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Email signature" description={<>For <span className="font-medium text-text-2">{brand.name}</span>. Each brand has its own signature; switch brand in the header to edit another.</>} />
            <CardBody>
              <SignatureForm key={brand.id} brand={brand.id} brandName={brand.name} body={signature.body} enabled={signature.enabled} imageUrl={signature.imageUrl} />
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Notifications & inbox" description="Changes save as you toggle. These apply to you in every brand." />
            <CardBody>
              <PrefsForm notify={notify} inbox={{ soundNewTicket: inbox.soundNewTicket, soundNewMessage: inbox.soundNewMessage, enterToSend: inbox.enterToSend }} />
            </CardBody>
          </Card>
        </div>
        <div className="min-w-0 space-y-4">
          <Card>
            <CardBody className="pt-4">
              <div className="flex items-center gap-3">
                <Avatar name={profile.name || profile.email} className="h-11 w-11 text-[14px]" />
                <div className="min-w-0">
                  <div className="truncate text-[14px] font-semibold text-text">{profile.name || "No name set"}</div>
                  <div className="truncate text-[12.5px] text-text-3">{profile.email}</div>
                </div>
              </div>
              <dl className="mt-3 space-y-1.5 text-[12.5px]">
                <div className="flex justify-between gap-2"><dt className="text-text-3">Role in {brand.name}</dt><dd><Badge tone={ROLE_TONE[brand.role]}>{ROLE_LABEL[brand.role]}</Badge></dd></div>
                <div className="flex justify-between gap-2"><dt className="text-text-3">Team</dt><dd className="text-text">{current?.team ?? "n/a"}</dd></div>
                <div className="flex justify-between gap-2"><dt className="text-text-3">Member since</dt><dd className="text-text">{current?.joined ? dateLabel(current.joined) : "n/a"}</dd></div>
                <div className="flex justify-between gap-2"><dt className="text-text-3">Account created</dt><dd className="text-text">{profile.since ? dateLabel(profile.since) : "n/a"}</dd></div>
              </dl>
              <p className="mt-3 text-[12px] text-text-3">{ROLE_HINT[brand.role]}</p>
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="My brands" description={`${profile.memberships.length} brand${profile.memberships.length === 1 ? "" : "s"} you can open in CX.`} />
            <CardBody className="px-0 pb-1">
              <ul className="divide-y divide-border">
                {profile.memberships.map((m) => (
                  <li key={m.id} className="flex min-w-0 items-center gap-2 px-4 py-2">
                    <div className="min-w-0 flex-1">
                      <Link href={`/cx/profile?brand=${m.id}`} className={`block truncate text-[13px] font-medium hover:text-link ${m.id === brand.id ? "text-link" : "text-text"}`}>{m.name}</Link>
                      <div className="truncate text-[12px] text-text-3">{m.domain}{m.team ? ` · ${m.team}` : ""}</div>
                    </div>
                    <Badge tone={ROLE_TONE[m.role]}>{ROLE_LABEL[m.role]}</Badge>
                  </li>
                ))}
              </ul>
            </CardBody>
          </Card>
        </div>
      </div>
    </Page>
  );
}
