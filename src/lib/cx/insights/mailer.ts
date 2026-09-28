import nodemailer from "nodemailer";
import { query } from "@/lib/db";
import { decryptSecret } from "@/lib/secrets";
import type { EmailConfig } from "@/lib/cx/inbox/channels";

/**
 * Outgoing mail for insights features (survey emails, scheduled exports, executive briefs) through the
 * brand's first active email channel (SMTP). Returns null when the brand has no usable mailbox.
 */
export type Mail = { to: string; subject: string; text: string; html?: string; attachments?: { filename: string; content: string; contentType?: string }[] };

export async function brandMailer(projectId: string) {
  const [ch] = await query<{ config: EmailConfig; secret_enc: string | null; name: string }>(
    "SELECT config,secret_enc,name FROM cx_channels WHERE project_id=$1 AND kind='email' AND status='active' AND secret_enc IS NOT NULL ORDER BY created_at LIMIT 1",
    [projectId],
  );
  if (!ch) return null;
  const c = ch.config;
  let pass: string | null = null;
  try {
    pass = decryptSecret(ch.secret_enc!);
  } catch {
    return null;
  }
  if (!pass || !c.smtpHost) return null;
  const transport = nodemailer.createTransport({ host: c.smtpHost, port: c.smtpPort, secure: c.smtpSecure, auth: { user: c.user, pass }, connectionTimeout: 20_000, greetingTimeout: 15_000, socketTimeout: 60_000 });
  return {
    from: c.fromAddress || c.user,
    async send(m: Mail) {
      const info = await transport.sendMail({ from: { name: c.fromName || c.fromAddress || c.user, address: c.fromAddress || c.user }, to: m.to, subject: m.subject, text: m.text, html: m.html, attachments: m.attachments });
      return String(info.messageId ?? "");
    },
  };
}

export const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
