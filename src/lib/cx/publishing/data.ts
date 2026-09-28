import { randomBytes, randomUUID } from "node:crypto";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { query } from "@/lib/db";
import { AppError } from "@/lib/domain";
import { cxContext } from "@/lib/cx/context";
import { channelAvailable } from "@/lib/cx/providers";
import { CHANNELS } from "@/lib/cx/channels";
import { decryptSecret, encryptSecret } from "@/lib/secrets";
import { enqueue, notify, setSchedule } from "@/lib/jobs/queue";
import { buildUtmUrl, isPubChannel, PUB_CHANNELS, renderText, shortCode, slugify, type ChannelResult, type PostStatus, type PubChannel, type Utm } from "./core";
import type { Creds } from "./adapters";

// ================================================================= brand access + roles

export type Brand = { id: string; name: string; domain: string; owner_id: string };
export type Access = { brand: Brand; isOwner: boolean; canApprove: boolean; canAuthor: boolean };

/**
 * Who may use publishing on a brand: the owner, CX brand members (Settings → Team: admin/supervisor =
 * author + approver, agent = author, viewer = read-only) and explicit publishing roles (cx_pub_roles).
 */
const MEMBER_BRANDS = `SELECT project_id FROM cx_members WHERE user_id=$1 UNION SELECT project_id FROM cx_pub_roles WHERE user_id=$1`;

/** Brands the user owns, plus brands where they are a member or hold a publishing role. */
export async function pubContext(userId: string, sp: Record<string, string | string[] | undefined>) {
  const ctx = await cxContext(userId, sp);
  const shared = await query<Brand>(`SELECT p.id, p.name, p.domain, p.owner_id FROM projects p WHERE p.owner_id<>$1 AND p.id IN (${MEMBER_BRANDS}) ORDER BY p.name`, [userId]);
  const requested = typeof sp.brand === "string" ? sp.brand : undefined;
  const own = ctx.brand ? { id: ctx.brand.id, name: ctx.brand.name, domain: ctx.brand.domain, owner_id: ctx.brand.owner_id } : null;
  const brand: Brand | null = (requested && own?.id === requested ? own : null) ?? (requested ? shared.find((b) => b.id === requested) : null) ?? own ?? shared[0] ?? null;
  const switcher = [...ctx.switcher, ...shared.map((b) => ({ id: b.id, name: `${b.name} · shared`, domain: b.domain }))];
  const access = brand ? await accessFor(userId, brand) : null;
  return { brand, switcher, access };
}

async function accessFor(userId: string, brand: Brand): Promise<Access> {
  if (brand.owner_id === userId) return { brand, isOwner: true, canApprove: true, canAuthor: true };
  const [m] = await query<{ role: string }>("SELECT role FROM cx_members WHERE project_id=$1 AND user_id=$2", [brand.id, userId]).catch(() => []);
  const roles = (await query<{ role: string }>("SELECT role FROM cx_pub_roles WHERE project_id=$1 AND user_id=$2", [brand.id, userId])).map((r) => r.role);
  const lead = m?.role === "admin" || m?.role === "supervisor";
  return { brand, isOwner: false, canApprove: lead || roles.includes("approver"), canAuthor: lead || m?.role === "agent" || roles.length > 0 };
}

/** Throws 404 unless the user can access the brand; 403 when the needed permission is missing. */
export async function requireBrand(userId: string, brandId: string, need?: "author" | "approve" | "owner"): Promise<Access> {
  const [b] = await query<Brand>(`SELECT p.id,p.name,p.domain,p.owner_id FROM projects p WHERE p.id=$1 AND (p.owner_id=$2 OR p.id IN (${MEMBER_BRANDS}))`, [brandId, userId]);
  if (!b) throw new AppError("Brand not found.", 404);
  const a = await accessFor(userId, b);
  if (need === "author" && !a.canAuthor) throw new AppError("Your role on this brand is read-only.", 403);
  if (need === "approve" && !a.canApprove) throw new AppError("Only approvers can do this.", 403);
  if (need === "owner" && !a.isOwner) throw new AppError("Only the brand owner can do this.", 403);
  return a;
}

