/**
 * Deterministic sample access log (Combined format) for a fictional outdoor store, so the Log File
 * Analyzer can be tried without a file. Always labelled "Demo" in the UI.
 */
import { rng } from "@/lib/seo/engine";

export const SAMPLE_HOST = "demo-outdoor-store.example";
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const UA = {
  gSmart: "Mozilla/5.0 (Linux; Android 6.0.1; Nexus 5X Build/MMB29P) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.6478.126 Mobile Safari/537.36 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
  gDesk: "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; Googlebot/2.1; +http://www.google.com/bot.html) Chrome/126.0.6478.126 Safari/537.36",
  gImg: "Googlebot-Image/1.0",
  gAds: "AdsBot-Google (+http://www.google.com/adsbot.html)",
  bing: "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm) Chrome/116.0.1938.76 Safari/537.36",
  yandex: "Mozilla/5.0 (compatible; YandexBot/3.0; +http://yandex.com/bots)",
  baidu: "Mozilla/5.0 (compatible; Baiduspider/2.0; +http://www.baidu.com/search/spider.html)",
  ddg: "DuckDuckBot/1.1; (+http://duckduckgo.com/duckduckbot.html)",
  apple: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/13.1.1 Safari/605.1.15 (Applebot/0.1; +http://www.apple.com/go/applebot)",
  gpt: "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; GPTBot/1.2; +https://openai.com/gptbot)",
  oai: "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; OAI-SearchBot/1.0; +https://openai.com/searchbot",
  chatgpt: "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; ChatGPT-User/1.0; +https://openai.com/bot",
  claude: "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; ClaudeBot/1.0; +claudebot@anthropic.com)",
  perplexity: "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; PerplexityBot/1.0; +https://perplexity.ai/perplexitybot)",
  cc: "CCBot/2.0 (https://commoncrawl.org/faq/)",
  byte: "Mozilla/5.0 (Linux; Android 5.0) AppleWebKit/537.36 (KHTML, like Gecko) Mobile Safari/537.36 (compatible; Bytespider; spider-feedback@bytedance.com)",
  amazon: "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; Amazonbot/0.1; +https://developer.amazon.com/support/amazonbot) Chrome/119.0.6045.214 Safari/537.36",
  ahrefs: "Mozilla/5.0 (compatible; AhrefsBot/7.0; +http://ahrefs.com/robot/)",
  semrush: "Mozilla/5.0 (compatible; SemrushBot/7~bl; +http://www.semrush.com/bot.html)",
  mj12: "Mozilla/5.0 (compatible; MJ12bot/v1.4.8; http://mj12bot.com/)",
  fb: "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)",
  script: "python-requests/2.31.0",
};
const HUMAN_UA = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15",
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Mobile Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:129.0) Gecko/20100101 Firefox/129.0",
];

type Crawler = { ua: string; ips: string[]; perDay: number; mix: [kind: Kind, weight: number][]; growth?: number };
type Kind = "page" | "product" | "blog" | "category" | "param" | "resource" | "image" | "sitemap" | "robots" | "old" | "missing" | "api" | "search";

const CATEGORIES = ["hiking-boots", "trail-running-shoes", "tents", "backpacks", "sleeping-bags", "rain-jackets", "camping-stoves", "headlamps", "trekking-poles", "water-filters"];
const PAGES = ["/", "/about", "/contact", "/shipping", "/returns", "/size-guide", "/stores", "/careers", "/gift-cards", "/sale"];
const BLOG = [
  "how-to-choose-hiking-boots", "best-tents-for-beginners", "trail-running-tips", "what-to-pack-for-a-day-hike", "sleeping-bag-temperature-ratings", "how-to-waterproof-boots",
  "backpacking-checklist", "camping-stove-safety", "how-to-fit-a-backpack", "rain-jacket-buying-guide", "headlamp-lumens-explained", "trekking-poles-worth-it",
  "water-filter-vs-purifier", "ultralight-backpacking-guide", "winter-camping-essentials", "how-to-clean-a-tent", "best-hikes-in-colorado", "leave-no-trace-principles",
  "trail-shoes-vs-hiking-boots", "how-to-layer-for-hiking", "first-aid-kit-for-hikers", "camping-with-kids", "how-to-read-a-topo-map", "altitude-sickness-prevention",
];
const P = (s: string) => s.replace(/s$/, "");

