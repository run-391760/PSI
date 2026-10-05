/**
 * Pure helpers of the CX settings package (WP-K3): profile networks and colors, clusters, IP allowlists
 * (CIDR), user groups and public social profiles. Client-safe, no server imports; fixture-tested in tests/cx-k3.test.ts.
 */

// ---------------------------------------------------------------- colors

/** Default profile/cluster colors (picked in order; users can change them). */
export const PROFILE_COLORS = ["#e5484d", "#d6409f", "#8e4ec6", "#6e56cf", "#3e63dd", "#0091ff", "#12a594", "#30a46c", "#f5a524", "#f76b15", "#a18072", "#687076"] as const;
export const isHexColor = (v: unknown): v is string => typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v);
export const defaultColor = (i: number) => PROFILE_COLORS[((i % PROFILE_COLORS.length) + PROFILE_COLORS.length) % PROFILE_COLORS.length];
/** A stable default color for an id (so a profile keeps its color until someone picks one). */
export function colorFor(id: string) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return defaultColor(Math.abs(h));
}

// ---------------------------------------------------------------- omni-channel networks

/**
 * Networks on Omni-Channel Setup, in display order. `connect` says how a profile is added:
 *   inbox     – connect dialog in Settings (email, chat, form, WhatsApp, Meta, LinkedIn)
 *   connector – free bot/API connector (Discord, Discourse, Telegram)
 *   api       – needs a platform API that isn't connected yet (shown with what it needs)
 */
export type NetworkDef = { kind: string; name: string; connect: "inbox" | "connector" | "api"; group: "social" | "messaging" | "owned" | "community" };
export const PROFILE_NETWORKS: NetworkDef[] = [
  { kind: "x", name: "X (Twitter)", connect: "api", group: "social" },
  { kind: "facebook", name: "Facebook", connect: "inbox", group: "social" },
  { kind: "youtube", name: "YouTube", connect: "api", group: "social" },
  { kind: "instagram", name: "Instagram", connect: "inbox", group: "social" },
  { kind: "linkedin", name: "LinkedIn", connect: "inbox", group: "social" },
  { kind: "gbp", name: "Google Business", connect: "api", group: "social" },
  { kind: "whatsapp", name: "WhatsApp", connect: "inbox", group: "messaging" },
  { kind: "email", name: "Email", connect: "inbox", group: "owned" },
  { kind: "livechat", name: "Live chat", connect: "inbox", group: "owned" },
  { kind: "webform", name: "Web form", connect: "inbox", group: "owned" },
  { kind: "telegram", name: "Telegram", connect: "connector", group: "messaging" },
  { kind: "discord", name: "Discord", connect: "connector", group: "community" },
  { kind: "discourse", name: "Discourse", connect: "connector", group: "community" },
];
export const networkName = (kind: string) => PROFILE_NETWORKS.find((n) => n.kind === kind)?.name ?? kind;

/** Group profiles into network sections in display order (unknown kinds last, alphabetically). */
export function profileSections<T extends { kind: string }>(profiles: T[]): { kind: string; name: string; items: T[] }[] {
  const order = (k: string) => {
    const i = PROFILE_NETWORKS.findIndex((n) => n.kind === k);
    return i < 0 ? 1000 : i;
  };
  const kinds = [...new Set(profiles.map((p) => p.kind))].sort((a, b) => order(a) - order(b) || a.localeCompare(b));
  return kinds.map((k) => ({ kind: k, name: networkName(k), items: profiles.filter((p) => p.kind === k) }));
}

/** "Active", "Paused" or "Error" plus a tone for a profile card. */
export function profileState(p: { status: string; last_error?: string | null }): { label: "Active" | "Paused" | "Error"; tone: "good" | "neutral" | "critical" } {
  if (p.status === "error" || (p.status !== "paused" && p.last_error)) return { label: "Error", tone: "critical" };
  if (p.status === "paused") return { label: "Paused", tone: "neutral" };
  return { label: "Active", tone: "good" };
}

