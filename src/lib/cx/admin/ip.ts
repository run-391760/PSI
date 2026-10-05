import { headers } from "next/headers";
import { query } from "@/lib/db";
import { AppError } from "@/lib/domain";
import { audit } from "./audit";
import { clientIpFrom, ipAllowed, normalizeIp, validateAllowlist } from "./pure/settings";
import { iso } from "./util";

/**
 * Per-brand IP allowlist (Settings → Users → IP whitelisting). When enabled, CX pages and the CX API
 * for that brand only answer requests from the listed addresses/ranges. Usage:
 *   const blocked = await ipBlocked(brand.id);            // in a page: null, or the blocked client IP
 *   await assertIpAllowed(brand.id);                       // in a server action: throws 403
 *   ipAllowedForRequest(projectId, req.headers)            // in a route handler
 */
export type IpSettings = { enabled: boolean; cidrs: string[]; updatedAt: string | null; updatedBy: string | null };

const cache = new Map<string, { at: number; s: IpSettings }>();

export async function getIpSettings(projectId: string, fresh = false): Promise<IpSettings> {
  const hit = cache.get(projectId);
  if (!fresh && hit && Date.now() - hit.at < 15_000) return hit.s;
  const [r] = await query<{ enabled: boolean; cidrs: string[]; updated_at: string; updated_by: string | null }>(
    "SELECT s.enabled,s.cidrs,s.updated_at,COALESCE(NULLIF(u.name,''),u.email) AS updated_by FROM cx_settings_ip s LEFT JOIN users u ON u.id=s.updated_by WHERE s.project_id=$1",
    [projectId],
  );
  const s: IpSettings = { enabled: r?.enabled ?? false, cidrs: r?.cidrs ?? [], updatedAt: iso(r?.updated_at), updatedBy: r?.updated_by ?? null };
  cache.set(projectId, { at: Date.now(), s });
  return s;
}

export async function saveIpSettings(projectId: string, input: { enabled: boolean; lines: string[] }, currentIp: string, actor: { id: string; name: string }) {
  const v = validateAllowlist(input.lines, input.enabled, currentIp);
  if (!v.ok) throw new AppError(v.error);
  await query(
    `INSERT INTO cx_settings_ip(project_id,enabled,cidrs,updated_by,updated_at) VALUES($1,$2,$3::jsonb,$4,now())
     ON CONFLICT(project_id) DO UPDATE SET enabled=excluded.enabled,cidrs=excluded.cidrs,updated_by=excluded.updated_by,updated_at=now()`,
    [projectId, input.enabled, JSON.stringify(v.cidrs), actor.id],
  );
  cache.delete(projectId);
  await audit(projectId, actor, "ip.allowlist", input.enabled ? `on, ${v.cidrs.length} entries` : "off", v.cidrs.join(", ").slice(0, 500));
  return v.cidrs;
}

/** The current request's client IP (server components and actions). */
export async function currentIp() {
  const h = await headers();
  return clientIpFrom((n) => h.get(n));
}

/**
 * null when the request may proceed, else the client IP that was refused. The brand owner (pass `userId`)
 * is exempt so a changed home/office IP can never lock the brand out for good.
 */
export async function ipBlocked(projectId: string, userId?: string | null): Promise<string | null> {
  const s = await getIpSettings(projectId);
  if (!s.enabled || !s.cidrs.length) return null;
  if (userId) {
    const [o] = await query("SELECT 1 FROM projects WHERE id=$1 AND owner_id=$2", [projectId, userId]);
    if (o) return null;
  }
  const ip = await currentIp();
  return ip && ipAllowed(ip, s.cidrs) ? null : ip || "unknown";
}

export async function assertIpAllowed(projectId: string, userId?: string | null) {
  const ip = await ipBlocked(projectId, userId);
  if (ip) throw new AppError(`Access to this brand is limited to approved IP addresses (yours: ${ip}).`, 403);
}

/** Route-handler variant (CX API): checks the request's own headers. */
export async function ipAllowedForRequest(projectId: string, h: Headers): Promise<{ ok: boolean; ip: string }> {
  const s = await getIpSettings(projectId);
  const ip = clientIpFrom((n) => h.get(n));
  if (!s.enabled || !s.cidrs.length) return { ok: true, ip };
  return { ok: !!ip && ipAllowed(ip, s.cidrs), ip: normalizeIp(ip) };
}
