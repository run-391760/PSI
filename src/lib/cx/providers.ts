import { CHANNELS, type ChannelKind } from "./channels";
import { liveEnabled } from "@/lib/providers/source";
import { newsEnabled } from "@/lib/providers/news";

/**
 * Which channel APIs are usable on this server (env configured, or free with no key). Facebook, Instagram
 * and LinkedIn only need an access token, pasted per brand (inbox channel or Publishing account) or set in
 * env, so they are always available; their app id/secret only matter for OAuth and webhooks.
 */
export function channelAvailable(kind: ChannelKind): boolean {
  const info = CHANNELS.find((c) => c.kind === kind);
  if (!info) return false;
  if (kind === "google-reviews") return liveEnabled();
  if (kind === "news") return newsEnabled(); // same switch as SEO Brand Monitoring
  if (["email", "livechat", "webform"].includes(kind)) return true; // configured per channel
  return info.env.every((e) => !!process.env[e]);
}
export const availableChannels = () => Object.fromEntries(CHANNELS.map((c) => [c.kind, channelAvailable(c.kind)])) as Record<ChannelKind, boolean>;

// ================================================================= shared credentials (pure)

type Env = Record<string, string | undefined>;
/** A credential the brand stored: the account it belongs to (Page id, IG user id, organization URN…) and its token. */
export type StoredCred = { externalId: string; token: string | null };
/** Where a credential came from: Publishing account, CX inbox channel, server env token, or app-only server key. */
export type CredVia = "account" | "inbox" | "env" | "app";
export type PickedCreds = { externalId: string; token: string; via: CredVia };

/** Server env fallback per Publishing channel: [account id, user/page access token]. */
export const PUB_ENV: Record<string, [string, string]> = {
  facebook: ["META_PAGE_ID", "META_PAGE_ACCESS_TOKEN"],
  instagram: ["INSTAGRAM_USER_ID", "META_PAGE_ACCESS_TOKEN"],
  linkedin: ["LINKEDIN_AUTHOR_URN", "LINKEDIN_ACCESS_TOKEN"],
  x: ["X_USER_ID", "X_USER_ACCESS_TOKEN"],
  threads: ["THREADS_USER_ID", "THREADS_ACCESS_TOKEN"],
  gbp: ["GBP_LOCATION", "GBP_ACCESS_TOKEN"],
};
/** App-level server keys that can read public insights (not publish) when the brand has no token. */
const APP_KEY: Record<string, string> = { x: "X_BEARER_TOKEN", youtube: "YOUTUBE_API_KEY" };
/** Channels whose CX inbox token also works for Publishing (same Page / IG account / organization). */
export const SHARED_TOKEN_KINDS = ["facebook", "instagram", "linkedin"] as const;
/** Meta Page tokens only work for their own Page / IG account, so the env token must belong to it. */
const PAGE_SCOPED = new Set(["facebook", "instagram"]);

/**
 * Credentials for a Publishing / Analytics channel. Callers load the rows; `inbox` lists the brand's CX
 * inbox channels of the same kind ({accountId, token}).
 * - YouTube: YOUTUBE_API_KEY, else the brand's stored OAuth token (insights read public channel stats).
 * - Others: the Publishing account's token → the inbox channel token for the same account (any inbox
 *   channel when no Publishing account is linked) → the server env token → (X) the app-only
 *   X_BEARER_TOKEN, which reads insights but cannot publish.
 */
export function pickPubCreds(kind: string, account: StoredCred | null, inbox: StoredCred[], env: Env): PickedCreds | null {
  const app = APP_KEY[kind] ? env[APP_KEY[kind]] : undefined;
  if (kind === "youtube") {
    if (!account?.externalId) return null;
    if (app) return { externalId: account.externalId, token: app, via: "app" };
    return account.token ? { externalId: account.externalId, token: account.token, via: "account" } : null;
  }
  if (account?.token) return { externalId: account.externalId, token: account.token, via: "account" };
  const shared = inbox.filter((c) => c.token && c.externalId);
  const hit = account ? shared.find((c) => c.externalId === account.externalId) : shared[0];
  if (hit) return { externalId: hit.externalId, token: hit.token!, via: "inbox" };
  const [envId, envTok] = PUB_ENV[kind] ?? [];
  const externalId = account?.externalId || (envId ? env[envId] : undefined);
  if (!externalId) return null;
  if (envTok && env[envTok]) return { externalId, token: env[envTok]!, via: "env" };
  if (app) return { externalId, token: app, via: "app" };
  return null;
}

/**
 * Access token for a CX inbox channel (Facebook, Instagram, LinkedIn): its own token → the brand's
 * Publishing token for the same account → the server env token (Meta: only when META_PAGE_ID /
 * INSTAGRAM_USER_ID is unset or names this account, since a Page token is tied to its Page).
 */
export function pickInboxToken(kind: string, own: string | null, accountId: string, account: StoredCred | null, env: Env): string | null {
  if (own) return own;
  if (account?.token && accountId && account.externalId === accountId) return account.token;
  const [envId, envTok] = PUB_ENV[kind] ?? [];
  const token = envTok ? env[envTok] : undefined;
  if (!token) return null;
  if (PAGE_SCOPED.has(kind) && envId && env[envId] && env[envId] !== accountId) return null;
  return token;
}

/** WhatsApp sender: the channel's phone number id (config.accountId) and token, else WHATSAPP_PHONE_NUMBER_ID / WHATSAPP_TOKEN. */
export function pickWhatsAppSender(channel: { phoneId?: string | null; token?: string | null } | null, env: Env): { phoneId: string; token: string } | null {
  const phoneId = channel?.phoneId || env.WHATSAPP_PHONE_NUMBER_ID;
  const token = channel?.token || env.WHATSAPP_TOKEN;
  return phoneId && token ? { phoneId, token } : null;
}