/** The handle/id line under a profile's name. */
export function profileHandle(kind: string, config: Record<string, unknown>): string {
  const s = (v: unknown) => (typeof v === "string" ? v : typeof v === "number" ? String(v) : "");
  if (kind === "email") return s(config.fromAddress) || s(config.user);
  if (kind === "discord") return config.channelName ? `#${s(config.channelName)}` : s(config.channelId);
  if (kind === "discourse") return s(config.base).replace(/^https?:\/\//, "");
  if (kind === "telegram") return config.bot ? `@${s(config.bot)}` : "";
  if (kind === "livechat") return "Website chat widget";
  if (kind === "webform") return s(config.title) || "Hosted contact form";
  return s(config.label) || s(config.accountId);
}

// ---------------------------------------------------------------- clusters

export type ClusterInput = { name: string; description?: string; channelIds: string[]; topicIds: string[]; sources?: string[]; isDefault?: boolean; color?: string };
export type CleanCluster = { name: string; description: string; channelIds: string[]; topicIds: string[]; sources: string[]; isDefault: boolean; color: string };

/** Validate a cluster: a name and at least one profile, topic or listening source, all known to the brand. */
export function cleanCluster(input: ClusterInput, known: { channelIds: string[]; topicIds: string[]; sources: readonly string[] }): { ok: true; value: CleanCluster } | { ok: false; error: string } {
  const name = String(input.name ?? "").trim().replace(/\s+/g, " ").slice(0, 60);
  if (!name) return { ok: false, error: "Name the cluster." };
  const channelIds = [...new Set(input.channelIds ?? [])].filter((id) => known.channelIds.includes(id));
  const topicIds = [...new Set(input.topicIds ?? [])].filter((id) => known.topicIds.includes(id));
  const sources = [...new Set(input.sources ?? [])].filter((s) => known.sources.includes(s));
  if (!channelIds.length && !topicIds.length && !sources.length) return { ok: false, error: "Select at least one profile or topic." };
  const color = input.color && isHexColor(input.color) ? input.color.toLowerCase() : "";
  if (input.color && !color) return { ok: false, error: "Color must be a hex value like #3e63dd." };
  return { ok: true, value: { name, description: String(input.description ?? "").trim().slice(0, 300), channelIds, topicIds, sources, isDefault: !!input.isDefault, color } };
}

const CHIP_NAMES: Record<string, string> = { x: "Twitter", gbp: "Google Business Location", youtube: "Youtube", livechat: "Live chat", webform: "Web form" };
/** Per-network count chips for the clusters table: "3 Facebook", "2 Topic", "1 Twitter"… sorted by label. */
export function clusterChips(channelKinds: string[], topicCount: number, sourceCount = 0): { label: string; kind: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const k of channelKinds) counts.set(k, (counts.get(k) ?? 0) + 1);
  const chips = [...counts].map(([kind, count]) => ({ kind, count, label: `${count} ${CHIP_NAMES[kind] ?? networkName(kind)}` }));
  if (topicCount) chips.push({ kind: "topic", count: topicCount, label: `${topicCount} Topic` });
  if (sourceCount) chips.push({ kind: "source", count: sourceCount, label: `${sourceCount} Listening source${sourceCount === 1 ? "" : "s"}` });
  return chips.sort((a, b) => a.label.replace(/^\d+ /, "").localeCompare(b.label.replace(/^\d+ /, "")));
}

/** Filter "Selected" / "Other" lists in the Edit Cluster dialog by a search string (name or network). */
export function splitPicker<T extends { id: string; name: string; network: string }>(all: T[], selected: string[], q: string) {
  const s = q.trim().toLowerCase();
  const hit = (x: T) => !s || x.name.toLowerCase().includes(s) || x.network.toLowerCase().includes(s);
  const set = new Set(selected);
  return { selected: all.filter((x) => set.has(x.id) && hit(x)), other: all.filter((x) => !set.has(x.id) && hit(x)) };
}

