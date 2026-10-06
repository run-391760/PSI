import { channelAvailable } from "@/lib/cx/providers";
import { googleConfigured, oauthConfigured, serviceAccount } from "@/lib/google/oauth";
import { liveEngine } from "@/lib/providers/ai-engines";
import { llmConfigured, llmLabel } from "@/lib/providers/llm";
import { newsEnabled } from "@/lib/providers/news";
import { pagespeedEnabled } from "@/lib/providers/pagespeed";
import { sarvamModel } from "@/lib/providers/sarvam";
import { flagEnabled, liveEnabled } from "@/lib/providers/source";

/**
 * One map of every credential the app reads: which env vars (or which CX settings page) provide it,
 * how "configured" is decided (the same resolvers the features use) and every feature it powers in the
 * SEO and CX workspaces. Rendered on SEO Settings → Integrations and CX Settings → Integrated Apps.
 * Server-only (reads process.env). Status helpers return flags, never values.
 */
export type Workspace = "SEO" | "CX";
export type Power = { workspace: Workspace; feature: string; href: string };

export type Credential = {
  id: string;
  label: string;
  provider: string;
  /** env: server variables · db: saved per brand/user in the app (encrypted with APP_SECRET). */
  storage: "env" | "db";
  kind: "key" | "free" | "internal";
  /** Alternatives: the credential is set when every variable of any one group is set. */
  env: string[][];
  /** Optional tuning variables (models, API versions, fallbacks). */
  optional?: string[];
  /** Same check the features use. Absent for db credentials (they are per brand). */
  configured?: () => boolean;
  /** Short status text when configured (model in use, quota mode…). */
  detail?: () => string | null;
  /** Shown when not configured (defaults, embedded fallbacks, when it becomes required). */
  unsetNote?: string;
  /** Not being set is fine (a default applies). Defaults to true when unsetNote is given. */
  unsetOk?: () => boolean;
  /** Something still missing although the credential counts as configured. */
  hint?: () => string | null;
  /** For db credentials: where they are saved. */
  savedAt?: { workspace: Workspace; label: string; href: string };
  powers: Power[];
  note?: string;
  docs?: string;
};

const isSet = (name: string) => Boolean(process.env[name] && process.env[name]!.trim());
const anySet = (groups: string[][]) => groups.some((g) => g.every(isSet));
const seo = (feature: string, href: string): Power => ({ workspace: "SEO", feature, href });
const cx = (feature: string, href: string): Power => ({ workspace: "CX", feature, href });
const model = (id: string) => () => liveEngine(id)?.model() ?? null;
/** Meta: the webhook pair, or the server-wide Page token (brands usually save their own Page token instead). */
const META_ENV = [["META_APP_SECRET", "META_VERIFY_TOKEN"], ["META_PAGE_ACCESS_TOKEN"]];

/** Features that run on whichever AI model key is set (shared helper in src/lib/providers/llm.ts). */
const SHARED_AI: Power[] = [
  seo("Pre-Publish Optimizer: AI review, fix-it and brief", "/optimizer"),
  cx("Inbox suggested replies, grammar fix and translate", "/cx/inbox"),
  cx("Ask & executive briefs", "/cx/ask"),
  cx("Quality AI pre-scoring", "/cx/quality"),
  cx("Crisis summaries", "/cx/crisis"),
  cx("Publishing AI compose", "/cx/publishing"),
  cx("Dashboard chart insights", "/cx/dashboards"),
  cx("Report insights", "/cx/reports"),
];
const SHARED_AI_NOTE = "Pre-Publish Optimizer and CX AI features use one AI key (Anthropic, OpenAI, Gemini or Sarvam), in order Anthropic → OpenAI → Gemini → Sarvam (the next one is tried if a call fails).";

