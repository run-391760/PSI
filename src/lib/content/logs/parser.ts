/**
 * Streaming access-log parser + aggregator (Apache/Nginx Combined and Common formats, optional
 * leading virtual host). Only aggregates are kept, so memory stays bounded for large files.
 */
import { ALL_BOTS, type BotGroup, detectBot } from "./bots";

const LINE = /^(\S+) \S+ \S+ \[([^\]]+)\] "((?:[^"\\]|\\.)*)" (\d{3}) (\d+|-)(?: "((?:[^"\\]|\\.)*)" "((?:[^"\\]|\\.)*)")?/;
const VHOST_LINE = /^\S+ (\S+) \S+ \S+ \[([^\]]+)\] "((?:[^"\\]|\\.)*)" (\d{3}) (\d+|-)(?: "((?:[^"\\]|\\.)*)" "((?:[^"\\]|\\.)*)")?/;
const MONTHS: Record<string, number> = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };

export type FileType = "page" | "js" | "css" | "image" | "font" | "json" | "xml" | "txt" | "pdf" | "media" | "other";
export const FILE_TYPE_LABELS: Record<FileType, string> = {
  page: "HTML pages",
  js: "JavaScript",
  css: "CSS",
  image: "Images",
  font: "Fonts",
  json: "JSON / API",
  xml: "XML / sitemaps",
  txt: "Text (robots.txt)",
  pdf: "PDF",
  media: "Audio / video",
  other: "Other",
};

export function fileType(path: string): FileType {
  const p = path.split("?")[0].toLowerCase();
  if (p.startsWith("/api/") || p.startsWith("/wp-json/") || p.startsWith("/graphql")) return "json";
  const ext = /\.([a-z0-9]{1,5})$/.exec(p)?.[1];
  if (!ext) return "page";
  if (["html", "htm", "php", "asp", "aspx", "jsp", "shtml", "cfm"].includes(ext)) return "page";
  if (["js", "mjs", "map"].includes(ext)) return "js";
  if (ext === "css") return "css";
  if (["png", "jpg", "jpeg", "gif", "webp", "svg", "ico", "avif", "bmp", "tif", "tiff"].includes(ext)) return "image";
  if (["woff", "woff2", "ttf", "otf", "eot"].includes(ext)) return "font";
  if (ext === "json") return "json";
  if (["xml", "rss", "atom", "gz"].includes(ext)) return "xml";
  if (ext === "txt") return "txt";
  if (ext === "pdf") return "pdf";
  if (["mp4", "webm", "mp3", "wav", "ogg", "mov", "m4a"].includes(ext)) return "media";
  return "other";
}

type Parsed = { ip: string; ms: number; day: string; method: string; path: string; status: number; bytes: number; ua: string; combined: boolean };

