"use client";

import { AlertTriangle, CheckCircle2, Copy, ExternalLink, Pause, Pencil, Play, Plus, RefreshCw, Trash, Webhook } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { type ReactNode, useState } from "react";
import { ChannelIcon } from "@/components/cx/inbox/ui";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Callout } from "@/components/ui/feedback";
import { Checkbox, Field, Input, Textarea } from "@/components/ui/input";
import { CHANNELS, type ChannelKind } from "@/lib/cx/channels";
import { syncLinkedInAction } from "@/app/(app)/cx/inbox/actions";
import type { ChannelRow } from "@/lib/cx/inbox/channels";
import { timeAgo } from "@/lib/format";
import { channelStatusAction, deleteChannelAction, saveChannelAction, saveEmailAction, syncEmailAction, testEmailAction, type EmailInput } from "./actions";

type Env = { whatsappVerify: boolean; whatsappSend: boolean; metaVerify: boolean; metaSecret: boolean };
type Props = { brand: string; origin: string; channels: ChannelRow[]; available: Record<ChannelKind, boolean>; env: Env };
type Editing = { kind: "email" | "livechat" | "webform" | "whatsapp" | "facebook" | "instagram" | "linkedin"; channel?: ChannelRow } | null;

export function ChannelsClient({ brand, origin, channels, available, env }: Props) {
  const [editing, setEditing] = useState<Editing>(null);
  const connectedKinds = new Set(channels.map((c) => c.kind));
  return (
    <div className="space-y-5">
      <Card>
        <CardHeader title="Connected channels" description="Conversations from these channels arrive in the Inbox as tickets." actions={
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="primary" onClick={() => setEditing({ kind: "email" })}><Plus className="h-3.5 w-3.5" />Email</Button>
            <Button size="sm" onClick={() => setEditing({ kind: "livechat" })}><Plus className="h-3.5 w-3.5" />Live chat</Button>
            <Button size="sm" onClick={() => setEditing({ kind: "webform" })}><Plus className="h-3.5 w-3.5" />Web form</Button>
          </div>
        } />
        <CardBody className="space-y-3">
          {channels.length === 0 ? (
            <div className="grid gap-3 md:grid-cols-3">
              {([["email", "Email", "Import a support mailbox over IMAP and reply over SMTP. Works with Gmail, Outlook, Zoho or any host (use an app password)."], ["livechat", "Live chat", "A chat bubble for your website. Paste one script tag; visitors chat with your team in real time."], ["webform", "Web form", "A hosted contact form (or your own HTML form) that turns submissions into tickets."]] as const).map(([k, t, d]) => (
                <button key={k} onClick={() => setEditing({ kind: k })} className="rounded-lg border border-dashed border-border-strong p-4 text-left hover:border-link hover:bg-surface-2">
                  <div className="flex items-center gap-2 text-[14px] font-semibold text-text"><ChannelIcon kind={k} className="h-4 w-4" />{t}</div>
                  <p className="mt-1 text-[12.5px] text-text-2">{d}</p>
                  <span className="mt-2 inline-block text-[12.5px] font-medium text-link">Connect →</span>
                </button>
              ))}
            </div>
          ) : (
            channels.map((c) => <ConnectedChannel key={c.id} c={c} brand={brand} origin={origin} onEdit={() => setEditing({ kind: c.kind as NonNullable<Editing>["kind"], channel: c })} />)
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Channel catalogue" description="Every channel the CX workspace supports, the API behind it and what it costs." />
        <CardBody>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {CHANNELS.map((ch) => {
              const connected = connectedKinds.has(ch.kind);
              const socialInbox = ch.kind === "whatsapp" ? env.whatsappVerify : ch.kind === "facebook" || ch.kind === "instagram" ? env.metaVerify && env.metaSecret : ch.kind === "linkedin";
              const builtIn = ["email", "livechat", "webform"].includes(ch.kind);
              return (
                <div key={ch.kind} className="flex flex-col rounded-lg border border-border p-3.5">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2 text-[14px] font-semibold text-text"><ChannelIcon kind={ch.kind} className="h-4 w-4" />{ch.name}</div>
                    {connected ? <Badge tone="good">Connected</Badge> : builtIn ? <Badge tone="info">Built in</Badge> : available[ch.kind] ? <Badge tone="info">API ready</Badge> : <Badge>Not connected</Badge>}
                  </div>
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {ch.uses.map((u) => <span key={u} className="rounded bg-surface-3 px-1.5 py-0.5 text-[11px] text-text-2">{u}</span>)}
                  </div>
                  <dl className="mt-2 space-y-1 text-[12.5px]">
                    <div className="flex gap-2"><dt className="w-10 shrink-0 text-text-3">API</dt><dd className="text-text">{ch.api}</dd></div>
                    <div className="flex gap-2"><dt className="w-10 shrink-0 text-text-3">Cost</dt><dd className="text-text"><Badge tone={ch.cost === "free" ? "good" : ch.cost === "paid" ? "warning" : "info"} className="mr-1">{ch.cost === "free" ? "Free" : ch.cost === "paid" ? "Paid" : "Free · approval"}</Badge>{ch.costNote !== "Free" && ch.costNote}</dd></div>
                    {ch.env.length > 0 && <div className="flex gap-2"><dt className="w-10 shrink-0 text-text-3">Env</dt><dd className="break-all font-mono text-[11.5px] text-text-2">{ch.env.join(", ")}</dd></div>}
                  </dl>
                  <p className="mt-2 flex-1 text-[12.5px] text-text-2">{ch.setup}</p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {builtIn && <Button size="sm" onClick={() => setEditing({ kind: ch.kind as "email" })}><Plus className="h-3.5 w-3.5" />Connect</Button>}
                    {(ch.kind === "whatsapp" || ch.kind === "facebook" || ch.kind === "instagram" || ch.kind === "linkedin") && (
                      socialInbox ? <Button size="sm" onClick={() => setEditing({ kind: ch.kind as "whatsapp" })}><Plus className="h-3.5 w-3.5" />Connect inbox</Button>
                        : <span className="text-[12px] text-text-3">Inbox needs {ch.kind === "whatsapp" ? "WHATSAPP_VERIFY_TOKEN" : "META_VERIFY_TOKEN + META_APP_SECRET"} on the server.</span>
                    )}
                    {ch.uses.includes("listening") && !builtIn && <Link href={`/cx/listening?brand=${brand}`} className="text-[12.5px] text-link hover:underline">Used by Social listening →</Link>}
                  </div>
                </div>
              );
            })}
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Messaging webhooks" description="Endpoints for platforms that push messages to us. They only accept requests when their tokens are configured." />
        <CardBody className="space-y-3 text-[13px]">
          <WebhookRow name="WhatsApp Business Cloud API" url={`${origin}/api/cx/webhooks/whatsapp`} ok={env.whatsappVerify} items={[["WHATSAPP_VERIFY_TOKEN", env.whatsappVerify, "verify token you enter in Meta → WhatsApp → Configuration"], ["META_APP_SECRET", env.metaSecret, "enforces the X-Hub-Signature-256 check (recommended)"], ["WHATSAPP_TOKEN + WHATSAPP_PHONE_NUMBER_ID", env.whatsappSend, "needed to send replies"]]} />
          <WebhookRow name="Facebook Messenger & Instagram messaging" url={`${origin}/api/cx/webhooks/meta`} ok={env.metaVerify && env.metaSecret} items={[["META_VERIFY_TOKEN", env.metaVerify, "verify token for the Meta app's Webhooks product"], ["META_APP_SECRET", env.metaSecret, "required: every POST is signature-checked"]]} />
          <p className="text-[12.5px] text-text-3">In the Meta app&apos;s Webhooks, subscribe Page fields <code>messages</code>, <code>feed</code>, <code>mention</code>, <code>ratings</code> and Instagram fields <code>messages</code>, <code>comments</code>, <code>mentions</code>, then connect the channel above with the phone number id / Page id / Instagram account id. Direct messages become one open ticket per sender; each comment thread, mention and tagged post becomes its own ticket, and replies are posted publicly on it. Posts you&apos;re tagged in on Instagram are checked every 15 minutes.</p>
        </CardBody>
      </Card>

      {editing?.kind === "email" && <EmailDialog brand={brand} channel={editing.channel} onClose={() => setEditing(null)} />}
      {(editing?.kind === "livechat" || editing?.kind === "webform") && <WidgetDialog brand={brand} kind={editing.kind} channel={editing.channel} onClose={() => setEditing(null)} />}
      {(editing?.kind === "whatsapp" || editing?.kind === "facebook" || editing?.kind === "instagram" || editing?.kind === "linkedin") && <SocialDialog brand={brand} kind={editing.kind} channel={editing.channel} onClose={() => setEditing(null)} />}
    </div>
  );
}

function WebhookRow({ name, url, ok, items }: { name: string; url: string; ok: boolean; items: [string, boolean, string][] }) {
  return (
    <div className="rounded-lg border border-border p-3">
      <div className="flex flex-wrap items-center gap-2 font-medium text-text"><Webhook className="h-4 w-4 text-text-3" />{name}{ok ? <Badge tone="good">Accepting</Badge> : <Badge>Disabled</Badge>}</div>
      <CopyField value={url} className="mt-2" />
      <ul className="mt-2 space-y-1">
        {items.map(([k, v, d]) => (
          <li key={k} className="flex items-start gap-2 text-[12.5px]">
            {v ? <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-good-ink" /> : <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning-ink" />}
            <span><code className="text-text">{k}</code> <span className="text-text-3">— {d}</span></span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function CopyField({ value, className, multiline }: { value: string; className?: string; multiline?: boolean }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className={`flex items-start gap-2 ${className ?? ""}`}>
      {multiline ? (
        <pre className="scroll-thin min-w-0 flex-1 overflow-x-auto rounded-md border border-border bg-surface-2 px-2.5 py-2 font-mono text-[11.5px] whitespace-pre text-text">{value}</pre>
      ) : (
        <code className="min-w-0 flex-1 truncate rounded-md border border-border bg-surface-2 px-2.5 py-1.5 font-mono text-[12px] text-text">{value}</code>
      )}
      <Button size="sm" variant="ghost" onClick={() => { navigator.clipboard?.writeText(value).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }).catch(() => {}); }} aria-label="Copy">
        <Copy className="h-3.5 w-3.5" />{copied ? "Copied" : "Copy"}
      </Button>
    </div>
  );
}

function ConnectedChannel({ c, brand, origin, onEdit }: { c: ChannelRow; brand: string; origin: string; onEdit: () => void }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ tone: "good" | "critical"; text: string } | null>(null);
  const [confirm, setConfirm] = useState(false);
  const run = async (key: string, fn: () => Promise<{ ok: boolean; error?: string; data?: unknown }>, okText?: (d: unknown) => string) => {
    setBusy(key); setMsg(null);
    const r = await fn();
    setBusy(null);
    if (!r.ok) setMsg({ tone: "critical", text: r.error ?? "Failed" });
    else if (okText) setMsg({ tone: "good", text: okText(r.data) });
    router.refresh();
  };
  const cfg = c.config as Record<string, any>;
  let details: ReactNode = null;
  if (c.kind === "email")
    details = (
      <div className="grid gap-x-6 gap-y-1 text-[12.5px] text-text-2 sm:grid-cols-2">
        <div>Mailbox <span className="text-text">{cfg.user}</span> · {cfg.mailbox || "INBOX"}</div>
        <div>IMAP <span className="text-text">{cfg.imapHost}:{cfg.imapPort}</span> · SMTP <span className="text-text">{cfg.smtpHost}:{cfg.smtpPort}</span></div>
        <div>Replies from <span className="text-text">{cfg.fromName ? `${cfg.fromName} <${cfg.fromAddress}>` : cfg.fromAddress}</span></div>
        <div>Last check {cfg.lastCheck ? timeAgo(cfg.lastCheck) : "never"} · {cfg.imported ?? 0} messages imported · checks every 5 min</div>
      </div>
    );
  if (c.kind === "livechat")
    details = (
      <div className="space-y-2">
        <div className="text-[12.5px] text-text-2">Paste before <code>&lt;/body&gt;</code> on every page of your site:</div>
        <CopyField value={`<script src="${origin}/api/cx/chat/widget?c=${c.id}" async></script>`} />
        <div className="flex flex-wrap items-center gap-3 text-[12.5px]"><span className="text-text-2">Hosted chat page:</span><a href={`/chat/${c.id}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-link hover:underline">{origin}/chat/{c.id.slice(0, 8)}…<ExternalLink className="h-3 w-3" /></a></div>
      </div>
    );
  if (c.kind === "webform") {
    const html = `<form action="${origin}/api/cx/forms/${c.id}" method="post">\n  <input name="name" placeholder="Name" required>\n  <input name="email" type="email" placeholder="Email" required>\n  <input name="subject" placeholder="Subject">\n  <textarea name="message" required></textarea>\n  <input name="website" style="display:none" tabindex="-1" autocomplete="off">\n  <button type="submit">Send</button>\n</form>`;
    details = (
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-3 text-[12.5px]"><span className="text-text-2">Hosted form:</span><a href={`/f/${c.id}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-link hover:underline">{origin}/f/{c.id.slice(0, 8)}…<ExternalLink className="h-3 w-3" /></a></div>
        <CopyField value={`${origin}/f/${c.id}`} />
        <details className="text-[12.5px]"><summary className="cursor-pointer text-text-2">Use your own HTML form instead</summary><CopyField value={html} multiline className="mt-2" /></details>
      </div>
    );
  }
  if (["whatsapp", "facebook", "instagram", "linkedin"].includes(c.kind))
    details = (
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px] text-text-2">
        <span>{c.kind === "linkedin" ? "Organization" : "Account id"} <span className="font-mono break-all text-text">{cfg.accountId}</span>{c.has_secret ? " · access token stored (encrypted)" : c.kind === "linkedin" ? " · uses the Publishing LinkedIn token" : ""}</span>
        {cfg.humanAgent ? <Badge tone="info">Human Agent (7-day replies)</Badge> : null}
        {c.kind === "linkedin" && <LinkedInSync brand={brand} />}
      </div>
    );

  return (
    <div className="rounded-lg border border-border p-3.5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2 text-[14px] font-semibold text-text">
            <ChannelIcon kind={c.kind} className="h-4 w-4" />{c.name}
            <Badge tone={c.status === "active" ? "good" : c.status === "error" ? "critical" : "neutral"}>{c.status === "active" ? "Active" : c.status === "error" ? "Error" : "Paused"}</Badge>
            <span className="text-[12px] font-normal text-text-3">{c.tickets} tickets · {c.open} open · added {timeAgo(c.created_at)}</span>
          </div>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {c.kind === "email" && <Button size="sm" disabled={!!busy} onClick={() => run("sync", () => syncEmailAction(brand, c.id), (d) => { const x = d as { imported: number; threaded: number }; return `Checked mailbox: ${x.imported} new tickets, ${x.threaded} replies threaded.`; })}><RefreshCw className={`h-3.5 w-3.5 ${busy === "sync" ? "animate-spin" : ""}`} />Sync now</Button>}
          <Button size="sm" variant="ghost" onClick={onEdit}><Pencil className="h-3.5 w-3.5" />Edit</Button>
          <Button size="sm" variant="ghost" disabled={!!busy} onClick={() => run("pause", () => channelStatusAction(brand, c.id, c.status === "paused" ? "active" : "paused"))}>{c.status === "paused" ? <><Play className="h-3.5 w-3.5" />Resume</> : <><Pause className="h-3.5 w-3.5" />Pause</>}</Button>
          <Button size="sm" variant="ghost" onClick={() => setConfirm(true)} aria-label="Remove channel"><Trash className="h-3.5 w-3.5" /></Button>
        </div>
      </div>
      <div className="mt-2">{details}</div>
      {c.last_error && <Callout tone="critical" className="mt-2" title="Last sync failed">{c.last_error}</Callout>}
      {msg && <Callout tone={msg.tone === "good" ? "good" : "critical"} className="mt-2">{msg.text}</Callout>}
      <Dialog open={confirm} onClose={() => setConfirm(false)} title="Remove channel?" description="Existing tickets stay in the inbox; new messages from this channel stop arriving." size="sm"
        footer={<><Button onClick={() => setConfirm(false)}>Cancel</Button><Button variant="danger" onClick={() => { setConfirm(false); run("del", () => deleteChannelAction(brand, c.id)); }}>Remove</Button></>}>
        <p className="text-[13px] text-text-2">{c.name}</p>
      </Dialog>
    </div>
  );
}

const PRESETS: Record<string, Partial<EmailInput>> = {
  gmail: { imapHost: "imap.gmail.com", imapPort: 993, imapSecure: true, smtpHost: "smtp.gmail.com", smtpPort: 465, smtpSecure: true },
  outlook: { imapHost: "outlook.office365.com", imapPort: 993, imapSecure: true, smtpHost: "smtp.office365.com", smtpPort: 587, smtpSecure: false },
  zoho: { imapHost: "imap.zoho.com", imapPort: 993, imapSecure: true, smtpHost: "smtp.zoho.com", smtpPort: 465, smtpSecure: true },
  yahoo: { imapHost: "imap.mail.yahoo.com", imapPort: 993, imapSecure: true, smtpHost: "smtp.mail.yahoo.com", smtpPort: 465, smtpSecure: true },
};

function EmailDialog({ brand, channel, onClose }: { brand: string; channel?: ChannelRow; onClose: () => void }) {
  const router = useRouter();
  const cfg = (channel?.config ?? {}) as Partial<EmailInput>;
  const [f, setF] = useState<EmailInput>({
    name: channel?.name ?? "", imapHost: cfg.imapHost ?? "", imapPort: cfg.imapPort ?? 993, imapSecure: cfg.imapSecure ?? true, smtpHost: cfg.smtpHost ?? "", smtpPort: cfg.smtpPort ?? 465, smtpSecure: cfg.smtpSecure ?? true,
    user: cfg.user ?? "", fromAddress: cfg.fromAddress ?? "", fromName: cfg.fromName ?? "", mailbox: cfg.mailbox ?? "INBOX", password: "",
  });
  const [busy, setBusy] = useState<"test" | "save" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [test, setTest] = useState<{ imap: string | null; smtp: string | null; messages: number | null } | null>(null);
  const set = <K extends keyof EmailInput>(k: K, v: EmailInput[K]) => setF((x) => ({ ...x, [k]: v }));
  const preset = (p: string) => setF((x) => ({ ...x, ...PRESETS[p] }));
  return (
    <Dialog open onClose={onClose} size="lg" title={channel ? "Edit email channel" : "Connect a mailbox"} description="Use an app password (Gmail: Google Account → Security → App passwords). The password is stored encrypted."
      footer={<>
        <Button onClick={onClose}>Cancel</Button>
        <Button disabled={!!busy} onClick={async () => { setBusy("test"); setError(null); setTest(null); const r = await testEmailAction(brand, f, channel?.id); setBusy(null); if (r.ok) setTest(r.data); else setError(r.error); }}>{busy === "test" ? "Testing…" : "Test connection"}</Button>
        <Button variant="primary" disabled={!!busy} onClick={async () => { setBusy("save"); setError(null); const r = await saveEmailAction(brand, f, channel?.id); setBusy(null); if (r.ok) { onClose(); router.refresh(); } else setError(r.error); }}>{busy === "save" ? "Saving…" : channel ? "Save" : "Connect"}</Button>
      </>}>
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2 text-[12.5px]"><span className="text-text-3">Presets:</span>{Object.keys(PRESETS).map((p) => <Button key={p} size="sm" variant="ghost" onClick={() => preset(p)}>{p[0].toUpperCase() + p.slice(1)}</Button>)}</div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Mailbox user" htmlFor="em-user"><Input id="em-user" value={f.user} onChange={(e) => set("user", e.target.value)} placeholder="support@yourbrand.com" autoComplete="off" /></Field>
          <Field label={channel ? "App password (leave empty to keep)" : "App password"} htmlFor="em-pass"><Input id="em-pass" type="password" value={f.password} onChange={(e) => set("password", e.target.value)} autoComplete="new-password" /></Field>
          <Field label="IMAP host" htmlFor="em-ih"><Input id="em-ih" value={f.imapHost} onChange={(e) => set("imapHost", e.target.value)} placeholder="imap.example.com" /></Field>
          <div className="flex gap-2">
            <Field label="Port" htmlFor="em-ip" className="w-24"><Input id="em-ip" type="number" value={f.imapPort} onChange={(e) => set("imapPort", Number(e.target.value))} /></Field>
            <label className="mt-6 flex items-center gap-1.5 text-[12.5px] text-text-2"><Checkbox checked={f.imapSecure} onChange={(e) => set("imapSecure", e.target.checked)} />SSL/TLS</label>
          </div>
          <Field label="SMTP host" htmlFor="em-sh"><Input id="em-sh" value={f.smtpHost} onChange={(e) => set("smtpHost", e.target.value)} placeholder="smtp.example.com" /></Field>
          <div className="flex gap-2">
            <Field label="Port" htmlFor="em-sp" className="w-24"><Input id="em-sp" type="number" value={f.smtpPort} onChange={(e) => set("smtpPort", Number(e.target.value))} /></Field>
            <label className="mt-6 flex items-center gap-1.5 text-[12.5px] text-text-2"><Checkbox checked={f.smtpSecure} onChange={(e) => set("smtpSecure", e.target.checked)} />SSL/TLS (off = STARTTLS)</label>
          </div>
          <Field label="From address" htmlFor="em-fa" hint="Defaults to the mailbox user"><Input id="em-fa" value={f.fromAddress} onChange={(e) => set("fromAddress", e.target.value)} /></Field>
          <Field label="From name" htmlFor="em-fn"><Input id="em-fn" value={f.fromName} onChange={(e) => set("fromName", e.target.value)} placeholder="Acme Support" /></Field>
          <Field label="Folder" htmlFor="em-mb"><Input id="em-mb" value={f.mailbox} onChange={(e) => set("mailbox", e.target.value)} /></Field>
          <Field label="Channel name" htmlFor="em-nm"><Input id="em-nm" value={f.name} onChange={(e) => set("name", e.target.value)} placeholder="Support mailbox" /></Field>
        </div>
        {test && (
          <div className="space-y-1.5">
            <Callout tone={test.imap ? "critical" : "good"} title={test.imap ? "IMAP failed" : "IMAP connected"}>{test.imap ?? `${test.messages ?? "n/a"} messages in ${f.mailbox || "INBOX"}.`}</Callout>
            <Callout tone={test.smtp ? "critical" : "good"} title={test.smtp ? "SMTP failed" : "SMTP ready"}>{test.smtp ?? "Replies can be sent."}</Callout>
          </div>
        )}
        {error && <Callout tone="critical">{error}</Callout>}
        <p className="text-[12px] text-text-3">The first sync imports the last 3 days (up to 50 messages); after that new mail is checked every 5 minutes. Replies are threaded by Message-ID/References and a [#number] tag in the subject.</p>
      </div>
    </Dialog>
  );
}

function WidgetDialog({ brand, kind, channel, onClose }: { brand: string; kind: "livechat" | "webform"; channel?: ChannelRow; onClose: () => void }) {
  const router = useRouter();
  const c = (channel?.config ?? {}) as Record<string, any>;
  const [name, setName] = useState(channel?.name ?? (kind === "livechat" ? "Website chat" : "Contact form"));
  const [cfg, setCfg] = useState<Record<string, any>>(
    kind === "livechat"
      ? { greeting: c.greeting ?? "Hi! How can we help you today?", color: c.color ?? "#4f46e5", askEmail: c.askEmail ?? true, offlineNote: c.offlineNote ?? "We usually reply within a few hours. Leave your email and we'll get back to you." }
      : { title: c.title ?? "Contact us", intro: c.intro ?? "Send us a message and we'll get back to you by email.", success: c.success ?? "Thanks! Your message has been received. We'll reply by email soon.", askPhone: c.askPhone ?? false, askSubject: c.askSubject ?? true, color: c.color ?? "#4f46e5" },
  );
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: string, v: unknown) => setCfg((x) => ({ ...x, [k]: v }));
  return (
    <Dialog open onClose={onClose} title={`${channel ? "Edit" : "Add"} ${kind === "livechat" ? "live chat" : "web form"}`}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={busy} onClick={async () => { setBusy(true); setError(null); const r = await saveChannelAction(brand, kind, name, cfg, channel?.id); setBusy(false); if (r.ok) { onClose(); router.refresh(); } else setError(r.error); }}>{busy ? "Saving…" : "Save"}</Button></>}>
      <div className="space-y-3">
        <Field label="Channel name" htmlFor="w-name"><Input id="w-name" value={name} onChange={(e) => setName(e.target.value)} /></Field>
        {kind === "livechat" ? (
          <>
            <Field label="Greeting" htmlFor="w-gr"><Input id="w-gr" value={cfg.greeting} onChange={(e) => set("greeting", e.target.value)} /></Field>
            <Field label="When no agent is online" htmlFor="w-off"><Textarea id="w-off" rows={2} value={cfg.offlineNote} onChange={(e) => set("offlineNote", e.target.value)} /></Field>
            <label className="flex items-center gap-2 text-[13px] text-text"><Checkbox checked={cfg.askEmail} onChange={(e) => set("askEmail", e.target.checked)} />Require the visitor's email before chatting</label>
          </>
        ) : (
          <>
            <Field label="Title" htmlFor="w-t"><Input id="w-t" value={cfg.title} onChange={(e) => set("title", e.target.value)} /></Field>
            <Field label="Intro" htmlFor="w-i"><Textarea id="w-i" rows={2} value={cfg.intro} onChange={(e) => set("intro", e.target.value)} /></Field>
            <Field label="Thank-you message" htmlFor="w-s"><Input id="w-s" value={cfg.success} onChange={(e) => set("success", e.target.value)} /></Field>
            <div className="flex flex-wrap gap-4">
              <label className="flex items-center gap-2 text-[13px] text-text"><Checkbox checked={cfg.askSubject} onChange={(e) => set("askSubject", e.target.checked)} />Subject field</label>
              <label className="flex items-center gap-2 text-[13px] text-text"><Checkbox checked={cfg.askPhone} onChange={(e) => set("askPhone", e.target.checked)} />Phone field</label>
            </div>
          </>
        )}
        <Field label="Accent color" htmlFor="w-c">
          <div className="flex items-center gap-2"><input id="w-c" type="color" value={cfg.color} onChange={(e) => set("color", e.target.value)} className="h-8 w-10 cursor-pointer rounded border border-border bg-surface" /><Input value={cfg.color} onChange={(e) => set("color", e.target.value)} className="w-32 font-mono" aria-label="Hex color" /></div>
        </Field>
        {error && <Callout tone="critical">{error}</Callout>}
      </div>
    </Dialog>
  );
}

function LinkedInSync({ brand }: { brand: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <span className="inline-flex items-center gap-2">
      <button type="button" disabled={busy} onClick={async () => { setBusy(true); const r = await syncLinkedInAction(brand); setBusy(false); setMsg(r.ok ? `${r.data} new` : r.error); router.refresh(); }} className="text-link hover:underline">{busy ? "Checking…" : "Check now"}</button>
      {msg && <span className="text-text-3">{msg}</span>}
    </span>
  );
}

type SocialKind = "whatsapp" | "facebook" | "instagram" | "linkedin";
const SOCIAL_NAME: Record<SocialKind, string> = { whatsapp: "WhatsApp", facebook: "Facebook Page", instagram: "Instagram", linkedin: "LinkedIn page" };
const TOKEN_HINT: Record<Exclude<SocialKind, "whatsapp">, string> = {
  facebook: "Long-lived Page token with pages_messaging, pages_manage_engagement, pages_read_user_content, pages_manage_metadata. Stored encrypted; saving it also subscribes the Page to the webhook. Without it replies are stored only.",
  instagram: "Page token of the Page linked to this Instagram account, with instagram_manage_messages and instagram_manage_comments. Needed to reply and to fetch mentions and tagged posts. Stored encrypted.",
  linkedin: "Token from the Community Management API with r_organization_social, w_organization_social, r_organization_social_feed, w_organization_social_feed and rw_organization_admin (a Page admin must authorize). Leave empty to use the brand's Publishing LinkedIn connection. Tokens expire after 60 days unless your app has refresh tokens.",
};

function SocialDialog({ brand, kind, channel, onClose }: { brand: string; kind: SocialKind; channel?: ChannelRow; onClose: () => void }) {
  const router = useRouter();
  const cfg = (channel?.config ?? {}) as Record<string, unknown>;
  const [name, setName] = useState(channel?.name ?? SOCIAL_NAME[kind]);
  const [accountId, setAccountId] = useState(String(cfg.accountId ?? ""));
  const [token, setToken] = useState("");
  const [humanAgent, setHumanAgent] = useState(!!cfg.humanAgent);
  const [error, setError] = useState<string | null>(null);
  const label = kind === "whatsapp" ? "Phone number id" : kind === "facebook" ? "Facebook Page id" : kind === "instagram" ? "Instagram account id" : "Organization URN";
  const title = kind === "whatsapp" ? "WhatsApp" : kind === "facebook" ? "Facebook" : kind === "instagram" ? "Instagram" : "LinkedIn";
  const description =
    kind === "whatsapp" ? "Messages arrive through the webhook; this maps them to this brand."
    : kind === "linkedin" ? "Comments on your company posts and @mentions of your page are checked every 5 minutes. LinkedIn has no API for page messages."
    : "Messages, comments, mentions and reviews arrive through the webhook; this maps them to this brand.";
  const save = async () => {
    const config: Record<string, unknown> = { accountId: accountId.trim() };
    if (kind === "facebook" || kind === "instagram") config.humanAgent = humanAgent;
    const r = await saveChannelAction(brand, kind, name, config, channel?.id, token || undefined);
    if (r.ok) { onClose(); router.refresh(); } else setError(r.error);
  };
  return (
    <Dialog open onClose={onClose} title={`Connect ${title} inbox`} description={description} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" onClick={save}>Save</Button></>}>
      <div className="space-y-3">
        <Field label="Channel name" htmlFor="s-n"><Input id="s-n" value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <Field label={label} htmlFor="s-a" hint={kind === "linkedin" ? "Like urn:li:organization:123456 (the number is in your page's admin URL)." : undefined}>
          <Input id="s-a" value={accountId} onChange={(e) => setAccountId(e.target.value)} className="font-mono" placeholder={kind === "linkedin" ? "urn:li:organization:123456" : undefined} />
        </Field>
        {kind !== "whatsapp" && (
          <Field label={kind === "linkedin" ? "Access token (optional)" : "Page access token (to send replies)"} htmlFor="s-t" hint={TOKEN_HINT[kind]}>
            <Input id="s-t" type="password" value={token} onChange={(e) => setToken(e.target.value)} autoComplete="off" />
          </Field>
        )}
        {(kind === "facebook" || kind === "instagram") && (
          <label className="flex items-start gap-2 text-[12.5px] text-text-2">
            <input type="checkbox" checked={humanAgent} onChange={(e) => setHumanAgent(e.target.checked)} className="mt-0.5 accent-brand" />
            <span>Human Agent permission approved by Meta: allow DM replies up to 7 days after the customer&apos;s last message (otherwise 24 hours).</span>
          </label>
        )}
        {error && <Callout tone="critical">{error}</Callout>}
      </div>
    </Dialog>
  );
}

