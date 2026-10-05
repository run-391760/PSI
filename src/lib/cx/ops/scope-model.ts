/**
 * Topic / Profile scope (Konnect "Select Cluster / Select Topic / Select Profile"): pure, client-safe.
 *
 * A scope is what the user ticked in the <ScopePicker>:
 *   { clusters: string[]; topics: string[]; profiles: string[] }
 * - clusters = profile groups (cx_ops_profile_groups.id)
 * - topics   = listening topics (cx_topics.id)
 * - profiles = connected channels (cx_channels.id) and listening sources ("src_<kind>", e.g. "src_news")
 *
 * An empty scope means "everything" (no filter). Otherwise the selection is the UNION of the ticked
 * clusters (expanded into their channels, sources and topics), topics and profiles.
 *
 * URL form (`?scope=`): sections joined by "*", each "<letter>.<id>.<id>…" with c = clusters,
 * t = topics, p = profiles, e.g. `c.8f2e…*p.4b1a….src_news` (only characters URLSearchParams leaves
 * unescaped). Ids are percent-encoded when they contain "." or "*". The parameter is omitted for an empty scope. Server code turns a scope into SQL with
 * `resolveScope()` (scope.ts) + `ticketScopeSql` / `messageScopeSql` / `mentionScopeSql` below.
 */

export type ScopeValue = { clusters: string[]; topics: string[]; profiles: string[] };
export type ScopeSection = keyof ScopeValue;

export type ClusterOption = { id: string; name: string; channelIds: string[]; sources: string[]; topicIds: string[]; isDefault: boolean };
export type TopicOption = { id: string; name: string; kind: string; active: boolean };
/** `network` is the channel / source kind (instagram, facebook, email, news…) used for the icon. */
export type ProfileOption = { id: string; name: string; network: string; type: "channel" | "source"; status?: string };
export type ScopeOptions = { clusters: ClusterOption[]; topics: TopicOption[]; profiles: ProfileOption[] };

/** What a scope selects, flattened. `all` = no filter (empty scope). */
export type ResolvedScope = { all: boolean; channelIds: string[]; topicIds: string[]; sourceKinds: string[] };

export const EMPTY_SCOPE: ScopeValue = { clusters: [], topics: [], profiles: [] };
export const SOURCE_PREFIX = "src_";
export const sourceProfileId = (kind: string) => `${SOURCE_PREFIX}${kind}`;
export const sourceOfProfile = (id: string) => (id.startsWith(SOURCE_PREFIX) ? id.slice(SOURCE_PREFIX.length) : null);

const uniq = (xs: string[]) => [...new Set(xs.filter(Boolean))];
const MAX_IDS = 500;
const MAX_ID = 120;

export function normalizeScope(v: Partial<ScopeValue> | null | undefined): ScopeValue {
  const list = (x: unknown) => (Array.isArray(x) ? uniq(x.filter((s): s is string => typeof s === "string" && s.length > 0 && s.length <= MAX_ID)).slice(0, MAX_IDS) : []);
  return { clusters: list(v?.clusters), topics: list(v?.topics), profiles: list(v?.profiles) };
}

export const isEmptyScope = (v: ScopeValue) => !v.clusters.length && !v.topics.length && !v.profiles.length;
export const scopeCount = (v: ScopeValue) => v.clusters.length + v.topics.length + v.profiles.length;
export const sameScope = (a: ScopeValue, b: ScopeValue) => encodeScope(a) === encodeScope(b);

const LETTER: Record<ScopeSection, string> = { clusters: "c", topics: "t", profiles: "p" };
const SECTION: Record<string, ScopeSection> = { c: "clusters", t: "topics", p: "profiles" };
const encId = (id: string) => encodeURIComponent(id).replace(/\./g, "%2E").replace(/\*/g, "%2A");
const decId = (s: string) => {
  try {
    return decodeURIComponent(s);
  } catch {
    return "";
  }
};

/** Compact URL value; "" for an empty scope. Ids are sorted so equal scopes encode identically. */
export function encodeScope(v: ScopeValue): string {
  const n = normalizeScope(v);
  return (Object.keys(LETTER) as ScopeSection[])
    .filter((k) => n[k].length)
    .map((k) => [LETTER[k], ...[...n[k]].sort().map(encId)].join("."))
    .join("*");
}

/** Parse `?scope=`; tolerant of junk (unknown sections and empty ids are dropped). */
export function decodeScope(raw: string | string[] | null | undefined): ScopeValue {
  const s = Array.isArray(raw) ? raw[0] : raw;
  const out: ScopeValue = { clusters: [], topics: [], profiles: [] };
  if (!s) return out;
  for (const part of s.split("*")) {
    const [letter, ...ids] = part.split(".");
    const key = SECTION[letter];
    if (!key) continue;
    out[key].push(...ids.map(decId));
  }
  return normalizeScope(out);
}

/** Read the scope from page searchParams (server) or URLSearchParams (client). */
export function scopeFromParams(sp: URLSearchParams | Record<string, string | string[] | undefined>, param = "scope"): ScopeValue {
  return decodeScope(sp instanceof URLSearchParams ? sp.get(param) : sp[param]);
}

/** Copy of `params` with the scope set (or removed when empty). */
export function withScopeParam(params: URLSearchParams | string, v: ScopeValue, param = "scope"): URLSearchParams {
  const next = new URLSearchParams(typeof params === "string" ? params : params.toString());
  const enc = encodeScope(v);
  if (enc) next.set(param, enc);
  else next.delete(param);
  return next;
}

