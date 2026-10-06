"use client";

import { Check, Copy, Link2, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { createLinkAction, deleteLinkAction } from "@/app/(app)/cx/publishing/actions";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/ui/confirm";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { DataTable, type Column } from "@/components/ui/data-table";
import { Callout } from "@/components/ui/feedback";
import { Field, Input, Select } from "@/components/ui/input";
import { buildUtmUrl, type Utm } from "@/lib/cx/publishing/core";
import { LocalTime } from "./posts-table";

export function CopyButton({ text, label }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <Button
      size={label ? "sm" : "icon"}
      variant="ghost"
      title="Copy"
      onClick={() => {
        navigator.clipboard?.writeText(text).then(() => {
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        }, () => {});
      }}
    >
      {done ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
      {label}
    </Button>
  );
}

/** UTM builder + built-in shortener. */
export function LinkBuilder({ brandId, campaigns }: { brandId: string; campaigns: { id: string; name: string }[] }) {
  const router = useRouter();
  const [url, setUrl] = useState("");
  const [utm, setUtm] = useState<Utm>({ source: "", medium: "social", campaign: "", term: "", content: "" });
  const [label, setLabel] = useState("");
  const [campaignId, setCampaignId] = useState("");
  const [created, setCreated] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const preview = useMemo(() => {
    if (!url.trim()) return null;
    try {
      return buildUtmUrl(url, utm);
    } catch (e) {
      return e instanceof Error ? `⚠ ${e.message}` : null;
    }
  }, [url, utm]);
  const set = (k: keyof Utm) => (e: React.ChangeEvent<HTMLInputElement>) => setUtm({ ...utm, [k]: e.target.value });
  return (
    <Card>
      <CardHeader title="UTM builder & short link" description="Every click on a short link is counted (bots excluded) and shown in Social analytics." />
      <CardBody className="grid gap-3">
        <Field label="Destination URL" htmlFor="lk-url">
          <Input id="lk-url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://example.com/landing" />
        </Field>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="utm_source" htmlFor="lk-s"><Input id="lk-s" value={utm.source} onChange={set("source")} placeholder="linkedin" /></Field>
          <Field label="utm_medium" htmlFor="lk-m"><Input id="lk-m" value={utm.medium} onChange={set("medium")} /></Field>
          <Field label="utm_campaign" htmlFor="lk-c"><Input id="lk-c" value={utm.campaign} onChange={set("campaign")} placeholder="autumn-launch" /></Field>
          <Field label="utm_term" htmlFor="lk-t"><Input id="lk-t" value={utm.term} onChange={set("term")} /></Field>
          <Field label="utm_content" htmlFor="lk-co"><Input id="lk-co" value={utm.content} onChange={set("content")} /></Field>
          <Field label="Campaign" htmlFor="lk-camp">
            <Select id="lk-camp" value={campaignId} onChange={(e) => setCampaignId(e.target.value)}>
              <option value="">None</option>
              {campaigns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
          </Field>
        </div>
        <Field label="Label (optional)" htmlFor="lk-l"><Input id="lk-l" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Newsletter CTA" /></Field>
        {preview && <p className="rounded-md bg-surface-2 px-3 py-2 font-mono text-[12px] break-all text-text-2">{preview}</p>}
        {error && <Callout tone="critical">{error}</Callout>}
        {created && (
          <Callout tone="good" title="Short link created" action={<CopyButton text={created} label="Copy" />}>
            <span className="font-mono break-all">{created}</span>
          </Callout>
        )}
        <div>
          <Button
            variant="primary"
            disabled={pending || !url.trim()}
            onClick={() =>
              start(async () => {
                const r = await createLinkAction(brandId, { url, utm, label, campaignId: campaignId || null });
                if (!r.ok) return setError(r.error);
                setError(null);
                setCreated(r.data.short);
                router.refresh();
              })
            }
          >
            <Link2 className="h-4 w-4" /> Shorten
          </Button>
        </div>
      </CardBody>
    </Card>
  );
}

export type LinkItem = { id: string; code: string; short: string; target_url: string; label: string; channel: string | null; campaign: string | null; post_id: string | null; created_at: string; clicks: number; clicks_7d: number; last_click: string | null };

export function LinksTable({ brandId, rows }: { brandId: string; rows: LinkItem[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const { confirm, confirmDialog } = useConfirm();
  const cols: Column<LinkItem>[] = [
    {
      key: "short",
      header: "Short link",
      sortValue: (r) => r.code,
      render: (r) => (
        <span className="flex items-center gap-1">
          <a href={r.short} target="_blank" rel="noreferrer" className="font-mono text-[12.5px] text-link hover:underline">/l/{r.code}</a>
          <CopyButton text={r.short} />
        </span>
      ),
      csv: (r) => r.short,
    },
    {
      key: "target",
      header: "Destination",
      sortValue: (r) => r.target_url,
      render: (r) => (
        <span className="block max-w-[380px] min-w-[160px]">
          {r.label && <span className="block truncate font-medium">{r.label}</span>}
          <span className="block truncate text-[12px] text-text-3" title={r.target_url}>{r.target_url}</span>
        </span>
      ),
      csv: (r) => r.target_url,
    },
    { key: "channel", header: "Source", hideOnMobile: true, sortValue: (r) => r.channel ?? "", render: (r) => r.channel ?? <span className="text-text-3">—</span> },
    { key: "campaign", header: "Campaign", hideOnMobile: true, sortValue: (r) => r.campaign ?? "", render: (r) => r.campaign ?? <span className="text-text-3">—</span> },
    { key: "clicks", header: "Clicks", align: "right", sortValue: (r) => r.clicks, render: (r) => r.clicks.toLocaleString("en-US") },
    { key: "clicks_7d", header: "7 days", align: "right", sortValue: (r) => r.clicks_7d, render: (r) => r.clicks_7d.toLocaleString("en-US") },
    { key: "last", header: "Last click", hideOnMobile: true, sortValue: (r) => r.last_click ?? "", render: (r) => <LocalTime iso={r.last_click} empty="Never" /> },
    {
      key: "x",
      header: "",
      sortable: false,
      noExport: true,
      render: (r) => (
        <Button size="icon" variant="ghost" title="Delete link (stops redirecting)" disabled={pending} onClick={async () => (await confirm({ title: "Delete this short link?", description: `/l/${r.code} stops redirecting.` })) && start(async () => { await deleteLinkAction(brandId, r.id); router.refresh(); })}>
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      ),
    },
  ];
  return (
    <>
      <DataTable rows={rows} columns={cols} rowKey={(r) => r.id} searchable searchText={(r) => `${r.code} ${r.label} ${r.target_url} ${r.campaign ?? ""}`} exportName="short-links" defaultSort={{ key: "clicks", dir: "desc" }} emptyText="No short links yet. Create one above or add a link to a post." />
      {confirmDialog}
    </>
  );
}