// ---------------------------------------------------------------- IP allowlist (CIDR)

type Addr = { v: 4 | 6; bytes: number[] };

/** Normalize a client address: strips brackets, ports and the IPv4-mapped IPv6 prefix. */
export function normalizeIp(raw: string | null | undefined): string {
  let s = String(raw ?? "").trim();
  if (!s) return "";
  if (s.startsWith("[")) s = s.slice(1, s.indexOf("]") > 0 ? s.indexOf("]") : undefined);
  else if (/^\d+\.\d+\.\d+\.\d+:\d+$/.test(s)) s = s.split(":")[0];
  s = s.toLowerCase().replace(/%.*$/, "");
  const mapped = s.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  return mapped ? mapped[1] : s;
}

function parseV4(s: string): number[] | null {
  const p = s.split(".");
  if (p.length !== 4) return null;
  const b = p.map((x) => (/^\d{1,3}$/.test(x) ? Number(x) : NaN));
  return b.every((n) => n >= 0 && n <= 255) ? b : null;
}

function parseV6(s: string): number[] | null {
  if (!/^[0-9a-f:.]+$/.test(s) || (s.match(/::/g) ?? []).length > 1) return null;
  let str = s;
  const v4 = s.match(/(\d+\.\d+\.\d+\.\d+)$/);
  if (v4) {
    const b = parseV4(v4[1]);
    if (!b) return null;
    str = `${s.slice(0, -v4[1].length)}${((b[0] << 8) | b[1]).toString(16)}:${((b[2] << 8) | b[3]).toString(16)}`;
  }
  const double = str.includes("::");
  const [head, rest = ""] = double ? str.split("::") : [str];
  const hs = head ? head.split(":") : [];
  const rs = rest ? rest.split(":") : [];
  if ([...hs, ...rs].some((g) => !/^[0-9a-f]{1,4}$/.test(g))) return null;
  const fill = 8 - hs.length - rs.length;
  if (double ? fill < 1 : fill !== 0) return null;
  const words = [...hs, ...Array(double ? fill : 0).fill("0"), ...rs].map((g) => parseInt(g, 16));
  return words.flatMap((w) => [w >> 8, w & 255]);
}

export function parseIp(raw: string): Addr | null {
  const s = normalizeIp(raw);
  if (!s) return null;
  const v4 = parseV4(s);
  if (v4) return { v: 4, bytes: v4 };
  const v6 = s.includes(":") ? parseV6(s) : null;
  return v6 ? { v: 6, bytes: v6 } : null;
}

export type Cidr = { v: 4 | 6; bytes: number[]; prefix: number; text: string };

/** "203.0.113.0/24", "2001:db8::/32" or a single address (treated as /32 or /128). Host bits are cleared. */
export function parseCidr(raw: string): Cidr | null {
  const s = String(raw ?? "").trim();
  if (!s) return null;
  const [addr, pre, extra] = s.split("/");
  if (extra !== undefined) return null;
  const ip = parseIp(addr);
  if (!ip) return null;
  const max = ip.v === 4 ? 32 : 128;
  const prefix = pre === undefined ? max : /^\d{1,3}$/.test(pre) ? Number(pre) : NaN;
  if (!(prefix >= 0 && prefix <= max)) return null;
  const bytes = ip.bytes.map((b, i) => {
    const bits = Math.max(0, Math.min(8, prefix - i * 8));
    return bits === 8 ? b : b & ((0xff << (8 - bits)) & 0xff);
  });
  const text = ip.v === 4 ? `${bytes.join(".")}/${prefix}` : `${v6Text(bytes)}/${prefix}`;
  return { v: ip.v, bytes, prefix, text };
}

