"use server";

import { revalidatePath } from "next/cache";
import { actionError, type ActionResult } from "@/app/(app)/projects/actions";
import { AppError } from "@/lib/domain";
import { createChannel, deleteChannel, getChannel, updateChannel, type EmailConfig } from "@/lib/cx/inbox/channels";
import { syncEmailChannel, testEmail } from "@/lib/cx/inbox/email";
import { channelSecret } from "@/lib/cx/inbox/channels";
import { brandUser } from "@/lib/cx/inbox/guard";
import { ensureInboxJobs } from "@/lib/cx/inbox/jobs";

const done = () => {
  revalidatePath("/cx/settings/channels");
  revalidatePath("/cx/inbox");
};

export type EmailInput = Omit<EmailConfig, "lastUid" | "uidValidity" | "imported" | "lastCheck"> & { name: string; password: string };
function emailConfig(i: EmailInput): EmailConfig {
  const host = (h: string) => h.trim().toLowerCase().replace(/^[a-z]+:\/\//, "");
  const c: EmailConfig = {
    imapHost: host(i.imapHost), imapPort: Number(i.imapPort) || 993, imapSecure: !!i.imapSecure,
    smtpHost: host(i.smtpHost), smtpPort: Number(i.smtpPort) || 465, smtpSecure: !!i.smtpSecure,
    user: i.user.trim(), fromAddress: (i.fromAddress || i.user).trim(), fromName: i.fromName.trim(), mailbox: i.mailbox.trim() || "INBOX",
  };
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(c.imapHost) || !/^[a-z0-9.-]+\.[a-z]{2,}$/.test(c.smtpHost)) throw new AppError("Enter valid IMAP and SMTP host names.");
  if (!c.user) throw new AppError("Enter the mailbox user name.");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c.fromAddress)) throw new AppError("Enter a valid From address.");
  return c;
}

export async function testEmailAction(brand: string, input: EmailInput, channelId?: string): Promise<ActionResult<{ imap: string | null; smtp: string | null; messages: number | null }>> {
  try {
    await brandUser(brand);
    let pass = input.password;
    if (!pass && channelId) pass = channelSecret(await getChannel(brand, channelId)) ?? "";
    if (!pass) return { ok: false, error: "Enter the app password." };
    return { ok: true, data: await testEmail(emailConfig(input), pass) };
  } catch (e) {
    return actionError(e);
  }
}

export async function saveEmailAction(brand: string, input: EmailInput, channelId?: string): Promise<ActionResult<string>> {
  try {
    const { user } = await brandUser(brand);
    const cfg = emailConfig(input);
    let id = channelId;
    if (id) await updateChannel(brand, id, { name: input.name || cfg.fromAddress, config: cfg, secret: input.password || null });
    else {
      if (!input.password) return { ok: false, error: "Enter the app password." };
      id = await createChannel(brand, "email", input.name || cfg.fromAddress, cfg, input.password);
    }
    await ensureInboxJobs(brand, user.id, true);
    done();
    return { ok: true, data: id };
  } catch (e) {
    return actionError(e);
  }
}

export async function syncEmailAction(brand: string, channelId: string): Promise<ActionResult<{ imported: number; threaded: number }>> {
  try {
    await brandUser(brand);
    const ch = await getChannel(brand, channelId);
    const r = await syncEmailChannel({ id: ch.id, project_id: brand, config: ch.config as EmailConfig, secret_enc: ch.secret_enc });
    done();
    return { ok: true, data: { imported: r.imported ?? 0, threaded: (r as { threaded?: number }).threaded ?? 0 } };
  } catch (e) {
    done();
    return actionError(e);
  }
}

export async function saveChannelAction(brand: string, kind: "livechat" | "webform" | "whatsapp" | "facebook" | "instagram", name: string, config: Record<string, unknown>, channelId?: string, secret?: string): Promise<ActionResult<string>> {
  try {
    const { user } = await brandUser(brand);
    const clean: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(config)) clean[k] = typeof v === "string" ? v.slice(0, 1000) : typeof v === "boolean" ? v : v;
    if (typeof clean.color === "string" && !/^#[0-9a-f]{6}$/i.test(clean.color)) throw new AppError("Color must be a hex value like #4f46e5.");
    if (["whatsapp", "facebook", "instagram"].includes(kind) && !String(clean.accountId ?? "").trim()) throw new AppError("Enter the account / page id.");
    let id = channelId;
    if (id) await updateChannel(brand, id, { name, config: clean, secret: secret || null });
    else id = await createChannel(brand, kind, name, clean, secret || null);
    await ensureInboxJobs(brand, user.id, false);
    if (kind === "facebook" && secret) {
      // Subscribe the Page to messages, comments/posts and mentions; a failure is shown on the channel, not fatal.
      const { subscribePage } = await import("@/lib/cx/inbox/social");
      const { setChannelResult } = await import("@/lib/cx/inbox/channels");
      await subscribePage(String(clean.accountId), secret).then(() => setChannelResult(id!, null), (e) => setChannelResult(id!, `Webhook subscription: ${e instanceof Error ? e.message : String(e)}`.slice(0, 300)));
    }
    done();
    return { ok: true, data: id };
  } catch (e) {
    return actionError(e);
  }
}

export async function channelStatusAction(brand: string, channelId: string, status: "active" | "paused"): Promise<ActionResult<null>> {
  try {
    await brandUser(brand);
    await updateChannel(brand, channelId, { status });
    done();
    return { ok: true, data: null };
  } catch (e) {
    return actionError(e);
  }
}

export async function deleteChannelAction(brand: string, channelId: string): Promise<ActionResult<null>> {
  try {
    await brandUser(brand);
    await deleteChannel(brand, channelId);
    done();
    return { ok: true, data: null };
  } catch (e) {
    return actionError(e);
  }
}