export type Member = { user_id: string; name: string; email: string; team_role: string | null; roles: string[]; explicit: string[]; owner: boolean };
/** Owner + CX brand members + users with explicit publishing roles, with their effective publishing roles. */
export async function listMembers(brand: Brand): Promise<Member[]> {
  const rows = await query<{ id: string; name: string; email: string; team_role: string | null; roles: string[] | null }>(
    `SELECT u.id,u.name,u.email,
       (SELECT m.role FROM cx_members m WHERE m.project_id=$1 AND m.user_id=u.id) team_role,
       (SELECT array_agg(r.role) FROM cx_pub_roles r WHERE r.project_id=$1 AND r.user_id=u.id) roles
     FROM users u WHERE u.id=$2 OR u.id IN (SELECT user_id FROM cx_members WHERE project_id=$1 UNION SELECT user_id FROM cx_pub_roles WHERE project_id=$1)
     ORDER BY (u.id=$2) DESC, u.name`,
    [brand.id, brand.owner_id],
  );
  return rows.map((r) => {
    const lead = r.team_role === "admin" || r.team_role === "supervisor";
    const set = new Set(r.roles ?? []);
    if (r.id === brand.owner_id || lead) {
      set.add("author");
      set.add("approver");
    }
    if (r.team_role === "agent") set.add("author");
    return { user_id: r.id, name: r.name || r.email, email: r.email, team_role: r.id === brand.owner_id ? "owner" : r.team_role, roles: [...set].sort(), explicit: r.roles ?? [], owner: r.id === brand.owner_id };
  });
}
export async function addMember(brand: Brand, email: string, role: "author" | "approver") {
  const [u] = await query<{ id: string }>("SELECT id FROM users WHERE lower(email)=lower($1)", [email.trim()]);
  if (!u) throw new AppError("No SynapseSEO user has that email. Ask them to sign up first.");
  if (u.id === brand.owner_id) throw new AppError("The owner is already author and approver.");
  await query("INSERT INTO cx_pub_roles(project_id,user_id,role) VALUES($1,$2,$3) ON CONFLICT DO NOTHING", [brand.id, u.id, role]);
}
export async function removeMember(brand: Brand, userId: string, role: string) {
  await query("DELETE FROM cx_pub_roles WHERE project_id=$1 AND user_id=$2 AND role=$3", [brand.id, userId, role]);
}

export async function getSettings(projectId: string) {
  const [s] = await query<{ require_approval: boolean }>("SELECT require_approval FROM cx_pub_settings WHERE project_id=$1", [projectId]);
  return { requireApproval: s?.require_approval ?? false };
}
export async function setRequireApproval(projectId: string, on: boolean) {
  await query("INSERT INTO cx_pub_settings(project_id,require_approval) VALUES($1,$2) ON CONFLICT(project_id) DO UPDATE SET require_approval=$2, updated_at=now()", [projectId, on]);
}

// ================================================================= channel accounts

export type AccountRow = { kind: string; external_id: string; label: string; has_token: boolean; updated_at: string };
export async function listAccounts(projectId: string) {
  return query<AccountRow>("SELECT kind, external_id, label, token_enc IS NOT NULL AS has_token, updated_at FROM cx_pub_accounts WHERE project_id=$1", [projectId]);
}
export async function saveAccount(projectId: string, kind: string, externalId: string, label: string, token: string | null) {
  if (!isPubChannel(kind)) throw new AppError("Unknown channel.");
  const id = externalId.trim();
  if (!id) throw new AppError("Enter the account ID.");
  if (kind === "linkedin" && !/^urn:li:(organization|person):\S+$/.test(id)) throw new AppError("LinkedIn author must be an URN like urn:li:organization:123456.");
  if (kind === "youtube" && !/^(UC[\w-]{22}|@[\w.-]{3,})$/.test(id)) throw new AppError("Enter a YouTube channel ID (UC…) or @handle.");
  await query(
    `INSERT INTO cx_pub_accounts(project_id,kind,external_id,label,token_enc) VALUES($1,$2,$3,$4,$5)
     ON CONFLICT(project_id,kind) DO UPDATE SET external_id=$3, label=$4, token_enc=COALESCE($5, cx_pub_accounts.token_enc), updated_at=now()`,
    [projectId, kind, id, label.trim(), token?.trim() ? encryptSecret(token.trim()) : null],
  );
}
export async function removeAccount(projectId: string, kind: string) {
  await query("DELETE FROM cx_pub_accounts WHERE project_id=$1 AND kind=$2", [projectId, kind]);
}

const ENV_FALLBACK: Record<string, [string, string]> = {
  facebook: ["META_PAGE_ID", "META_PAGE_ACCESS_TOKEN"],
  instagram: ["INSTAGRAM_USER_ID", "META_PAGE_ACCESS_TOKEN"],
  linkedin: ["LINKEDIN_AUTHOR_URN", "LINKEDIN_ACCESS_TOKEN"],
  x: ["X_USER_ID", "X_USER_ACCESS_TOKEN"],
};

export type Connection = { kind: PubChannel; name: string; api: string; costNote: string; env: string[]; setup: string; envReady: boolean; account: string | null; connected: boolean; reason: string | null; publishApi: boolean };

