"use client";

import { AtSign, ExternalLink, Link2, Plus, Send, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { addTrackedAction, removeTrackedAction } from "@/app/(app)/cx/mentions-tracker/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/input";
import { normalizePostUrl } from "@/lib/cx/ops/model";
import { platformLabel, TRACK_PLATFORMS } from "@/lib/cx/ops/tracker-model";
import { cn } from "@/lib/utils";

export type TrackedView = { id: string; kind: "handle" | "post"; platform: string; value: string; label: string };
export type PubView = TrackedView & { postId: string; publishedAt: string | null };

/** Tracked handles and post URLs (stored) plus the brand's published posts (derived from Publishing). */
export function TrackerSettings({ brand, handles, posts, published, canEdit }: { brand: string; handles: TrackedView[]; posts: TrackedView[]; published: PubView[]; canEdit: boolean }) {
  const [showAllPub, setShowAllPub] = useState(false);
  const pub = showAllPub ? published : published.slice(0, 5);
  return (
    <Card>
      <CardHeader title="Tracked handles & posts" description="Mentions of these handles and replies linking to these posts are tracked for a response." />
      <CardBody className="space-y-5">
        <section>
          <h3 className="mb-1.5 flex items-center gap-1.5 text-[12.5px] font-semibold text-text-2"><AtSign className="h-3.5 w-3.5" /> Handles <span className="font-normal text-text-3">({handles.length})</span></h3>
          {handles.length === 0 ? (
            <p className="mb-2 text-[12.5px] text-text-3">No handles yet. Add your brand&apos;s social handles (e.g. @acme on X or Mastodon); listening mentions containing &quot;@handle&quot; will show up here.</p>
          ) : (
            <ul className="mb-2 divide-y divide-border rounded-md border border-border">
              {handles.map((h) => <TrackedRow key={h.id} brand={brand} t={h} canEdit={canEdit} />)}
            </ul>
          )}
          {canEdit && <AddForm brand={brand} kind="handle" />}
        </section>
        <section>
          <h3 className="mb-1.5 flex items-center gap-1.5 text-[12.5px] font-semibold text-text-2"><Link2 className="h-3.5 w-3.5" /> Posts <span className="font-normal text-text-3">({posts.length + published.length})</span></h3>
          {posts.length === 0 && published.length === 0 && <p className="mb-2 text-[12.5px] text-text-3">No posts yet. Paste the URL of a post you want to watch; mentions that link to it are tracked. Posts you publish from Publishing are added automatically.</p>}
          {posts.length > 0 && (
            <ul className="mb-2 divide-y divide-border rounded-md border border-border">
              {posts.map((p) => <TrackedRow key={p.id} brand={brand} t={p} canEdit={canEdit} />)}
            </ul>
          )}
          {canEdit && <AddForm brand={brand} kind="post" />}
          {published.length > 0 && (
            <div className="mt-3">
              <div className="mb-1 flex items-center gap-1.5 text-[12px] font-medium text-text-3"><Send className="h-3 w-3" /> From Publishing ({published.length})</div>
              <ul className="divide-y divide-border rounded-md border border-border bg-surface-2">
                {pub.map((p) => (
                  <li key={p.id} className="flex min-w-0 items-center gap-2 px-2.5 py-1.5 text-[12.5px]">
                    <Badge className="shrink-0">{platformLabel(p.platform)}</Badge>
                    <a href={p.value} target="_blank" rel="noopener noreferrer" className="min-w-0 flex-1 truncate text-text hover:text-link" title={p.value}>{p.label}</a>
                    <ExternalLink className="h-3 w-3 shrink-0 text-text-3" aria-hidden />
                  </li>
                ))}
              </ul>
              {published.length > 5 && (
                <button type="button" onClick={() => setShowAllPub((v) => !v)} className="mt-1 text-[12px] text-link hover:underline">{showAllPub ? "Show fewer" : `Show all ${published.length}`}</button>
              )}
            </div>
          )}
        </section>
        {!canEdit && <p className="text-[12px] text-text-3">Viewers can&apos;t change tracked handles or posts.</p>}
      </CardBody>
    </Card>
  );
}

function TrackedRow({ brand, t, canEdit }: { brand: string; t: TrackedView; canEdit: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const display = t.kind === "handle" ? `@${t.value}` : (normalizePostUrl(t.value) ?? t.value);
  return (
    <li className={cn("flex min-w-0 items-center gap-2 px-2.5 py-1.5 text-[12.5px]", pending && "opacity-50")}>
      <Badge className="shrink-0">{platformLabel(t.platform)}</Badge>
      <span className="min-w-0 flex-1">
        {t.kind === "post" ? (
          <a href={t.value} target="_blank" rel="noopener noreferrer" className="block truncate text-text hover:text-link" title={t.value}>{t.label || display}</a>
        ) : (
          <span className="block truncate font-medium text-text">{display}</span>
        )}
        {t.label && <span className="block truncate text-[11.5px] text-text-3">{t.kind === "handle" ? t.label : display}</span>}
        {error && <span className="block text-[11.5px] text-critical-ink">{error}</span>}
      </span>
      {canEdit && (
        <button
          type="button"
          aria-label={`Stop tracking ${display}`}
          title="Stop tracking"
          disabled={pending}
          onClick={() => start(async () => {
            const r = await removeTrackedAction(brand, t.id);
            if (!r.ok) setError(r.error); else router.refresh();
          })}
          className="rounded p-1 text-text-3 hover:bg-surface-3 hover:text-critical-ink"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      )}
    </li>
  );
}

function AddForm({ brand, kind }: { brand: string; kind: "handle" | "post" }) {
  const router = useRouter();
  const [platform, setPlatform] = useState(kind === "handle" ? "x" : "facebook");
  const [value, setValue] = useState("");
  const [label, setLabel] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <form
      className="space-y-1.5"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          setError(null);
          const r = await addTrackedAction(brand, { kind, platform, value, label });
          if (!r.ok) { setError(r.error); return; }
          setValue(""); setLabel("");
          router.refresh();
        });
      }}
    >
      <div className="flex gap-1.5">
        <Select value={platform} onChange={(e) => setPlatform(e.target.value)} className="h-8 w-[118px] shrink-0 text-[12.5px]" aria-label={kind === "handle" ? "Handle platform" : "Post platform"}>
          {TRACK_PLATFORMS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
        </Select>
        <Input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={kind === "handle" ? "@yourbrand" : "https://…/post-url"}
          aria-label={kind === "handle" ? "Handle" : "Post URL"}
          className="h-8 min-w-0 flex-1"
          inputMode={kind === "post" ? "url" : undefined}
        />
      </div>
      <div className="flex gap-1.5">
        <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Label (optional)" aria-label="Label" className="h-8 min-w-0 flex-1" maxLength={80} />
        <Button type="submit" size="sm" className="h-8" loading={pending} disabled={!value.trim()}>
          <Plus className="h-3.5 w-3.5" /> Add {kind === "handle" ? "handle" : "post"}
        </Button>
      </div>
      {error && <p className="text-[12px] text-critical-ink" role="alert">{error}</p>}
    </form>
  );
}
