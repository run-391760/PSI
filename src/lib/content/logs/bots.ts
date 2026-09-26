/** Crawler detection by user agent (client-safe metadata + matcher). */

export type BotGroup = "search" | "ai" | "seo" | "social" | "monitor" | "other";
export type BotDef = { id: string; name: string; group: BotGroup; re: RegExp; /** rDNS suffixes for verification (search engines only). */ rdns?: string[]; note?: string };

export const GROUP_LABELS: Record<BotGroup, string> = {
  search: "Search engines",
  ai: "AI crawlers",
  seo: "SEO tools",
  social: "Social & previews",
  monitor: "Monitoring",
  other: "Other bots & scripts",
};

/** Order matters: specific tokens first. */
export const BOTS: BotDef[] = [
  // AI crawlers and AI assistants
  { id: "gptbot", name: "GPTBot", group: "ai", re: /GPTBot/i, note: "OpenAI training crawler" },
  { id: "oai-searchbot", name: "OAI-SearchBot", group: "ai", re: /OAI-SearchBot/i, note: "ChatGPT search index" },
  { id: "chatgpt-user", name: "ChatGPT-User", group: "ai", re: /ChatGPT-User/i, note: "Fetches pages for ChatGPT users" },
  { id: "claudebot", name: "ClaudeBot", group: "ai", re: /ClaudeBot|anthropic-ai/i, note: "Anthropic crawler" },
  { id: "claude-user", name: "Claude-User", group: "ai", re: /Claude-User|Claude-SearchBot/i, note: "Fetches pages for Claude users / search" },
  { id: "perplexitybot", name: "PerplexityBot", group: "ai", re: /PerplexityBot|Perplexity-User/i, note: "Perplexity answer engine" },
  { id: "google-extended", name: "Google-Extended", group: "ai", re: /Google-Extended/i, note: "Robots.txt token for Gemini training; Google crawls with Googlebot, so it rarely appears in logs" },
  { id: "ccbot", name: "CCBot", group: "ai", re: /CCBot/i, note: "Common Crawl (used to train many LLMs)" },
  { id: "bytespider", name: "Bytespider", group: "ai", re: /Bytespider/i, note: "ByteDance crawler" },
  { id: "amazonbot", name: "Amazonbot", group: "ai", re: /Amazonbot/i },
  { id: "applebot-extended", name: "Applebot-Extended", group: "ai", re: /Applebot-Extended/i },
  { id: "meta-externalagent", name: "Meta-ExternalAgent", group: "ai", re: /meta-externalagent|meta-externalfetcher/i },
  { id: "cohere", name: "cohere-ai", group: "ai", re: /cohere-ai|cohere-training/i },
  { id: "duckassistbot", name: "DuckAssistBot", group: "ai", re: /DuckAssistBot/i },
  { id: "youbot", name: "YouBot", group: "ai", re: /YouBot/i },
  { id: "diffbot", name: "Diffbot", group: "ai", re: /Diffbot/i },
  // Google family
  { id: "googlebot-image", name: "Googlebot-Image", group: "search", re: /Googlebot-Image/i, rdns: ["googlebot.com", "google.com"] },
  { id: "googlebot-video", name: "Googlebot-Video", group: "search", re: /Googlebot-Video/i, rdns: ["googlebot.com", "google.com"] },
  { id: "googlebot-news", name: "Googlebot-News", group: "search", re: /Googlebot-News/i, rdns: ["googlebot.com", "google.com"] },
  { id: "google-other", name: "Google (other crawlers)", group: "search", re: /AdsBot-Google|Mediapartners-Google|Google-InspectionTool|GoogleOther|Storebot-Google|APIs-Google|FeedFetcher-Google|Google-Read-Aloud|Google-Site-Verification/i, rdns: ["googlebot.com", "google.com", "googleusercontent.com"] },
  { id: "googlebot-smartphone", name: "Googlebot Smartphone", group: "search", re: /Googlebot\/[\d.]+.*|Googlebot/i, rdns: ["googlebot.com", "google.com"] },
  // Other search engines
  { id: "bingbot", name: "Bingbot", group: "search", re: /bingbot|BingPreview|msnbot|adidxbot/i, rdns: ["search.msn.com"] },
  { id: "yandexbot", name: "YandexBot", group: "search", re: /Yandex(Bot|Images|Mobile|Metrika|Accessibility|Direct|Video|Media|Blogs|Favicons|Webmaster|PagesChecker|Calendar|News|Market)?/i, rdns: ["yandex.ru", "yandex.net", "yandex.com"] },
  { id: "baiduspider", name: "Baiduspider", group: "search", re: /Baiduspider/i, rdns: ["baidu.com", "baidu.jp"] },
  { id: "duckduckbot", name: "DuckDuckBot", group: "search", re: /DuckDuckBot|DuckDuckGo-Favicons-Bot/i },
  { id: "applebot", name: "Applebot", group: "search", re: /Applebot/i, rdns: ["applebot.apple.com"] },
  { id: "yahoo", name: "Yahoo Slurp", group: "search", re: /Slurp/i },
  { id: "seznam", name: "SeznamBot", group: "search", re: /SeznamBot/i },
  { id: "petalbot", name: "PetalBot", group: "search", re: /PetalBot/i },
  { id: "naver", name: "Naver Yeti", group: "search", re: /Yeti\/|NaverBot/i },
  // SEO tools
  { id: "ahrefsbot", name: "AhrefsBot", group: "seo", re: /AhrefsBot|AhrefsSiteAudit/i },
  { id: "semrushbot", name: "SemrushBot", group: "seo", re: /SemrushBot|SiteAuditBot|SplitSignalBot/i },
  { id: "mj12bot", name: "MJ12bot", group: "seo", re: /MJ12bot/i },
  { id: "dotbot", name: "DotBot", group: "seo", re: /DotBot|rogerbot/i },
  { id: "screaming-frog", name: "Screaming Frog", group: "seo", re: /Screaming Frog/i },
  { id: "other-seo", name: "Other SEO tools", group: "seo", re: /BLEXBot|DataForSeoBot|serpstatbot|SeekportBot|Barkrowler|linkdexbot|SynapseSEOBot/i },
  // Social / previews
  { id: "facebook", name: "Facebook", group: "social", re: /facebookexternalhit|FacebookBot|facebookcatalog/i },
  { id: "twitterbot", name: "Twitterbot", group: "social", re: /Twitterbot/i },
  { id: "linkedinbot", name: "LinkedInBot", group: "social", re: /LinkedInBot/i },
  { id: "other-social", name: "Other previews", group: "social", re: /Pinterestbot|Slackbot|WhatsApp|TelegramBot|Discordbot|redditbot|Embedly|SkypeUriPreview/i },
  // Monitoring
  { id: "monitor", name: "Uptime monitors", group: "monitor", re: /UptimeRobot|Pingdom|StatusCake|Site24x7|BetterUptime|Better Stack|NewRelicPinger|Datadog/i },
  // Generic
  { id: "other", name: "Other bots & scripts", group: "other", re: /bot\b|bot\/|crawler|spider|crawl|scraper|fetcher|python-requests|python-urllib|aiohttp|curl\/|wget|Go-http-client|okhttp|axios\/|node-fetch|HeadlessChrome|PhantomJS|libwww|Java\/|Apache-HttpClient|Scrapy/i },
];

