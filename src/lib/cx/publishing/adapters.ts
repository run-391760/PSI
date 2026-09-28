/**
 * Channel adapters: publishing (Meta Graph API for Facebook Pages + Instagram, LinkedIn Posts API,
 * X API v2) and read-only insights (YouTube Data API, Meta, LinkedIn, X). Request builders and
 * response mappers are pure and fixture-tested; `send*` / `fetch*` do the HTTP. No DB imports here.
 */
import type { PubChannel } from "./core";

export type Creds = { externalId: string; token: string };
export type Media = { kind: "image" | "video"; mime: string; filename: string; publicUrl: string | null; read: () => Promise<Buffer> };
export type PublishInput = { text: string; firstComment: string; link: string | null; media: Media[] };
export type PublishOutput = { externalId: string; url: string | null; warnings: string[] };
export type HttpRequest = { method: "GET" | "POST"; url: string; headers?: Record<string, string>; body?: Record<string, unknown> };

const GRAPH = () => `https://graph.facebook.com/${process.env.META_GRAPH_VERSION || "v23.0"}`;
const LI_VERSION = () => process.env.LINKEDIN_API_VERSION || "202509";
const X_API = "https://api.x.com/2";

class ApiError extends Error {}

async function http<T = Record<string, unknown>>(req: HttpRequest, expect = "JSON"): Promise<{ json: T; headers: Headers }> {
  const res = await fetch(req.url, {
    method: req.method,
    headers: { ...(req.body ? { "content-type": "application/json" } : {}), ...req.headers },
    body: req.body ? JSON.stringify(req.body) : undefined,
    signal: AbortSignal.timeout(60_000),
  });
  const text = await res.text();
  let json: unknown = {};
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    if (expect === "JSON" && !res.ok) json = { raw: text.slice(0, 300) };
  }
  if (!res.ok) throw new ApiError(apiErrorMessage(json, res.status));
  return { json: json as T, headers: res.headers };
}

/** Human-readable error from Graph / LinkedIn / X / Google error bodies. */
export function apiErrorMessage(body: unknown, status: number): string {
  const b = (body ?? {}) as Record<string, any>;
  const msg =
    b.error?.message ?? // Graph + Google
    b.message ?? // LinkedIn
    b.detail ?? // X
    b.errors?.[0]?.message ??
    b.title ??
    b.raw;
  return `HTTP ${status}${msg ? `: ${String(msg).slice(0, 300)}` : ""}`;
}

// ================================================================= Facebook Page

export function facebookFeedRequest(c: Creds, input: PublishInput, mediaIds: string[] = []): HttpRequest {
  const body: Record<string, unknown> = { message: input.text, access_token: c.token };
  if (mediaIds.length) body.attached_media = mediaIds.map((id) => ({ media_fbid: id }));
  else if (input.link) body.link = input.link;
  return { method: "POST", url: `${GRAPH()}/${encodeURIComponent(c.externalId)}/feed`, body };
}
export function facebookPhotoRequest(c: Creds, url: string, published: boolean, caption?: string): HttpRequest {
  return { method: "POST", url: `${GRAPH()}/${encodeURIComponent(c.externalId)}/photos`, body: { url, published, ...(caption ? { caption } : {}), access_token: c.token } };
}
export function facebookVideoRequest(c: Creds, url: string, description: string): HttpRequest {
  return { method: "POST", url: `${GRAPH()}/${encodeURIComponent(c.externalId)}/videos`, body: { file_url: url, description, access_token: c.token } };
}

function requirePublicUrls(media: Media[], network: string) {
  const missing = media.filter((m) => !m.publicUrl);
  if (missing.length) throw new ApiError(`${network} downloads media from a public URL; set APP_URL to this server's public https address.`);
  return media.map((m) => m.publicUrl!);
}

