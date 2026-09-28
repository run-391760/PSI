import { CalendarDays, Plus } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { BrandSwitcher } from "@/components/cx/brand-switcher";
import { LinkBuilder, LinksTable } from "@/components/cx/publishing/links";
import { BulkUpload, PostsTable } from "@/components/cx/publishing/posts-table";
import { ConnectionsPanel, RolesPanel } from "@/components/cx/publishing/settings";
import { NoBrand, PubNav } from "@/components/cx/publishing/shared";
import { Page, PageHeader } from "@/components/shell/page";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Callout } from "@/components/ui/feedback";
import { Metric, MetricStrip } from "@/components/ui/metric";
import { requirePageUser } from "@/lib/auth";
import { STATUS_LABEL, renderText, type PostStatus } from "@/lib/cx/publishing/core";
import { connections, getSettings, listCampaigns, listLinks, listMembers, listPosts, pubContext, shortUrl, statusCounts } from "@/lib/cx/publishing/data";
import { headers } from "next/headers";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Publishing" };

const STATUSES: PostStatus[] = ["draft", "pending", "approved", "scheduled", "published", "failed"];

export default async function PublishingPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requirePageUser();
  const sp = await searchParams;
  const { brand, switcher, access } = await pubContext(user.id, sp);
  if (!brand || !access) return <NoBrand title="Publishing" />;
  const tab = typeof sp.tab === "string" ? sp.tab : "posts";
  const status = typeof sp.status === "string" && (STATUSES as string[]).includes(sp.status) ? sp.status : undefined;
  const [counts, conns, settings] = await Promise.all([statusCounts(brand.id), connections(brand.id), getSettings(brand.id)]);
  const q = `brand=${brand.id}`;
  const connected = conns.filter((c) => c.connected && c.publishApi);
  const total = Object.values(counts).reduce((a, b) => a + (b ?? 0), 0);

  return (
    <Page>
      <PageHeader
        breadcrumbs={[{ label: "CX" }, { label: "Publishing" }]}
        title="Publishing"
        subject={brand.name}
        description="Compose multi-channel posts, run them through approval, schedule and publish them, and track every link click."
        meta={
          <>
            <Badge tone={connected.length ? "good" : "neutral"}>{connected.length ? `${connected.length} channel${connected.length > 1 ? "s" : ""} connected` : "No publishing API connected"}</Badge>
            {settings.requireApproval && <Badge tone="info">Approval required</Badge>}
            {!access.canAuthor && <Badge>Read-only</Badge>}
          </>
        }
        actions={
          <>
            <BrandSwitcher brands={switcher} current={brand.id} />
            {access.canAuthor && <BulkUpload brandId={brand.id} />}
            {access.canAuthor && (
              <ButtonLink href={`/cx/publishing/new?${q}`} variant="primary">
                <Plus className="h-4 w-4" /> New post
              </ButtonLink>
            )}
          </>
        }
      />
      <PubNav brandId={brand.id} pending={counts.pending} />

      {tab === "links" ? (
        <LinksTab brandId={brand.id} />
      ) : tab === "settings" ? (
        <SettingsTab brand={brand} isOwner={access.isOwner} conns={conns} requireApproval={settings.requireApproval} />
      ) : (
        <>
          <MetricStrip className="mb-4">
            <Metric label="Posts" value={total.toLocaleString("en-US")} />
            <Metric label="Pending approval" value={(counts.pending ?? 0).toLocaleString("en-US")} href={`/cx/publishing?${q}&tab=approvals`} />
            <Metric label="Scheduled" value={(counts.scheduled ?? 0).toLocaleString("en-US")} href={`/cx/publishing/calendar?${q}`} />
            <Metric label="Published" value={(counts.published ?? 0).toLocaleString("en-US")} />
            <Metric label="Failed / not connected" value={(counts.failed ?? 0).toLocaleString("en-US")} href={`/cx/publishing?${q}&status=failed`} />
          </MetricStrip>
          {!connected.length && (
            <Callout tone="info" className="mb-4" title="No publishing API is connected on this server">
              You can still compose, approve and schedule posts; when a post is due on a channel that is not connected it is marked “channel not connected”. See{" "}
              <Link className="text-link hover:underline" href={`/cx/publishing?${q}&tab=settings`}>Channels & roles</Link> for what each network needs (Meta and LinkedIn are free with app review, X API is paid).
            </Callout>
          )}
          {tab === "approvals" ? <ApprovalsTab brandId={brand.id} canApprove={access.canApprove} canAuthor={access.canAuthor} /> : <PostsTab brandId={brand.id} status={status} counts={counts} canAuthor={access.canAuthor} />}
        </>
      )}
    </Page>
  );
}

