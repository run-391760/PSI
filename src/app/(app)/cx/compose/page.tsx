import type { Metadata } from "next";
import Link from "next/link";
import { BrandSwitcher } from "@/components/cx/brand-switcher";
import { ChannelIcon, NoBrand, StatusBadge, channelLabel } from "@/components/cx/inbox/ui";
import { ComposeForm } from "@/components/cx/ops/compose-form";
import { Page, PageHeader } from "@/components/shell/page";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { requirePageUser } from "@/lib/auth";
import { CHANNELS } from "@/lib/cx/channels";
import { cxContext } from "@/lib/cx/context";
import { getInboxSettings } from "@/lib/cx/inbox/settings";
import { listAgents } from "@/lib/cx/inbox/store";
import { emailSuggestions, getSignature } from "@/lib/cx/inbox/workspace";
import { composeChannels, recentComposed } from "@/lib/cx/ops/compose";
import { COMPOSE_CAPS, composeCap } from "@/lib/cx/ops/model";
import { timeAgo } from "@/lib/format";

export const metadata: Metadata = { title: "Compose message" };

export default async function ComposePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requirePageUser();
  const sp = await searchParams;
  const { brand, switcher } = await cxContext(user.id, sp);
  const crumbs = [{ label: "CX" }, { label: "Compose message" }];
  if (!brand) return <NoBrand title="Compose message" breadcrumbs={crumbs} redirect="/cx/compose" />;
  const [channels, agents, recent, settings, signature, suggestions] = await Promise.all([
    composeChannels(brand.id), listAgents(brand.id), recentComposed(brand.id), getInboxSettings(brand.id), getSignature(brand.id, user.id), emailSuggestions(brand.id),
  ]);
  const email = CHANNELS.find((c) => c.kind === "email")!;
  const s = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : "");
  return (
    <Page>
      <PageHeader
        title="Compose message"
        subject={brand.name}
        breadcrumbs={crumbs}
        description="Start a new outbound conversation on a connected channel. It becomes a ticket (waiting for the customer) and the customer's reply threads back into it."
        actions={<BrandSwitcher brands={switcher} current={brand.id} />}
      />
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
        <ComposeForm
          brand={brand.id}
          me={{ id: user.id, name: user.name || user.email }}
          readOnly={brand.role === "viewer"}
          channels={channels.map((c) => ({ ...c, canStart: composeCap(c.kind).canStart && c.status !== "paused", how: composeCap(c.kind).how, needs: composeCap(c.kind).needs ?? null }))}
          agents={agents.map((a) => ({ id: a.id, name: a.name }))}
          allowedDomains={settings.allowedEmailDomains}
          hasSignature={signature.enabled && (!!signature.body.trim() || !!signature.imageFileId)}
          suggestions={suggestions}
          initial={{ to: s("to"), name: s("name"), subject: s("subject") }}
          emailSetup={{ api: email.api, setup: email.setup }}
        />
        <div className="space-y-4">
          <Card>
            <CardHeader title="What each channel allows" description="Platform rules for company-initiated conversations." />
            <CardBody className="space-y-2.5 pt-0">
              {COMPOSE_CAPS.map((c) => (
                <div key={c.kind} className="text-[12.5px]">
                  <div className="flex items-center gap-1.5"><ChannelIcon kind={c.kind} className="text-text-3" /><span className="font-medium text-text">{channelLabel(c.kind)}</span><Badge tone={c.canStart ? "good" : "neutral"}>{c.canStart ? "Can start" : "Reply only"}</Badge>{channels.some((x) => x.kind === c.kind) && <Badge tone="info">Connected</Badge>}</div>
                  <p className="mt-0.5 text-text-2">{c.how}</p>
                  {c.needs && <p className="text-text-3">Needs: {c.needs}</p>}
                </div>
              ))}
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Recently composed" description="Outbound conversations started here." href={`/cx/inbox?brand=${brand.id}&view=all&q=tag:outbound`} />
            <CardBody className="pt-0">
              {recent.length === 0 ? <p className="text-[12.5px] text-text-3">Nothing sent yet.</p> : (
                <ul className="space-y-2">
                  {recent.map((r) => (
                    <li key={r.id} className="text-[12.5px]">
                      <Link href={`/cx/inbox?brand=${brand.id}&view=all&t=${r.id}`} className="block truncate font-medium text-link hover:underline">#{r.number} {r.subject}</Link>
                      <div className="flex flex-wrap items-center gap-1.5 text-text-3">
                        <span className="truncate">{r.contact_email}</span><StatusBadge status={r.status} />
                        {r.delivery === "failed" ? <Badge tone="critical">Not sent</Badge> : r.replied ? <Badge tone="good">Replied</Badge> : <Badge>Awaiting reply</Badge>}
                        <span suppressHydrationWarning>{timeAgo(r.created_at)}</span>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>
        </div>
      </div>
    </Page>
  );
}