function v6Text(bytes: number[]) {
  const words = Array.from({ length: 8 }, (_, i) => (bytes[i * 2] << 8) | bytes[i * 2 + 1]);
  // Compress the longest run of zero words.
  let best = -1, bestLen = 0;
  for (let i = 0; i < 8; ) {
    if (words[i] !== 0) { i++; continue; }
    let j = i;
    while (j < 8 && words[j] === 0) j++;
    if (j - i > bestLen && j - i > 1) { best = i; bestLen = j - i; }
    i = j;
  }
  const hex = words.map((w) => w.toString(16));
  if (best < 0) return hex.join(":");
  return `${hex.slice(0, best).join(":")}::${hex.slice(best + bestLen).join(":")}`;
}

export function ipInCidr(ip: string, cidr: string | Cidr): boolean {
  const a = parseIp(ip);
  const c = typeof cidr === "string" ? parseCidr(cidr) : cidr;
  if (!a || !c || a.v !== c.v) return false;
  for (let i = 0; i < a.bytes.length; i++) {
    const bits = Math.max(0, Math.min(8, c.prefix - i * 8));
    if (bits === 0) return true;
    const mask = (0xff << (8 - bits)) & 0xff;
    if ((a.bytes[i] & mask) !== c.bytes[i]) return false;
  }
  return true;
}

export const ipAllowed = (ip: string, cidrs: string[]) => cidrs.some((c) => ipInCidr(ip, c));

/**
 * Validate an allowlist before saving. When it is enabled it must contain the admin's current IP
 * (otherwise saving would lock them out), and it can't be empty.
 */
