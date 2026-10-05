import { XMLParser } from "fast-xml-parser";
import { booleanQuery, hashtagsFor, parseAppId, simpleQueries, type ListenSource } from "./sources";
import { engineQueries, hashtagsOf, newsEditions, plainQueries, type TopicSpec } from "./topic-query";

/**
 * Listening connectors: pure mappers (API response → RawMention, fixture-tested) and fetchers.
 * Free: Google News RSS, Hacker News Algolia, Mastodon hashtag timelines, Apple customer reviews RSS.
 * Keyed: Reddit (REDDIT_CLIENT_ID/SECRET), YouTube (YOUTUBE_API_KEY), Bluesky (BLUESKY_HANDLE/APP_PASSWORD).
 * No database or AI imports here.
 */
export type RawMention = {
  source: ListenSource;
  externalId: string;
  url: string | null;
  author: string;
  authorHandle: string | null;
  authorFollowers: number | null;
  /** true/false when the source reports verification (Mastodon verified links, Bluesky verification); absent when unknown. */
  authorVerified?: boolean | null;
  title: string;
  body: string;
  language: string | null;
  country: string | null;
  publishedAt: string | null;
  engagement: Record<string, number>;
  /** Images/videos attached to the post (UGC board). */
  media?: MediaItem[];
};
export type MediaItem = { type: "image" | "video"; url: string; preview: string | null; alt: string | null };

type J = Record<string, any>;
const str = (v: unknown) => (typeof v === "string" ? v : typeof v === "number" ? String(v) : "");
const numOrNull = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v !== "" && Number.isFinite(Number(v)) ? Number(v) : null);
const iso = (v: unknown) => {
  if (v == null || v === "") return null;
  const d = typeof v === "number" ? new Date(v * 1000) : new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};