export const CREDENTIALS: Credential[] = [
  // ------------------------------------------------------------------------------------- AI models
  {
    id: "anthropic",
    label: "Anthropic (Claude)",
    provider: "Anthropic",
    storage: "env",
    kind: "key",
    env: [["ANTHROPIC_API_KEY"]],
    optional: ["ANTHROPIC_MODEL"],
    configured: () => isSet("ANTHROPIC_API_KEY"),
    detail: model("claude"),
    powers: [seo("AI Visibility: Claude answers", "/ai-visibility"), ...SHARED_AI],
    note: SHARED_AI_NOTE,
    docs: "https://console.anthropic.com/",
  },
  {
    id: "openai",
    label: "OpenAI",
    provider: "OpenAI",
    storage: "env",
    kind: "key",
    env: [["OPENAI_API_KEY"]],
    optional: ["OPENAI_MODEL", "OPENAI_IMAGE_MODEL"],
    configured: () => isSet("OPENAI_API_KEY"),
    detail: model("chatgpt"),
    powers: [seo("AI Visibility: ChatGPT answers", "/ai-visibility"), ...SHARED_AI, cx("Publishing AI image generation", "/cx/publishing/assets")],
    note: `${SHARED_AI_NOTE} Image generation needs OpenAI.`,
    docs: "https://platform.openai.com/api-keys",
  },
  {
    id: "gemini",
    label: "Google Gemini",
    provider: "Google",
    storage: "env",
    kind: "key",
    env: [["GEMINI_API_KEY"]],
    optional: ["GEMINI_MODEL"],
    configured: () => isSet("GEMINI_API_KEY"),
    detail: model("gemini"),
    powers: [seo("AI Visibility: Gemini answers", "/ai-visibility"), ...SHARED_AI],
    note: SHARED_AI_NOTE,
    docs: "https://aistudio.google.com/apikey",
  },
  {
    id: "sarvam",
    label: "Sarvam AI",
    provider: "Sarvam AI",
    storage: "env",
    kind: "key",
    env: [["SARVAM_API_KEY"]],
    optional: ["SARVAM_MODEL"],
    configured: () => isSet("SARVAM_API_KEY"),
    detail: () => sarvamModel(),
    powers: [
      ...SHARED_AI,
      cx("Listening: Indian-language detection, English translation and sentiment", "/cx/listening"),
      cx("Inbox translation to and from Indian languages", "/cx/inbox"),
    ],
    note: `${SHARED_AI_NOTE} Sarvam also translates new Indian-language listening mentions (Hindi, Bengali, Gujarati, Tamil, Telugu and more, plus romanized Hindi) to English before sentiment and intent scoring, up to 200 per fetch run, and handles inbox translation whenever either side is an Indian language.`,
    docs: "https://docs.sarvam.ai/api-reference/authentication",
  },
  {
    id: "perplexity",
    label: "Perplexity",
    provider: "Perplexity",
    storage: "env",
    kind: "key",
    env: [["PERPLEXITY_API_KEY"]],
    optional: ["PERPLEXITY_MODEL", "PERPLEXITY_PRESET"],
    configured: () => isSet("PERPLEXITY_API_KEY"),
    detail: model("perplexity"),
    powers: [seo("AI Visibility: Perplexity answers", "/ai-visibility")],
    note: "Used only for AI Visibility answers, not for writing features.",
    docs: "https://docs.perplexity.ai/",
  },
  // ---------------------------------------------------------------------------------- SEO data
  {
    id: "dataforseo",
    label: "DataForSEO",
    provider: "DataForSEO",
    storage: "env",
    kind: "key",
    env: [["DATAFORSEO_LOGIN", "DATAFORSEO_PASSWORD"]],
    optional: ["GLOBAL_API_BUDGET_USD", "MAX_MONTHLY_API_USD"],
    configured: liveEnabled,
    powers: [
      seo("Pre-Publish Optimizer: live SERP, keyword metrics and content briefs", "/optimizer"),
      seo("Keyword Magic Tool", "/keyword-magic-tool"),
      seo("Keyword Overview", "/keyword-overview"),
      seo("Keyword Strategy", "/keyword-strategy"),
      seo("Keyword Gap", "/keyword-gap"),
      seo("PPC Keyword Tool", "/ppc-keyword-tool"),
      seo("Domain Overview", "/domain-overview"),
      seo("Organic Research", "/organic-research"),
      seo("Market Explorer", "/market-explorer"),
      seo("Position Tracking", "/position-tracking"),
      seo("SERP Sensor", "/sensor"),
      seo("Advertising Research", "/advertising-research"),
      seo("Backlink Analytics", "/backlink-analytics"),
      seo("Backlink Audit", "/backlink-audit"),
      seo("Backlink Gap", "/backlink-gap"),
      seo("Bulk Analysis", "/bulk-analysis"),
      seo("Link Building", "/link-building"),
      seo("Topic Research", "/topic-research"),
      seo("On Page SEO Checker benchmarks", "/on-page-checker"),
      seo("Google listing", "/local/listings"),
      seo("Google reviews", "/local/reviews"),
      seo("Map Rank Tracker", "/local/map-rank-tracker"),
      seo("AI Visibility: Google AI Overviews", "/ai-visibility"),
      cx("Google reviews", "/cx/listening/reviews"),
      cx("Plan & usage: paid-API spend", "/cx/plan"),
    ],
    note: "Every paid call reserves its worst-case cost against the monthly budget first (Settings → Budget).",
    docs: "https://dataforseo.com/apis",
  },
  {
    id: "google",
    label: "Google Search Console & GA4",
    provider: "Google",
    storage: "env",
    kind: "key",
    env: [
      ["GOOGLE_SERVICE_ACCOUNT_JSON"],
      ["GOOGLE_SERVICE_ACCOUNT_FILE"],
      ["GOOGLE_GA4_SERVICE_ACCOUNT_JSON"],
      ["GOOGLE_GA4_SERVICE_ACCOUNT_FILE"],
      ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"],
    ],
    configured: googleConfigured,
    detail: () => {
      const sa = !!serviceAccount("gsc") || !!serviceAccount("ga4");
      return sa ? "Service account" : oauthConfigured() ? "OAuth · each user connects Google" : null;
    },
    powers: [
      seo("Pre-Publish Optimizer: Search Console data", "/optimizer"),
      seo("Organic Traffic Insights", "/organic-traffic-insights"),
      seo("Project dashboards and reports", "/projects"),
      seo("Keyword Overview & Strategy: Search Console", "/keyword-overview"),
      seo("Position Tracking: Search Console import", "/position-tracking"),
      seo("On Page SEO Checker: page data", "/on-page-checker"),
      seo("Link Building: prospect keywords", "/link-building"),
      cx("Analytics: GA4 audience", "/cx/analytics"),
    ],
    note: "A service account works for everyone; an OAuth web client lets each user connect on Organic Traffic Insights.",
    docs: "https://console.cloud.google.com/apis/credentials",
  },
  {
    id: "pagespeed",
    label: "PageSpeed Insights",
    provider: "Google",
    storage: "env",
    kind: "free",
    env: [],
    optional: ["PAGESPEED_API_KEY", "ENABLE_PAGESPEED"],
    configured: pagespeedEnabled,
    detail: () => (isSet("PAGESPEED_API_KEY") ? "API key set" : "Shared quota"),
    unsetNote: "Turned off with ENABLE_PAGESPEED=false",
    powers: [seo("Site Audit: Core Web Vitals", "/site-audit"), seo("Pre-Publish Optimizer: live check", "/optimizer")],
    note: "Free and on by default. An API key is optional and raises the quota.",
    docs: "https://developers.google.com/speed/docs/insights/v5/get-started",
  },
  {
    id: "autocomplete",
    label: "Google Autocomplete",
    provider: "Google",
    storage: "env",
    kind: "free",
    env: [],
    optional: ["ENABLE_AUTOCOMPLETE"],
    configured: () => flagEnabled("ENABLE_AUTOCOMPLETE"),
    unsetNote: "Turned off with ENABLE_AUTOCOMPLETE=false",
    powers: [seo("Keyword Magic Tool suggestions", "/keyword-magic-tool"), seo("Topic Research questions", "/topic-research"), seo("Pre-Publish Optimizer: related questions", "/optimizer")],
    note: "Free, no key needed.",
  },
  {
    id: "news",
    label: "Google News",
    provider: "Google",
    storage: "env",
    kind: "free",
    env: [],
    optional: ["ENABLE_NEWS_MENTIONS"],
    configured: newsEnabled,
    unsetNote: "Turned off with ENABLE_NEWS_MENTIONS=false",
    powers: [seo("Brand Monitoring mentions", "/brand-monitoring")],
    note: "Free, no key needed.",
  },
  // ----------------------------------------------------------------------------------- CX channels
  {
    id: "meta",
    label: "Meta app (Facebook & Instagram)",
    provider: "Meta",
    storage: "env",
    kind: "key",
    // What the code reads: the webhook route needs META_APP_SECRET + META_VERIFY_TOKEN; inbox, publishing and
    // analytics need a Page token (saved per brand, META_PAGE_ACCESS_TOKEN as the server-wide fallback).
    env: META_ENV,
    optional: ["META_PAGE_ID", "INSTAGRAM_USER_ID", "META_GRAPH_VERSION"],
    configured: () => anySet(META_ENV),
    unsetNote: "Brands save their Page token in Omni-Channel Setup or Publishing; inbox webhooks need META_APP_SECRET + META_VERIFY_TOKEN",
    hint: () => (anySet([META_ENV[0]]) ? null : "Inbox webhooks (Messenger, Instagram DMs, comments) also need META_APP_SECRET and META_VERIFY_TOKEN"),
    powers: [
      cx("Inbox: Messenger, Instagram DMs, comments and mentions", "/cx/inbox"),
      cx("Publishing: Facebook & Instagram", "/cx/publishing"),
      cx("Analytics: Facebook & Instagram insights", "/cx/analytics"),
      cx("Instagram report", "/cx/reports/instagram"),
    ],
    note: "Each brand saves its Page token in Omni-Channel Setup or Publishing (META_PAGE_ACCESS_TOKEN is the server-wide fallback), so posting and replying need no server key. The webhook at /api/cx/webhooks/meta needs META_APP_SECRET and META_VERIFY_TOKEN.",
    docs: "https://developers.facebook.com/apps/",
  },
  {
    id: "whatsapp",
    label: "WhatsApp Cloud API",
    provider: "Meta",
    storage: "env",
    kind: "key",
    env: [["WHATSAPP_TOKEN", "WHATSAPP_PHONE_NUMBER_ID", "WHATSAPP_VERIFY_TOKEN"]],
    configured: () => channelAvailable("whatsapp"),
    powers: [cx("Inbox: WhatsApp conversations", "/cx/inbox")],
    note: "Point the webhook at /api/cx/webhooks/whatsapp.",
    docs: "https://developers.facebook.com/docs/whatsapp/cloud-api",
  },
  {
    id: "linkedin",
    label: "LinkedIn",
    provider: "LinkedIn",
    storage: "env",
    kind: "key",
    env: [["LINKEDIN_ACCESS_TOKEN"]],
    optional: ["LINKEDIN_AUTHOR_URN", "LINKEDIN_API_VERSION"],
    configured: () => isSet("LINKEDIN_ACCESS_TOKEN"),
    unsetNote: "Brands save their LinkedIn token in Omni-Channel Setup or Publishing",
    powers: [
      cx("Inbox: LinkedIn comments and mentions", "/cx/inbox"),
      cx("Publishing: LinkedIn", "/cx/publishing"),
      cx("Analytics: LinkedIn insights", "/cx/analytics"),
    ],
    note: "Only an access token is read: the brand's saved token, else LINKEDIN_ACCESS_TOKEN as the server-wide fallback.",
    docs: "https://www.linkedin.com/developers/apps",
  },
  {
    id: "x",
    label: "X (Twitter) API",
    provider: "X",
    storage: "env",
    kind: "key",
    env: [["X_BEARER_TOKEN"]],
    optional: ["X_USER_ID", "X_USER_ACCESS_TOKEN"],
    configured: () => channelAvailable("x"),
    powers: [cx("Publishing: X posts and insights", "/cx/publishing")],
    note: "Posting also needs a user token, saved in Publishing or set as X_USER_ACCESS_TOKEN.",
    docs: "https://developer.x.com/",
  },
  {
    id: "youtube",
    label: "YouTube Data API",
    provider: "Google",
    storage: "env",
    kind: "key",
    env: [["YOUTUBE_API_KEY"]],
    optional: ["YOUTUBE_UPLOAD_ACCESS_TOKEN"],
    configured: () => channelAvailable("youtube"),
    powers: [
      cx("Listening: YouTube videos and comments", "/cx/listening"),
      cx("Social profiles: @handle lookup", "/cx/settings/social-profiles"),
      cx("Publishing: YouTube channel insights", "/cx/publishing"),
    ],
    docs: "https://console.cloud.google.com/apis/library/youtube.googleapis.com",
  },
  {
    id: "reddit",
    label: "Reddit API",
    provider: "Reddit",
    storage: "env",
    kind: "key",
    env: [["REDDIT_CLIENT_ID", "REDDIT_CLIENT_SECRET"]],
    configured: () => channelAvailable("reddit"),
    powers: [cx("Listening: Reddit", "/cx/listening"), cx("Social profiles: Reddit", "/cx/settings/social-profiles")],
    docs: "https://www.reddit.com/prefs/apps",
  },
  {
    id: "bluesky",
    label: "Bluesky",
    provider: "Bluesky",
    storage: "env",
    kind: "key",
    env: [["BLUESKY_HANDLE", "BLUESKY_APP_PASSWORD"]],
    configured: () => channelAvailable("bluesky"),
    powers: [cx("Listening: Bluesky keyword search", "/cx/listening")],
  },
  {
    id: "threads",
    label: "Threads API",
    provider: "Meta",
    storage: "env",
    kind: "key",
    env: [["THREADS_USER_ID", "THREADS_ACCESS_TOKEN"]],
    configured: () => anySet([["THREADS_USER_ID", "THREADS_ACCESS_TOKEN"]]),
    unsetNote: "A Threads account token saved in Publishing is enough",
    powers: [cx("Publishing: Threads", "/cx/publishing")],
    note: "Publishing reads only a token: the brand's Publishing account, else THREADS_USER_ID + THREADS_ACCESS_TOKEN.",
    docs: "https://developers.facebook.com/docs/threads",
  },
  {
    id: "gbp",
    label: "Google Business Profile",
    provider: "Google",
    storage: "env",
    kind: "key",
    env: [["GBP_LOCATION", "GBP_ACCESS_TOKEN"]],
    configured: () => anySet([["GBP_LOCATION", "GBP_ACCESS_TOKEN"]]),
    unsetNote: "A location token saved in Publishing is enough",
    powers: [cx("Publishing: Google Business Profile posts", "/cx/publishing")],
    note: "Publishing reads only a business.manage token: the location's Publishing account, else GBP_LOCATION + GBP_ACCESS_TOKEN.",
    docs: "https://developers.google.com/my-business",
  },
  {
    id: "playstore",
    label: "Google Play Developer API",
    provider: "Google",
    storage: "env",
    kind: "key",
    env: [["GOOGLE_PLAY_SERVICE_ACCOUNT_JSON"]],
    configured: () => channelAvailable("playstore"),
    powers: [cx("Channel catalogue: Google Play reviews", "/cx/settings/apps")],
    note: "Marks the channel available; review import is not built yet.",
  },
  {
    id: "twilio",
    label: "Twilio / Exotel calls",
    provider: "Twilio",
    storage: "env",
    kind: "key",
    env: [["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN"]],
    configured: () => channelAvailable("phone"),
    powers: [cx("Calls analytics", "/cx/reports/calls")],
    note: "Marks calls available; the call webhook is not built yet.",
  },
  {
    id: "tiktok",
    label: "TikTok",
    provider: "TikTok",
    storage: "env",
    kind: "key",
    env: [["TIKTOK_CLIENT_KEY", "TIKTOK_CLIENT_SECRET"]],
    configured: () => anySet([["TIKTOK_CLIENT_KEY", "TIKTOK_CLIENT_SECRET"]]),
    powers: [cx("All Apps: TikTok connect card", "/cx/settings/apps")],
    note: "Shown as configured only; no TikTok integration is built yet.",
  },
  {
    id: "pinterest",
    label: "Pinterest",
    provider: "Pinterest",
    storage: "env",
    kind: "key",
    env: [["PINTEREST_APP_ID", "PINTEREST_APP_SECRET"]],
    configured: () => anySet([["PINTEREST_APP_ID", "PINTEREST_APP_SECRET"]]),
    powers: [cx("All Apps: Pinterest connect card", "/cx/settings/apps")],
    note: "Shown as configured only; no Pinterest integration is built yet.",
  },
  {
    id: "messaging-partners",
    label: "LINE / Viber",
    provider: "LINE · Viber",
    storage: "env",
    kind: "key",
    env: [["LINE_CHANNEL_SECRET", "LINE_CHANNEL_ACCESS_TOKEN"], ["VIBER_AUTH_TOKEN"]],
    configured: () => anySet([["LINE_CHANNEL_SECRET", "LINE_CHANNEL_ACCESS_TOKEN"], ["VIBER_AUTH_TOKEN"]]),
    powers: [cx("All Apps: LINE and Viber connect cards", "/cx/settings/apps")],
    note: "Shown as configured only; no LINE or Viber integration is built yet.",
  },
  {
    id: "asset-storage",
    label: "Asset storage pickers",
    provider: "Amazon S3 · Google Drive · OneDrive",
    storage: "env",
    kind: "key",
    env: [["AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "CX_ASSETS_S3_BUCKET"], ["GOOGLE_CLIENT_ID", "GOOGLE_PICKER_API_KEY"], ["ONEDRIVE_CLIENT_ID"]],
    configured: () => anySet([["AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "CX_ASSETS_S3_BUCKET"], ["GOOGLE_CLIENT_ID", "GOOGLE_PICKER_API_KEY"], ["ONEDRIVE_CLIENT_ID"]]),
    powers: [cx("Publishing assets: storage card", "/cx/publishing/assets")],
    note: "Picker import is not enabled in this build yet.",
  },
  // ------------------------------------------------------------------------------------- internal
  {
    id: "app-secret",
    label: "APP_SECRET (encryption key)",
    provider: "This server",
    storage: "env",
    kind: "internal",
    env: [["APP_SECRET"]],
    configured: () => isSet("APP_SECRET"),
    unsetNote: "Development uses a generated key in .data/app-secret; required in production",
    unsetOk: () => process.env.NODE_ENV !== "production",
    powers: [
      seo("Google connections (OAuth tokens)", "/organic-traffic-insights"),
      cx("Saved channel tokens and mailboxes", "/cx/settings/channels"),
      cx("Publishing account tokens", "/cx/publishing"),
      cx("Webhook secrets and external API headers", "/cx/settings/api"),
      cx("Alert integrations", "/cx/settings/alerts"),
    ],
    note: "Encrypts every credential saved in the app. Changing it makes saved tokens unreadable.",
  },
  {
    id: "database",
    label: "DATABASE_URL",
    provider: "PostgreSQL",
    storage: "env",
    kind: "internal",
    env: [["DATABASE_URL"]],
    configured: () => isSet("DATABASE_URL"),
    unsetNote: "Using the embedded PGlite database in .data/postgres",
    powers: [seo("All SEO data", "/dashboard"), cx("All CX data", "/cx")],
    note: "Contains the database password.",
  },
  {
    id: "signup-invite",
    label: "SIGNUP_INVITE_CODE",
    provider: "This server",
    storage: "env",
    kind: "internal",
    env: [["SIGNUP_INVITE_CODE"]],
    optional: ["ALLOW_SIGNUPS"],
    configured: () => isSet("SIGNUP_INVITE_CODE"),
    unsetNote: "Sign-ups follow ALLOW_SIGNUPS",
    powers: [seo("Account registration (both workspaces)", "/register")],
  },
  // ------------------------------------------------------------------------- saved in the app (db)
  {
    id: "db-meta-page",
    label: "Facebook / Instagram Page token",
    provider: "Meta",
    storage: "db",
    kind: "key",
    env: [],
    savedAt: { workspace: "CX", label: "Omni-Channel Setup", href: "/cx/settings/channels" },
    powers: [cx("Inbox replies, private replies and mention fetches", "/cx/inbox")],
  },
  {
    id: "db-linkedin",
    label: "LinkedIn access token",
    provider: "LinkedIn",
    storage: "db",
    kind: "key",
    env: [],
    savedAt: { workspace: "CX", label: "Omni-Channel Setup", href: "/cx/settings/channels" },
    powers: [cx("Inbox: LinkedIn comments and replies", "/cx/inbox")],
    note: "Falls back to the LinkedIn Publishing account token, then LINKEDIN_ACCESS_TOKEN.",
  },
  {
    id: "db-mailbox",
    label: "Mailbox (IMAP/SMTP app password)",
    provider: "Your email provider",
    storage: "db",
    kind: "key",
    env: [],
    savedAt: { workspace: "CX", label: "Omni-Channel Setup", href: "/cx/settings/channels" },
    powers: [
      cx("Inbox: email", "/cx/inbox"),
      cx("Surveys", "/cx/surveys"),
      cx("Scheduled report exports", "/cx/reports"),
      cx("Alerts, SLA and invite emails", "/cx/settings/alerts"),
    ],
  },
  {
    id: "db-publishing",
    label: "Publishing account tokens",
    provider: "Meta · LinkedIn · X · Threads · Google · YouTube",
    storage: "db",
    kind: "key",
    env: [],
    savedAt: { workspace: "CX", label: "Publishing", href: "/cx/publishing" },
    powers: [cx("Publishing: post, schedule and delete", "/cx/publishing"), cx("Publishing insights", "/cx/analytics"), cx("A/B testing", "/cx/ab-testing")],
  },
  {
    id: "db-connectors",
    label: "Discord / Discourse / Telegram tokens",
    provider: "Discord · Discourse · Telegram",
    storage: "db",
    kind: "key",
    env: [],
    savedAt: { workspace: "CX", label: "Omni-Channel Setup", href: "/cx/settings/channels" },
    powers: [cx("Inbox connectors", "/cx/inbox")],
  },
  {
    id: "db-alerts",
    label: "Slack webhook / Telegram alert bot",
    provider: "Slack · Telegram",
    storage: "db",
    kind: "key",
    env: [],
    savedAt: { workspace: "CX", label: "Alerts", href: "/cx/settings/alerts" },
    powers: [cx("Alert delivery", "/cx/settings/alerts")],
  },
  {
    id: "db-webhooks",
    label: "Webhook secrets & external API headers",
    provider: "Your systems",
    storage: "db",
    kind: "key",
    env: [],
    savedAt: { workspace: "CX", label: "API & webhooks", href: "/cx/settings/api" },
    powers: [cx("Outbound webhooks", "/cx/settings/api"), cx("Ticket enrichment lookups", "/cx/inbox")],
  },
  {
    id: "db-google-user",
    label: "Google account connection",
    provider: "Google",
    storage: "db",
    kind: "key",
    env: [],
    savedAt: { workspace: "SEO", label: "Organic Traffic Insights", href: "/organic-traffic-insights" },
    powers: [seo("Organic Traffic Insights (per user)", "/organic-traffic-insights"), cx("Analytics: GA4 audience (brand owner)", "/cx/analytics")],
    note: "Needs GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET on the server.",
  },
];

export const credential = (id: string) => CREDENTIALS.find((c) => c.id === id);

/** Every env var a credential names (required alternatives + optional). */
export const credentialEnvVars = (c: Credential) => [...new Set([...c.env.flat(), ...(c.optional ?? [])])];

/** Feature labels for the SEO integration cards: CX features get a "CX: " prefix. */
export function powersOf(id: string): string[] {
  return [...new Set((credential(id)?.powers ?? []).map((p) => (p.workspace === "CX" ? `CX: ${p.feature}` : p.feature)))];
}

export type CredentialStatus = {
  id: string;
  label: string;
  provider: string;
  storage: "env" | "db";
  kind: Credential["kind"];
  /** null for credentials saved per brand/user in the app. */
  configured: boolean | null;
  /** Not configured, but a default applies (no action needed). */
  unsetOk: boolean;
  statusLabel: string;
  /** Each alternative with whether each variable is set (names only). */
  env: { name: string; set: boolean }[][];
  optional: { name: string; set: boolean }[];
  hint: string | null;
  savedAt: Credential["savedAt"] | null;
  powers: Power[];
  note: string | null;
  docs: string | null;
};

/** Configured flags for every credential. Never returns secret values. */
export function credentialStatus(): { llm: boolean; llmLabel: string | null; items: CredentialStatus[] } {
  const items = CREDENTIALS.map((c): CredentialStatus => {
    const on = c.configured ? c.configured() : null;
    const detail = on && c.detail ? c.detail() : null;
    return {
      id: c.id,
      label: c.label,
      provider: c.provider,
      storage: c.storage,
      kind: c.kind,
      configured: on,
      unsetOk: on === false && (c.unsetOk ? c.unsetOk() : !!c.unsetNote),
      statusLabel: on == null ? `Saved in ${c.savedAt?.workspace ?? "CX"} settings` : on ? (detail ? `Configured · ${detail}` : "Configured") : c.kind === "free" ? "Off" : "Not set",
      env: c.env.map((g) => g.map((name) => ({ name, set: isSet(name) }))),
      optional: (c.optional ?? []).map((name) => ({ name, set: isSet(name) })),
      hint: on && c.hint ? c.hint() : !on && on !== null ? (c.unsetNote ?? null) : null,
      savedAt: c.savedAt ?? null,
      powers: c.powers,
      note: c.note ?? null,
      docs: c.docs ?? null,
    };
  });
  const llm = llmConfigured();
  return { llm, llmLabel: llm ? llmLabel() : null, items };
}
