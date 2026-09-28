/** Outbound webhooks and API token logic (pure, fixture-tested). */
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const WEBHOOK_EVENTS = [
  { key: "ticket.created", label: "Ticket created" },
  { key: "ticket.updated", label: "Ticket updated (status, assignee, priority, tags)" },
  { key: "ticket.classified", label: "Ticket classified / fields changed" },
  { key: "message.received", label: "Customer message received" },
  { key: "message.sent", label: "Agent reply sent" },
  { key: "note.added", label: "Internal note added" },
  { key: "sla.warning", label: "SLA pre-breach warning" },
  { key: "sla.breached", label: "SLA breached / escalated" },
  { key: "alert.fired", label: "Alert fired" },
] as const;
export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number]["key"];

/** Retries: 10 attempts after the first try, then the delivery fails and the webhook is deactivated (V1). */
export const MAX_RETRIES = 10;
const BACKOFF_MIN = [1, 2, 5, 10, 20, 30, 60, 120, 240, 480];
/** When to try again after `attempts` failed tries (1-based); null = give up. */
export function nextAttemptAt(attempts: number, now = new Date()) {
  if (attempts > MAX_RETRIES) return null;
  return new Date(now.getTime() + BACKOFF_MIN[Math.min(BACKOFF_MIN.length - 1, Math.max(0, attempts - 1))] * 60_000);
}
export const deliveredOk = (status: number | null) => status != null && status >= 200 && status < 300;