function toItems(rows: Awaited<ReturnType<typeof listPosts>>) {
  return rows.map((p) => ({
    id: p.id,
    title: p.title,
    excerpt: renderText(p.body, {}, "", () => null).slice(0, 200),
    status: p.status,
    channels: p.channels,
    campaign: p.campaign,
    author: p.author,
    scheduled_at: p.scheduled_at ? new Date(p.scheduled_at).toISOString() : null,
    published_at: p.published_at ? new Date(p.published_at).toISOString() : null,
    updated_at: new Date(p.updated_at).toISOString(),
    results: p.results,
    media: p.media.length,
  }));
}

async function PostsTab({ brandId, status, counts, canAuthor }: { brandId: string; status?: string; counts: Partial<Record<PostStatus, number>>; canAuthor: boolean }) {
  const rows = await listPosts(brandId, { status });
  const chip = (s: string | undefined, label: string, n?: number) => (
    <Link
      key={label}
      href={`/cx/publishing?brand=${brandId}${s ? `&status=${s}` : ""}`}
      className={cn("rounded-full border px-2.5 py-1 text-[12.5px]", status === s ? "border-brand bg-brand-soft text-text" : "border-border text-text-2 hover:bg-surface-3")}
    >
      {label} {n != null && <span className="text-text-3">{n}</span>}
    </Link>
  );
  return (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-1.5">
        {chip(undefined, "All")}
        {STATUSES.map((s) => chip(s, STATUS_LABEL[s], counts[s] ?? 0))}
        <ButtonLink href={`/cx/publishing/calendar?brand=${brandId}`} variant="ghost" size="sm" className="ml-auto">
          <CalendarDays className="h-4 w-4" /> Calendar
        </ButtonLink>
      </div>
      <PostsTable brandId={brandId} rows={toItems(rows)} canAuthor={canAuthor} empty={status ? `No ${STATUS_LABEL[status as PostStatus].toLowerCase()} posts.` : "No posts yet. Create your first post or bulk-schedule from a CSV."} />
    </>
  );
}

async function ApprovalsTab({ brandId, canApprove, canAuthor }: { brandId: string; canApprove: boolean; canAuthor: boolean }) {
  const rows = await listPosts(brandId, { status: "pending" });
  return (
    <>
      <p className="mb-3 text-[13px] text-text-2">
        {canApprove ? "Open a post to approve it or request changes with a comment." : "Posts waiting for an approver. You can comment on them; approvers decide."}
      </p>
      <PostsTable brandId={brandId} rows={toItems(rows)} canAuthor={canAuthor} empty="Nothing waiting for approval." />
    </>
  );
}

async function LinksTab({ brandId }: { brandId: string }) {
  const [links, campaigns] = await Promise.all([listLinks(brandId), listCampaigns(brandId)]);
  const h = await headers();
  const origin = `${h.get("x-forwarded-proto") ?? "http"}://${h.get("x-forwarded-host") ?? h.get("host")}`;
  return (
    <div className="grid gap-5 xl:grid-cols-[420px_1fr]">
      <div className="min-w-0">
        <LinkBuilder brandId={brandId} campaigns={campaigns.map((c) => ({ id: c.id, name: c.name }))} />
      </div>
      <Card className="min-w-0 p-3">
        <LinksTable
          brandId={brandId}
          rows={links.map((l) => ({ ...l, short: shortUrl(origin, l.code), created_at: new Date(l.created_at).toISOString(), last_click: l.last_click ? new Date(l.last_click).toISOString() : null }))}
        />
      </Card>
    </div>
  );
}

async function SettingsTab({ brand, isOwner, conns, requireApproval }: { brand: { id: string; name: string; domain: string; owner_id: string }; isOwner: boolean; conns: Awaited<ReturnType<typeof connections>>; requireApproval: boolean }) {
  const members = await listMembers(brand);
  return (
    <div className="grid gap-5">
      {!isOwner && <Callout tone="info">Only the brand owner can link accounts and change roles.</Callout>}
      <ConnectionsPanel brandId={brand.id} items={conns.map((c) => ({ ...c, label: "" }))} canEdit={isOwner} />
      <RolesPanel brandId={brand.id} members={members} requireApproval={requireApproval} isOwner={isOwner} />
    </div>
  );
}
