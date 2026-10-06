/**
 * Channel adapters: publishing (Meta Graph API for Facebook Pages + Instagram, LinkedIn Posts API,
 * X API v2) and read-only insights (YouTube Data API, Meta, LinkedIn, X). Request builders and
 * response mappers are pure and fixture-tested; `send*` / `fetch*` do the HTTP. No DB imports here.
 */
import { metaGraphUrl } from "@/lib/cx/channels";
import type { PubChannel } from "./core";
import type { OptionValue } from "./options";

/** `appOnly`: an app-level server key (X_BEARER_TOKEN, YOUTUBE_API_KEY) that reads public insights but cannot publish. */
export type Creds = { externalId: string; token: string; appOnly?: boolean };
export type Media = { kind: "image" | "video" | "document"; mime: string; filename: string; publicUrl: string | null; read: () => Promise<Buffer> };
/** `options` = this channel's options, `common` = shared options (poll), `cover` = resolved cover asset. */
export type PublishInput = { text: string; firstComment: string; link: string | null; media: Media[]; postType?: string; options?: Record<string, OptionValue>; common?: Record<string, OptionValue>; cover?: Media | null };
const list = (v: OptionValue | undefined) => (Array.isArray(v) ? v : []);
const str = (v: OptionValue | undefined) => (typeof v === "string" ? v : "");
export type PublishOutput = { externalId: string; url: string | null; warnings: string[] };
export type HttpRequest = { method: "GET" | "POST" | "DELETE"; url: string; headers?: Record<string, string>; body?: Record<string, unknown> };

const GRAPH = metaGraphUrl;
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
  const countries = list(input.options?.target_countries).map((x) => x.toUpperCase());
  const ageMin = Number(str(input.options?.target_age_min)) || 0;
  if (countries.length || ageMin) body.targeting = { ...(countries.length ? { geo_locations: { countries } } : {}), ...(ageMin ? { age_min: ageMin } : {}) };
  return { method: "POST", url: `${GRAPH()}/${encodeURIComponent(c.externalId)}/feed`, body };
}
export function facebookPhotoRequest(c: Creds, url: string, published: boolean, caption?: string): HttpRequest {
  return { method: "POST", url: `${GRAPH()}/${encodeURIComponent(c.externalId)}/photos`, body: { url, published, ...(caption ? { caption } : {}), access_token: c.token } };
}
export function facebookVideoRequest(c: Creds, url: string, description: string, title?: string): HttpRequest {
  return { method: "POST", url: `${GRAPH()}/${encodeURIComponent(c.externalId)}/videos`, body: { file_url: url, description, ...(title ? { title } : {}), access_token: c.token } };
}

/** Reels and video stories use the resumable upload flow: start → upload by file_url → finish. */
export function facebookResumableRequests(c: Creds, edge: "video_reels" | "video_stories", fileUrl: string, finish: Record<string, unknown>) {
  const base = `${GRAPH()}/${encodeURIComponent(c.externalId)}/${edge}`;
  return {
    start: { method: "POST", url: base, body: { upload_phase: "start", access_token: c.token } } as HttpRequest,
    upload: (uploadUrl: string): HttpRequest => ({ method: "POST", url: uploadUrl, headers: { authorization: `OAuth ${c.token}`, file_url: fileUrl } }),
    finish: (videoId: string): HttpRequest => ({ method: "POST", url: base, body: { upload_phase: "finish", video_id: videoId, access_token: c.token, ...finish } }),
  };
}

function requirePublicUrls(media: Media[], network: string) {
  const missing = media.filter((m) => !m.publicUrl);
  if (missing.length) throw new ApiError(`${network} downloads media from a public URL; set APP_URL to this server's public https address.`);
  return media.map((m) => m.publicUrl!);
}

