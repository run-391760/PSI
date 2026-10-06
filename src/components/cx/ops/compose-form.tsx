"use client";

import { Info, Mail, Send } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { composeEmailAction } from "@/app/(app)/cx/compose/actions";
import { ChannelIcon, channelLabel } from "@/components/cx/inbox/ui";
import { AttachButton, PendingFiles, useUploads } from "@/components/cx/inbox/ticket-dialogs";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Callout } from "@/components/ui/feedback";
import { Checkbox, Field, Input, Select, Textarea } from "@/components/ui/input";
import { blockedRecipients, parseAddresses } from "@/lib/cx/inbox/model";
import { cn } from "@/lib/utils";

type Ch = { id: string; kind: string; name: string; status: string; from_address: string | null; canStart: boolean; how: string; needs: string | null };

export function ComposeForm({ brand, me, readOnly, channels, agents, allowedDomains, hasSignature, suggestions, initial, emailSetup }: {
  brand: string; me: { id: string; name: string }; readOnly: boolean; channels: Ch[]; agents: { id: string; name: string }[]; allowedDomains: string[];
  hasSignature: boolean; suggestions: string[]; initial: { to: string; name: string; subject: string }; emailSetup: { api: string; setup: string };
}) {
  const router = useRouter();
  const firstEmail = channels.find((c) => c.kind === "email" && c.canStart);
  const [channelId, setChannelId] = useState(firstEmail?.id ?? channels[0]?.id ?? "");
  const [f, setF] = useState({ to: initial.to, cc: "", bcc: "", name: initial.name, subject: initial.subject, body: "", priority: "normal" as "low" | "normal" | "high" | "urgent", assigneeId: me.id, tags: "", signature: hasSignature });
  const [showCc, setShowCc] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ ticketId: string; number: number; delivery: string; error: string | null } | null>(null);
  const [busy, setBusy] = useState(false);
  const uploads = useUploads(brand);
  const ch = channels.find((c) => c.id === channelId) ?? null;
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));
  const addrs = parseAddresses([f.to, f.cc, f.bcc]);
  const blocked = blockedRecipients(addrs.valid, allowedDomains);
  const send = async () => {
    if (!ch) return;
    setBusy(true); setError(null); setDone(null);
    const r = await composeEmailAction(brand, { channelId: ch.id, to: f.to, cc: f.cc, bcc: f.bcc, name: f.name, subject: f.subject, body: f.body, priority: f.priority, assigneeId: f.assigneeId || null, includeSignature: f.signature, attachmentIds: uploads.ids, tags: f.tags.split(/[,\s]+/).filter(Boolean) });
    setBusy(false);
    if (!r.ok) return setError(r.error);
    setDone(r.data);
    uploads.clear();
    setF((x) => ({ ...x, to: "", cc: "", bcc: "", name: "", subject: "", body: "", tags: "" }));
    router.refresh();
  };
  return (
    <Card className="h-fit">
      <CardHeader title="New conversation" description="Pick the channel, write the message, send. The ticket is assigned to you unless you choose someone else." />
      <CardBody className="space-y-3 pt-0">
        {channels.length === 0 ? (
          <Callout tone="info" title="Connect a channel to compose" action={<Link href={`/cx/settings/channels?brand=${brand}`} className="text-[12.5px] text-link hover:underline">Settings → Channels →</Link>}>
            Email is the channel that allows starting conversations: {emailSetup.api}. {emailSetup.setup}
          </Callout>
        ) : (
          <>
            <Field label="Channel" htmlFor="cm-ch">
              <Select id="cm-ch" value={channelId} onChange={(e) => setChannelId(e.target.value)}>
                {channels.map((c) => <option key={c.id} value={c.id}>{c.name} · {channelLabel(c.kind)}{c.kind === "email" && c.from_address ? ` (${c.from_address})` : ""}{c.canStart ? "" : " (reply only)"}</option>)}
              </Select>
            </Field>
            {ch && !ch.canStart && (
              <Callout tone="warning" title={`${channelLabel(ch.kind)} can't start conversations`}>
                {ch.status === "paused" ? "This channel is paused. " : ""}{ch.how}{ch.needs ? ` Needs: ${ch.needs}` : ""}
                {!firstEmail && <> To start a conversation now, <Link href={`/cx/settings/channels?brand=${brand}`} className="text-link hover:underline">connect an email mailbox</Link>.</>}
              </Callout>
            )}
            {!firstEmail && ch?.kind !== "email" && (
              <p className="flex items-start gap-1.5 text-[12.5px] text-text-3"><Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />No email mailbox is connected. {emailSetup.setup}</p>
            )}
          </>
        )}
        {ch?.kind === "email" && ch.canStart && (
          <>
            <div className="grid gap-3 sm:grid-cols-[1fr_200px]">
              <Field label="To" htmlFor="cm-to" error={addrs.invalid.length ? `Not valid: ${addrs.invalid.join(", ")}` : blocked.length ? `Not allowed by ticket settings: ${blocked.join(", ")}` : undefined}>
                <Input id="cm-to" type="text" list="cm-sugg" value={f.to} onChange={(e) => set("to", e.target.value)} placeholder="customer@example.com" autoComplete="off" />
              </Field>
              <Field label="Customer name" htmlFor="cm-name"><Input id="cm-name" value={f.name} onChange={(e) => set("name", e.target.value)} placeholder="Optional" /></Field>
            </div>
            <datalist id="cm-sugg">{suggestions.map((s) => <option key={s} value={s} />)}</datalist>
            {!showCc ? <button type="button" className="-mt-1 text-[12px] text-link hover:underline" onClick={() => setShowCc(true)}>Add Cc / Bcc</button> : (
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Cc" htmlFor="cm-cc"><Input id="cm-cc" list="cm-sugg" value={f.cc} onChange={(e) => set("cc", e.target.value)} /></Field>
                <Field label="Bcc" htmlFor="cm-bcc"><Input id="cm-bcc" list="cm-sugg" value={f.bcc} onChange={(e) => set("bcc", e.target.value)} /></Field>
              </div>
            )}
            <Field label="Subject" htmlFor="cm-sub" hint="The ticket number is added to the subject, e.g. “… [#42]”, so replies thread back."><Input id="cm-sub" value={f.subject} onChange={(e) => set("subject", e.target.value)} maxLength={250} /></Field>
            <Field label="Message" htmlFor="cm-body">
              <Textarea id="cm-body" rows={9} value={f.body} onChange={(e) => set("body", e.target.value)} placeholder="Write your message. Links like [label](https://…) are supported." />
            </Field>
            <div className="flex flex-wrap items-center gap-2">
              <AttachButton uploads={uploads} />
              <label className={cn("flex items-center gap-1.5 text-[12.5px]", hasSignature ? "text-text" : "text-text-3")} title={hasSignature ? "" : "Set a signature in My profile or Inbox settings"}><Checkbox checked={f.signature} disabled={!hasSignature} onChange={(e) => set("signature", e.target.checked)} />Add my signature</label>
            </div>
            <PendingFiles uploads={uploads} />
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Priority" htmlFor="cm-pr">
                <Select id="cm-pr" value={f.priority} onChange={(e) => set("priority", e.target.value as typeof f.priority)}>
                  {["low", "normal", "high", "urgent"].map((p) => <option key={p} value={p}>{p[0].toUpperCase() + p.slice(1)}</option>)}
                </Select>
              </Field>
              <Field label="Assignee" htmlFor="cm-as">
                <Select id="cm-as" value={f.assigneeId} onChange={(e) => set("assigneeId", e.target.value)}>
                  {agents.map((a) => <option key={a.id} value={a.id}>{a.id === me.id ? `${a.name} (me)` : a.name}</option>)}
                </Select>
              </Field>
              <Field label="Tags" htmlFor="cm-tags" hint="“outbound” is added automatically."><Input id="cm-tags" value={f.tags} onChange={(e) => set("tags", e.target.value)} placeholder="e.g. admissions" /></Field>
            </div>
            {error && <Callout tone="critical">{error}</Callout>}
            {done && (
              <Callout tone={done.delivery === "sent" ? "good" : "warning"} title={done.delivery === "sent" ? `Sent · ticket #${done.number} created` : `Ticket #${done.number} created, but the email was not sent`}
                action={<Link href={`/cx/inbox?brand=${brand}&view=all&t=${done.ticketId}`} className="text-[12.5px] text-link hover:underline">Open ticket →</Link>}>
                {done.delivery === "sent" ? "The customer's reply will thread into this ticket." : `${done.error ?? "Delivery failed."} Fix the mailbox in Settings → Channels and resend from the ticket.`}
              </Callout>
            )}
            <div className="flex justify-end">
              <Button variant="primary" disabled={busy || readOnly || !addrs.valid.length || addrs.invalid.length > 0 || blocked.length > 0 || uploads.busy} loading={busy} onClick={send}>{!busy && <Send className="h-3.5 w-3.5" />}Send and create ticket</Button>
            </div>
          </>
        )}
        {ch && ch.kind !== "email" && channels.some((c) => c.kind === "email" && c.canStart) && (
          <Button onClick={() => setChannelId(firstEmail!.id)}><Mail className="h-3.5 w-3.5" />Switch to {firstEmail!.name}</Button>
        )}
        {ch?.canStart && <div className="flex items-center gap-1.5 text-[11.5px] text-text-3"><ChannelIcon kind={ch.kind} />{ch.how}</div>}
      </CardBody>
    </Card>
  );
}