export function generateSampleLog({ days = 30, end = new Date() }: { days?: number; end?: Date } = {}) {
  const r = rng("content:log-sample:v1");
  const products = CATEGORIES.flatMap((c) => Array.from({ length: 18 }, (_, i) => `/p/${P(c)}-${["trail", "summit", "ridge", "alpine", "canyon", "mesa"][i % 6]}-${100 + i * 7}`));
  const discontinued = products.filter((_, i) => i % 23 === 5).map((p) => `${p}-v1`);
  const oldUrls = [...CATEGORIES.map((c) => `/shop/${c}/`), ...BLOG.slice(0, 6).map((b) => `/news/${b}.html`), "/index.php", "/catalog"];
  const zipf = <T,>(items: T[], s = 1.1) => {
    const w = items.map((_, i) => 1 / (i + 1) ** s);
    return () => r.weighted(items, w);
  };
  const pickProduct = zipf(products, 0.9);
  const pickBlog = zipf(BLOG, 0.8);
  const pickCat = zipf(CATEGORIES, 0.7);
  const resources = ["/static/js/app.3f2a9c.js", "/static/js/vendor.91bd07.js", "/static/css/main.7e1a44.css", "/fonts/inter-var.woff2", "/favicon.ico", "/static/js/analytics.js"];
  const params = ["sort=price_asc", "sort=newest", "color=green", "color=black", "size=10", "page=2", "page=3", "utm_source=newsletter&utm_medium=email", "sessionid=a81f22", "filter=waterproof&sort=rating", "ref=footer"];

  const urlFor = (kind: Kind): string => {
    switch (kind) {
      case "page":
        return r.weighted(PAGES, [30, 3, 3, 4, 4, 5, 2, 1, 1, 6]);
      case "product":
        return pickProduct();
      case "blog":
        return `/blog/${pickBlog()}`;
      case "category":
        return `/c/${pickCat()}`;
      case "param":
        return `/c/${pickCat()}?${r.pick(params)}`;
      case "resource":
        return r.pick(resources);
      case "image":
        return `/images/products/${pickProduct().slice(3)}${r.chance(0.5) ? "" : `-${r.int(2, 4)}`}.webp`;
      case "sitemap":
        return r.weighted(["/sitemap.xml", "/sitemap-products.xml", "/sitemap-blog.xml", "/feed.xml"], [4, 3, 2, 1]);
      case "robots":
        return "/robots.txt";
      case "old":
        return r.pick(oldUrls);
      case "missing":
        return r.chance(0.6) ? r.pick(discontinued) : r.pick(["/blog/summer-sale-2023", "/wp-login.php", "/.env", "/c/snowshoes", "/p/gift-card-old", "/xmlrpc.php"]);
      case "api":
        return `/api/stock?sku=${r.int(1000, 1400)}`;
      case "search":
        return `/search?q=${r.pick(["tent", "boots", "rain+jacket", "headlamp", "stove"])}`;
    }
  };

  const googleIps = ["66.249.66.1", "66.249.66.34", "66.249.66.87", "66.249.68.12", "66.249.79.101", "66.249.79.140"];
  const S: [Kind, number][] = [["page", 8], ["product", 40], ["blog", 14], ["category", 10], ["param", 6], ["resource", 8], ["sitemap", 2], ["robots", 1], ["old", 3], ["missing", 2], ["api", 1], ["search", 1]];
  const AI: [Kind, number][] = [["blog", 45], ["product", 25], ["page", 10], ["category", 8], ["robots", 3], ["missing", 2], ["param", 3], ["sitemap", 1]];
  const SEO: [Kind, number][] = [["product", 30], ["category", 12], ["param", 22], ["blog", 12], ["old", 8], ["missing", 6], ["page", 6], ["robots", 2]];
  const crawlers: Crawler[] = [
    { ua: UA.gSmart, ips: googleIps, perDay: 430, mix: S },
    { ua: UA.gDesk, ips: googleIps, perDay: 80, mix: S },
    { ua: UA.gImg, ips: googleIps.slice(0, 3), perDay: 45, mix: [["image", 1]] },
    { ua: UA.gAds, ips: ["66.249.90.77"], perDay: 12, mix: [["product", 8], ["category", 2], ["missing", 1]] },
    { ua: UA.bing, ips: ["40.77.167.8", "157.55.39.21", "207.46.13.95", "52.167.144.20"], perDay: 170, mix: S },
    { ua: UA.yandex, ips: ["5.255.253.14", "213.180.203.60"], perDay: 20, mix: S },
    { ua: UA.baidu, ips: ["220.181.108.80", "116.179.32.150"], perDay: 12, mix: S },
    { ua: UA.ddg, ips: ["20.191.45.212", "40.88.21.235"], perDay: 9, mix: S },
    { ua: UA.apple, ips: ["17.241.219.33", "17.241.75.12"], perDay: 28, mix: S },
    { ua: UA.gpt, ips: ["20.171.207.4", "20.171.207.130", "52.230.152.44"], perDay: 55, mix: AI, growth: 1.2 },
    { ua: UA.oai, ips: ["20.42.10.176"], perDay: 12, mix: AI, growth: 1.6 },
    { ua: UA.chatgpt, ips: ["23.98.142.179"], perDay: 9, mix: [["blog", 6], ["product", 3], ["page", 1]], growth: 2 },
    { ua: UA.claude, ips: ["34.162.142.92", "34.162.183.95"], perDay: 45, mix: AI, growth: 0.8 },
    { ua: UA.perplexity, ips: ["44.221.181.252", "3.224.220.101"], perDay: 20, mix: AI, growth: 1 },
    { ua: UA.cc, ips: ["18.97.14.80", "18.97.9.168"], perDay: 14, mix: AI },
    { ua: UA.byte, ips: ["47.128.20.14", "47.128.60.93"], perDay: 16, mix: AI },
    { ua: UA.amazon, ips: ["52.70.240.171"], perDay: 10, mix: AI },
    { ua: UA.ahrefs, ips: ["54.36.148.12", "54.36.149.90", "51.222.253.4"], perDay: 65, mix: SEO },
    { ua: UA.semrush, ips: ["85.208.96.201", "185.191.171.18"], perDay: 48, mix: SEO },
    { ua: UA.mj12, ips: ["136.243.228.179"], perDay: 9, mix: SEO },
    { ua: UA.fb, ips: ["173.252.83.12", "69.171.249.8"], perDay: 11, mix: [["product", 6], ["blog", 4], ["page", 1]] },
    { ua: UA.script, ips: ["45.155.205.99", "193.35.18.7"], perDay: 20, mix: [["missing", 4], ["param", 3], ["api", 3], ["product", 4], ["page", 2]] },
  ];

  const endDay = Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate());
  const lines: string[] = [];
  const incidentDay = Math.floor(days * 0.62);
  const googleSpikeDay = Math.floor(days * 0.35);
  for (let d = 0; d < days; d++) {
    const dayStart = endDay - (days - d) * 86400000;
    const dow = new Date(dayStart).getUTCDay();
    const week = dow === 0 || dow === 6 ? 0.82 : 1;
    const day: [number, string][] = [];
    const push = (ip: string, sec: number, method: string, path: string, status: number, bytes: number, ref: string, ua: string) => {
      const t = new Date(dayStart + sec * 1000);
      const ts = `${String(t.getUTCDate()).padStart(2, "0")}/${MON[t.getUTCMonth()]}/${t.getUTCFullYear()}:${String(t.getUTCHours()).padStart(2, "0")}:${String(t.getUTCMinutes()).padStart(2, "0")}:${String(t.getUTCSeconds()).padStart(2, "0")} +0000`;
      day.push([sec, `${ip} - - [${ts}] "${method} ${path} HTTP/1.1" ${status} ${bytes} "${ref}" "${ua}"`]);
    };
    const serve = (kind: Kind, path: string, sec: number): [number, number] => {
      const incident = d === incidentDay && sec > 50400 && sec < 54000;
      if (incident && kind !== "resource" && kind !== "image") return [503, 312];
      if (kind === "old") return [301, 0];
      if (kind === "missing") return [404, 4870];
      if (kind === "search" && r.chance(0.08)) return [500, 1220];
      if (kind === "api" && r.chance(0.05)) return [503, 180];
      if (path.endsWith("/") && path.length > 1) return [301, 0];
      if (r.chance(kind === "resource" || kind === "image" ? 0.35 : 0.06)) return [304, 0];
      const size = kind === "image" ? r.int(24000, 280000) : kind === "resource" ? r.int(38000, 190000) : kind === "sitemap" ? r.int(8000, 64000) : kind === "robots" ? 412 : kind === "api" ? r.int(200, 900) : r.int(18000, 92000);
      return [200, size];
    };
    for (const c of crawlers) {
      const trend = 1 + (c.growth ?? 0) * (d / days) * 0.6;
      const spike = d === googleSpikeDay && c.ips === googleIps ? 2.4 : 1;
      const n = Math.round(c.perDay * week * trend * spike * r.range(0.8, 1.2));
      for (let i = 0; i < n; i++) {
        const kind = r.weighted(c.mix.map((m) => m[0]), c.mix.map((m) => m[1]));
        const path = urlFor(kind);
        const sec = r.int(0, 86399);
        const [status, bytes] = serve(kind, path, sec);
        push(r.pick(c.ips), sec, kind === "api" && r.chance(0.2) ? "HEAD" : "GET", path, status, bytes, "-", c.ua);
      }
    }
    // Humans (browsers): pages plus the resources they load.
    const humans = Math.round(520 * week * r.range(0.85, 1.15));
    for (let i = 0; i < humans; i++) {
      const ip = `${r.int(24, 223)}.${r.int(0, 255)}.${r.int(0, 255)}.${r.int(1, 254)}`;
      const ua = r.pick(HUMAN_UA);
      const kind = r.weighted<Kind>(["product", "category", "page", "blog", "param", "search"], [40, 18, 14, 16, 7, 5]);
      const path = urlFor(kind);
      const sec = r.int(0, 86399);
      const [status, bytes] = serve(kind, path, sec);
      push(ip, sec, "GET", path, status, bytes, r.pick(["-", "https://www.google.com/", "https://www.google.com/", "https://www.bing.com/", `https://${SAMPLE_HOST}/`]), ua);
      if (status === 200 && r.chance(0.5)) push(ip, sec + 1, "GET", r.pick(resources), 200, r.int(38000, 190000), `https://${SAMPLE_HOST}${path}`, ua);
    }
    day.sort((a, b) => a[0] - b[0]);
    for (const [, l] of day) lines.push(l);
  }
  return lines.join("\n") + "\n";
}