async function sendFacebook(c: Creds, input: PublishInput): Promise<PublishOutput> {
  const warnings: string[] = [];
  let postId: string;
  if (input.postType === "reel" || input.postType === "story") {
    const m = input.media[0];
    if (!m) throw new ApiError("Add one image or video.");
    const [url] = requirePublicUrls([m], "Facebook");
    if (input.postType === "story" && m.kind === "image") {
      const photo = String((await http<{ id: string }>(facebookPhotoRequest(c, url, false))).json.id);
      const r = (await http<{ post_id?: string; id?: string }>({ method: "POST", url: `${GRAPH()}/${encodeURIComponent(c.externalId)}/photo_stories`, body: { photo_id: photo, access_token: c.token } })).json;
      const id = String(r.post_id ?? r.id ?? photo);
      return { externalId: id, url: `https://www.facebook.com/${id}`, warnings };
    }
    if (m.kind !== "video") throw new ApiError("Facebook reels need a video.");
    const flow = facebookResumableRequests(c, input.postType === "reel" ? "video_reels" : "video_stories", url, input.postType === "reel" ? { video_state: "PUBLISHED", description: input.text, ...(str(input.options?.video_title) ? { title: str(input.options?.video_title) } : {}) } : {});
    const st = (await http<{ video_id: string; upload_url: string }>(flow.start)).json;
    await http(flow.upload(st.upload_url));
    const fin = (await http<{ post_id?: string }>(flow.finish(st.video_id))).json;
    const id = String(fin.post_id ?? st.video_id);
    if (list(input.options?.collaborators).length) warnings.push("Invite reel collaborators in Meta Business Suite.");
    return { externalId: id, url: `https://www.facebook.com/${id}`, warnings };
  }
  const videos = input.media.filter((m) => m.kind === "video");
  const images = input.media.filter((m) => m.kind === "image");
  if (videos.length) {
    if (input.media.length > 1) warnings.push("Facebook: only the first video was published (mixed/multiple media not supported in one post).");
    const [url] = requirePublicUrls([videos[0]], "Facebook");
    postId = String((await http<{ id: string }>(facebookVideoRequest(c, url, input.text, str(input.options?.video_title) || undefined))).json.id);
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

export function instagramContainerRequest(
  c: Creds,
  m: { url: string; kind: "image" | "video" | "document" } | null,
  caption: string,
  opts: { carouselItem?: boolean; children?: string[]; story?: boolean; coverUrl?: string; shareToFeed?: boolean; collaborators?: string[] } = {},
): HttpRequest {
  const body: Record<string, unknown> = { access_token: c.token };
  if (opts.children) Object.assign(body, { media_type: "CAROUSEL", children: opts.children.join(","), caption });
  else if (opts.story) Object.assign(body, { media_type: "STORIES", ...(m?.kind === "video" ? { video_url: m.url } : { image_url: m?.url }) });
  else if (m?.kind === "video") Object.assign(body, { media_type: opts.carouselItem ? "VIDEO" : "REELS", video_url: m.url });
  else if (m) Object.assign(body, { image_url: m.url });
  if (opts.carouselItem) body.is_carousel_item = true;
  else if (!opts.children && !opts.story) body.caption = caption;
  if (!opts.carouselItem && !opts.story && m?.kind === "video") {
    if (opts.coverUrl) body.cover_url = opts.coverUrl;
    if (opts.shareToFeed != null) body.share_to_feed = opts.shareToFeed;
  }
  if (!opts.carouselItem && !opts.story && opts.collaborators?.length) body.collaborators = opts.collaborators.slice(0, 3);
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
  const o = input.options ?? {};
  const collaborators = list(o.collaborators).map((u) => u.replace(/^@/, ""));
  if (input.postType === "story" || input.postType === "reel") {
    const coverUrl = input.cover?.publicUrl ?? undefined;
    creation = String((await http<{ id: string }>(instagramContainerRequest(c, items[0], input.text, { story: input.postType === "story", coverUrl, shareToFeed: o.share_to_feed === true ? true : input.postType === "reel" ? false : undefined, collaborators }))).json.id);
  } else if (items.length === 1) {
    creation = String((await http<{ id: string }>(instagramContainerRequest(c, items[0], input.text, { collaborators }))).json.id);
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
  if (input.firstComment.trim() && input.postType !== "story")
    await http({ method: "POST", url: `${GRAPH()}/${mediaId}/comments`, body: { message: input.firstComment, access_token: c.token } }).catch((e) => warnings.push(`First comment failed: ${e.message}`));
  if (o.disable_comments === true && input.postType !== "story")
    await http({ method: "POST", url: `${GRAPH()}/${mediaId}`, body: { comment_enabled: false, access_token: c.token } }).catch((e) => warnings.push(`Turning comments off failed: ${e.message}`));
  const permalink = await http<{ permalink?: string }>({ method: "GET", url: `${GRAPH()}/${mediaId}?fields=permalink&access_token=${encodeURIComponent(c.token)}` })
    .then((r) => r.json.permalink ?? null)
    .catch(() => null);
  return { externalId: mediaId, url: permalink, warnings };
}

// ================================================================= LinkedIn

/** LinkedIn "little text" format: reserved characters must be backslash-escaped. */
export const escapeLinkedIn = (s: string) => s.replace(/[\\|{}@[\]()<>#*_~]/g, (ch) => `\\${ch}`);

const LI_POLL: Record<string, string> = { "24": "ONE_DAY", "72": "THREE_DAYS", "168": "SEVEN_DAYS", "336": "FOURTEEN_DAYS" };

export function linkedinPostRequest(c: Creds, input: PublishInput, imageUrns: string[] = [], document?: { urn: string; title: string }): HttpRequest {
  const o = input.options ?? {};
  const target: Record<string, string[]> = {};
  if (list(o.target_geo).length) target.geoLocations = list(o.target_geo);
  if (list(o.target_seniorities).length) target.seniorities = list(o.target_seniorities);
  if (list(o.target_industries).length) target.industries = list(o.target_industries);
  if (list(o.target_company_sizes).length) target.staffCountRanges = list(o.target_company_sizes);
  const body: Record<string, unknown> = {
    author: c.externalId,
    commentary: escapeLinkedIn(input.text),
    visibility: "PUBLIC",
    distribution: { feedDistribution: "MAIN_FEED", targetEntities: Object.keys(target).length ? [target] : [], thirdPartyDistributionChannels: [] },
    lifecycleState: "PUBLISHED",
    isReshareDisabledByAuthor: o.disable_reshare === true,
  };
  if (input.postType === "poll") {
    body.content = { poll: { question: input.text.slice(0, 140), options: list(input.common?.poll_options).map((text) => ({ text })), settings: { duration: LI_POLL[str(input.common?.poll_hours)] ?? "THREE_DAYS" } } };
    return { method: "POST", url: "https://api.linkedin.com/rest/posts", headers: liHeaders(c), body };
  }
  if (document) body.content = { media: { id: document.urn, title: document.title } };
  else if (imageUrns.length === 1) body.content = { media: { id: imageUrns[0] } };
  else if (imageUrns.length > 1) body.content = { multiImage: { images: imageUrns.map((id) => ({ id })) } };
  else if (input.link) body.content = { article: { source: input.link, title: input.link } };
  return { method: "POST", url: "https://api.linkedin.com/rest/posts", headers: liHeaders(c), body };
}
export function linkedinCommentRequest(c: Creds, postUrn: string, text: string): HttpRequest {
  return { method: "POST", url: `https://api.linkedin.com/rest/socialActions/${encodeURIComponent(postUrn)}/comments`, headers: liHeaders(c), body: { actor: c.externalId, object: postUrn, message: { text } } };
}
const liHeaders = (c: Creds) => ({ authorization: `Bearer ${c.token}`, "LinkedIn-Version": LI_VERSION(), "X-Restli-Protocol-Version": "2.0.0" });

async function sendLinkedIn(c: Creds, input: PublishInput): Promise<PublishOutput> {
  const warnings: string[] = [];
  const urns: string[] = [];
  let document: { urn: string; title: string } | undefined;
  const doc = input.postType === "document" ? input.media.find((m) => m.kind === "document") : undefined;
  if (doc) {
    const init = (await http<{ value: { uploadUrl: string; document: string } }>({ method: "POST", url: "https://api.linkedin.com/rest/documents?action=initializeUpload", headers: liHeaders(c), body: { initializeUploadRequest: { owner: c.externalId } } })).json.value;
    const put = await fetch(init.uploadUrl, { method: "PUT", headers: { authorization: `Bearer ${c.token}` }, body: new Uint8Array(await doc.read()), signal: AbortSignal.timeout(120_000) });
    if (!put.ok) throw new ApiError(`LinkedIn document upload failed (HTTP ${put.status}).`);
    document = { urn: init.document, title: str(input.options?.document_title) || doc.filename };
  }
  for (const m of doc || input.postType === "poll" ? [] : input.media) {
    if (m.kind !== "image") {
      warnings.push(`LinkedIn: video "${m.filename}" skipped (video upload is not supported by this adapter).`);
      continue;
    }
    const init = (await http<{ value: { uploadUrl: string; image: string } }>({ method: "POST", url: "https://api.linkedin.com/rest/images?action=initializeUpload", headers: liHeaders(c), body: { initializeUploadRequest: { owner: c.externalId } } })).json.value;
    const put = await fetch(init.uploadUrl, { method: "PUT", headers: { authorization: `Bearer ${c.token}`, "content-type": m.mime }, body: new Uint8Array(await m.read()), signal: AbortSignal.timeout(120_000) });
    if (!put.ok) throw new ApiError(`LinkedIn image upload failed (HTTP ${put.status}).`);
    urns.push(init.image);
  }
  const { headers } = await http(linkedinPostRequest(c, input, urns, document));
  const id = headers.get("x-restli-id") ?? headers.get("x-linkedin-id") ?? "";
  if (id && input.firstComment.trim())
    await http(linkedinCommentRequest(c, id, input.firstComment)).catch((e) => warnings.push(`First comment failed: ${e.message}`));
  return { externalId: id, url: id ? `https://www.linkedin.com/feed/update/${id}/` : null, warnings };
}

// ================================================================= X

export function xTweetRequest(c: Creds, text: string, opts: { mediaIds?: string[]; replyTo?: string; poll?: { options: string[]; hours: number }; replySettings?: string } = {}): HttpRequest {
  const body: Record<string, unknown> = { text };
  if (opts.poll) body.poll = { options: opts.poll.options.slice(0, 4), duration_minutes: Math.min(10080, Math.max(5, Math.round(opts.poll.hours * 60))) };
  else if (opts.mediaIds?.length) body.media = { media_ids: opts.mediaIds.slice(0, 4) };
  if (opts.replySettings) body.reply_settings = opts.replySettings;
  if (opts.replyTo) body.reply = { in_reply_to_tweet_id: opts.replyTo };
  return { method: "POST", url: `${X_API}/tweets`, headers: { authorization: `Bearer ${c.token}` }, body };
}

const X_USER_TOKEN_NEEDED = "X publishing needs the account's user access token (OAuth 2.0 with tweet.write) or X_USER_ACCESS_TOKEN; X_BEARER_TOKEN is app-only and only reads insights.";

async function sendX(c: Creds, input: PublishInput): Promise<PublishOutput> {
  if (c.appOnly) throw new ApiError(X_USER_TOKEN_NEEDED);
  const warnings: string[] = [];
  const mediaIds: string[] = [];
  const poll = input.postType === "poll" ? { options: list(input.common?.poll_options), hours: Number(str(input.common?.poll_hours)) || 24 } : undefined;
  for (const m of poll ? [] : input.media.slice(0, 4)) {
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
  const id = String((await http<{ data: { id: string } }>(xTweetRequest(c, input.text, { mediaIds, poll, replySettings: str(input.options?.reply_settings) || undefined }))).json.data.id);
  if (input.firstComment.trim()) await http(xTweetRequest(c, input.firstComment, { replyTo: id })).catch((e) => warnings.push(`Reply failed: ${e.message}`));
  return { externalId: id, url: `https://x.com/i/web/status/${id}`, warnings };
}

// ================================================================= Threads

const THREADS = "https://graph.threads.net/v1.0";
export function threadsContainerRequest(c: Creds, input: PublishInput): HttpRequest {
  const o = input.options ?? {};
  const m = input.media[0];
  const body: Record<string, unknown> = { access_token: c.token, text: input.text };
  if (m?.kind === "image" && m.publicUrl) Object.assign(body, { media_type: "IMAGE", image_url: m.publicUrl });
  else if (m?.kind === "video" && m.publicUrl) Object.assign(body, { media_type: "VIDEO", video_url: m.publicUrl });
  else body.media_type = "TEXT";
  if (input.postType === "poll") {
    const opts = list(input.common?.poll_options);
    body.poll_attachment = Object.fromEntries(opts.slice(0, 4).map((t, i) => [`option_${"abcd"[i]}`, t]));
  }
  if (str(o.reply_control)) body.reply_control = str(o.reply_control);
  if (str(o.topic_tag)) body.topic_tag = str(o.topic_tag);
  if (o.ghost_post === true) body.is_ghost_post = true;
  if (input.link && body.media_type === "TEXT") body.link_attachment = input.link;
  return { method: "POST", url: `${THREADS}/${encodeURIComponent(c.externalId)}/threads`, body };
}
async function sendThreads(c: Creds, input: PublishInput): Promise<PublishOutput> {
  if (input.media.length) requirePublicUrls(input.media.slice(0, 1), "Threads");
  const creation = String((await http<{ id: string }>(threadsContainerRequest(c, input))).json.id);
  if (input.media[0]?.kind === "video") await new Promise((r) => setTimeout(r, 30_000)); // Threads recommends waiting for video processing
  const id = String((await http<{ id: string }>({ method: "POST", url: `${THREADS}/${encodeURIComponent(c.externalId)}/threads_publish`, body: { creation_id: creation, access_token: c.token } })).json.id);
  const permalink = await http<{ permalink?: string }>({ method: "GET", url: `${THREADS}/${id}?fields=permalink&access_token=${encodeURIComponent(c.token)}` })
    .then((r) => r.json.permalink ?? null)
    .catch(() => null);
  return { externalId: id, url: permalink, warnings: input.media.length > 1 ? ["Threads: only the first media item was attached."] : [] };
}

// ================================================================= Google Business Profile (local posts)

const ymd = (s: string) => {
  const [year, month, day] = s.split("-").map(Number);
  return { year, month, day };
};
/** Local post for `accounts/{a}/locations/{l}` (externalId): standard update, event or offer. */
export function gbpLocalPostRequest(c: Creds, input: PublishInput): HttpRequest {
  const o = input.options ?? {};
  const body: Record<string, unknown> = { languageCode: "en", summary: input.text.slice(0, 1500), topicType: "STANDARD" };
  const image = input.media.find((m) => m.kind === "image" && m.publicUrl);
  if (image) body.media = [{ mediaFormat: "PHOTO", sourceUrl: image.publicUrl }];
  const cta = str(o.cta);
  if (cta && (input.link || cta === "CALL")) body.callToAction = cta === "CALL" ? { actionType: "CALL" } : { actionType: cta, url: input.link };
  if (input.postType === "event") {
    body.topicType = o.offer === true ? "OFFER" : "EVENT";
    body.event = { title: str(o.event_title), schedule: { startDate: ymd(str(o.start_date)), endDate: ymd(str(o.end_date)) } };
    if (o.offer === true) {
      body.offer = { ...(str(o.coupon_code) ? { couponCode: str(o.coupon_code) } : {}), ...(str(o.redeem_url) ? { redeemOnlineUrl: str(o.redeem_url) } : {}), ...(str(o.terms) ? { termsConditions: str(o.terms) } : {}) };
      delete body.callToAction;
    }
  }
  return { method: "POST", url: `https://mybusiness.googleapis.com/v4/${c.externalId}/localPosts`, headers: { authorization: `Bearer ${c.token}` }, body };
}
async function sendGbp(c: Creds, input: PublishInput): Promise<PublishOutput> {
  const r = (await http<{ name: string; searchUrl?: string }>(gbpLocalPostRequest(c, input))).json;
  return { externalId: r.name, url: r.searchUrl ?? null, warnings: [] };
}

// ================================================================= YouTube video upload (OAuth token)

export function youtubeMetadata(input: PublishInput) {
  const o = input.options ?? {};
  return {
    snippet: { title: (str(o.title) || input.text.split("\n")[0] || "Video").slice(0, 100), description: input.text.slice(0, 5000), categoryId: str(o.category) || "22" },
    status: { privacyStatus: str(o.privacy) || "private", selfDeclaredMadeForKids: o.made_for_kids === true },
  };
}
export async function uploadYoutube(token: string, input: PublishInput): Promise<PublishOutput> {
  const video = input.media.find((m) => m.kind === "video");
  if (!video) throw new ApiError("YouTube uploads need a video.");
  const boundary = `synapse${Date.now()}`;
  const head = Buffer.from(`--${boundary}\r\ncontent-type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(youtubeMetadata(input))}\r\n--${boundary}\r\ncontent-type: ${video.mime}\r\n\r\n`);
  const body = Buffer.concat([head, await video.read(), Buffer.from(`\r\n--${boundary}--`)]);
  const res = await fetch("https://www.googleapis.com/upload/youtube/v3/videos?uploadType=multipart&part=snippet,status", {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": `multipart/related; boundary=${boundary}` },
    body: new Uint8Array(body),
    signal: AbortSignal.timeout(600_000),
  });
  const j = (await res.json().catch(() => ({}))) as { id?: string };
  if (!res.ok || !j.id) throw new ApiError(apiErrorMessage(j, res.status));
  return { externalId: j.id, url: `https://www.youtube.com/watch?v=${j.id}`, warnings: [] };
}

export const publishers: Partial<Record<PubChannel, (c: Creds, input: PublishInput) => Promise<PublishOutput>>> = {
  facebook: sendFacebook,
  instagram: sendInstagram,
  linkedin: sendLinkedIn,
  x: sendX,
  threads: sendThreads,
  gbp: sendGbp,
};

// ================================================================= delete published posts

/** DELETE request for a published post, or null when the network's API cannot delete it (Instagram). */
export function deleteRequest(kind: PubChannel, c: Creds, externalId: string): HttpRequest | null {
  const id = encodeURIComponent(externalId);
  switch (kind) {
    case "facebook":
      return { method: "DELETE", url: `${GRAPH()}/${id}?access_token=${encodeURIComponent(c.token)}` };
    case "linkedin":
      return { method: "DELETE", url: `https://api.linkedin.com/rest/posts/${id}`, headers: liHeaders(c) };
    case "x":
      return { method: "DELETE", url: `${X_API}/tweets/${id}`, headers: { authorization: `Bearer ${c.token}` } };
    case "threads":
      return { method: "DELETE", url: `${THREADS}/${id}?access_token=${encodeURIComponent(c.token)}` };
    case "gbp":
      return { method: "DELETE", url: `https://mybusiness.googleapis.com/v4/${externalId}`, headers: { authorization: `Bearer ${c.token}` } };
    case "youtube":
      return { method: "DELETE", url: `https://www.googleapis.com/youtube/v3/videos?id=${id}`, headers: { authorization: `Bearer ${c.token}` } };
    default:
      return null;
  }
}
export const canDelete = (kind: string) => ["facebook", "linkedin", "x", "threads", "gbp", "youtube"].includes(kind);
export async function deletePublished(kind: PubChannel, c: Creds, externalId: string) {
  if (kind === "x" && c.appOnly) throw new ApiError(X_USER_TOKEN_NEEDED);
  const req = deleteRequest(kind, c, externalId);
  if (!req) throw new ApiError("This network's API cannot delete published posts; delete it in the app.");
  await http(req, "TEXT");
}

// ================================================================= AI image generation (OpenAI Images, when a key is set)

export const imageGenConfigured = () => !!process.env.OPENAI_API_KEY;
export const IMAGE_SIZES = ["1024x1024", "1024x1536", "1536x1024"] as const;
export function openAiImageRequest(prompt: string, size: string): HttpRequest {
  return {
    method: "POST",
    url: "https://api.openai.com/v1/images/generations",
    headers: { authorization: `Bearer ${process.env.OPENAI_API_KEY ?? ""}` },
    body: { model: process.env.OPENAI_IMAGE_MODEL || "gpt-image-1", prompt: prompt.slice(0, 4000), size: (IMAGE_SIZES as readonly string[]).includes(size) ? size : "1024x1024", n: 1 },
  };
}
/** PNG bytes from an Images API response (b64_json), or null. */
export function mapOpenAiImage(json: unknown): Buffer | null {
  const b64 = (json as { data?: { b64_json?: string }[] })?.data?.[0]?.b64_json;
  return b64 ? Buffer.from(b64, "base64") : null;
}
export async function generateImage(prompt: string, size: string): Promise<Buffer | null> {
  if (!imageGenConfigured()) return null;
  const { json } = await http(openAiImageRequest(prompt, size));
  const buf = mapOpenAiImage(json);
  if (!buf) throw new ApiError("The image API returned no image.");
  return buf;
}

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

/** Google API keys look like "AIza…"; anything else is treated as an OAuth access token. */
export const isGoogleApiKey = (v: string) => /^AIza[\w-]{30,}$/.test(v);

/** YouTube channel stats with an API key (YOUTUBE_API_KEY) or the brand's OAuth token (youtube.readonly). */
export async function fetchYoutube(key: string, channelId: string, auth: "key" | "bearer" = isGoogleApiKey(key) ? "key" : "bearer"): Promise<ChannelStats | null> {
  const base = "https://www.googleapis.com/youtube/v3";
  const isHandle = channelId.startsWith("@");
  const get = (path: string) => http<any>(auth === "key" ? { method: "GET", url: `${base}/${path}&key=${encodeURIComponent(key)}` } : { method: "GET", url: `${base}/${path}`, headers: { authorization: `Bearer ${key}` } });
  const ch = (await get(`channels?part=snippet,statistics,contentDetails&${isHandle ? "forHandle" : "id"}=${encodeURIComponent(channelId)}`)).json;
  const uploads = ch?.items?.[0]?.contentDetails?.relatedPlaylists?.uploads;
  if (!ch?.items?.length) return null;
  let videos: any = { items: [] };
  if (uploads) {
    const pl = (await get(`playlistItems?part=contentDetails&maxResults=12&playlistId=${uploads}`)).json;
    const ids = (pl.items ?? []).map((i: any) => i.contentDetails?.videoId).filter(Boolean);
    if (ids.length) videos = (await get(`videos?part=snippet,statistics&id=${ids.join(",")}`)).json;
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