async function sendFacebook(c: Creds, input: PublishInput): Promise<PublishOutput> {
  const warnings: string[] = [];
  let postId: string;
  const videos = input.media.filter((m) => m.kind === "video");
  const images = input.media.filter((m) => m.kind === "image");
  if (videos.length) {
    if (input.media.length > 1) warnings.push("Facebook: only the first video was published (mixed/multiple media not supported in one post).");
    const [url] = requirePublicUrls([videos[0]], "Facebook");
    postId = String((await http<{ id: string }>(facebookVideoRequest(c, url, input.text))).json.id);
  } else if (images.length === 1) {
    const [url] = requirePublicUrls(images, "Facebook");
    const r = (await http<{ id: string; post_id?: string }>(facebookPhotoRequest(c, url, true, input.text))).json;
    postId = String(r.post_id ?? r.id);
  } else {
    const ids: string[] = [];
    for (const url of requirePublicUrls(images, "Facebook")) ids.push(String((await http<{ id: string }>(facebookPhotoRequest(c, url, false))).json.id));
    postId = String((await http<{ id: string }>(facebookFeedRequest(c, input, ids))).json.id);
  }
  if (input.firstComment.trim())
    await http({ method: "POST", url: `${GRAPH()}/${postId}/comments`, body: { message: input.firstComment, access_token: c.token } }).catch((e) => warnings.push(`First comment failed: ${e.message}`));
  return { externalId: postId, url: `https://www.facebook.com/${postId}`, warnings };
}

// ================================================================= Instagram

export function instagramContainerRequest(c: Creds, m: { url: string; kind: "image" | "video" } | null, caption: string, opts: { carouselItem?: boolean; children?: string[] } = {}): HttpRequest {
  const body: Record<string, unknown> = { access_token: c.token };
  if (opts.children) Object.assign(body, { media_type: "CAROUSEL", children: opts.children.join(","), caption });
  else if (m?.kind === "video") Object.assign(body, { media_type: opts.carouselItem ? "VIDEO" : "REELS", video_url: m.url });
  else if (m) Object.assign(body, { image_url: m.url });
  if (opts.carouselItem) body.is_carousel_item = true;
  else if (!opts.children) body.caption = caption;
  return { method: "POST", url: `${GRAPH()}/${encodeURIComponent(c.externalId)}/media`, body };
}

async function waitContainer(c: Creds, id: string) {
  for (let i = 0; i < 30; i++) {
    const s = (await http<{ status_code?: string }>({ method: "GET", url: `${GRAPH()}/${id}?fields=status_code&access_token=${encodeURIComponent(c.token)}` })).json.status_code;
    if (!s || s === "FINISHED" || s === "PUBLISHED") return;
    if (s === "ERROR" || s === "EXPIRED") throw new ApiError(`Instagram could not process the media (${s}).`);
    await new Promise((r) => setTimeout(r, 5000));
  }
  throw new ApiError("Instagram media processing timed out.");
}

async function sendInstagram(c: Creds, input: PublishInput): Promise<PublishOutput> {
  if (!input.media.length) throw new ApiError("Instagram needs an image or video.");
  const urls = requirePublicUrls(input.media.slice(0, 10), "Instagram");
  const items = input.media.slice(0, 10).map((m, i) => ({ url: urls[i], kind: m.kind }));
  let creation: string;
  if (items.length === 1) {
    creation = String((await http<{ id: string }>(instagramContainerRequest(c, items[0], input.text))).json.id);
  } else {
    const children: string[] = [];
    for (const it of items) {
      const id = String((await http<{ id: string }>(instagramContainerRequest(c, it, "", { carouselItem: true }))).json.id);
      if (it.kind === "video") await waitContainer(c, id);
      children.push(id);
    }
    creation = String((await http<{ id: string }>(instagramContainerRequest(c, null, input.text, { children }))).json.id);
  }
  await waitContainer(c, creation);
  const mediaId = String((await http<{ id: string }>({ method: "POST", url: `${GRAPH()}/${encodeURIComponent(c.externalId)}/media_publish`, body: { creation_id: creation, access_token: c.token } })).json.id);
  const warnings: string[] = [];
  if (input.firstComment.trim())
    await http({ method: "POST", url: `${GRAPH()}/${mediaId}/comments`, body: { message: input.firstComment, access_token: c.token } }).catch((e) => warnings.push(`First comment failed: ${e.message}`));
  const permalink = await http<{ permalink?: string }>({ method: "GET", url: `${GRAPH()}/${mediaId}?fields=permalink&access_token=${encodeURIComponent(c.token)}` })
    .then((r) => r.json.permalink ?? null)
    .catch(() => null);
  return { externalId: mediaId, url: permalink, warnings };
}

