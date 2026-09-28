import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { BrandSwitcher } from "@/components/cx/brand-switcher";
import { Composer } from "@/components/cx/publishing/composer";
import { NoBrand, PubNav, StatusBadge } from "@/components/cx/publishing/shared";
import { Page, PageHeader } from "@/components/shell/page";
import { requirePageUser } from "@/lib/auth";
import { aiConfigured } from "@/lib/cx/ai";
import { AppError } from "@/lib/domain";
import { connections, bestTimeData, getPost, getSettings, hashtagData, listAssets, listCampaigns, listMembers, postApprovals, postComments, pubContext, statusCounts } from "@/lib/cx/publishing/data";
import { canDelete, imageGenConfigured } from "@/lib/cx/publishing/adapters";
import { hashtagSuggestions } from "@/lib/cx/publishing/suggest";

export const metadata: Metadata = { title: "Post composer" };

export default async function PostPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requirePageUser();
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const { brand, switcher, access } = await pubContext(user.id, sp);
  if (!brand || !access) return <NoBrand title="New post" />;
  const isNew = id === "new";
  const post = isNew
    ? null
    : await getPost(brand.id, id).catch((e) => {
        if (e instanceof AppError && e.status === 404) notFound();
        throw e;
      });
  const [conns, assets, campaigns, members, settings, comments, counts, decisions, bestTime, tagData] = await Promise.all([
    connections(brand.id),
    listAssets(brand.id),
    listCampaigns(brand.id),
    listMembers(brand),
    getSettings(brand.id),
    post ? postComments(post.id) : Promise.resolve([]),
    statusCounts(brand.id),
    post ? postApprovals(post.id) : Promise.resolve([]),
    bestTimeData(brand.id),
    hashtagData(brand.id),
  ]);
  const hashtags = hashtagSuggestions({ mentions: tagData.mentions, posts: tagData.posts, brand: brand.name, limit: 30 });
  const h = await headers();
  const origin = (process.env.APP_URL || `${h.get("x-forwarded-proto") ?? "http"}://${h.get("x-forwarded-host") ?? h.get("host")}`).replace(/\/$/, "");
  const date = typeof sp.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(sp.date) ? sp.date : null;
  const iso = (v: string | null) => (v ? new Date(v).toISOString() : null);

  return (
    <Page>
      <PageHeader
        breadcrumbs={[{ label: "CX" }, { label: "Publishing", href: `/cx/publishing?brand=${brand.id}` }, { label: isNew ? "New post" : "Post" }]}
        title={isNew ? "New post" : post!.title || "Post"}
        subject={brand.name}
        meta={post ? <StatusBadge status={post.status} /> : undefined}
        actions={<BrandSwitcher brands={switcher} current={brand.id} />}
      />
      <PubNav brandId={brand.id} pending={counts.pending} />
      <Composer
        key={post ? `${post.id}:${post.updated_at}` : "new"}
        brandId={brand.id}
        brandName={brand.name}
        domain={brand.domain}
        origin={origin}
        post={
          post && {
            id: post.id,
            status: post.status,
            title: post.title,
            body: post.body,
            variants: post.variants,
            channels: post.channels,
            media: post.media,
            first_comment: post.first_comment,
            link_url: post.link_url,
            utm: post.utm,
            links: post.links,
            campaign_id: post.campaign_id,
            approver_id: post.approver_id,
            scheduled_at: iso(post.scheduled_at),
            published_at: iso(post.published_at),
            results: post.results,
            author: post.author,
            post_type: post.post_type,
            options: post.options,
            approver_ids: post.approver_ids,
            content_tags: post.content_tags,
          }
        }
        channels={conns.map((c) => ({ kind: c.kind, connected: c.connected, reason: c.reason, publishApi: c.publishApi }))}
        assets={assets.map((a) => ({ id: a.id, filename: a.filename, mime: a.mime, tags: a.tags, approval: a.approval }))}
        campaigns={campaigns.map((c) => ({ id: c.id, name: c.name }))}
        approvers={members.filter((m) => m.roles.includes("approver")).map((m) => ({ user_id: m.user_id, name: m.owner ? `${m.name} (owner)` : m.name }))}
        ai={aiConfigured()}
        canAuthor={access.canAuthor}
        canApprove={access.canApprove}
        requireApproval={settings.requireApproval}
        comments={comments.map((c) => ({ ...c, created_at: new Date(c.created_at).toISOString() }))}
        initialDate={date}
        userId={user.id}
        decisions={decisions.map((d) => ({ user_id: d.user_id, name: d.name, decision: d.decision, comment: d.comment ?? "", at: d.at ? new Date(d.at).toISOString() : "" }))}
        requireAssetApproval={settings.requireAssetApproval}
        tags={{ defined: settings.contentTags, canCreate: access.isTagManager, locked: settings.tagPolicy === "managers" && !access.isTagManager }}
        bestTime={bestTime}
        hashtags={hashtags}
        imageAi={imageGenConfigured()}
        deletable={conns.filter((c) => canDelete(c.kind) && (c.connected || c.kind === "youtube")).map((c) => c.kind)}
      />
    </Page>
  );
}