const httpsUrl = (v: unknown) => (typeof v === "string" && /^https:\/\//.test(v) ? v : null);
/** Mastodon media_attachments → media. */
export function mastodonMedia(list: J[] | undefined): MediaItem[] {
  return (Array.isArray(list) ? list : []).flatMap((m) => {
    const url = httpsUrl(m.url) ?? httpsUrl(m.remote_url);
    if (!url || !["image", "video", "gifv"].includes(str(m.type))) return [];
    return [{ type: m.type === "image" ? ("image" as const) : ("video" as const), url, preview: httpsUrl(m.preview_url), alt: str(m.description) || null }];
  });
}
/** Bluesky embed views (images, video, record-with-media) → media. */
export function blueskyMedia(embed: J | undefined): MediaItem[] {
  if (!embed) return [];
  const t = str(embed.$type);
  if (t.startsWith("app.bsky.embed.images")) return ((embed.images ?? []) as J[]).flatMap((i) => (httpsUrl(i.fullsize) ? [{ type: "image" as const, url: i.fullsize, preview: httpsUrl(i.thumb), alt: str(i.alt) || null }] : []));
  if (t.startsWith("app.bsky.embed.video")) return httpsUrl(embed.playlist) ? [{ type: "video", url: embed.playlist, preview: httpsUrl(embed.thumbnail), alt: str(embed.alt) || null }] : [];
  if (t.startsWith("app.bsky.embed.recordWithMedia")) return blueskyMedia(embed.media);
  return [];
}
const eng = (o: Record<string, unknown>) => Object.fromEntries(Object.entries(o).flatMap(([k, v]) => (numOrNull(v) == null ? [] : [[k, numOrNull(v) as number]])));

export function stripHtml(s: string) {
  return s
    .replace(/<br\s*\/?>|<\/p>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&quot;|&#x22;/g, '"')
    .replace(/&#x2F;/g, "/")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

// ------------------------------------------------------------------ Google News RSS

const xml = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_", textNodeName: "#text", htmlEntities: true, parseTagValue: false, trimValues: true });
const xtext = (v: unknown): string => (v == null ? "" : typeof v === "object" ? str((v as J)["#text"]) : str(v));

export function mapNewsRss(body: string): RawMention[] {
  const doc = xml.parse(body) as J;
  const raw = doc?.rss?.channel?.item;
  const items: J[] = Array.isArray(raw) ? raw : raw ? [raw] : [];
  const out: RawMention[] = [];
  const seen = new Set<string>();
  for (const it of items) {
    const link = xtext(it.link);
    const guid = xtext(it.guid) || link;
    if (!link || seen.has(guid)) continue;
    seen.add(guid);
    const publisher = xtext(it.source);
    const publisherUrl = typeof it.source === "object" ? str(it.source?.["@_url"]) || null : null;
    let title = stripHtml(xtext(it.title));
    if (publisher && title.endsWith(` - ${publisher}`)) title = title.slice(0, -(publisher.length + 3)).trim();
    let snippet = stripHtml(xtext(it.description));
    if (snippet.startsWith(title)) snippet = snippet.slice(title.length).trim();
    if (publisher && snippet.endsWith(publisher)) snippet = snippet.slice(0, -publisher.length).trim();
    out.push({
      source: "news",
      externalId: guid,
      url: link,
      author: publisher || "Unknown publisher",
      authorHandle: publisherUrl ? publisherUrl.replace(/^https?:\/\//, "").replace(/\/$/, "") : null,
      authorFollowers: null,
      title,
      body: snippet,
      language: null,
      country: null,
      publishedAt: iso(xtext(it.pubDate)),
      engagement: {},
    });
  }
  return out;
}

// ------------------------------------------------------------------ Hacker News (Algolia)

export function mapHackerNews(json: J): RawMention[] {
  return ((json?.hits ?? []) as J[]).flatMap((h) => {
    const id = str(h.objectID);
    if (!id) return [];
    const isComment = !!h.comment_text;
    const title = stripHtml(str(h.title) || (isComment ? `Comment on: ${str(h.story_title)}` : ""));
    const body = stripHtml(str(h.comment_text) || str(h.story_text) || "");
    return [
      {
        source: "hackernews" as const,
        externalId: id,
        url: `https://news.ycombinator.com/item?id=${id}`,
        author: str(h.author) || "unknown",
        authorHandle: str(h.author) || null,
        authorFollowers: null,
        title,
        body: body || (h.url ? str(h.url) : ""),
        language: null,
        country: null,
        publishedAt: iso(h.created_at) ?? iso(h.created_at_i),
        engagement: eng({ points: h.points, comments: h.num_comments }),
      },
    ];
  });
}

// ------------------------------------------------------------------ Mastodon

export function mapMastodon(statuses: J[], instance = "mastodon.social"): RawMention[] {
  return (Array.isArray(statuses) ? statuses : []).flatMap((s) => {
    const id = str(s.id);
    if (!id) return [];
    const acct = str(s.account?.acct);
    return [
      {
        source: "mastodon" as const,
        externalId: s.uri ? str(s.uri) : `${instance}:${id}`,
        url: str(s.url) || str(s.uri) || null,
        author: str(s.account?.display_name) || acct || "unknown",
        authorHandle: acct ? `@${acct.includes("@") ? acct : `${acct}@${instance}`}` : null,
        authorFollowers: numOrNull(s.account?.followers_count),
        authorVerified: Array.isArray(s.account?.fields) ? (s.account.fields as J[]).some((f) => !!f?.verified_at) : null,
        title: "",
        body: stripHtml(str(s.content)) || stripHtml(str(s.spoiler_text)),
        language: str(s.language) || null,
        country: null,
        publishedAt: iso(s.created_at),
        engagement: eng({ likes: s.favourites_count, reposts: s.reblogs_count, replies: s.replies_count }),
        media: mastodonMedia(s.media_attachments),
      },
    ];
  });
}

// ------------------------------------------------------------------ Apple customer reviews RSS (JSON)

export function mapAppStore(json: J, appId: string, country = "us"): RawMention[] {
  const raw = json?.feed?.entry;
  const entries: J[] = Array.isArray(raw) ? raw : raw ? [raw] : [];
  return entries.flatMap((e) => {
    const id = str(e.id?.label);
    const rating = numOrNull(e["im:rating"]?.label);
    // The first entry of older feeds is the app itself (no rating).
    if (!id || rating == null) return [];
    const body = str(e.content?.label);
    return [
      {
        source: "appstore" as const,
        externalId: `${appId}:${id}`,
        url: `https://apps.apple.com/${country}/app/id${appId}?see-all=reviews`,
        author: str(e.author?.name?.label) || "App Store user",
        authorHandle: null,
        authorFollowers: null,
        title: str(e.title?.label),
        body,
        language: null,
        country: country.toUpperCase(),
        publishedAt: iso(e.updated?.label),
        engagement: eng({ rating, votes: e["im:voteCount"]?.label }),
      },
    ];
  });
}

// ------------------------------------------------------------------ Reddit

export function mapReddit(json: J): RawMention[] {
  return ((json?.data?.children ?? []) as J[]).flatMap((c) => {
    const d = c?.data ?? {};
    const name = str(d.name) || (d.id ? `${c.kind ?? "t3"}_${d.id}` : "");
    if (!name) return [];
    return [
      {
        source: "reddit" as const,
        externalId: name,
        url: d.permalink ? `https://www.reddit.com${d.permalink}` : str(d.url) || null,
        author: str(d.author) || "[deleted]",
        authorHandle: d.author ? `u/${d.author}` : null,
        authorFollowers: null,
        title: str(d.title) ? `${d.subreddit_name_prefixed ? `${d.subreddit_name_prefixed}: ` : ""}${str(d.title)}` : "",
        body: str(d.selftext) || str(d.body),
        language: null,
        country: null,
        publishedAt: iso(numOrNull(d.created_utc)),
        engagement: eng({ score: d.score, comments: d.num_comments }),
        media: d.post_hint === "image" && httpsUrl(d.url) ? [{ type: "image" as const, url: d.url, preview: httpsUrl(d.thumbnail), alt: null }] : d.is_video && httpsUrl(d.url) ? [{ type: "video" as const, url: d.url, preview: httpsUrl(d.thumbnail), alt: null }] : [],
      },
    ];
  });
}

// ------------------------------------------------------------------ YouTube

export function mapYouTubeSearch(json: J): RawMention[] {
  return ((json?.items ?? []) as J[]).flatMap((it) => {
    const vid = str(it.id?.videoId);
    if (!vid) return [];
    const s = it.snippet ?? {};
    return [
      {
        source: "youtube" as const,
        externalId: `video:${vid}`,
        url: `https://www.youtube.com/watch?v=${vid}`,
        author: stripHtml(str(s.channelTitle)) || "YouTube channel",
        authorHandle: str(s.channelId) || null,
        authorFollowers: null,
        title: stripHtml(str(s.title)),
        body: stripHtml(str(s.description)),
        language: str(s.defaultLanguage) || null,
        country: null,
        publishedAt: iso(s.publishedAt),
        engagement: {},
        media: httpsUrl(s.thumbnails?.high?.url ?? s.thumbnails?.medium?.url) ? [{ type: "video" as const, url: `https://www.youtube.com/watch?v=${vid}`, preview: s.thumbnails?.high?.url ?? s.thumbnails?.medium?.url, alt: null }] : [],
      },
    ];
  });
}

export function mapYouTubeComments(json: J, videoTitle = ""): RawMention[] {
  return ((json?.items ?? []) as J[]).flatMap((it) => {
    const c = it.snippet?.topLevelComment?.snippet ?? {};
    const id = str(it.snippet?.topLevelComment?.id) || str(it.id);
    const vid = str(it.snippet?.videoId) || str(c.videoId);
    if (!id) return [];
    return [
      {
        source: "youtube" as const,
        externalId: `comment:${id}`,
        url: vid ? `https://www.youtube.com/watch?v=${vid}&lc=${id}` : null,
        author: str(c.authorDisplayName) || "YouTube user",
        authorHandle: str(c.authorChannelId?.value) || null,
        authorFollowers: null,
        title: videoTitle ? `Comment on: ${videoTitle}` : "",
        body: str(c.textOriginal) || stripHtml(str(c.textDisplay)),
        language: null,
        country: null,
        publishedAt: iso(c.publishedAt),
        engagement: eng({ likes: c.likeCount, replies: it.snippet?.totalReplyCount }),
      },
    ];
  });
}

// ------------------------------------------------------------------ Bluesky

export function mapBluesky(json: J): RawMention[] {
  return ((json?.posts ?? []) as J[]).flatMap((p) => {
    const uri = str(p.uri);
    if (!uri) return [];
    const handle = str(p.author?.handle);
    const rkey = uri.split("/").pop();
    const langs = p.record?.langs;
    return [
      {
        source: "bluesky" as const,
        externalId: uri,
        url: handle && rkey ? `https://bsky.app/profile/${handle}/post/${rkey}` : null,
        author: str(p.author?.displayName) || handle || "unknown",
        authorHandle: handle ? `@${handle}` : null,
        authorFollowers: numOrNull(p.author?.followersCount),
        authorVerified: p.author ? str(p.author.verification?.verifiedStatus) === "valid" : null,
        title: "",
        body: str(p.record?.text),
        language: Array.isArray(langs) && langs[0] ? str(langs[0]).slice(0, 2) : null,
        country: null,
        publishedAt: iso(p.record?.createdAt) ?? iso(p.indexedAt),
        engagement: eng({ likes: p.likeCount, reposts: p.repostCount, replies: p.replyCount }),
        media: blueskyMedia(p.embed),
      },
    ];
  });
}

// ------------------------------------------------------------------ fetchers

export type TopicQuery = {
  keywords: string[];
  excluded: string[];
  appIds: string[];
  country: string;
  language: string;
  /** Full topic spec (AND CONTAINS, exclusions, regional). When set, queries are built from it with chunking. */
  spec?: TopicSpec;
};

const UA = "Mozilla/5.0 (compatible; SynapseSEO-Listening/1.0)";
async function get(url: string, init: RequestInit = {}): Promise<Response> {
  const res = await fetch(url, { cache: "no-store", ...init, signal: AbortSignal.timeout(20_000), headers: { "User-Agent": UA, Accept: "application/json, application/rss+xml, */*;q=0.5", ...(init.headers ?? {}) } });
  if (!res.ok) {
    const detail = (await res.text().catch(() => "")).slice(0, 160).replace(/\s+/g, " ");
    throw new Error(`HTTP ${res.status}${detail ? `: ${detail}` : ""}`);
  }
  return res;
}
const getJson = async (url: string, init?: RequestInit) => (await get(url, init)).json() as Promise<J>;

let redditToken: { token: string; exp: number } | null = null;
async function redditAuth() {
  if (redditToken && redditToken.exp > Date.now() + 60_000) return redditToken.token;
  const basic = Buffer.from(`${process.env.REDDIT_CLIENT_ID}:${process.env.REDDIT_CLIENT_SECRET}`).toString("base64");
  const d = await getJson("https://www.reddit.com/api/v1/access_token", {
    method: "POST",
    headers: { Authorization: `Basic ${basic}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: "grant_type=client_credentials",
  });
  if (!d.access_token) throw new Error("Reddit did not return an access token (check REDDIT_CLIENT_ID/SECRET).");
  redditToken = { token: String(d.access_token), exp: Date.now() + Number(d.expires_in ?? 3600) * 1000 };
  return redditToken.token;
}

let bskySession: { jwt: string; at: number } | null = null;
async function blueskyAuth() {
  if (bskySession && Date.now() - bskySession.at < 60 * 60_000) return bskySession.jwt;
  const d = await getJson("https://bsky.social/xrpc/com.atproto.server.createSession", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ identifier: process.env.BLUESKY_HANDLE, password: process.env.BLUESKY_APP_PASSWORD }),
  });
  if (!d.accessJwt) throw new Error("Bluesky login failed (check BLUESKY_HANDLE/APP_PASSWORD).");
  bskySession = { jwt: String(d.accessJwt), at: Date.now() };
  return bskySession.jwt;
}

const MAX_RULES = 5;

/** Queries per source for a topic: from the full spec when present, else from the legacy keyword rules. */
function topicPlan(t: TopicQuery) {
  if (!t.spec) {
    const rules = t.keywords.slice(0, MAX_RULES);
    return {
      boolean: (_sites: boolean, max = MAX_RULES) => rules.slice(0, max).map((k) => booleanQuery(k, t.excluded)),
      plain: (max = 2) => rules.flatMap((k) => simpleQueries(k, max)),
      hashtags: () => [...new Set(rules.flatMap(hashtagsFor))].slice(0, 6),
      editions: [(t.country || "US").toUpperCase()],
    };
  }
  const spec = t.spec;
  return {
    boolean: (sites: boolean, max = MAX_RULES) => engineQueries(spec, { maxQueries: max, sites }).queries,
    plain: () => plainQueries(spec, 6),
    hashtags: () => hashtagsOf(spec, 6),
    editions: newsEditions(spec, t.country || "US"),
  };
}

/** Fetch raw mentions of one topic from one source. Throws on transport/API errors. */
export async function fetchSource(source: ListenSource, t: TopicQuery): Promise<RawMention[]> {
  const plan = topicPlan(t);
  const out: RawMention[] = [];
  switch (source) {
    case "news": {
      const qs = plan.boolean(true, t.spec ? 4 : MAX_RULES);
      for (const cc of plan.editions)
        for (const q of qs) {
          const res = await get(`https://news.google.com/rss/search?q=${encodeURIComponent(`${q} when:30d`)}&hl=en-${cc}&gl=${cc}&ceid=${cc}:en`);
          out.push(...mapNewsRss(await res.text()).map((m) => (plan.editions.length > 1 || t.spec?.countries.length ? { ...m, country: cc } : m)));
        }
      break;
    }
    case "hackernews":
      for (const q of plan.plain(2).slice(0, 6)) out.push(...mapHackerNews(await getJson(`https://hn.algolia.com/api/v1/search_by_date?query=${encodeURIComponent(q)}&tags=(story,comment)&hitsPerPage=50`)));
      break;
    case "mastodon":
      for (const tag of plan.hashtags()) out.push(...mapMastodon((await getJson(`https://mastodon.social/api/v1/timelines/tag/${encodeURIComponent(tag)}?limit=40`)) as unknown as J[]));
      break;
    case "appstore":
      for (const raw of t.appIds.slice(0, 5)) {
        const app = parseAppId(raw);
        if (!app) continue;
        out.push(...mapAppStore(await getJson(`https://itunes.apple.com/${app.country}/rss/customerreviews/page=1/id=${app.id}/sortBy=mostRecent/json`), app.id, app.country));
      }
      break;
    case "reddit": {
      const token = await redditAuth();
      for (const q of plan.boolean(true))
        out.push(...mapReddit(await getJson(`https://oauth.reddit.com/search?q=${encodeURIComponent(q)}&sort=new&t=month&limit=50&raw_json=1`, { headers: { Authorization: `Bearer ${token}` } })));
      break;
    }
    case "youtube": {
      const key = encodeURIComponent(process.env.YOUTUBE_API_KEY ?? "");
      const after = new Date(Date.now() - 30 * 86400000).toISOString();
      for (const q of plan.boolean(false, 3)) {
        const videos = mapYouTubeSearch(await getJson(`https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&order=date&maxResults=25&publishedAfter=${after}&q=${encodeURIComponent(q)}&key=${key}`));
        out.push(...videos);
        for (const v of videos.slice(0, 5)) {
          const vid = v.externalId.slice(6);
          const c = await getJson(`https://www.googleapis.com/youtube/v3/commentThreads?part=snippet&order=time&maxResults=20&videoId=${vid}&key=${key}`).catch(() => null); // comments may be disabled
          if (c) out.push(...mapYouTubeComments(c, v.title));
        }
      }
      break;
    }
    case "bluesky": {
      const jwt = await blueskyAuth();
      for (const q of plan.plain(2).slice(0, 6)) out.push(...mapBluesky(await getJson(`https://bsky.social/xrpc/app.bsky.feed.searchPosts?q=${encodeURIComponent(q)}&sort=latest&limit=50`, { headers: { Authorization: `Bearer ${jwt}` } })));
      break;
    }
  }
  return out;
}

// ------------------------------------------------------------------ public profile feeds (More Social Profiles, no login)

/** YouTube channel Atom feed (https://www.youtube.com/feeds/videos.xml?channel_id=UC…) → videos. Free, no key. */
export function mapYouTubeFeed(body: string): RawMention[] {
  const doc = xml.parse(body) as J;
  const feed = doc?.feed ?? {};
  const raw = feed.entry;
  const entries: J[] = Array.isArray(raw) ? raw : raw ? [raw] : [];
  const channel = xtext(feed.author?.name) || xtext(feed.title);
  return entries.flatMap((e) => {
    const vid = xtext(e["yt:videoId"]);
    if (!vid) return [];
    const group = e["media:group"] ?? {};
    const thumb = typeof group["media:thumbnail"] === "object" ? str(group["media:thumbnail"]?.["@_url"]) : "";
    const stats = group["media:community"]?.["media:statistics"];
    const views = typeof stats === "object" ? numOrNull(stats?.["@_views"]) : null;
    return [
      {
        source: "youtube" as const,
        externalId: `video:${vid}`,
        url: `https://www.youtube.com/watch?v=${vid}`,
        author: xtext(e.author?.name) || channel || "YouTube channel",
        authorHandle: xtext(e["yt:channelId"]) || null,
        authorFollowers: null,
        title: stripHtml(xtext(e.title)),
        body: stripHtml(xtext(group["media:description"])).slice(0, 4000),
        language: null,
        country: null,
        publishedAt: iso(xtext(e.published)),
        engagement: (views == null ? {} : { views }) as Record<string, number>,
        media: httpsUrl(thumb) ? [{ type: "video" as const, url: `https://www.youtube.com/watch?v=${vid}`, preview: thumb, alt: null }] : [],
      },
    ];
  });
}

/** Bluesky public author feed (public.api.bsky.app getAuthorFeed) → posts. */
export const mapBlueskyAuthorFeed = (json: J) => mapBluesky({ posts: ((json?.feed ?? []) as J[]).map((f) => f?.post).filter(Boolean) });

/**
 * Latest posts of one public profile tracked without login. Free: Mastodon, Bluesky (public AppView),
 * YouTube (channel RSS; @handles need YOUTUBE_API_KEY to resolve), Hacker News. Keyed: Reddit (REDDIT_CLIENT_ID/SECRET).
 * Returns the resolved external id (e.g. a YouTube channel id) so it can be stored.
 */
export async function fetchProfileFeed(network: string, handle: string, externalId = ""): Promise<{ posts: RawMention[]; externalId: string }> {
  const h = handle.trim().replace(/^@/, "");
  switch (network) {
    case "mastodon": {
      const [user, instance = "mastodon.social"] = h.split("@");
      if (!/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(instance)) throw new Error("Use the form @user@instance.social.");
      const id = externalId || str((await getJson(`https://${instance}/api/v1/accounts/lookup?acct=${encodeURIComponent(user)}`)).id);
      if (!id) throw new Error("Account not found on that instance.");
      const statuses = (await getJson(`https://${instance}/api/v1/accounts/${encodeURIComponent(id)}/statuses?limit=40&exclude_reblogs=true`)) as unknown as J[];
      return { posts: mapMastodon(statuses, instance), externalId: id };
    }
    case "bluesky": {
      const json = await getJson(`https://public.api.bsky.app/xrpc/app.bsky.feed.getAuthorFeed?actor=${encodeURIComponent(h)}&limit=50&filter=posts_no_replies`);
      return { posts: mapBlueskyAuthorFeed(json), externalId: externalId || h };
    }
    case "youtube": {
      let id = externalId || (/^UC[\w-]{22}$/.test(h) ? h : "");
      if (!id) {
        const key = process.env.YOUTUBE_API_KEY;
        if (!key) throw new Error("Enter the channel id (UC…) or set YOUTUBE_API_KEY to resolve @handles.");
        const d = await getJson(`https://www.googleapis.com/youtube/v3/channels?part=id&forHandle=${encodeURIComponent(`@${h}`)}&key=${encodeURIComponent(key)}`);
        id = str(d?.items?.[0]?.id);
        if (!id) throw new Error("YouTube channel not found.");
      }
      const res = await get(`https://www.youtube.com/feeds/videos.xml?channel_id=${encodeURIComponent(id)}`);
      return { posts: mapYouTubeFeed(await res.text()), externalId: id };
    }
    case "hackernews":
      return { posts: mapHackerNews(await getJson(`https://hn.algolia.com/api/v1/search_by_date?tags=author_${encodeURIComponent(h)}&hitsPerPage=50`)), externalId: h };
    case "reddit": {
      const token = await redditAuth();
      const path = /^r\//i.test(h) ? `/r/${encodeURIComponent(h.slice(2))}/new` : `/user/${encodeURIComponent(h.replace(/^u\//i, ""))}/submitted`;
      return { posts: mapReddit(await getJson(`https://oauth.reddit.com${path}?limit=50&raw_json=1`, { headers: { Authorization: `Bearer ${token}` } })), externalId: h };
    }
    default:
      throw new Error("This network has no free public API; connect its API to track this profile.");
  }
}