/** Parse one log line (null = not a Combined/Common log line). */
export function parseLine(line: string): Parsed | null {
  const m = LINE.exec(line) ?? VHOST_LINE.exec(line);
  if (!m) return null;
  const [, ip, ts, request, status, bytes, , ua] = m;
  const t = /^(\d{2})\/(\w{3})\/(\d{4}):(\d{2}):(\d{2}):(\d{2})(?: ([+-])(\d{2})(\d{2}))?/.exec(ts);
  if (!t || MONTHS[t[2]] === undefined) return null;
  const offset = t[7] ? (t[7] === "-" ? -1 : 1) * (Number(t[8]) * 60 + Number(t[9])) : 0;
  const ms = Date.UTC(Number(t[3]), MONTHS[t[2]], Number(t[1]), Number(t[4]), Number(t[5]), Number(t[6])) - offset * 60000;
  const day = `${t[3]}-${String(MONTHS[t[2]] + 1).padStart(2, "0")}-${t[1]}`;
  const parts = request.split(" ");
  let method = "-",
    path = "-";
  if (parts.length >= 2) {
    method = parts[0].slice(0, 10).toUpperCase();
    path = parts[1];
    if (/^https?:\/\//i.test(path)) {
      try {
        const u = new URL(path);
        path = u.pathname + u.search;
      } catch {
        /* keep raw */
      }
    }
    if (path.length > 500) path = path.slice(0, 500);
  }
  return { ip, ms, day, method, path, status: Number(status), bytes: bytes === "-" ? 0 : Number(bytes), ua: (ua ?? "").replace(/\\"/g, '"'), combined: ua !== undefined };
}

const REDIRECTS = new Set([301, 302, 303, 307, 308]);
const cls = (s: number) => (s >= 500 ? "s5" : s >= 400 ? "s4" : s >= 300 ? "s3" : "s2") as "s2" | "s3" | "s4" | "s5";
type Classes = { s2: number; s3: number; s4: number; s5: number };
const classes = (): Classes => ({ s2: 0, s3: 0, s4: 0, s5: 0 });

type BotAgg = { id: string; name: string; group: BotGroup; hits: number; bytes: number; st: Classes; codes: Map<number, number>; urls: Set<string> | number; first: number; last: number; ips: Map<string, number>; types: Map<FileType, number> };
type PageAgg = { path: string; hits: number; redirects: number; bots: Map<string, number>; last: number; lastStatus: number; st: Classes; days: Set<string>; first: number; bytes: number; group: Map<BotGroup, number> };

const MAX_PAGES = 150_000;
const MAX_BOT_URLS = 50_000;

export type LogSummary = {
  version: 1;
  format: "combined" | "common" | "mixed";
  totals: { lines: number; parsed: number; skipped: number; hits: number; botHits: number; humanHits: number; bytes: number; uniqueUrls: number; uniqueBotUrls: number; truncatedUrls: boolean };
  period: { from: string | null; to: string | null; days: number };
  bots: {
    id: string;
    name: string;
    group: BotGroup;
    hits: number;
    share: number;
    bytes: number;
    urls: number;
    first: string;
    last: string;
    ips: number;
    s2: number;
    s3: number;
    s4: number;
    s5: number;
    codes: { code: number; hits: number }[];
    topIps: { ip: string; hits: number }[];
    types: Partial<Record<FileType, number>>;
    verification: { status: "verified" | "partial" | "failed" | "unverified"; checked: number; verified: number; note?: string };
  }[];
  groups: { group: BotGroup; hits: number }[];
  daily: Record<string, number | string>[];
  fileTypes: { type: FileType; hits: number; pages: number }[];
  statusCodes: { code: number; hits: number }[];
  pages: { path: string; hits: number; google: number; bing: number; ai: number; other: number; topBot: string; last: string; lastStatus: number; s2: number; s3: number; s4: number; s5: number; days: number; type: FileType }[];
  errors: { path: string; status: number; hits: number; last: string; bots: string[] }[];
  waste: { redirects: number; clientErrors: number; serverErrors: number; params: number; total: number; share: number; paramNames: { name: string; hits: number }[]; paramUrls: { path: string; hits: number }[] };
  ai: { hits: number; pages: number; topPages: { path: string; hits: number; bots: string[] }[] };
  robots: { botId: string; hits: number }[];
  sitemaps: { botId: string; hits: number }[];
};

export class LogAggregator {
  lines = 0;
  parsed = 0;
  combined = 0;
  bytes = 0;
  humanHits = 0;
  private bots = new Map<string, BotAgg>();
  private pages = new Map<string, PageAgg>();
  private truncated = false;
  private daily = new Map<string, Map<string, number>>();
  private status = new Map<number, number>();
  private types = new Map<FileType, { hits: number; urls: Set<string> }>();
  private params = new Map<string, number>();
  private robots = new Map<string, number>();
  private sitemaps = new Map<string, number>();
  private first = Infinity;
  private last = -Infinity;
  private dayMin = "";
  private dayMax = "";

  add(line: string) {
    if (!line) return;
    this.lines++;
    const p = parseLine(line);
    if (!p) return;
    this.parsed++;
    if (p.combined) this.combined++;
    this.bytes += p.bytes;
    if (p.ms < this.first) this.first = p.ms;
    if (p.ms > this.last) this.last = p.ms;
    if (!this.dayMin || p.day < this.dayMin) this.dayMin = p.day;
    if (!this.dayMax || p.day > this.dayMax) this.dayMax = p.day;
    // Common-format lines carry no user agent, so crawlers can't be told apart from visitors.
    const bot = p.combined ? detectBot(p.ua) : null;
    const dayMap = this.daily.get(p.day) ?? new Map<string, number>();
    this.daily.set(p.day, dayMap);
    if (!bot) {
      this.humanHits++;
      dayMap.set("human", (dayMap.get("human") ?? 0) + 1);
      return;
    }
    dayMap.set(bot.id, (dayMap.get(bot.id) ?? 0) + 1);
    const c = cls(p.status);
    const redirect = REDIRECTS.has(p.status);
    if (c === "s4" || c === "s5") dayMap.set(`_${c}`, (dayMap.get(`_${c}`) ?? 0) + 1);
    if (redirect) dayMap.set("_s3", (dayMap.get("_s3") ?? 0) + 1);
    const type = fileType(p.path);
    // Bot aggregate
    let b = this.bots.get(bot.id);
    if (!b) {
      b = { id: bot.id, name: bot.name, group: bot.group, hits: 0, bytes: 0, st: classes(), codes: new Map(), urls: new Set(), first: p.ms, last: p.ms, ips: new Map(), types: new Map() };
      this.bots.set(bot.id, b);
    }
    b.hits++;
    b.bytes += p.bytes;
    b.st[cls(p.status)]++;
    b.codes.set(p.status, (b.codes.get(p.status) ?? 0) + 1);
    if (b.urls instanceof Set) {
      b.urls.add(p.path);
      if (b.urls.size > MAX_BOT_URLS) b.urls = b.urls.size;
    }
    if (p.ms < b.first) b.first = p.ms;
    if (p.ms > b.last) b.last = p.ms;
    if (b.ips.size < 2000 || b.ips.has(p.ip)) b.ips.set(p.ip, (b.ips.get(p.ip) ?? 0) + 1);
    b.types.set(type, (b.types.get(type) ?? 0) + 1);
    // Global bot aggregates
    this.status.set(p.status, (this.status.get(p.status) ?? 0) + 1);
    const tt = this.types.get(type) ?? { hits: 0, urls: new Set<string>() };
    tt.hits++;
    if (tt.urls.size < MAX_BOT_URLS) tt.urls.add(p.path);
    this.types.set(type, tt);
    const q = p.path.indexOf("?");
    if (q >= 0)
      for (const kv of p.path.slice(q + 1).split("&")) {
        const name = decodeSafe(kv.split("=")[0]).toLowerCase().slice(0, 40);
        if (name) this.params.set(name, (this.params.get(name) ?? 0) + 1);
        if (this.params.size > 500) break;
      }
    const bare = p.path.split("?")[0];
    if (bare === "/robots.txt") this.robots.set(bot.id, (this.robots.get(bot.id) ?? 0) + 1);
    if (/sitemap[^/]*\.xml(\.gz)?$/i.test(bare)) this.sitemaps.set(bot.id, (this.sitemaps.get(bot.id) ?? 0) + 1);
    // Page aggregate
    let pg = this.pages.get(p.path);
    if (!pg) {
      if (this.pages.size >= MAX_PAGES) {
        this.truncated = true;
        return;
      }
      pg = { path: p.path, hits: 0, redirects: 0, bots: new Map(), last: p.ms, lastStatus: p.status, st: classes(), days: new Set(), first: p.ms, bytes: 0, group: new Map() };
      this.pages.set(p.path, pg);
    }
    pg.hits++;
    if (redirect) pg.redirects++;
    pg.bots.set(bot.id, (pg.bots.get(bot.id) ?? 0) + 1);
    pg.group.set(bot.group, (pg.group.get(bot.group) ?? 0) + 1);
    pg.st[cls(p.status)]++;
    if (p.ms >= pg.last) {
      pg.last = p.ms;
      pg.lastStatus = p.status;
    }
    if (p.ms < pg.first) pg.first = p.ms;
    if (pg.days.size < 400) pg.days.add(p.day);
    pg.bytes += p.bytes;
  }

  get botHits() {
    let n = 0;
    for (const b of this.bots.values()) n += b.hits;
    return n;
  }

  /** Top IPs per bot (for reverse-DNS verification). */
  topIps(botId: string, n = 3) {
    const b = this.bots.get(botId);
    return b ? [...b.ips.entries()].sort((a, c) => c[1] - a[1]).slice(0, n).map(([ip]) => ip) : [];
  }
  botIds() {
    return [...this.bots.keys()];
  }

  finish(verification: Record<string, LogSummary["bots"][number]["verification"]> = {}): LogSummary {
    const iso = (ms: number) => new Date(ms).toISOString();
    const botHits = this.botHits;
    const days = this.dayMin && this.dayMax ? Math.round((Date.parse(this.dayMax) - Date.parse(this.dayMin)) / 86400000) + 1 : 0;
    const bots = [...this.bots.values()]
      .sort((a, b) => b.hits - a.hits)
      .map((b) => ({
        id: b.id,
        name: b.name,
        group: b.group,
        hits: b.hits,
        share: botHits ? Math.round((b.hits / botHits) * 1000) / 10 : 0,
        bytes: b.bytes,
        urls: b.urls instanceof Set ? b.urls.size : b.urls,
        first: iso(b.first),
        last: iso(b.last),
        ips: b.ips.size,
        ...b.st,
        codes: [...b.codes.entries()].sort((x, y) => y[1] - x[1]).slice(0, 8).map(([code, hits]) => ({ code, hits })),
        topIps: [...b.ips.entries()].sort((x, y) => y[1] - x[1]).slice(0, 5).map(([ip, hits]) => ({ ip, hits })),
        types: Object.fromEntries(b.types),
        verification: verification[b.id] ?? { status: "unverified" as const, checked: 0, verified: 0 },
      }));
    const groups = new Map<BotGroup, number>();
    for (const b of bots) groups.set(b.group, (groups.get(b.group) ?? 0) + b.hits);
    // Daily series: every date in the period, one key per bot + human.
    const daily: Record<string, number | string>[] = [];
    if (this.dayMin) {
      for (let t = Date.parse(this.dayMin); t <= Date.parse(this.dayMax) && daily.length < 800; t += 86400000) {
        const d = new Date(t).toISOString().slice(0, 10);
        const m = this.daily.get(d);
        const row: Record<string, number | string> = { date: d, human: m?.get("human") ?? 0, _s3: m?.get("_s3") ?? 0, _s4: m?.get("_s4") ?? 0, _s5: m?.get("_s5") ?? 0 };
        for (const b of bots) row[b.id] = m?.get(b.id) ?? 0;
        daily.push(row);
      }
    }
    const allPages = [...this.pages.values()].filter((p) => p.hits > 0);
    const pages = allPages
      .sort((a, b) => b.hits - a.hits)
      .slice(0, 1500)
      .map((p) => {
        const google = sumPrefix(p.bots, "google") - (p.bots.get("google-extended") ?? 0);
        const bing = p.bots.get("bingbot") ?? 0;
        const ai = p.group.get("ai") ?? 0;
        const top = [...p.bots.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "";
        return { path: p.path, hits: p.hits, google, bing, ai, other: p.hits - google - bing - ai, topBot: top, last: iso(p.last), lastStatus: p.lastStatus, ...p.st, days: p.days.size, type: fileType(p.path) };
      });
    const errors = allPages
      .filter((p) => p.st.s4 + p.st.s5 > 0)
      .sort((a, b) => b.st.s4 + b.st.s5 - (a.st.s4 + a.st.s5))
      .slice(0, 500)
      .map((p) => ({ path: p.path, status: p.lastStatus >= 400 ? p.lastStatus : p.st.s5 ? 500 : 404, hits: p.st.s4 + p.st.s5, last: iso(p.last), bots: [...p.bots.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([id]) => id) }));
    let redirects = 0,
      clientErrors = 0,
      serverErrors = 0,
      paramHits = 0;
    for (const p of allPages) {
      redirects += p.redirects;
      clientErrors += p.st.s4;
      serverErrors += p.st.s5;
      if (p.path.includes("?") && p.st.s2) paramHits += p.st.s2;
    }
    const wasteTotal = redirects + clientErrors + serverErrors + paramHits;
    const aiPages = allPages.filter((p) => (p.group.get("ai") ?? 0) > 0);
    return {
      version: 1,
      format: this.combined === this.parsed ? "combined" : this.combined === 0 ? "common" : "mixed",
      totals: { lines: this.lines, parsed: this.parsed, skipped: this.lines - this.parsed, hits: this.parsed, botHits, humanHits: this.humanHits, bytes: this.bytes, uniqueUrls: this.pages.size, uniqueBotUrls: allPages.length, truncatedUrls: this.truncated },
      period: { from: this.dayMin || null, to: this.dayMax || null, days },
      bots,
      groups: [...groups.entries()].sort((a, b) => b[1] - a[1]).map(([group, hits]) => ({ group, hits })),
      daily,
      fileTypes: [...this.types.entries()].sort((a, b) => b[1].hits - a[1].hits).map(([type, v]) => ({ type, hits: v.hits, pages: v.urls.size })),
      statusCodes: [...this.status.entries()].sort((a, b) => b[1] - a[1]).map(([code, hits]) => ({ code, hits })),
      pages,
      errors,
      waste: {
        redirects,
        clientErrors,
        serverErrors,
        params: paramHits,
        total: wasteTotal,
        share: botHits ? Math.round((wasteTotal / botHits) * 1000) / 10 : 0,
        paramNames: [...this.params.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([name, hits]) => ({ name, hits })),
        paramUrls: allPages.filter((p) => p.path.includes("?")).sort((a, b) => b.hits - a.hits).slice(0, 100).map((p) => ({ path: p.path, hits: p.hits })),
      },
      ai: {
        hits: groups.get("ai") ?? 0,
        pages: aiPages.length,
        topPages: aiPages
          .sort((a, b) => (b.group.get("ai") ?? 0) - (a.group.get("ai") ?? 0))
          .slice(0, 50)
          .map((p) => ({ path: p.path, hits: p.group.get("ai") ?? 0, bots: [...p.bots.keys()].filter((id) => ALL_BOTS.find((x) => x.id === id)?.group === "ai") })),
      },
      robots: [...this.robots.entries()].sort((a, b) => b[1] - a[1]).map(([botId, hits]) => ({ botId, hits })),
      sitemaps: [...this.sitemaps.entries()].sort((a, b) => b[1] - a[1]).map(([botId, hits]) => ({ botId, hits })),
    };
  }
}

function sumPrefix(m: Map<string, number>, prefix: string) {
  let n = 0;
  for (const [k, v] of m) if (k.startsWith(prefix)) n += v;
  return n;
}
function decodeSafe(s: string) {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}
