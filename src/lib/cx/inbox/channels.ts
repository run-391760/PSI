import { randomUUID } from "node:crypto";
import { query } from "@/lib/db";
import { AppError } from "@/lib/domain";
import { decryptSecret, encryptSecret } from "@/lib/secrets";
import { iso } from "./store";

/** Connected CX channels (cx_channels) owned by the inbox module: email, live chat, web form, WhatsApp/Meta. */
export type EmailConfig = {
  imapHost: string; imapPort: number; imapSecure: boolean;
  smtpHost: string; smtpPort: number; smtpSecure: boolean;
  user: string; fromAddress: string; fromName: string; mailbox: string;
  lastUid?: number; uidValidity?: string; imported?: number; lastCheck?: string;
};
export type ChatConfig = { greeting: string; color: string; askEmail: boolean; offlineNote: string; agentName: string };
export type FormConfig = { title: string; intro: string; success: string; askPhone: boolean; askSubject: boolean; color: string };
export type SocialConfig = { accountId: string; label?: string };

export type ChannelRow = { id: string; project_id: string; kind: string; name: string; config: Record<string, any>; status: "active" | "paused" | "error"; last_error: string | null; last_synced_at: string | null; created_at: string; has_secret: boolean; tickets: number; open: number };

export const DEFAULT_CHAT: ChatConfig = { greeting: "Hi! How can we help you today?", color: "#4f46e5", askEmail: true, offlineNote: "We usually reply within a few hours. Leave your email and we'll get back to you.", agentName: "Support" };
export const DEFAULT_FORM: FormConfig = { title: "Contact us", intro: "Send us a message and we'll get back to you by email.", success: "Thanks! Your message has been received. We'll reply by email soon.", askPhone: false, askSubject: true, color: "#4f46e5" };

export async function listChannels(projectId: string) {
  const rows = await query<ChannelRow>(
    `SELECT ch.id,ch.project_id,ch.kind,ch.name,ch.config,ch.status,ch.last_error,ch.last_synced_at,ch.created_at,(ch.secret_enc IS NOT NULL) AS has_secret,
            (SELECT count(*)::int FROM cx_tickets t WHERE t.channel_id=ch.id) AS tickets,
            (SELECT count(*)::int FROM cx_tickets t WHERE t.channel_id=ch.id AND t.status NOT IN ('solved','closed')) AS open
       FROM cx_channels ch WHERE ch.project_id=$1 ORDER BY ch.created_at`,
    [projectId],
  );
  return rows.map((r) => ({ ...r, config: publicConfig(r.kind, r.config), last_synced_at: iso(r.last_synced_at), created_at: iso(r.created_at)! }));
}
/** Never expose secrets; config itself holds no secrets. */
const publicConfig = (_kind: string, c: Record<string, any>) => c;

/** Public lookup (widget / form / webhooks) by channel id. */
export async function publicChannel(id: string, kind: string | string[]) {
  const kinds = Array.isArray(kind) ? kind : [kind];
  const [r] = await query<{ id: string; project_id: string; kind: string; name: string; config: Record<string, any>; status: string; brand: string; domain: string }>(
    "SELECT ch.id,ch.project_id,ch.kind,ch.name,ch.config,ch.status,p.name AS brand,p.domain FROM cx_channels ch JOIN projects p ON p.id=ch.project_id WHERE ch.id=$1 AND ch.kind = ANY($2)",
    [id, kinds],
  );
  return r ?? null;
}

export async function getChannel(projectId: string, id: string) {
  const [r] = await query<{ id: string; kind: string; name: string; config: Record<string, any>; secret_enc: string | null; status: string }>("SELECT id,kind,name,config,secret_enc,status FROM cx_channels WHERE id=$1 AND project_id=$2", [id, projectId]);
  if (!r) throw new AppError("Channel not found.", 404);
  return r;
}
export function channelSecret(r: { secret_enc: string | null }) {
  return r.secret_enc ? decryptSecret(r.secret_enc) : null;
}

export async function createChannel(projectId: string, kind: string, name: string, config: Record<string, unknown>, secret?: string | null) {
  if (!["email", "livechat", "webform", "whatsapp", "facebook", "instagram", "linkedin"].includes(kind)) throw new AppError("This channel cannot be connected here.");
  const id = randomUUID();
  await query("INSERT INTO cx_channels(id,project_id,kind,name,config,secret_enc) VALUES($1,$2,$3,$4,$5::jsonb,$6)", [id, projectId, kind, name.trim().slice(0, 80) || kind, JSON.stringify(config), secret ? encryptSecret(secret) : null]);
  return id;
}
export async function updateChannel(projectId: string, id: string, patch: { name?: string; config?: Record<string, unknown>; status?: "active" | "paused"; secret?: string | null }) {
  const ch = await getChannel(projectId, id);
  const config = patch.config ? { ...ch.config, ...patch.config } : ch.config;
  await query(
    "UPDATE cx_channels SET name=$3, config=$4::jsonb, status=COALESCE($5,status), secret_enc=COALESCE($6,secret_enc), last_error=CASE WHEN $5='active' THEN NULL ELSE last_error END WHERE id=$1 AND project_id=$2",
    [id, projectId, patch.name?.trim().slice(0, 80) || ch.name, JSON.stringify(config), patch.status ?? null, patch.secret ? encryptSecret(patch.secret) : null],
  );
}
export async function deleteChannel(projectId: string, id: string) {
  await query("DELETE FROM cx_channels WHERE id=$1 AND project_id=$2", [id, projectId]);
}
export async function setChannelResult(id: string, error: string | null, config?: Record<string, unknown>) {
  await query(
    "UPDATE cx_channels SET last_error=$2, status=CASE WHEN $2::text IS NULL THEN (CASE WHEN status='error' THEN 'active' ELSE status END) ELSE 'error' END, last_synced_at=CASE WHEN $2::text IS NULL THEN now() ELSE last_synced_at END, config=CASE WHEN $3::jsonb IS NULL THEN config ELSE config || $3::jsonb END WHERE id=$1",
    [id, error, config ? JSON.stringify(config) : null],
  );
}
