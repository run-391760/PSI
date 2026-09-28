/**
 * Channel catalogue for the CX workspace: every channel, what it powers, which API it needs and
 * whether that API is free. Client-safe (no server imports).
 */
export type ChannelKind =
  | "email"
  | "livechat"
  | "webform"
  | "youtube"
  | "reddit"
  | "news"
  | "hackernews"
  | "bluesky"
  | "mastodon"
  | "appstore"
  | "playstore"
  | "facebook"
  | "instagram"
  | "whatsapp"
  | "x"
  | "linkedin"
  | "google-reviews";

export type ChannelUse = "listening" | "inbox" | "publishing" | "analytics";

export type ChannelInfo = {
  kind: ChannelKind;
  name: string;
  uses: ChannelUse[];
  api: string;
  cost: "free" | "free-approval" | "paid";
  costNote: string;
  /** Server env vars (empty = configured per channel in Settings → Channels, or none needed). */
  env: string[];
  setup: string;
};

export const CHANNELS: ChannelInfo[] = [
  { kind: "email", name: "Email", uses: ["inbox"], api: "IMAP + SMTP of your mailbox", cost: "free", costNote: "Free", env: [], setup: "Add the mailbox's IMAP/SMTP host, user and an app password in Settings → Channels." },
  { kind: "livechat", name: "Live chat", uses: ["inbox"], api: "Built-in chat widget", cost: "free", costNote: "Free", env: [], setup: "Create a live chat channel and paste its embed snippet on your website." },
  { kind: "webform", name: "Web form", uses: ["inbox"], api: "Built-in contact form", cost: "free", costNote: "Free", env: [], setup: "Create a form channel and share or embed its link." },
  { kind: "news", name: "News", uses: ["listening"], api: "Google News RSS", cost: "free", costNote: "Free", env: [], setup: "Nothing to configure." },
  { kind: "reddit", name: "Reddit", uses: ["listening", "inbox"], api: "Reddit API", cost: "free", costNote: "Free for low volume (commercial use needs Reddit's agreement)", env: ["REDDIT_CLIENT_ID", "REDDIT_CLIENT_SECRET"], setup: "Create a 'script' app at reddit.com/prefs/apps." },
  { kind: "youtube", name: "YouTube", uses: ["listening", "inbox", "analytics"], api: "YouTube Data API v3", cost: "free", costNote: "Free (10,000 quota units/day)", env: ["YOUTUBE_API_KEY"], setup: "Enable YouTube Data API v3 in Google Cloud and create an API key." },
  { kind: "hackernews", name: "Hacker News", uses: ["listening"], api: "HN Algolia search API", cost: "free", costNote: "Free", env: [], setup: "Nothing to configure." },
  { kind: "bluesky", name: "Bluesky", uses: ["listening"], api: "Bluesky (AT Protocol) search", cost: "free", costNote: "Free (app password)", env: ["BLUESKY_HANDLE", "BLUESKY_APP_PASSWORD"], setup: "Create an app password in Bluesky settings." },
  { kind: "mastodon", name: "Mastodon", uses: ["listening"], api: "Mastodon public hashtag timelines", cost: "free", costNote: "Free", env: [], setup: "Nothing to configure (hashtag timelines on mastodon.social)." },
  { kind: "appstore", name: "App Store reviews", uses: ["listening"], api: "Apple customer reviews RSS", cost: "free", costNote: "Free", env: [], setup: "Add your app's App Store ID to a topic." },
  { kind: "playstore", name: "Google Play reviews", uses: ["listening", "inbox"], api: "Google Play Developer API (own apps)", cost: "free-approval", costNote: "Free for your own apps (service account)", env: ["GOOGLE_PLAY_SERVICE_ACCOUNT_JSON"], setup: "Invite a service account in Play Console → Users & permissions." },
  { kind: "facebook", name: "Facebook", uses: ["listening", "inbox", "publishing", "analytics"], api: "Meta Graph API", cost: "free-approval", costNote: "Free; needs a Meta app with App Review", env: ["META_APP_ID", "META_APP_SECRET"], setup: "Create a Meta app, request pages_manage_posts, pages_read_engagement, pages_messaging; connect a Page." },
  { kind: "instagram", name: "Instagram", uses: ["listening", "inbox", "publishing", "analytics"], api: "Instagram Graph API", cost: "free-approval", costNote: "Free; needs Meta App Review", env: ["META_APP_ID", "META_APP_SECRET"], setup: "Business account linked to a Facebook Page; instagram_manage_comments / messages permissions." },
  { kind: "whatsapp", name: "WhatsApp", uses: ["inbox"], api: "WhatsApp Business Cloud API", cost: "paid", costNote: "Meta per-conversation pricing; business verification", env: ["WHATSAPP_TOKEN", "WHATSAPP_PHONE_NUMBER_ID", "WHATSAPP_VERIFY_TOKEN"], setup: "Set up WhatsApp Business in Meta Business Manager and point the webhook to /api/cx/webhooks/whatsapp." },
  { kind: "x", name: "X (Twitter)", uses: ["listening", "inbox", "publishing", "analytics"], api: "X API v2", cost: "paid", costNote: "Paid: Basic tier or higher for search/mentions", env: ["X_BEARER_TOKEN"], setup: "Subscribe to an X API tier and create a bearer token." },
  { kind: "linkedin", name: "LinkedIn", uses: ["publishing", "analytics"], api: "LinkedIn Community Management API", cost: "free-approval", costNote: "Free; partner approval required", env: ["LINKEDIN_CLIENT_ID", "LINKEDIN_CLIENT_SECRET"], setup: "Apply for Community Management API access." },
  { kind: "google-reviews", name: "Google reviews", uses: ["listening", "inbox"], api: "Business Profile API or DataForSEO", cost: "free-approval", costNote: "Business Profile API needs Google approval; DataForSEO is pay-per-use", env: ["DATAFORSEO_LOGIN"], setup: "Connect DataForSEO, or request Business Profile API access." },
];

export const channelInfo = (kind: string) => CHANNELS.find((c) => c.kind === kind);
