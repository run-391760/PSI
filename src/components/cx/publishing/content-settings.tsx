"use client";

import { X as XIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { saveContentTagsAction, savePubSettingsAction } from "@/app/(app)/cx/publishing/actions";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Callout } from "@/components/ui/feedback";
import { Checkbox, Field, Input, Select } from "@/components/ui/input";
import { normTag } from "@/lib/cx/publishing/options";

type S = { tagPolicy: "authors" | "managers"; contentTags: string[]; failureEmail: boolean; quotaMb: number; requireAssetApproval: boolean };

/** Content tags + permissions, asset approval + storage quota, failed-post email. */
export function ContentSettingsPanel({ brandId, isOwner, isTagManager, settings, usage }: { brandId: string; isOwner: boolean; isTagManager: boolean; settings: S; usage: Record<string, number> }) {
  const router = useRouter();
  const [tags, setTags] = useState(settings.contentTags);
  const [text, setText] = useState("");
  const [quota, setQuota] = useState(String(settings.quotaMb));
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, msg: string) =>
    start(async () => {
      const r = await fn();
      if (!r.ok) {
        setError(r.error ?? "Failed.");
        setSaved(null);
      } else {
        setError(null);
        setSaved(msg);
        router.refresh();
      }
    });
  const saveTags = (next: string[]) => {
    setTags(next);
    run(() => saveContentTagsAction(brandId, next), "Tag list saved.");
  };
  return (
    <Card>
      <CardHeader title="Content tags, assets & alerts" description="Who may tag posts, which assets can be used, storage, and failed-post alerts." />
      <CardBody className="grid gap-5">
        <div className="grid gap-2">
          <span className="text-[13px] font-medium">Content tags</span>
          <div className="flex flex-wrap gap-1">
            {tags.length ? (
              tags.map((t) => (
                <span key={t} className="inline-flex items-center gap-1 rounded-full bg-surface-3 px-2 py-0.5 text-[12px]">
                  #{t} <span className="text-text-3">{usage[t] ?? 0}</span>
                  {isTagManager && (
                    <button type="button" aria-label={`Remove ${t}`} disabled={pending} onClick={() => saveTags(tags.filter((x) => x !== t))}>
                      <XIcon className="h-3 w-3" />
                    </button>
                  )}
                </span>
              ))
            ) : (
              <span className="text-[12.5px] text-text-3">No tags defined yet.</span>
            )}
          </div>
          {isTagManager && (
            <form
              className="flex max-w-md gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                const n = normTag(text);
                if (n && !tags.includes(n)) saveTags([...tags, n]);
                setText("");
              }}
            >
              <Input value={text} onChange={(e) => setText(e.target.value)} placeholder="New tag, e.g. product-launch" aria-label="New content tag" />
              <Button type="submit" disabled={pending || !text.trim()}>Add</Button>
            </form>
          )}
          <Field label="Who can tag posts" htmlFor="tag-policy" className="max-w-md">
            <Select id="tag-policy" disabled={!isOwner || pending} value={settings.tagPolicy} onChange={(e) => run(() => savePubSettingsAction(brandId, { tagPolicy: e.target.value as S["tagPolicy"] }), "Tag permissions saved.")}>
              <option value="authors">Authors pick existing tags; managers can create tags</option>
              <option value="managers">Only content-tag managers can add or change tags</option>
            </Select>
          </Field>
          <p className="text-[12px] text-text-3">Content-tag managers: the owner, CX team admins and people with the “tag manager” role (Approval workflow & roles).</p>
        </div>

        <div className="grid gap-2 border-t border-border pt-4">
          <span className="text-[13px] font-medium">Assets</span>
          <label className="flex items-start gap-2 text-[13px]">
            <Checkbox className="mt-0.5" disabled={!isOwner || pending} defaultChecked={settings.requireAssetApproval} onChange={(e) => run(() => savePubSettingsAction(brandId, { requireAssetApproval: e.target.checked }), "Asset approval setting saved.")} />
            <span>
              Only approved assets can be attached to posts
              <span className="block text-[12px] text-text-3">Authors send assets for approval from the asset library; approvers approve or reject them.</span>
            </span>
          </label>
          <div className="flex flex-wrap items-end gap-2">
            <Field label="Storage quota (MB)" htmlFor="quota" hint="Default 1,024 MB (1 GB) per brand." className="w-48">
              <Input id="quota" type="number" min={10} value={quota} disabled={!isOwner} onChange={(e) => setQuota(e.target.value)} />
            </Field>
            {isOwner && (
              <Button disabled={pending || Number(quota) === settings.quotaMb} onClick={() => run(() => savePubSettingsAction(brandId, { quotaMb: Number(quota) }), "Quota saved.")}>
                Save quota
              </Button>
            )}
          </div>
        </div>

        <div className="grid gap-2 border-t border-border pt-4">
          <span className="text-[13px] font-medium">Failed posts</span>
          <label className="flex items-start gap-2 text-[13px]">
            <Checkbox className="mt-0.5" disabled={!isOwner || pending} defaultChecked={settings.failureEmail} onChange={(e) => run(() => savePubSettingsAction(brandId, { failureEmail: e.target.checked }), "Alert setting saved.")} />
            <span>
              Email the author, owner and approvers when a post fails
              <span className="block text-[12px] text-text-3">Sent from the brand’s email channel (CX Settings → Channels). In-app alerts are always sent.</span>
            </span>
          </label>
        </div>
        {error && <Callout tone="critical">{error}</Callout>}
        {saved && <p className="text-[12.5px] text-good-ink">{saved}</p>}
      </CardBody>
    </Card>
  );
}
