import { randomUUID } from "node:crypto";
import { query } from "@/lib/db";
import { AppError } from "@/lib/domain";
import { rateLimit } from "@/lib/auth";
import { audit } from "./audit";
import { authorize, matchApiRoute, newToken, readTokens, tokenHash, tokenPrefix, type TokenRecord } from "./pure/webhooks";
import { classifyTicket, getClassificationTree, getFieldDefs, getTicketFields } from "./fields";
import { iso } from "./util";

/** Public token-auth REST API (V3, K9) under /api/cx/v1 and its token management. */
export type ApiToken = { id: string; kind: "account" | "user"; name: string; prefix: string; user_name: string | null; last_used_at: string | null; revoked_at: string | null; created_at: string };

export async function listTokens(projectId: string): Promise<ApiToken[]> {
  const rows = await query<ApiToken>("SELECT t.id,t.kind,t.name,t.prefix,u.name AS user_name,t.last_used_at,t.revoked_at,t.created_at FROM cx_admin_api_tokens t LEFT JOIN users u ON u.id=t.user_id WHERE t.project_id=$1 ORDER BY t.created_at DESC", [projectId]);
  return rows.map((r) => ({ ...r, last_used_at: iso(r.last_used_at), revoked_at: iso(r.revoked_at), created_at: iso(r.created_at)! }));
}
export async function createToken(projectId: string, kind: "account" | "user", name: string, userId: string, actor: { id: string; name: string }) {
  const token = newToken(kind);
  await query("INSERT INTO cx_admin_api_tokens(id,project_id,user_id,kind,name,prefix,token_hash) VALUES($1,$2,$3,$4,$5,$6,$7)", [randomUUID(), projectId, kind === "user" ? userId : null, kind, name.trim().slice(0, 60) || `${kind} token`, tokenPrefix(token), tokenHash(token)]);
  await audit(projectId, actor, "api.token.create", `${kind}: ${name}`);
  return token;
}
export async function revokeToken(projectId: string, id: string, actor: { id: string; name: string }) {
  const [r] = await query<{ name: string }>("UPDATE cx_admin_api_tokens SET revoked_at=now() WHERE id=$1 AND project_id=$2 AND revoked_at IS NULL RETURNING name", [id, projectId]);
  if (r) await audit(projectId, actor, "api.token.revoke", r.name);
}

class ApiError extends Error { constructor(public status: number, message: string) { super(message); } }
const limitOf = (sp: URLSearchParams, max = 500) => Math.min(max, Math.max(1, Number(sp.get("limit")) || 100));
const dateOf = (v: string | null) => (v && !Number.isNaN(Date.parse(v)) ? new Date(v).toISOString() : null);

/** Handle one API request. Returns [status, json]. */
export async function handleApi(req: Request, segments: string[]): Promise<[number, unknown]> {
  const url = new URL(req.url);
  if (segments.length === 0 || (segments.length === 1 && segments[0] === "")) {
    const { API_ROUTES } = await import("./pure/webhooks");
    return [200, { name: "CX API", version: "v1", auth: "Authorization: Bearer <account token> [+ X-User-Token: <user token> for writes]", endpoints: API_ROUTES.map((r) => ({ method: r.method, path: `/api/cx/v1/${r.path}`, description: r.description })) }];
  }
  const m = matchApiRoute(req.method, segments);
  if (!m) return [404, { error: "Unknown endpoint. GET /api/cx/v1 lists them." }];
  const tokens = readTokens((n) => req.headers.get(n), url.searchParams);
  const hashes = [tokens.account, tokens.user].filter((t): t is string => !!t).map(tokenHash);
  const rows = hashes.length ? await query<TokenRecord & { token_hash: string; revoked_at: string | null }>("SELECT id,project_id,user_id,kind,token_hash,revoked_at FROM cx_admin_api_tokens WHERE token_hash = ANY($1)", [hashes]) : [];
  const auth = authorize(tokens, (h) => { const r = rows.find((x) => x.token_hash === h); return r ? { ...r, revoked: !!r.revoked_at } : undefined; }, m.route.write);
  if (!auth.ok) return [auth.status, { error: auth.error }];
  try { await rateLimit(`cxapi:${auth.tokenIds[0]}`, 120, 60); } catch { return [429, { error: "Rate limit: 120 requests per minute per account token." }]; }
  await query("UPDATE cx_admin_api_tokens SET last_used_at=now() WHERE id = ANY($1)", [auth.tokenIds]);
  const body = req.method === "POST" ? ((await req.json().catch(() => null)) as Record<string, any> | null) ?? {} : {};
  try {
    return [m.route.write ? 201 : 200, await run(m.route.name, auth.projectId, auth.userId, m.params, url.searchParams, body)];
  } catch (e) {
    if (e instanceof ApiError) return [e.status, { error: e.message }];
    if (e instanceof AppError) return [e.status ?? 400, { error: e.message }];
    throw e;
  }
}