const cache = new Map<string, BotDef | null>();

/** Classify a user agent; null = likely a human browser. */
export function detectBot(ua: string): BotDef | null {
  if (!ua || ua === "-") return BOTS[BOTS.length - 1];
  const hit = cache.get(ua);
  if (hit !== undefined) return hit;
  let found: BotDef | null = null;
  for (const b of BOTS) {
    if (b.re.test(ua)) {
      found = b;
      break;
    }
  }
  if (found?.id === "googlebot-smartphone" && !/Android|Mobile|iPhone/i.test(ua)) found = GOOGLEBOT_DESKTOP;
  if (cache.size > 5000) cache.clear();
  cache.set(ua, found);
  return found;
}
export const GOOGLEBOT_DESKTOP: BotDef = { id: "googlebot-desktop", name: "Googlebot Desktop", group: "search", re: /Googlebot/i, rdns: ["googlebot.com", "google.com"] };
export const ALL_BOTS: BotDef[] = [...BOTS.slice(0, BOTS.findIndex((b) => b.id === "googlebot-smartphone") + 1), GOOGLEBOT_DESKTOP, ...BOTS.slice(BOTS.findIndex((b) => b.id === "googlebot-smartphone") + 1)];
export const botById = (id: string) => ALL_BOTS.find((b) => b.id === id);