/** Publishing/insights connection of each channel for a brand: env (server) + account credentials (brand). */
export async function connections(projectId: string): Promise<Connection[]> {
  const accounts = await listAccounts(projectId);
  return PUB_CHANNELS.map((c) => {
    const info = CHANNELS.find((x) => x.kind === c.kind)!;
    const envReady = channelAvailable(info.kind);
    const acc = accounts.find((a) => a.kind === c.kind);
    const [envId, envTok] = ENV_FALLBACK[c.kind] ?? [];
    const account = acc?.external_id ?? (envId ? process.env[envId] || null : null);
    const hasToken = c.kind === "youtube" ? true : !!acc?.has_token || !!(envTok && process.env[envTok]);
    const connected = envReady && !!account && hasToken;
    const reason = connected
      ? null
      : !envReady
        ? `${info.api} is not configured on this server (${info.env.join(", ")}). ${info.costNote}.`
        : !account
          ? `No ${c.name} account linked to this brand yet.`
          : "Access token missing for this account.";
    return { kind: c.kind, name: c.name, api: info.api, costNote: info.costNote, env: info.env, setup: info.setup, envReady, account, connected, reason, publishApi: c.publishApi };
  });
}

export async function credsFor(projectId: string, kind: PubChannel): Promise<Creds | null> {
  if (!channelAvailable(kind)) return null;
  const [acc] = await query<{ external_id: string; token_enc: string | null }>("SELECT external_id, token_enc FROM cx_pub_accounts WHERE project_id=$1 AND kind=$2", [projectId, kind]);
  const [envId, envTok] = ENV_FALLBACK[kind] ?? [];
  const externalId = acc?.external_id ?? (envId ? process.env[envId] : undefined);
  let token = acc?.token_enc ? decryptSecret(acc.token_enc) : envTok ? process.env[envTok] : undefined;
  if (kind === "youtube") token = process.env.YOUTUBE_API_KEY;
  if (kind === "x" && !token) return null;
  return externalId && token ? { externalId, token } : null;
}

// ================================================================= campaigns

export type Campaign = { id: string; name: string; color: number; starts_on: string | null; ends_on: string | null; notes: string; posts: number };
export async function listCampaigns(projectId: string) {
  return query<Campaign>(
    `SELECT c.id,c.name,c.color,to_char(c.starts_on,'YYYY-MM-DD') starts_on,to_char(c.ends_on,'YYYY-MM-DD') ends_on,c.notes,
       (SELECT count(*)::int FROM cx_pub_posts p WHERE p.campaign_id=c.id) posts
     FROM cx_pub_campaigns c WHERE c.project_id=$1 ORDER BY c.starts_on NULLS LAST, c.name`,
    [projectId],
  );
}
export async function saveCampaign(projectId: string, input: { id?: string; name: string; color: number; starts_on: string | null; ends_on: string | null; notes: string }) {
  const name = input.name.trim().slice(0, 120);
  if (!name) throw new AppError("Name the campaign.");
  if (input.starts_on && input.ends_on && input.ends_on < input.starts_on) throw new AppError("The end date is before the start date.");
  const color = Math.min(8, Math.max(1, Math.round(input.color || 1)));
  if (input.id) {
    await query("UPDATE cx_pub_campaigns SET name=$3,color=$4,starts_on=$5,ends_on=$6,notes=$7 WHERE id=$1 AND project_id=$2", [input.id, projectId, name, color, input.starts_on || null, input.ends_on || null, input.notes ?? ""]);
    return input.id;
  }
  const id = randomUUID();
  await query("INSERT INTO cx_pub_campaigns(id,project_id,name,color,starts_on,ends_on,notes) VALUES($1,$2,$3,$4,$5,$6,$7)", [id, projectId, name, color, input.starts_on || null, input.ends_on || null, input.notes ?? ""]);
  return id;
}
export async function deleteCampaign(projectId: string, id: string) {
  await query("DELETE FROM cx_pub_campaigns WHERE id=$1 AND project_id=$2", [id, projectId]);
}

// ================================================================= assets

export function assetsRoot() {
  const db = process.env.PGLITE_PATH || path.join(process.cwd(), ".data", "postgres");
  return path.join(path.dirname(path.resolve(db)), "assets");
}
export type Asset = { id: string; filename: string; mime: string; size: number; tags: string[]; created_at: string; public_token: string; file: string };
export const MAX_ASSET_BYTES = 100 * 1024 * 1024;
const MIME_EXT: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/gif": "gif", "image/webp": "webp", "video/mp4": "mp4", "video/quicktime": "mov", "video/webm": "webm" };
export const ASSET_MIMES = Object.keys(MIME_EXT);