/** Drop ids that no longer exist (deleted channels, topics, clusters). */
export function pruneScope(v: ScopeValue, o: ScopeOptions): ScopeValue {
  const has = (list: { id: string }[]) => {
    const ids = new Set(list.map((x) => x.id));
    return (id: string) => ids.has(id);
  };
  return { clusters: v.clusters.filter(has(o.clusters)), topics: v.topics.filter(has(o.topics)), profiles: v.profiles.filter(has(o.profiles)) };
}

/** Expand clusters and split profiles into channel ids / source kinds. Unknown ids are ignored. */
export function resolveScopeWith(v: ScopeValue, o: ScopeOptions): ResolvedScope {
  const n = normalizeScope(v);
  if (isEmptyScope(n)) return { all: true, channelIds: [], topicIds: [], sourceKinds: [] };
  const channelIds: string[] = [];
  const topicIds: string[] = [];
  const sourceKinds: string[] = [];
  const clusters = new Map(o.clusters.map((c) => [c.id, c]));
  const channels = new Set(o.profiles.filter((p) => p.type === "channel").map((p) => p.id));
  const topics = new Set(o.topics.map((t) => t.id));
  for (const id of n.clusters) {
    const c = clusters.get(id);
    if (!c) continue;
    channelIds.push(...c.channelIds);
    sourceKinds.push(...c.sources);
    topicIds.push(...c.topicIds);
  }
  for (const id of n.topics) if (topics.has(id)) topicIds.push(id);
  for (const id of n.profiles) {
    const src = sourceOfProfile(id);
    if (src) sourceKinds.push(src);
    else if (channels.has(id)) channelIds.push(id);
  }
  return { all: false, channelIds: uniq(channelIds), topicIds: uniq(topicIds), sourceKinds: uniq(sourceKinds) };
}

/** Selected names in option order, for the trigger ("PU Overall, PU Goa, …"). */
export function scopeNames(v: ScopeValue, o: ScopeOptions): string[] {
  const pick = <T extends { id: string; name: string }>(list: T[], ids: string[]) => {
    const set = new Set(ids);
    return list.filter((x) => set.has(x.id)).map((x) => x.name);
  };
  return [...pick(o.clusters, v.clusters), ...pick(o.topics, v.topics), ...pick(o.profiles, v.profiles)];
}

/** Case-insensitive search over a section's options. */
export function filterOptions<T extends { name: string; network?: string }>(list: T[], q: string): T[] {
  const needle = q.trim().toLowerCase();
  if (!needle) return list;
  return list.filter((x) => `${x.name} ${x.network ?? ""}`.toLowerCase().includes(needle));
}

// ------------------------------------------------------------------ SQL

/** Placeholder binder: `p(value)` pushes onto `params` and returns "$n". */
export type Bind = (v: unknown) => string;
export function binder(params: unknown[]): Bind {
  return (v) => {
    params.push(v);
    return `$${params.length}`;
  };
}

/**
 * SQL condition limiting cx_tickets (alias `t`) to a scope: tickets on the selected channels, tickets
 * created from the selected listening sources (no channel), and tickets created from mentions of the
 * selected topics. "true" for an empty scope, "false" when the scope selects nothing that exists.
 */
export function ticketScopeSql(r: ResolvedScope, p: Bind, t = "t"): string {
  if (r.all) return "true";
  const parts: string[] = [];
  if (r.channelIds.length) parts.push(`${t}.channel_id = ANY(${p(r.channelIds)}::text[])`);
  if (r.sourceKinds.length) parts.push(`(${t}.channel_id IS NULL AND ${t}.channel_kind = ANY(${p(r.sourceKinds)}::text[]))`);
  if (r.topicIds.length) parts.push(`EXISTS (SELECT 1 FROM cx_mentions sm WHERE sm.ticket_id = ${t}.id AND sm.topic_id = ANY(${p(r.topicIds)}::text[]))`);
  return parts.length ? `(${parts.join(" OR ")})` : "false";
}

/** SQL condition limiting cx_messages (alias `m`) to messages of in-scope tickets. */
export function messageScopeSql(r: ResolvedScope, p: Bind, m = "m"): string {
  if (r.all) return "true";
  const cond = ticketScopeSql(r, p, "st");
  return cond === "false" ? "false" : `${m}.ticket_id IN (SELECT st.id FROM cx_tickets st WHERE ${cond})`;
}

/**
 * SQL condition limiting cx_mentions (alias `mn`) to a scope: mentions of the selected topics or from
 * the selected sources, plus mentions already turned into tickets on the selected channels.
 */
export function mentionScopeSql(r: ResolvedScope, p: Bind, mn = "mn"): string {
  if (r.all) return "true";
  const parts: string[] = [];
  if (r.topicIds.length) parts.push(`${mn}.topic_id = ANY(${p(r.topicIds)}::text[])`);
  if (r.sourceKinds.length) parts.push(`${mn}.source = ANY(${p(r.sourceKinds)}::text[])`);
  if (r.channelIds.length) parts.push(`${mn}.ticket_id IN (SELECT ct.id FROM cx_tickets ct WHERE ct.channel_id = ANY(${p(r.channelIds)}::text[]))`);
  return parts.length ? `(${parts.join(" OR ")})` : "false";
}