async function ticketOr404(projectId: string, id: string) {
  const [t] = await query<Record<string, any>>("SELECT * FROM cx_tickets WHERE project_id=$1 AND (id=$2 OR number::text=$2)", [projectId, id]);
  if (!t) throw new ApiError(404, "Ticket not found.");
  return t;
}
async function actor(userId: string) {
  const [u] = await query<{ id: string; name: string; email: string }>("SELECT id,name,email FROM users WHERE id=$1", [userId]);
  return { id: u.id, name: u.name || u.email };
}
const ticketJson = (t: Record<string, any>) => ({
  id: t.id, number: t.number, subject: t.subject, status: t.status, priority: t.priority, channel: t.channel_kind, channel_id: t.channel_id, contact_id: t.contact_id, assignee_id: t.assignee_id,
  team: t.team, tags: t.tags, sentiment: t.sentiment, intent: t.intent, language: t.language, first_response_due: iso(t.first_response_due), resolution_due: iso(t.resolution_due),
  first_response_at: iso(t.first_response_at), resolved_at: iso(t.resolved_at), created_at: iso(t.created_at), updated_at: iso(t.updated_at),
});
async function picklist(projectId: string, key: string) {
  const [f] = await query<{ options: string[] }>("SELECT options FROM cx_admin_fields WHERE project_id=$1 AND grp='system' AND key=$2", [projectId, key]);
  return { data: (f?.options ?? []).map((o, i) => ({ id: i + 1, name: o })) };
}