export async function listAssets(projectId: string, opts: { q?: string; tag?: string; kind?: string } = {}) {
  return query<Asset>(
    `SELECT id,filename,mime,size::int size,tags,created_at,public_token,file FROM cx_pub_assets WHERE project_id=$1
       AND ($2::text IS NULL OR filename ILIKE '%'||$2||'%' OR tags::text ILIKE '%'||$2||'%')
       AND ($3::text IS NULL OR tags ? $3)
       AND ($4::text IS NULL OR mime LIKE $4||'/%')
     ORDER BY created_at DESC LIMIT 500`,
    [projectId, opts.q?.trim() || null, opts.tag || null, opts.kind || null],
  );
}
export const normTags = (tags: string[]) => [...new Set(tags.map((t) => t.trim().toLowerCase().replace(/^#/, "").slice(0, 40)).filter(Boolean))].slice(0, 20);

export async function storeAsset(projectId: string, userId: string, file: { name: string; type: string; bytes: Buffer }, tags: string[]) {
  const ext = MIME_EXT[file.type];
  if (!ext) throw new AppError(`${file.name}: only JPEG, PNG, GIF, WebP, MP4, MOV and WebM files are supported.`);
  if (file.bytes.length > MAX_ASSET_BYTES) throw new AppError(`${file.name} is larger than 100 MB.`);
  const id = randomUUID();
  const rel = path.join(projectId, `${id}.${ext}`);
  const abs = path.join(assetsRoot(), rel);
  await mkdir(path.dirname(abs), { recursive: true });
  await writeFile(abs, file.bytes);
  const name = path.basename(file.name).replace(/[^\w.\- ()]/g, "_").slice(0, 160) || `upload.${ext}`;
  await query("INSERT INTO cx_pub_assets(id,project_id,filename,mime,size,file,public_token,tags,uploaded_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9)", [
    id, projectId, name, file.type, file.bytes.length, rel, randomBytes(24).toString("base64url"), JSON.stringify(normTags(tags)), userId,
  ]);
  return id;
}
export async function assetFile(a: { file: string }) {
  const abs = path.resolve(assetsRoot(), a.file);
  if (!abs.startsWith(path.resolve(assetsRoot()) + path.sep)) throw new AppError("Invalid asset path.", 400);
  return readFile(abs);
}
export async function assetForUser(userId: string, id: string) {
  const [a] = await query<Asset & { project_id: string }>("SELECT * FROM cx_pub_assets WHERE id=$1", [id]);
  if (!a) throw new AppError("Asset not found.", 404);
  await requireBrand(userId, a.project_id);
  return a;
}
export async function assetByToken(token: string) {
  const [a] = await query<Asset>("SELECT * FROM cx_pub_assets WHERE public_token=$1", [token]);
  return a ?? null;
}
export async function setAssetTags(projectId: string, id: string, tags: string[]) {
  await query("UPDATE cx_pub_assets SET tags=$3::jsonb WHERE id=$1 AND project_id=$2", [id, projectId, JSON.stringify(normTags(tags))]);
}
export async function deleteAsset(projectId: string, id: string) {
  const [a] = await query<Asset>("DELETE FROM cx_pub_assets WHERE id=$1 AND project_id=$2 RETURNING *", [id, projectId]);
  if (a) await unlink(path.resolve(assetsRoot(), a.file)).catch(() => {});
}

// ================================================================= short links + clicks

export async function createLink(projectId: string, input: { url: string; utm: Utm; label?: string; channel?: string | null; postId?: string | null; campaignId?: string | null }) {
  const target = buildUtmUrl(input.url, input.utm);
  for (let i = 0; i < 5; i++) {
    const code = shortCode();
    const rows = await query<{ code: string }>(
      "INSERT INTO cx_pub_links(id,project_id,code,target_url,label,channel,post_id,campaign_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(code) DO NOTHING RETURNING code",
      [randomUUID(), projectId, code, target, (input.label ?? "").slice(0, 120), input.channel ?? null, input.postId ?? null, input.campaignId ?? null],
    );
    if (rows[0]) return { code, target };
  }
  throw new AppError("Could not allocate a short code; try again.");
}
export async function deleteLink(projectId: string, id: string) {
  await query("DELETE FROM cx_pub_links WHERE id=$1 AND project_id=$2", [id, projectId]);
}

/** Resolve a short code and record a click (bots are recorded as device "bot" and excluded from reports). */
export async function recordClick(code: string, device: string, referrerHost: string | null) {
  const [l] = await query<{ id: string; target_url: string }>("SELECT id,target_url FROM cx_pub_links WHERE code=$1", [code]);
  if (!l) return null;
  await query("INSERT INTO cx_pub_clicks(link_id,device,referrer_host) VALUES($1,$2,$3)", [l.id, device, referrerHost]);
  return l.target_url;
}

export type LinkRow = { id: string; code: string; target_url: string; label: string; channel: string | null; post_id: string | null; campaign: string | null; created_at: string; clicks: number; clicks_7d: number; last_click: string | null };
export async function listLinks(projectId: string) {
  return query<LinkRow>(
    `SELECT l.id,l.code,l.target_url,l.label,l.channel,l.post_id,c.name campaign,l.created_at,
       count(k.id) FILTER (WHERE k.device<>'bot')::int clicks,
       count(k.id) FILTER (WHERE k.device<>'bot' AND k.clicked_at>now()-interval '7 days')::int clicks_7d,
       max(k.clicked_at) FILTER (WHERE k.device<>'bot') last_click
     FROM cx_pub_links l LEFT JOIN cx_pub_clicks k ON k.link_id=l.id LEFT JOIN cx_pub_campaigns c ON c.id=l.campaign_id
     WHERE l.project_id=$1 GROUP BY l.id,c.name ORDER BY l.created_at DESC LIMIT 1000`,
    [projectId],
  );
}
export async function clickAnalytics(projectId: string, days: number) {
  const base = `FROM cx_pub_clicks k JOIN cx_pub_links l ON l.id=k.link_id WHERE l.project_id=$1 AND k.device<>'bot' AND k.clicked_at > now() - ($2 * interval '1 day')`;
  const [daily, byChannel, byDevice, byRef, totals] = await Promise.all([
    query<{ day: string; clicks: number }>(`SELECT to_char(date_trunc('day',k.clicked_at),'YYYY-MM-DD') AS day, count(*)::int clicks ${base} GROUP BY 1 ORDER BY 1`, [projectId, days]),
    query<{ label: string; clicks: number }>(`SELECT COALESCE(l.channel,'other') label, count(*)::int clicks ${base} GROUP BY 1 ORDER BY 2 DESC`, [projectId, days]),
    query<{ label: string; clicks: number }>(`SELECT COALESCE(k.device,'unknown') label, count(*)::int clicks ${base} GROUP BY 1 ORDER BY 2 DESC`, [projectId, days]),
    query<{ label: string; clicks: number }>(`SELECT COALESCE(k.referrer_host,'Direct / app') label, count(*)::int clicks ${base} GROUP BY 1 ORDER BY 2 DESC LIMIT 8`, [projectId, days]),
    query<{ clicks: number; links: number; prev: number }>(
      `SELECT (SELECT count(*)::int ${base}) clicks,
         (SELECT count(*)::int FROM cx_pub_links WHERE project_id=$1) links,
         (SELECT count(*)::int FROM cx_pub_clicks k JOIN cx_pub_links l ON l.id=k.link_id WHERE l.project_id=$1 AND k.device<>'bot'
            AND k.clicked_at <= now() - ($2 * interval '1 day') AND k.clicked_at > now() - ($2 * 2 * interval '1 day')) prev`,
      [projectId, days],
    ),
  ]);
  // Fill missing days with 0 (a day without clicks is a real zero: the tracker was live).
  const map = new Map(daily.map((d) => [d.day, d.clicks]));
  const series: { day: string; clicks: number }[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86_400_000).toISOString().slice(0, 10);
    series.push({ day: d, clicks: map.get(d) ?? 0 });
  }
  return { series, byChannel, byDevice, byRef, ...totals[0] };
}

// ================================================================= posts

export type PostRow = {
  id: string; project_id: string; campaign_id: string | null; campaign: string | null; campaign_color: number | null;
  author_id: string | null; author: string | null; approver_id: string | null; approver: string | null;
  status: PostStatus; title: string; body: string; variants: Record<string, string>; channels: PubChannel[]; media: string[];
  first_comment: string; link_url: string | null; utm: Utm; links: Record<string, string>; origin: string | null;
  scheduled_at: string | null; published_at: string | null; results: Record<string, ChannelResult>; created_at: string; updated_at: string;
};
const POST_SELECT = `SELECT p.*, c.name campaign, c.color campaign_color, ua.name author, ap.name approver
  FROM cx_pub_posts p LEFT JOIN cx_pub_campaigns c ON c.id=p.campaign_id LEFT JOIN users ua ON ua.id=p.author_id LEFT JOIN users ap ON ap.id=p.approver_id`;

export async function listPosts(projectId: string, opts: { status?: string; from?: string; to?: string } = {}) {
  return query<PostRow>(
    `${POST_SELECT} WHERE p.project_id=$1 AND ($2::text IS NULL OR p.status=$2)
       AND ($3::timestamptz IS NULL OR COALESCE(p.published_at,p.scheduled_at) >= $3) AND ($4::timestamptz IS NULL OR COALESCE(p.published_at,p.scheduled_at) < $4)
     ORDER BY COALESCE(p.scheduled_at,p.updated_at) DESC LIMIT 2000`,
    [projectId, opts.status || null, opts.from ?? null, opts.to ?? null],
  );
}
export async function getPost(projectId: string, id: string) {
  const [p] = await query<PostRow>(`${POST_SELECT} WHERE p.id=$1 AND p.project_id=$2`, [id, projectId]);
  if (!p) throw new AppError("Post not found.", 404);
  return p;
}
export async function postComments(postId: string) {
  return query<{ id: string; author_name: string; kind: string; body: string; created_at: string }>("SELECT id,author_name,kind,body,created_at FROM cx_pub_comments WHERE post_id=$1 ORDER BY created_at", [postId]);
}
export async function addComment(postId: string, user: { id: string; name: string; email: string }, kind: string, body: string) {
  await query("INSERT INTO cx_pub_comments(id,post_id,user_id,author_name,kind,body) VALUES($1,$2,$3,$4,$5,$6)", [randomUUID(), postId, user.id, user.name || user.email, kind, body.slice(0, 4000)]);
}
export async function statusCounts(projectId: string) {
  const rows = await query<{ status: PostStatus; n: number }>("SELECT status, count(*)::int n FROM cx_pub_posts WHERE project_id=$1 GROUP BY status", [projectId]);
  return Object.fromEntries(rows.map((r) => [r.status, r.n])) as Partial<Record<PostStatus, number>>;
}

export type PostInput = {
  id?: string; title: string; body: string; variants: Record<string, string>; channels: string[]; media: string[];
  firstComment: string; linkUrl: string; utm: Utm; campaignId: string | null; approverId: string | null; scheduledAt: string | null;
};

/** Create/update a post's content (status handled by transitions). Editing an approved post sends it back to draft when approval is required. */
export async function savePost(access: Access, userId: string, input: PostInput, origin: string) {
  const channels = [...new Set(input.channels)].filter(isPubChannel);
  if (!channels.length) throw new AppError("Pick at least one channel.");
  const variants = Object.fromEntries(Object.entries(input.variants ?? {}).filter(([k, v]) => isPubChannel(k) && channels.includes(k as PubChannel) && v.trim()));
  const linkUrl = input.linkUrl?.trim() || null;
  if (linkUrl) buildUtmUrl(linkUrl, {}); // validates
  const pid = access.brand.id;
  if (input.campaignId) {
    const [c] = await query("SELECT 1 FROM cx_pub_campaigns WHERE id=$1 AND project_id=$2", [input.campaignId, pid]);
    if (!c) throw new AppError("Campaign not found.");
  }
  const media = input.media.length ? (await query<{ id: string }>("SELECT id FROM cx_pub_assets WHERE project_id=$1 AND id = ANY($2::text[])", [pid, input.media])).map((r) => r.id) : [];
  const orderedMedia = input.media.filter((m) => media.includes(m));
  const { requireApproval } = await getSettings(pid);
  const scheduledAt = input.scheduledAt ? new Date(input.scheduledAt) : null;
  if (scheduledAt && Number.isNaN(scheduledAt.getTime())) throw new AppError("Invalid schedule time.");
  const values = [input.title.trim().slice(0, 200), input.body, JSON.stringify(variants), JSON.stringify(channels), JSON.stringify(orderedMedia), input.firstComment ?? "", linkUrl, JSON.stringify(input.utm ?? {}), input.campaignId || null, input.approverId || null, scheduledAt?.toISOString() ?? null, origin];
  let id = input.id;
  if (id) {
    const cur = await getPost(pid, id);
    if (cur.status === "published") throw new AppError("Published posts cannot be edited.");
    const back = requireApproval && ["pending", "approved", "scheduled"].includes(cur.status) ? "draft" : cur.status === "failed" ? "draft" : cur.status;
    await query(
      `UPDATE cx_pub_posts SET title=$3,body=$4,variants=$5::jsonb,channels=$6::jsonb,media=$7::jsonb,first_comment=$8,link_url=$9,utm=$10::jsonb,campaign_id=$11,approver_id=$12,scheduled_at=$13,origin=$14,status=$15,updated_at=now() WHERE id=$1 AND project_id=$2`,
      [id, pid, ...values, back],
    );
  } else {
    id = randomUUID();
    await query(
      `INSERT INTO cx_pub_posts(id,project_id,title,body,variants,channels,media,first_comment,link_url,utm,campaign_id,approver_id,scheduled_at,origin,author_id) VALUES($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7::jsonb,$8,$9,$10::jsonb,$11,$12,$13,$14,$15)`,
      [id, pid, ...values, userId],
    );
  }
  await syncPostLinks(pid, id);
  return id;
}

/** One tracked short link per channel (utm_source = channel) for the post's destination URL. */
async function syncPostLinks(projectId: string, postId: string) {
  const p = await getPost(projectId, postId);
  if (!p.link_url) {
    await query("UPDATE cx_pub_posts SET links='{}'::jsonb WHERE id=$1", [postId]);
    return;
  }
  const existing = await query<{ id: string; channel: string; code: string }>("SELECT id,channel,code FROM cx_pub_links WHERE post_id=$1", [postId]);
  const links: Record<string, string> = {};
  for (const kind of p.channels) {
    const utm: Utm = { source: kind, medium: p.utm.medium || "social", campaign: p.utm.campaign || (p.campaign ? slugify(p.campaign) : undefined), term: p.utm.term, content: p.utm.content };
    const target = buildUtmUrl(p.link_url, utm);
    const ex = existing.find((e) => e.channel === kind);
    if (ex) {
      await query("UPDATE cx_pub_links SET target_url=$2, campaign_id=$3, label=$4 WHERE id=$1", [ex.id, target, p.campaign_id, p.title || p.body.slice(0, 80)]);
      links[kind] = ex.code;
    } else links[kind] = (await createLink(projectId, { url: p.link_url, utm, label: p.title || p.body.slice(0, 80), channel: kind, postId, campaignId: p.campaign_id })).code;
  }
  await query("UPDATE cx_pub_posts SET links=$2::jsonb WHERE id=$1", [postId, JSON.stringify(links)]);
}

export const shortUrl = (origin: string | null, code: string) => `${(process.env.APP_URL || origin || "").replace(/\/$/, "")}/l/${code}`;
export const postText = (p: Pick<PostRow, "body" | "variants" | "links" | "origin" | "link_url">, kind: string) =>
  renderText(p.body, p.variants, kind, (k) => (p.links[k] ? shortUrl(p.origin, p.links[k]) : p.link_url));

async function setStatus(id: string, status: PostStatus) {
  await query("UPDATE cx_pub_posts SET status=$2, updated_at=now() WHERE id=$1", [id, status]);
}

export async function transition(access: Access, user: { id: string; name: string; email: string }, postId: string, action: "submit" | "approve" | "reject" | "schedule" | "unschedule" | "publish_now" | "retry", comment: string, at?: string) {
  const p = await getPost(access.brand.id, postId);
  const { requireApproval } = await getSettings(access.brand.id);
  const link = `/cx/publishing/${p.id}?brand=${access.brand.id}`;
  const label = p.title || p.body.slice(0, 60) || "Untitled post";
  switch (action) {
    case "submit": {
      if (!["draft", "failed"].includes(p.status)) throw new AppError("Only drafts can be submitted for approval.");
      await setStatus(p.id, "pending");
      await addComment(p.id, user, "submit", comment);
      const approver = p.approver_id ?? access.brand.owner_id;
      if (approver !== user.id) await notify({ ownerId: approver, projectId: access.brand.id, tool: "cx-publishing", severity: "info", title: `Post waiting for approval: ${label}`, body: comment || undefined, link });
      return;
    }
    case "approve":
    case "reject": {
      if (!access.canApprove) throw new AppError("Only approvers can do this.", 403);
      if (p.status !== "pending") throw new AppError("The post is not waiting for approval.");
      if (action === "reject" && !comment.trim()) throw new AppError("Tell the author what to change.");
      const next: PostStatus = action === "reject" ? "draft" : p.scheduled_at ? "scheduled" : "approved";
      await setStatus(p.id, next);
      if (action === "approve") await query("UPDATE cx_pub_posts SET approver_id=$2 WHERE id=$1", [p.id, user.id]);
      await addComment(p.id, user, action, comment);
      if (p.author_id && p.author_id !== user.id)
        await notify({ ownerId: p.author_id, projectId: access.brand.id, tool: "cx-publishing", severity: action === "approve" ? "success" : "warning", title: `${action === "approve" ? "Approved" : "Changes requested"}: ${label}`, body: comment || undefined, link });
      if (next === "scheduled") await kickDispatcher(access.brand.id, user.id);
      return;
    }
    case "schedule":
    case "publish_now":
    case "retry": {
      if (p.status === "published") throw new AppError("The post is already published.");
      if (requireApproval && !["approved", "scheduled", "failed"].includes(p.status))
        throw new AppError("This brand requires approval: submit the post for approval first.");
      const when = action === "schedule" ? new Date(at ?? p.scheduled_at ?? "") : new Date();
      if (Number.isNaN(when.getTime())) throw new AppError("Pick a date and time.");
      if (action === "schedule" && when.getTime() < Date.now() - 60_000) throw new AppError("The time is in the past.");
      await query("UPDATE cx_pub_posts SET status='scheduled', scheduled_at=$2, updated_at=now() WHERE id=$1", [p.id, when.toISOString()]);
      await addComment(p.id, user, "schedule", action === "schedule" ? `Scheduled for ${when.toISOString()}` : action === "retry" ? "Retry publishing" : "Publish now");
      await kickDispatcher(access.brand.id, user.id);
      return;
    }
    case "unschedule": {
      if (p.status !== "scheduled") throw new AppError("The post is not scheduled.");
      await setStatus(p.id, requireApproval ? "approved" : "draft");
      await addComment(p.id, user, "comment", "Unscheduled");
      return;
    }
  }
}

/** Move a post in the calendar (keeps its status; published posts cannot move). */
export async function reschedule(projectId: string, postId: string, at: string) {
  const when = new Date(at);
  if (Number.isNaN(when.getTime())) throw new AppError("Invalid date.");
  const p = await getPost(projectId, postId);
  if (p.status === "published") throw new AppError("Published posts cannot be moved.");
  if (p.status === "scheduled" && when.getTime() < Date.now() - 60_000) throw new AppError("Scheduled posts cannot move into the past.");
  await query("UPDATE cx_pub_posts SET scheduled_at=$2, updated_at=now() WHERE id=$1", [postId, when.toISOString()]);
}

export async function markManual(projectId: string, user: { id: string; name: string; email: string }, postId: string, kind: string, url: string) {
  const p = await getPost(projectId, postId);
  if (!p.channels.includes(kind as PubChannel)) throw new AppError("That channel is not part of the post.");
  if (url && !/^https?:\/\//.test(url)) throw new AppError("Enter the post URL (https://…).");
  const results = { ...p.results, [kind]: { status: "manual", url: url || undefined, at: new Date().toISOString() } as ChannelResult };
  const done = p.channels.every((k) => ["published", "manual"].includes(results[k]?.status ?? ""));
  await query(`UPDATE cx_pub_posts SET results=$2::jsonb, status=CASE WHEN $3 THEN 'published' ELSE status END, published_at=CASE WHEN $3 THEN COALESCE(published_at,now()) ELSE published_at END, updated_at=now() WHERE id=$1`, [postId, JSON.stringify(results), done]);
  await addComment(postId, user, "publish", `Marked ${kind} as published manually${url ? `: ${url}` : ""}`);
}

export async function deletePost(projectId: string, id: string) {
  await query("DELETE FROM cx_pub_posts WHERE id=$1 AND project_id=$2", [id, projectId]);
}
export async function duplicatePost(access: Access, userId: string, id: string, origin: string) {
  const p = await getPost(access.brand.id, id);
  return savePost(access, userId, { title: p.title ? `${p.title} (copy)` : "", body: p.body, variants: p.variants, channels: p.channels, media: p.media, firstComment: p.first_comment, linkUrl: p.link_url ?? "", utm: p.utm, campaignId: p.campaign_id, approverId: p.approver_id, scheduledAt: null }, origin);
}

// ================================================================= dispatcher bootstrap

const minuteKey = (d: Date) => d.toISOString().slice(0, 16);
/** Make sure the every-minute dispatcher runs now and keeps running (hourly schedule as a restart safety net). */
export async function kickDispatcher(projectId: string, ownerId: string) {
  await enqueue({ kind: "cx.publishing.dispatch", ownerId, projectId, payload: {}, dedupeKey: `cx.publishing.dispatch:${minuteKey(new Date())}` });
  await setSchedule(projectId, "cx.publishing.dispatch", { cadence: "hourly" });
}

export async function bulkCreate(access: Access, userId: string, rows: import("./core").BulkRow[], origin: string) {
  const { requireApproval } = await getSettings(access.brand.id);
  const campaigns = await listCampaigns(access.brand.id);
  const assets = await listAssets(access.brand.id);
  let created = 0;
  for (const r of rows) {
    let campaignId: string | null = null;
    if (r.campaign) campaignId = campaigns.find((c) => c.name.toLowerCase() === r.campaign!.toLowerCase())?.id ?? null;
    if (r.campaign && !campaignId) {
      campaignId = await saveCampaign(access.brand.id, { name: r.campaign, color: (campaigns.length % 8) + 1, starts_on: null, ends_on: null, notes: "" });
      campaigns.push({ id: campaignId, name: r.campaign, color: 1, starts_on: null, ends_on: null, notes: "", posts: 0 });
    }
    const media = r.media.map((f) => assets.find((a) => a.filename.toLowerCase() === f.toLowerCase())?.id).filter((x): x is string => !!x);
    const body = r.link && !r.text.includes("{link}") ? `${r.text} {link}` : r.text;
    const id = await savePost(access, userId, { title: "", body, variants: {}, channels: r.channels, media, firstComment: r.firstComment, linkUrl: r.link ?? "", utm: {}, campaignId, approverId: null, scheduledAt: r.at }, origin);
    await query("UPDATE cx_pub_posts SET status=$2 WHERE id=$1", [id, requireApproval ? "pending" : "scheduled"]);
    created++;
  }
  if (created && !requireApproval) await kickDispatcher(access.brand.id, userId);
  return { created, pendingApproval: requireApproval };
}
