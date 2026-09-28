import { query } from "@/lib/db";
import { AppError } from "@/lib/domain";
import { audit } from "./audit";
import { emailDomainAllowed, maskEmail, maskPhone, normalizeDomains } from "./pure/pii";

/**
 * Brand-level admin settings shared with other packages (read them, don't write them):
 *   const s = await adminSettings(projectId);   // piiMask, allowedDomains, statusRequiredWithReply, queue timer
 *   await assertEmailAllowed(projectId, "ops@partner.com");  // throws when the domain isn't on the allow list
 *   const c = await maskContact(projectId, userId, contact); // masked email/phone unless the viewer may see PII
 */
export type AdminSettings = { piiMask: boolean; allowedDomains: string[]; statusRequiredWithReply: boolean; showQueueTimer: boolean; queueTimerMinutes: number };

export async function adminSettings(projectId: string): Promise<AdminSettings> {
  const [r] = await query<{ pii_mask: boolean; allowed_domains: string[]; status_required_with_reply: boolean; show_queue_timer: boolean; queue_timer_minutes: number }>(
    "SELECT pii_mask,allowed_domains,status_required_with_reply,show_queue_timer,queue_timer_minutes FROM cx_admin_settings WHERE project_id=$1",
    [projectId],
  );
  return { piiMask: r?.pii_mask ?? false, allowedDomains: r?.allowed_domains ?? [], statusRequiredWithReply: r?.status_required_with_reply ?? false, showQueueTimer: r?.show_queue_timer ?? true, queueTimerMinutes: r?.queue_timer_minutes ?? 10 };
}

export async function saveAdminSettings(projectId: string, patch: Partial<AdminSettings>, actor?: { id: string; name: string }) {
  const cur = await adminSettings(projectId);
  const next = { ...cur, ...patch, allowedDomains: patch.allowedDomains ? normalizeDomains(patch.allowedDomains) : cur.allowedDomains };
  next.queueTimerMinutes = Math.min(1440, Math.max(1, Math.round(next.queueTimerMinutes || 10)));
  await query(
    `INSERT INTO cx_admin_settings(project_id,pii_mask,allowed_domains,status_required_with_reply,show_queue_timer,queue_timer_minutes) VALUES($1,$2,$3::jsonb,$4,$5,$6)
     ON CONFLICT(project_id) DO UPDATE SET pii_mask=excluded.pii_mask, allowed_domains=excluded.allowed_domains, status_required_with_reply=excluded.status_required_with_reply,
       show_queue_timer=excluded.show_queue_timer, queue_timer_minutes=excluded.queue_timer_minutes, updated_at=now()`,
    [projectId, next.piiMask, JSON.stringify(next.allowedDomains), next.statusRequiredWithReply, next.showQueueTimer, next.queueTimerMinutes],
  );
  const changed = (Object.keys(patch) as (keyof AdminSettings)[]).filter((k) => JSON.stringify(cur[k]) !== JSON.stringify(next[k]));
  if (changed.length) await audit(projectId, actor ?? null, "settings.update", changed.join(", "), changed.map((k) => `${k}: ${JSON.stringify(next[k])}`).join("; "));
  return next;
}

/** Outbound email guard for escalate / forward / compose (U10). */
export async function assertEmailAllowed(projectId: string, ...emails: string[]) {
  const { allowedDomains } = await adminSettings(projectId);
  const bad = emails.filter((e) => !emailDomainAllowed(e, allowedDomains));
  if (bad.length) throw new AppError(`Emails to ${bad[0].split("@")[1] ?? bad[0]} are not allowed for this brand (Settings → Roles → Security).`, 403);
}

/** Mask a contact's email/phone for viewers without the "view_pii" permission when masking is on. */
export async function maskContact<T extends { email?: string | null; phone?: string | null }>(projectId: string, userId: string, c: T): Promise<T & { masked: boolean }> {
  const { piiMask } = await adminSettings(projectId);
  if (!piiMask) return { ...c, masked: false };
  const { can } = await import("./roles");
  if (await can(projectId, userId, "view_pii")) return { ...c, masked: false };
  return { ...c, email: maskEmail(c.email), phone: maskPhone(c.phone), masked: true };
}

/** Reveal a contact's PII (logged in the audit log; requires the "reveal_pii" permission). */
export async function revealContact(projectId: string, user: { id: string; name: string }, contactId: string) {
  const { can } = await import("./roles");
  if (!(await can(projectId, user.id, "reveal_pii"))) throw new AppError("Your role can't reveal personal data.", 403);
  const [c] = await query<{ name: string; email: string | null; phone: string | null }>("SELECT name,email,phone FROM cx_contacts WHERE id=$1 AND project_id=$2", [contactId, projectId]);
  if (!c) throw new AppError("Contact not found.", 404);
  await audit(projectId, user, "pii.reveal", `contact ${c.name || contactId}`, "email, phone");
  return { email: c.email, phone: c.phone };
}