export function validateAllowlist(lines: string[], enabled: boolean, currentIp: string): { ok: true; cidrs: string[] } | { ok: false; error: string } {
  const cidrs: string[] = [];
  for (const raw of lines.map((l) => l.replace(/#.*$/, "").trim()).filter(Boolean)) {
    const c = parseCidr(raw);
    if (!c) return { ok: false, error: `"${raw}" is not an IP address or CIDR range.` };
    if (c.prefix === 0) return { ok: false, error: `"${raw}" allows every address; turn the allowlist off instead.` };
    if (!cidrs.includes(c.text)) cidrs.push(c.text);
  }
  if (cidrs.length > 200) return { ok: false, error: "Up to 200 entries." };
  if (enabled) {
    if (!cidrs.length) return { ok: false, error: "Add at least one address or range before turning the allowlist on." };
    if (!currentIp || !parseIp(currentIp)) return { ok: false, error: "Your current IP address can't be determined, so the allowlist can't be turned on safely." };
    if (!ipAllowed(currentIp, cidrs)) return { ok: false, error: `Your current IP (${normalizeIp(currentIp)}) is not in the list. Add it first so you don't lock yourself out.` };
  }
  return { ok: true, cidrs };
}

/** The client IP from proxy headers: the right-most X-Forwarded-For entry (added by the nearest proxy), else X-Real-IP. */
export function clientIpFrom(get: (name: string) => string | null): string {
  const xff = get("x-forwarded-for");
  if (xff) {
    const parts = xff.split(",").map((p) => p.trim()).filter(Boolean);
    if (parts.length) return normalizeIp(parts[parts.length - 1]);
  }
  return normalizeIp(get("x-real-ip") ?? "");
}

// ---------------------------------------------------------------- user groups

export type UserGroupInput = { name: string; description?: string; memberIds: string[] };
export function cleanUserGroup(input: UserGroupInput, knownUserIds: string[]): { ok: true; value: Required<UserGroupInput> } | { ok: false; error: string } {
  const name = String(input.name ?? "").trim().replace(/\s+/g, " ").slice(0, 60);
  if (!name) return { ok: false, error: "Name the user group." };
  const memberIds = [...new Set(input.memberIds ?? [])].filter((id) => knownUserIds.includes(id));
  if (!memberIds.length) return { ok: false, error: "Add at least one member of this brand." };
  return { ok: true, value: { name, description: String(input.description ?? "").trim().slice(0, 300), memberIds } };
}

// ---------------------------------------------------------------- public social profiles (no login)

export type SocialNetwork = { id: string; name: string; access: "free" | "keyed" | "api"; source: string | null; placeholder: string; note: string };
/** Networks for More Social Profiles and whether a public profile can be read without login. */
export const SOCIAL_NETWORKS: SocialNetwork[] = [
  { id: "bluesky", name: "Bluesky", access: "free", source: "bluesky", placeholder: "brand.bsky.social", note: "Free: public Bluesky AppView author feed." },
  { id: "mastodon", name: "Mastodon", access: "free", source: "mastodon", placeholder: "@brand@mastodon.social", note: "Free: the instance's public account timeline." },
  { id: "youtube", name: "YouTube", access: "free", source: "youtube", placeholder: "UC… channel id or @handle", note: "Free: channel RSS feed. @handles need YOUTUBE_API_KEY to resolve to a channel id." },
  { id: "hackernews", name: "Hacker News", access: "free", source: "hackernews", placeholder: "username", note: "Free: HN Algolia search by author." },
  { id: "reddit", name: "Reddit", access: "keyed", source: "reddit", placeholder: "u/name or r/subreddit", note: "Needs REDDIT_CLIENT_ID and REDDIT_CLIENT_SECRET (free script app)." },
  { id: "x", name: "X (Twitter)", access: "api", source: null, placeholder: "@handle", note: "Needs a paid X API tier (Basic or higher)." },
  { id: "facebook", name: "Facebook", access: "api", source: null, placeholder: "page name or URL", note: "Public Page content needs a Meta app with Page Public Content Access (App Review)." },
  { id: "instagram", name: "Instagram", access: "api", source: null, placeholder: "@handle", note: "Other accounts' posts need Instagram Business Discovery via a reviewed Meta app." },
  { id: "linkedin", name: "LinkedIn", access: "api", source: null, placeholder: "company/name", note: "LinkedIn has no public API for other companies' posts (partner programs only)." },
  { id: "tiktok", name: "TikTok", access: "api", source: null, placeholder: "@handle", note: "Needs TikTok Research API approval." },
  { id: "threads", name: "Threads", access: "api", source: null, placeholder: "@handle", note: "Needs a Meta app with Threads keyword/profile access." },
];
export const socialNetwork = (id: string) => SOCIAL_NETWORKS.find((n) => n.id === id);
export const SOCIAL_RELATIONS = [
  { id: "competitor", label: "Competitor" },
  { id: "partner", label: "Partner" },
  { id: "own", label: "Our other profile" },
  { id: "influencer", label: "Influencer" },
  { id: "other", label: "Other" },
] as const;

/**
 * Turn what the user typed (a handle or a profile URL) into a canonical handle and public URL.
 * Mastodon: @user@instance; Bluesky: domain handle; YouTube: UC… id or @handle; Reddit: u/x or r/x.
 */
export function parseSocialHandle(network: string, raw: string): { ok: true; handle: string; url: string } | { ok: false; error: string } {
  let s = String(raw ?? "").trim();
  if (!s) return { ok: false, error: "Enter a handle or profile URL." };
  if (s.length > 200) return { ok: false, error: "That handle is too long." };
  let u: URL | null = null;
  if (/^https?:\/\//i.test(s)) {
    try { u = new URL(s); } catch { return { ok: false, error: "That URL isn't valid." }; }
  }
  const path = u ? u.pathname.replace(/\/+$/, "").split("/").filter(Boolean) : [];
  const word = (x: string) => /^[\w.-]{1,100}$/.test(x);
  switch (network) {
    case "mastodon": {
      if (u) {
        const user = path[0]?.replace(/^@/, "");
        if (!user || !word(user)) return { ok: false, error: "Use a profile URL like https://mastodon.social/@brand." };
        s = `@${user}@${u.hostname}`;
      }
      const m = s.replace(/^@/, "").match(/^([\w.-]+)@([a-z0-9.-]+\.[a-z]{2,})$/i);
      if (!m) return { ok: false, error: "Use the form @user@instance.social." };
      return { ok: true, handle: `@${m[1]}@${m[2].toLowerCase()}`, url: `https://${m[2].toLowerCase()}/@${m[1]}` };
    }
    case "bluesky": {
      if (u) s = path[0] === "profile" && path[1] ? path[1] : "";
      s = s.replace(/^@/, "").toLowerCase();
      if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(s) && !/^did:plc:[a-z0-9]+$/.test(s)) return { ok: false, error: "Use a handle like brand.bsky.social." };
      return { ok: true, handle: s, url: `https://bsky.app/profile/${s}` };
    }
    case "youtube": {
      if (u) s = path[0] === "channel" && path[1] ? path[1] : path[0]?.startsWith("@") ? path[0] : "";
      if (/^UC[\w-]{22}$/.test(s)) return { ok: true, handle: s, url: `https://www.youtube.com/channel/${s}` };
      const h = s.replace(/^@/, "");
      if (!word(h)) return { ok: false, error: "Use a channel id (UC…) or @handle." };
      return { ok: true, handle: `@${h}`, url: `https://www.youtube.com/@${h}` };
    }
    case "hackernews": {
      if (u) s = u.searchParams.get("id") ?? "";
      if (!/^[\w-]{2,15}$/.test(s)) return { ok: false, error: "Use a Hacker News username." };
      return { ok: true, handle: s, url: `https://news.ycombinator.com/user?id=${s}` };
    }
    case "reddit": {
      if (u) s = path[0] === "user" || path[0] === "u" ? `u/${path[1] ?? ""}` : path[0] === "r" ? `r/${path[1] ?? ""}` : "";
      const m = s.match(/^\/?(u|r|user)\/([\w-]{2,30})$/i);
      if (!m) return { ok: false, error: "Use u/name or r/subreddit." };
      const kind = m[1].toLowerCase() === "r" ? "r" : "u";
      return { ok: true, handle: `${kind}/${m[2]}`, url: `https://www.reddit.com/${kind === "r" ? "r" : "user"}/${m[2]}` };
    }
    default: {
      const host: Record<string, string> = { x: "x.com", facebook: "www.facebook.com", instagram: "www.instagram.com", linkedin: "www.linkedin.com", tiktok: "www.tiktok.com", threads: "www.threads.net" };
      if (!host[network]) return { ok: false, error: "Unknown network." };
      if (u) s = network === "linkedin" && path.length >= 2 ? `${path[0]}/${path[1]}` : path[0] ?? "";
      const h = s.replace(/^@/, "");
      if (!(network === "linkedin" ? /^[\w-]+(\/[\w.%-]+)?$/.test(h) : word(h))) return { ok: false, error: "That doesn't look like a handle." };
      const at = ["x", "instagram", "tiktok", "threads"].includes(network) ? "@" : "";
      return { ok: true, handle: `${at}${h}`, url: `https://${host[network]}/${network === "tiktok" || network === "threads" ? "@" : ""}${h}` };
    }
  }
}

/** Whether a tracked profile can be fetched now (free source, or keyed source with keys set). */
export function profileFetchable(network: string, keys: { reddit: boolean; youtubeKey: boolean }, handle: string): { ok: boolean; reason: string | null } {
  const n = socialNetwork(network);
  if (!n) return { ok: false, reason: "Unknown network." };
  if (n.access === "api") return { ok: false, reason: n.note };
  if (network === "reddit" && !keys.reddit) return { ok: false, reason: n.note };
  if (network === "youtube" && !/^UC[\w-]{22}$/.test(handle) && !keys.youtubeKey) return { ok: false, reason: "Enter the channel id (UC…) or set YOUTUBE_API_KEY to resolve the @handle." };
  return { ok: true, reason: null };
}
