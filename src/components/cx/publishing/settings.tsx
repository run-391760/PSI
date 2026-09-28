"use client";

import { Trash2, UserPlus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { addMemberAction, removeAccountAction, removeMemberAction, saveAccountAction, setRequireApprovalAction } from "@/app/(app)/cx/publishing/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Callout } from "@/components/ui/feedback";
import { Checkbox, Field, Input, Select } from "@/components/ui/input";
import { ChannelChip } from "./shared";

export type ConnectionItem = { kind: string; name: string; api: string; costNote: string; env: string[]; setup: string; envReady: boolean; account: string | null; connected: boolean; reason: string | null; publishApi: boolean; label: string };

const ID_HINT: Record<string, { label: string; placeholder: string; token: string | null; help: string }> = {
  facebook: { label: "Page ID", placeholder: "104857389201234", token: "Page access token", help: "Long-lived Page token with pages_manage_posts + pages_read_engagement." },
  instagram: { label: "Instagram business account ID", placeholder: "17841400000000000", token: "Page access token (of the linked Page)", help: "Needs instagram_content_publish + instagram_basic." },
  linkedin: { label: "Author URN", placeholder: "urn:li:organization:123456", token: "Access token", help: "Member token with w_organization_social (+ r_organization_social for analytics)." },
  x: { label: "User ID", placeholder: "2244994945", token: "OAuth 2.0 user access token", help: "User-context token with tweet.write, tweet.read, users.read, media.write (also used for analytics)." },
  youtube: { label: "Channel ID or @handle", placeholder: "UC_x5XG1OV2P6uZZ5FSM9Ttw", token: "OAuth upload token (optional)", help: "Channel analytics use the YouTube Data API key. Video uploads (reel posts) need an OAuth token with the youtube.upload scope." },
  threads: { label: "Threads user ID", placeholder: "17841400000000000", token: "Threads access token", help: "Long-lived token with threads_basic, threads_content_publish (and threads_delete to delete posts)." },
  gbp: { label: "Location", placeholder: "accounts/123/locations/456", token: "OAuth access token", help: "Token with the business.manage scope for this location." },
};

function run(start: (fn: () => Promise<void>) => void, fn: () => Promise<{ ok: boolean; error?: string }>, setError: (e: string | null) => void, done: () => void) {
  start(async () => {
    const r = await fn();
    if (!r.ok) setError(r.error ?? "Failed.");
    else {
      setError(null);
      done();
    }
  });
}

function AccountForm({ brandId, c, canEdit }: { brandId: string; c: ConnectionItem; canEdit: boolean }) {
  const router = useRouter();
  const h = ID_HINT[c.kind];
  const [id, setId] = useState(c.account ?? "");
  const [token, setToken] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  if (!canEdit) return null;
  return (
    <div className="mt-3 grid gap-2 border-t border-border pt-3">
      <div className="grid gap-2 sm:grid-cols-2">
        <Field label={h.label} htmlFor={`acc-${c.kind}`}>
          <Input id={`acc-${c.kind}`} value={id} onChange={(e) => setId(e.target.value)} placeholder={h.placeholder} />
        </Field>
        {h.token && (
          <Field label={h.token} htmlFor={`tok-${c.kind}`} hint={c.account ? "Leave empty to keep the stored token." : undefined}>
            <Input id={`tok-${c.kind}`} type="password" autoComplete="off" value={token} onChange={(e) => setToken(e.target.value)} placeholder="Stored encrypted" />
          </Field>
        )}
      </div>
      <p className="text-[12px] text-text-3">{h.help}</p>
      {error && <Callout tone="critical">{error}</Callout>}
      <div className="flex gap-2">
        <Button size="sm" variant="primary" disabled={pending || !id.trim()} onClick={() => run(start, () => saveAccountAction(brandId, c.kind, id, "", token), setError, () => { setToken(""); router.refresh(); })}>
          Save account
        </Button>
        {c.account && (
          <Button size="sm" variant="ghost" disabled={pending} onClick={() => confirm(`Unlink ${c.name}?`) && run(start, () => removeAccountAction(brandId, c.kind), setError, () => { setId(""); router.refresh(); })}>
            Unlink
          </Button>
        )}
      </div>
    </div>
  );
}

export function ConnectionsPanel({ brandId, items, canEdit }: { brandId: string; items: ConnectionItem[]; canEdit: boolean }) {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      {items.map((c) => (
        <Card key={c.kind}>
          <CardHeader
            title={<span className="flex items-center gap-2"><ChannelChip kind={c.kind} /> {c.name}</span>}
            description={`${c.api} · ${c.costNote}`}
            actions={<Badge tone={c.connected ? "good" : c.envReady ? "warning" : "neutral"}>{c.connected ? "Connected" : c.envReady ? "Account needed" : "Not connected"}</Badge>}
          />
          <CardBody className="text-[12.5px] text-text-2">
            <ul className="grid gap-1">
              <li>Publishing: {c.publishApi ? (c.connected ? "automatic at the scheduled time" : "posts can be planned and scheduled; they are marked “channel not connected” when due") : "no public API — publish manually and mark the post as published"}</li>
              <li>Analytics: {c.connected ? "live from the API" : "shown once connected"}</li>
              {c.account && <li>Account: <span className="font-mono">{c.account}</span></li>}
            </ul>
            {!c.envReady && (
              <p className="mt-2">
                Server settings: {c.env.map((e) => <code key={e} className="mx-0.5 rounded bg-surface-3 px-1 py-0.5 text-text-2">{e}</code>)} — {c.setup}
              </p>
            )}
            <AccountForm brandId={brandId} c={c} canEdit={canEdit} />
          </CardBody>
        </Card>
      ))}
    </div>
  );
}

