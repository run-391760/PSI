import nodemailer from "nodemailer";
import { query } from "@/lib/db";
import { decryptSecret } from "@/lib/secrets";

/**
 * Outbound admin email (alerts, escalations, break overruns) through the brand's first active email
 * channel (SMTP). Returns a reason string when no email channel is connected.
 */
type Cfg = { smtpHost: string; smtpPort: number; smtpSecure: boolean; user: string; fromAddress: string; fromName: string };

export async function brandMailer(projectId: string) {
  const [ch] = await query<{ config: Cfg; secret_enc: string | null }>("SELECT config,secret_enc FROM cx_channels WHERE project_id=$1 AND kind='email' AND status<>'paused' AND secret_enc IS NOT NULL ORDER BY created_at LIMIT 1", [projectId]);
  return ch ?? null;
}

export async function sendAdminEmail(projectId: string, mail: { to: string[]; bcc?: string[]; subject: string; text: string; attachments?: { filename: string; content: string }[] }): Promise<{ ok: boolean; error: string | null }> {
  const to = mail.to.filter(Boolean), bcc = (mail.bcc ?? []).filter(Boolean);
  if (!to.length && !bcc.length) return { ok: false, error: "No recipients." };
  const ch = await brandMailer(projectId);
  if (!ch) return { ok: false, error: "Connect an email channel (Settings → Channels) to send email alerts." };
  try {
    const c = ch.config;
    const t = nodemailer.createTransport({ host: c.smtpHost, port: c.smtpPort, secure: c.smtpSecure, auth: { user: c.user, pass: decryptSecret(ch.secret_enc!) }, connectionTimeout: 20_000, socketTimeout: 60_000 });
    await t.sendMail({ from: c.fromName ? `"${c.fromName.replace(/"/g, "")}" <${c.fromAddress}>` : c.fromAddress, to: to.length ? to : c.fromAddress, bcc, subject: mail.subject.slice(0, 250), text: mail.text, attachments: mail.attachments });
    return { ok: true, error: null };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message.slice(0, 300) : "SMTP error" };
  }
}