async function run(name: string, projectId: string, userId: string | null, p: Record<string, string>, sp: URLSearchParams, b: Record<string, any>): Promise<unknown> {
  const { updateTickets, createTicket } = await import("@/lib/cx/inbox/store");
  switch (name) {
    case "groups": {
      const [g] = await query<{ id: string; name: string; domain: string; created_at: string }>("SELECT id,name,domain,created_at FROM projects WHERE id=$1", [projectId]);
      return { data: [{ ...g, created_at: iso(g.created_at) }] };
    }
    case "topics": return { data: await query("SELECT id,name,kind,keywords,excluded,sources,languages,active FROM cx_topics WHERE project_id=$1 ORDER BY name", [projectId]) };
    case "clusters": {
      const rows = await query<{ kind: string; id: string; name: string }>("SELECT kind,id,name FROM cx_topics WHERE project_id=$1", [projectId]);
      return { data: ["brand", "competitor", "campaign", "industry"].map((k) => ({ id: k, name: k, topics: rows.filter((r) => r.kind === k).map(({ id, name }) => ({ id, name })) })).filter((c) => c.topics.length) };
    }
    case "profiles": return { data: (await query<{ id: string; kind: string; name: string; status: string; last_synced_at: string | null; created_at: string }>("SELECT id,kind,name,status,last_synced_at,created_at FROM cx_channels WHERE project_id=$1 ORDER BY created_at", [projectId])).map((r) => ({ ...r, last_synced_at: iso(r.last_synced_at), created_at: iso(r.created_at) })) };
    case "messages": {
      const rows = await query<Record<string, any>>(
        `SELECT m.id,m.ticket_id,t.number,t.channel_kind AS channel,m.direction,m.author_name,m.body,m.delivery,m.created_at FROM cx_messages m JOIN cx_tickets t ON t.id=m.ticket_id
          WHERE t.project_id=$1 AND ($2::timestamptz IS NULL OR m.created_at >= $2) AND ($3::timestamptz IS NULL OR m.created_at < $3) AND ($4::text IS NULL OR t.channel_kind=$4) AND ($5::text IS NULL OR m.direction=$5)
          ORDER BY m.created_at DESC LIMIT $6`,
        [projectId, dateOf(sp.get("since")), dateOf(sp.get("until")), sp.get("channel"), sp.get("direction"), limitOf(sp)]);
      return { data: rows.map((r) => ({ ...r, created_at: iso(r.created_at) })) };
    }
    case "socialMessages":
    case "posts": {
      const platform = sp.get("platform");
      if (name === "posts" && !platform) throw new ApiError(400, "Query parameter platform is required (e.g. youtube, linkedin).");
      const rows = await query<Record<string, any>>(
        "SELECT id,source AS platform,external_id,url,author,author_handle,title,body,language,published_at,sentiment,engagement,status FROM cx_mentions WHERE project_id=$1 AND ($2::text IS NULL OR source=$2) AND ($3::timestamptz IS NULL OR published_at >= $3) ORDER BY published_at DESC NULLS LAST LIMIT $4",
        [projectId, platform, dateOf(sp.get("since")), limitOf(sp)]);
      return { data: rows.map((r) => ({ ...r, published_at: iso(r.published_at) })) };
    }
    case "classifications": {
      const tree = await getClassificationTree(projectId);
      return { data: tree.map((n) => ({ id: n.id, parent_id: n.parentId, name: n.label, level: n.level, sentiment: n.sentiment, hidden: n.hidden })) };
    }
    case "severities": return picklist(projectId, "severity");
    case "commenterTypes": return picklist(projectId, "commenter_type");
    case "commenterLevels": return picklist(projectId, "commenter_level");
    case "conversationTypes": return picklist(projectId, "conversation_type");
    case "additionalInfo": return { data: (await getFieldDefs(projectId)).filter((d) => d.group !== "system").map((d) => ({ key: d.key, label: d.label, scope: d.scope, group: d.group, type: d.type, options: d.options, required: d.required, encrypted: d.encrypted })) };
    case "tickets": {
      const rows = await query<Record<string, any>>(
        "SELECT * FROM cx_tickets WHERE project_id=$1 AND ($2::text IS NULL OR status=$2) AND ($3::timestamptz IS NULL OR created_at >= $3) AND ($4::timestamptz IS NULL OR updated_at >= $4) ORDER BY updated_at DESC LIMIT $5",
        [projectId, sp.get("status"), dateOf(sp.get("since")), dateOf(sp.get("updated_since")), limitOf(sp)]);
      return { data: rows.map(ticketJson) };
    }
    case "ticket": {
      const t = await ticketOr404(projectId, p.id);
      const msgs = await query<Record<string, any>>("SELECT id,direction,author_name,body,attachments,delivery,created_at FROM cx_messages WHERE ticket_id=$1 ORDER BY created_at", [t.id]);
      const f = await getTicketFields(t.id);
      return { data: { ...ticketJson(t), classification_ids: f.classificationIds, fields: f.values, messages: msgs.map((m) => ({ ...m, created_at: iso(m.created_at) })) } };
    }
    case "activity": {
      const t = await ticketOr404(projectId, p.id);
      return { data: (await query<Record<string, any>>("SELECT actor,kind,detail,created_at FROM cx_inbox_events WHERE ticket_id=$1 ORDER BY created_at", [t.id])).map((e) => ({ ...e, created_at: iso(e.created_at) })) };
    }
    case "createTicket": {
      const subject = String(b.subject ?? "").trim(), text = String(b.body ?? b.message ?? "").trim();
      if (!text) throw new ApiError(400, "body is required.");
      const c = b.contact ?? {};
      const channel = /^[a-z][a-z0-9-]{1,30}$/.test(String(b.channel ?? "")) ? String(b.channel) : "api";
      const r = await createTicket({ projectId, channelKind: channel, contact: { name: c.name ?? null, email: c.email ?? null, phone: c.phone ?? null, ...(c.handle && c.platform ? { handle: { kind: String(c.platform), id: String(c.handle) } } : {}) }, subject: subject || text.slice(0, 80), body: text, externalId: b.external_id ? String(b.external_id) : null, externalThreadId: b.thread_id ? String(b.thread_id) : null, authorName: c.name ?? undefined });
      const { onTicketCreated } = await import("./hooks");
      await onTicketCreated(projectId, r.id);
      return { data: { id: r.id, number: r.number, contact_id: r.contactId } };
    }
    case "note": {
      const t = await ticketOr404(projectId, p.id);
      const text = String(b.body ?? "").trim();
      if (!text) throw new ApiError(400, "body is required.");
      const me = await actor(userId!);
      const { postReply } = await import("@/lib/cx/inbox/dispatch");
      await postReply(projectId, t.id, { id: me.id, name: b.author ? `${String(b.author).slice(0, 60)} (API)` : `${me.name} (API)` }, { body: text, note: true });
      return { data: { ok: true } };
    }
    case "actions": {
      const t = await ticketOr404(projectId, p.id);
      const me = await actor(userId!);
      const patch: Record<string, unknown> = {};
      if (b.status) patch.status = b.status;
      if (b.priority) patch.priority = b.priority;
      if (b.team !== undefined) patch.team = b.team;
      if (b.tags) patch.tags = b.tags;
      if (b.add_tags) patch.addTags = b.add_tags;
      if (b.assignee !== undefined) {
        if (!b.assignee) patch.assignee_id = null;
        else {
          const [u] = await query<{ id: string }>("SELECT id FROM users WHERE id=$1 OR lower(email)=lower($1)", [String(b.assignee)]);
          if (!u) throw new ApiError(400, "Unknown assignee.");
          patch.assignee_id = u.id;
        }
      }
      if (!Object.keys(patch).length) throw new ApiError(400, "Nothing to change (status, priority, assignee, team, tags, add_tags).");
      await updateTickets(projectId, [t.id], patch as never, `${me.name} (API)`);
      return { data: ticketJson(await ticketOr404(projectId, t.id)) };
    }
    case "resolve": {
      const t = await ticketOr404(projectId, p.id);
      await updateTickets(projectId, [t.id], { status: "solved" } as never, `${(await actor(userId!)).name} (API)`);
      return { data: { ok: true, status: "solved" } };
    }
    case "classify": {
      const t = await ticketOr404(projectId, p.id);
      let ids: string[] = Array.isArray(b.classification_ids) ? b.classification_ids.map(String) : [];
      if (!ids.length && Array.isArray(b.path)) {
        const tree = await getClassificationTree(projectId);
        let parent: string | null = null;
        for (const label of b.path.map(String)) {
          const n = tree.find((x) => x.parentId === parent && x.label.toLowerCase() === label.toLowerCase());
          if (!n) throw new ApiError(400, `Unknown classification "${label}".`);
          ids = [...ids, n.id];
          parent = n.id;
        }
      }
      if (!ids.length) throw new ApiError(400, "Send classification_ids or path.");
      await classifyTicket(projectId, t.id, { classificationIds: ids }, userId!);
      return { data: await getTicketFields(t.id) };
    }
    case "severity": {
      const t = await ticketOr404(projectId, p.id);
      await classifyTicket(projectId, t.id, { values: { severity: b.severity } }, userId!);
      return { data: await getTicketFields(t.id) };
    }
    case "customInfo": {
      const t = await ticketOr404(projectId, p.id);
      if (!b.values || typeof b.values !== "object") throw new ApiError(400, "Send values: { key: value }.");
      await classifyTicket(projectId, t.id, { values: b.values }, userId!);
      return { data: await getTicketFields(t.id) };
    }
    case "socialProfiles": {
      const email = sp.get("email"), phone = sp.get("phone");
      if (!email && !phone) throw new ApiError(400, "Query email or phone.");
      const contacts = await query<Record<string, any>>(
        "SELECT id,name,email,phone,handles,tags,first_seen,last_seen FROM cx_contacts WHERE project_id=$1 AND (($2::text IS NOT NULL AND lower(email)=lower($2)) OR ($3::text IS NOT NULL AND right(regexp_replace(coalesce(phone,''),'\\D','','g'),10)=right(regexp_replace($3,'\\D','','g'),10)))",
        [projectId, email, phone]);
      const out = [];
      for (const c of contacts) {
        const tickets = await query<{ id: string; number: number; channel_kind: string; status: string; created_at: string }>("SELECT id,number,channel_kind,status,created_at FROM cx_tickets WHERE contact_id=$1 ORDER BY created_at DESC LIMIT 50", [c.id]);
        out.push({ ...c, first_seen: iso(c.first_seen), last_seen: iso(c.last_seen), profiles: Object.entries(c.handles ?? {}).map(([platform, handle]) => ({ platform, handle })), tickets: tickets.map((t) => ({ ...t, created_at: iso(t.created_at) })) });
      }
      return { data: out };
    }
    case "activeUsers": {
      const { queueAgents } = await import("./queue");
      return { data: (await queueAgents(projectId)).map((a) => ({ user_id: a.id, name: a.name, email: a.email, status: a.status, status_name: a.statusName, since: a.since, paused: a.paused, in_queue: a.load, page_size: a.capacity, office_start: a.officeStart, office_end: a.officeEnd, timezone: a.timezone })) };
    }
  }
  throw new ApiError(404, "Unknown endpoint.");
}