/** Signature header value: sha256=<hex HMAC of "<timestamp>.<body>">. */
export function signPayload(secret: string, timestamp: number, body: string) {
  return `sha256=${createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex")}`;
}
export function verifySignature(secret: string, timestamp: number, body: string, header: string) {
  const a = Buffer.from(signPayload(secret, timestamp, body)), b = Buffer.from(header);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Only public http(s) URLs (no localhost / private ranges) may receive webhooks. */
export function safeWebhookUrl(url: string) {
  let u: URL;
  try { u = new URL(url.trim()); } catch { return null; }
  if (!["https:", "http:"].includes(u.protocol)) return null;
  const h = u.hostname.toLowerCase();
  if (h === "localhost" || h.endsWith(".local") || h.endsWith(".internal") || /^(127\.|10\.|192\.168\.|169\.254\.|0\.|172\.(1[6-9]|2\d|3[01])\.)/.test(h) || h === "[::1]" || /^\[?f[cd]/.test(h)) return null;
  return u.toString();
}

// ---------------------------------------------------------------- API tokens

export const newToken = (kind: "account" | "user") => `${kind === "account" ? "cxa" : "cxu"}_${randomBytes(24).toString("base64url")}`;
export const tokenHash = (t: string) => createHash("sha256").update(t).digest("hex");
export const tokenPrefix = (t: string) => `${t.slice(0, 8)}…${t.slice(-4)}`;

/** Read tokens from headers: Authorization: Bearer <account token>, X-Account-Token, X-User-Token (or query for GET). */
export function readTokens(get: (name: string) => string | null, search?: URLSearchParams) {
  const bearer = get("authorization")?.match(/^Bearer\s+(\S+)$/i)?.[1] ?? null;
  const tokens = [bearer, get("x-account-token"), get("x-user-token"), search?.get("account_token") ?? null, search?.get("user_token") ?? null].filter((t): t is string => !!t);
  return { account: tokens.find((t) => t.startsWith("cxa_")) ?? null, user: tokens.find((t) => t.startsWith("cxu_")) ?? null };
}

export type TokenRecord = { id: string; project_id: string; user_id: string | null; kind: "account" | "user"; revoked: boolean };
/**
 * Authenticate: an account token (brand scope) is always required; a user token (same brand) identifies
 * the acting user and is required for writes.
 */
export function authorize(tokens: { account: string | null; user: string | null }, lookup: (hash: string) => TokenRecord | undefined, write: boolean) {
  if (!tokens.account) return { ok: false as const, status: 401, error: "Missing account token (Authorization: Bearer cxa_…)." };
  const acc = lookup(tokenHash(tokens.account));
  if (!acc || acc.kind !== "account" || acc.revoked) return { ok: false as const, status: 401, error: "Invalid or revoked account token." };
  let user: TokenRecord | undefined;
  if (tokens.user) {
    user = lookup(tokenHash(tokens.user));
    if (!user || user.kind !== "user" || user.revoked || user.project_id !== acc.project_id) return { ok: false as const, status: 401, error: "Invalid or revoked user token for this account." };
  }
  if (write && !user) return { ok: false as const, status: 403, error: "Write endpoints need a user token (X-User-Token: cxu_…)." };
  return { ok: true as const, projectId: acc.project_id, userId: user?.user_id ?? null, tokenIds: [acc.id, ...(user ? [user.id] : [])] };
}

// ---------------------------------------------------------------- API route table

export type ApiRoute = { method: "GET" | "POST"; path: string; name: string; description: string; write: boolean };
export const API_ROUTES: ApiRoute[] = [
  { method: "GET", path: "groups", name: "groups", description: "The account (brand) this token belongs to.", write: false },
  { method: "GET", path: "topics", name: "topics", description: "Listening topics.", write: false },
  { method: "GET", path: "profiles", name: "profiles", description: "Connected channel profiles.", write: false },
  { method: "GET", path: "clusters", name: "clusters", description: "Topic clusters (brand, competitor, campaign, industry).", write: false },
  { method: "GET", path: "messages", name: "messages", description: "Ticket messages. Query: since, until, channel, direction, limit (≤500).", write: false },
  { method: "GET", path: "social-messages", name: "socialMessages", description: "Listening mentions by platform. Query: platform, since, limit.", write: false },
  { method: "GET", path: "posts", name: "posts", description: "Public posts by platform (youtube, linkedin…). Query: platform, limit.", write: false },
  { method: "GET", path: "classifications", name: "classifications", description: "Classification tree with sentiment per level.", write: false },
  { method: "GET", path: "severities", name: "severities", description: "Severity picklist.", write: false },
  { method: "GET", path: "commenter-types", name: "commenterTypes", description: "Commenter type picklist.", write: false },
  { method: "GET", path: "commenter-levels", name: "commenterLevels", description: "Commenter level picklist.", write: false },
  { method: "GET", path: "conversation-types", name: "conversationTypes", description: "Conversation type picklist.", write: false },
  { method: "GET", path: "additional-info", name: "additionalInfo", description: "Additional Info and Custom Info field definitions.", write: false },
  { method: "GET", path: "tickets", name: "tickets", description: "Tickets. Query: status, since, updated_since, limit (≤500).", write: false },
  { method: "POST", path: "tickets", name: "createTicket", description: "Create a ticket (custom channel). Body: subject, body, channel, contact {name,email,phone}.", write: true },
  { method: "GET", path: "tickets/:id", name: "ticket", description: "One ticket with messages, classification and fields.", write: false },
  { method: "GET", path: "tickets/:id/activity", name: "activity", description: "Ticket activity log.", write: false },
  { method: "POST", path: "tickets/:id/notes", name: "note", description: "Add an internal note. Body: body, author (optional custom author name).", write: true },
  { method: "POST", path: "tickets/:id/actions", name: "actions", description: "Update status, priority, assignee (email or id), team, tags.", write: true },
  { method: "POST", path: "tickets/:id/classify", name: "classify", description: "Set classification. Body: classification_ids or path [\"L1\",\"L2\"].", write: true },
  { method: "POST", path: "tickets/:id/resolve", name: "resolve", description: "Resolve the ticket.", write: true },
  { method: "POST", path: "tickets/:id/severity", name: "severity", description: "Set severity. Body: severity.", write: true },
  { method: "POST", path: "tickets/:id/custom-info", name: "customInfo", description: "Set Additional / Custom Info fields. Body: values {key: value}.", write: true },
  { method: "GET", path: "contacts/social-profiles", name: "socialProfiles", description: "Social profiles and tickets of a contact. Query: email or phone.", write: false },
  { method: "GET", path: "queue/active-users", name: "activeUsers", description: "Agents in the queue with status, load, office hours.", write: false },
];

export function matchApiRoute(method: string, segments: string[]) {
  for (const r of API_ROUTES) {
    if (r.method !== method) continue;
    const parts = r.path.split("/");
    if (parts.length !== segments.length) continue;
    const params: Record<string, string> = {};
    if (parts.every((p, i) => (p.startsWith(":") ? ((params[p.slice(1)] = decodeURIComponent(segments[i])), true) : p === segments[i]))) return { route: r, params };
  }
  return null;
}