export type MemberItem = { user_id: string; name: string; email: string; team_role: string | null; roles: string[]; owner: boolean; explicit: string[] };

export function RolesPanel({ brandId, members, requireApproval, isOwner }: { brandId: string; members: MemberItem[]; requireApproval: boolean; isOwner: boolean }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"author" | "approver" | "tagger">("approver");
  const [req, setReq] = useState(requireApproval);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <Card>
      <CardHeader title="Approval workflow & roles" description="Authors write and submit posts; approvers approve or request changes (pick several on a post to require all of them). Tag managers curate content tags. CX team admins/supervisors are approvers, agents are authors." />
      <CardBody className="grid gap-4">
        <label className="flex items-start gap-2 text-[13px]">
          <Checkbox
            className="mt-0.5"
            checked={req}
            disabled={!isOwner}
            onChange={(e) => {
              const on = e.target.checked;
              setReq(on);
              run(start, () => setRequireApprovalAction(brandId, on), (err) => { setError(err); if (err) setReq(!on); }, () => router.refresh());
            }}
          />
          <span>
            <span className="font-medium">Require approval before scheduling</span>
            <span className="block text-[12px] text-text-3">When on, posts must be approved first, and editing an approved post sends it back for approval.</span>
          </span>
        </label>
        <div className="divide-y divide-border rounded-md border border-border">
          {members.map((m) => (
            <div key={m.user_id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-[13px]">
              <span className="min-w-0">
                <span className="font-medium">{m.name}</span> <span className="text-text-3">{m.email}</span>
                {m.team_role && <span className="ml-1 text-[12px] text-text-3">· {m.owner ? "owner" : `team ${m.team_role}`}</span>}
              </span>
              <span className="flex flex-wrap items-center gap-1">
                {m.roles.map((r) => <Badge key={r} tone={r === "approver" ? "brand" : "neutral"}>{r === "tagger" ? "tag manager" : r}</Badge>)}
                {!m.roles.length && <Badge>read-only</Badge>}
                {isOwner &&
                  m.explicit.map((r) => (
                    <Button key={r} size="sm" variant="ghost" title={`Remove explicit ${r} role`} disabled={pending} onClick={() => run(start, () => removeMemberAction(brandId, m.user_id, r), setError, () => router.refresh())}>
                      <Trash2 className="h-3.5 w-3.5" /> {r === "tagger" ? "tag manager" : r}
                    </Button>
                  ))}
              </span>
            </div>
          ))}
        </div>
        {isOwner && (
          <div className="flex flex-wrap items-end gap-2">
            <Field label="Add by email" htmlFor="role-email" className="min-w-52 flex-1">
              <Input id="role-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="colleague@company.com" />
            </Field>
            <Select value={role} onChange={(e) => setRole(e.target.value as "author" | "approver" | "tagger")} aria-label="Role" className="w-40">
              <option value="approver">Approver</option>
              <option value="author">Author</option>
              <option value="tagger">Tag manager</option>
            </Select>
            <Button disabled={pending || !email.trim()} onClick={() => run(start, () => addMemberAction(brandId, email, role), setError, () => { setEmail(""); router.refresh(); })}>
              <UserPlus className="h-4 w-4" /> Add
            </Button>
          </div>
        )}
        {error && <Callout tone="critical">{error}</Callout>}
      </CardBody>
    </Card>
  );
}