// ================================================================= LinkedIn

/** LinkedIn "little text" format: reserved characters must be backslash-escaped. */
export const escapeLinkedIn = (s: string) => s.replace(/[\\|{}@[\]()<>#*_~]/g, (ch) => `\\${ch}`);

export function linkedinPostRequest(c: Creds, input: PublishInput, imageUrns: string[] = []): HttpRequest {
  const body: Record<string, unknown> = {
    author: c.externalId,
    commentary: escapeLinkedIn(input.text),
    visibility: "PUBLIC",
    distribution: { feedDistribution: "MAIN_FEED", targetEntities: [], thirdPartyDistributionChannels: [] },
    lifecycleState: "PUBLISHED",
    isReshareDisabledByAuthor: false,
  };
  if (imageUrns.length === 1) body.content = { media: { id: imageUrns[0] } };
  else if (imageUrns.length > 1) body.content = { multiImage: { images: imageUrns.map((id) => ({ id })) } };
  else if (input.link) body.content = { article: { source: input.link, title: input.link } };
  return { method: "POST", url: "https://api.linkedin.com/rest/posts", headers: liHeaders(c), body };
}
const liHeaders = (c: Creds) => ({ authorization: `Bearer ${c.token}`, "LinkedIn-Version": LI_VERSION(), "X-Restli-Protocol-Version": "2.0.0" });

async function sendLinkedIn(c: Creds, input: PublishInput): Promise<PublishOutput> {
  const warnings: string[] = [];
  const urns: string[] = [];
  for (const m of input.media) {
    if (m.kind !== "image") {
      warnings.push(`LinkedIn: video "${m.filename}" skipped (video upload is not supported by this adapter).`);
      continue;
    }
    const init = (await http<{ value: { uploadUrl: string; image: string } }>({ method: "POST", url: "https://api.linkedin.com/rest/images?action=initializeUpload", headers: liHeaders(c), body: { initializeUploadRequest: { owner: c.externalId } } })).json.value;
    const put = await fetch(init.uploadUrl, { method: "PUT", headers: { authorization: `Bearer ${c.token}`, "content-type": m.mime }, body: new Uint8Array(await m.read()), signal: AbortSignal.timeout(120_000) });
    if (!put.ok) throw new ApiError(`LinkedIn image upload failed (HTTP ${put.status}).`);
    urns.push(init.image);
  }
  const { headers } = await http(linkedinPostRequest(c, input, urns));
  const id = headers.get("x-restli-id") ?? headers.get("x-linkedin-id") ?? "";
  return { externalId: id, url: id ? `https://www.linkedin.com/feed/update/${id}/` : null, warnings };
}

// ================================================================= X

export function xTweetRequest(c: Creds, text: string, opts: { mediaIds?: string[]; replyTo?: string } = {}): HttpRequest {
  const body: Record<string, unknown> = { text };
  if (opts.mediaIds?.length) body.media = { media_ids: opts.mediaIds.slice(0, 4) };
  if (opts.replyTo) body.reply = { in_reply_to_tweet_id: opts.replyTo };
  return { method: "POST", url: `${X_API}/tweets`, headers: { authorization: `Bearer ${c.token}` }, body };
}

async function sendX(c: Creds, input: PublishInput): Promise<PublishOutput> {
  const warnings: string[] = [];
  const mediaIds: string[] = [];
  for (const m of input.media.slice(0, 4)) {
    if (m.kind !== "image") {
      warnings.push(`X: video "${m.filename}" skipped (chunked video upload is not supported by this adapter).`);
      continue;
    }
    const form = new FormData();
    form.set("media", new Blob([new Uint8Array(await m.read())], { type: m.mime }), m.filename);
    form.set("media_category", "tweet_image");
    const res = await fetch(`${X_API}/media/upload`, { method: "POST", headers: { authorization: `Bearer ${c.token}` }, body: form, signal: AbortSignal.timeout(120_000) });
    const j = (await res.json().catch(() => ({}))) as { data?: { id?: string } };
    if (!res.ok || !j.data?.id) throw new ApiError(apiErrorMessage(j, res.status));
    mediaIds.push(j.data.id);
  }
  const id = String((await http<{ data: { id: string } }>(xTweetRequest(c, input.text, { mediaIds }))).json.data.id);
  if (input.firstComment.trim()) await http(xTweetRequest(c, input.firstComment, { replyTo: id })).catch((e) => warnings.push(`Reply failed: ${e.message}`));
  return { externalId: id, url: `https://x.com/i/web/status/${id}`, warnings };
}

export const publishers: Partial<Record<PubChannel, (c: Creds, input: PublishInput) => Promise<PublishOutput>>> = {
  facebook: sendFacebook,
  instagram: sendInstagram,
  linkedin: sendLinkedIn,
  x: sendX,
};

// ================================================================= insights (read-only)

export type RecentItem = { id: string; title: string; url: string | null; at: string | null; views: number | null; likes: number | null; comments: number | null; shares: number | null };
export type ChannelStats = { kind: string; name: string; handle: string | null; url: string | null; followers: number | null; views: number | null; posts: number | null; recent: RecentItem[] };

const n = (v: unknown): number | null => (v == null || v === "" || Number.isNaN(Number(v)) ? null : Number(v));

export function mapYoutube(channelRes: any, videosRes: any): ChannelStats | null {
  const ch = channelRes?.items?.[0];
  if (!ch) return null;
  const s = ch.statistics ?? {};
  return {
    kind: "youtube",
    name: ch.snippet?.title ?? "YouTube channel",
    handle: ch.snippet?.customUrl ?? null,
    url: `https://www.youtube.com/channel/${ch.id}`,
    followers: s.hiddenSubscriberCount ? null : n(s.subscriberCount),
    views: n(s.viewCount),
    posts: n(s.videoCount),
    recent: (videosRes?.items ?? []).map((v: any) => ({
      id: String(v.id),
      title: v.snippet?.title ?? "",
      url: `https://www.youtube.com/watch?v=${v.id}`,
      at: v.snippet?.publishedAt ?? null,
      views: n(v.statistics?.viewCount),
      likes: n(v.statistics?.likeCount),
      comments: n(v.statistics?.commentCount),
      shares: null,
    })),
  };
}

export async function fetchYoutube(key: string, channelId: string): Promise<ChannelStats | null> {
  const base = "https://www.googleapis.com/youtube/v3";
  const isHandle = channelId.startsWith("@");
  const ch = (await http<any>({ method: "GET", url: `${base}/channels?part=snippet,statistics,contentDetails&${isHandle ? "forHandle" : "id"}=${encodeURIComponent(channelId)}&key=${encodeURIComponent(key)}` })).json;
  const uploads = ch?.items?.[0]?.contentDetails?.relatedPlaylists?.uploads;
  if (!ch?.items?.length) return null;
  let videos: any = { items: [] };
  if (uploads) {
    const pl = (await http<any>({ method: "GET", url: `${base}/playlistItems?part=contentDetails&maxResults=12&playlistId=${uploads}&key=${encodeURIComponent(key)}` })).json;
    const ids = (pl.items ?? []).map((i: any) => i.contentDetails?.videoId).filter(Boolean);
    if (ids.length) videos = (await http<any>({ method: "GET", url: `${base}/videos?part=snippet,statistics&id=${ids.join(",")}&key=${encodeURIComponent(key)}` })).json;
  }
  return mapYoutube(ch, videos);
}

export function mapFacebook(page: any, posts: any): ChannelStats {
  return {
    kind: "facebook",
    name: page?.name ?? "Facebook Page",
    handle: page?.username ?? null,
    url: page?.link ?? (page?.id ? `https://www.facebook.com/${page.id}` : null),
    followers: n(page?.followers_count ?? page?.fan_count),
    views: null,
    posts: null,
    recent: (posts?.data ?? []).map((p: any) => ({
      id: String(p.id),
      title: (p.message ?? "").slice(0, 140),
      url: p.permalink_url ?? null,
      at: p.created_time ?? null,
      views: null,
      likes: n(p.reactions?.summary?.total_count),
      comments: n(p.comments?.summary?.total_count),
      shares: n(p.shares?.count) ?? 0, // Graph omits "shares" when a post has none
    })),
  };
}
export function mapInstagram(user: any, media: any): ChannelStats {
  return {
    kind: "instagram",
    name: user?.name ?? user?.username ?? "Instagram",
    handle: user?.username ? `@${user.username}` : null,
    url: user?.username ? `https://www.instagram.com/${user.username}/` : null,
    followers: n(user?.followers_count),
    views: null,
    posts: n(user?.media_count),
    recent: (media?.data ?? []).map((m: any) => ({ id: String(m.id), title: (m.caption ?? "").slice(0, 140), url: m.permalink ?? null, at: m.timestamp ?? null, views: null, likes: n(m.like_count), comments: n(m.comments_count), shares: null })),
  };
}
export function mapX(user: any, tweets: any): ChannelStats {
  const u = user?.data ?? {};
  return {
    kind: "x",
    name: u.name ?? "X account",
    handle: u.username ? `@${u.username}` : null,
    url: u.username ? `https://x.com/${u.username}` : null,
    followers: n(u.public_metrics?.followers_count),
    views: null,
    posts: n(u.public_metrics?.tweet_count),
    recent: (tweets?.data ?? []).map((t: any) => ({
      id: String(t.id),
      title: (t.text ?? "").slice(0, 140),
      url: `https://x.com/i/web/status/${t.id}`,
      at: t.created_at ?? null,
      views: n(t.public_metrics?.impression_count),
      likes: n(t.public_metrics?.like_count),
      comments: n(t.public_metrics?.reply_count),
      shares: n(t.public_metrics?.retweet_count),
    })),
  };
}
export function mapLinkedIn(orgUrn: string, size: any): ChannelStats {
  return { kind: "linkedin", name: "LinkedIn page", handle: orgUrn, url: null, followers: n(size?.firstDegreeSize), views: null, posts: null, recent: [] };
}

export async function fetchInsights(kind: PubChannel, c: Creds): Promise<ChannelStats | null> {
  const t = encodeURIComponent(c.token);
  if (kind === "facebook") {
    const page = (await http<any>({ method: "GET", url: `${GRAPH()}/${c.externalId}?fields=id,name,username,link,followers_count,fan_count&access_token=${t}` })).json;
    const posts = (await http<any>({ method: "GET", url: `${GRAPH()}/${c.externalId}/posts?fields=message,created_time,permalink_url,shares,reactions.summary(total_count).limit(0),comments.summary(total_count).limit(0)&limit=10&access_token=${t}` })).json;
    return mapFacebook(page, posts);
  }
  if (kind === "instagram") {
    const user = (await http<any>({ method: "GET", url: `${GRAPH()}/${c.externalId}?fields=username,name,followers_count,media_count&access_token=${t}` })).json;
    const media = (await http<any>({ method: "GET", url: `${GRAPH()}/${c.externalId}/media?fields=caption,timestamp,permalink,like_count,comments_count&limit=10&access_token=${t}` })).json;
    return mapInstagram(user, media);
  }
  if (kind === "x") {
    const h = { authorization: `Bearer ${c.token}` };
    const user = (await http<any>({ method: "GET", url: `${X_API}/users/${c.externalId}?user.fields=public_metrics,username,name`, headers: h })).json;
    const tweets = (await http<any>({ method: "GET", url: `${X_API}/users/${c.externalId}/tweets?max_results=10&tweet.fields=public_metrics,created_at`, headers: h })).json;
    return mapX(user, tweets);
  }
  if (kind === "linkedin") {
    const size = (await http<any>({ method: "GET", url: `https://api.linkedin.com/rest/networkSizes/${encodeURIComponent(c.externalId)}?edgeType=COMPANY_FOLLOWED_BY_MEMBER`, headers: liHeaders(c) })).json;
    return mapLinkedIn(c.externalId, size);
  }
  return null;
}
