"use client";

import { Check, EyeOff, ExternalLink, MailOpen, Tag, Ticket, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { bulkMentionsAction, createTicketAction, labelMentionAction } from "@/app/(app)/cx/listening/actions";
import { Badge, type Tone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/feedback";
import { Checkbox, Input } from "@/components/ui/input";
import { compact, dateTimeLabel, timeAgo } from "@/lib/format";
import { INTENTS, SENTIMENTS, languageName } from "@/lib/cx/listening/sources";
import { cn } from "@/lib/utils";
import { SourceIcon } from "./source-icon";
import { KIND_TONE } from "./topics-manager";

export type FeedMention = {
  id: string;
  topic_name: string | null;
  topic_kind: string | null;
  source: string;
  url: string | null;
  author: string;
  author_handle: string | null;
  author_followers: number | null;
  title: string;
  body: string;
  language: string | null;
  /** English translation of an Indian-language mention (Sarvam AI). */
  translation?: string | null;
  published_at: string | null;
  sentiment: string | null;
  intent: string | null;
  engagement: Record<string, number>;
  status: "new" | "read" | "actioned" | "ignored";
  tags: string[];
  ticket_id: string | null;
  ticket_number: number | null;
};

const SENT_TONE: Record<string, Tone> = { positive: "good", neutral: "neutral", negative: "critical" };
const chip = "h-6 rounded-md border px-1.5 text-[12px] font-medium focus:outline-none cursor-pointer";
const SENT_CLASS: Record<string, string> = {
  positive: "border-transparent bg-good-soft text-good-ink",
  neutral: "border-border bg-surface-2 text-text-2",
  negative: "border-transparent bg-critical-soft text-critical-ink",
};

export function MentionsFeed({ brandId, mentions }: { brandId: string; mentions: FeedMention[] }) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [tag, setTag] = useState("");
  const [labels, setLabels] = useState<Record<string, { sentiment?: string; intent?: string }>>({});

  const toggle = (id: string) =>
    setSelected((cur) => {
      const n = new Set(cur);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const all = mentions.length > 0 && selected.size === mentions.length;

  const bulk = async (op: "read" | "new" | "ignored" | "tag", ids = [...selected]) => {
    if (!ids.length) return;
    setBusy(op);
    setError(null);
    const r = await bulkMentionsAction(brandId, ids, op, op === "tag" ? tag.trim() : undefined);
    setBusy(null);
    if (!r.ok) return setError(r.error);
    setNotice(`${r.data.count} ${r.data.count === 1 ? "mention" : "mentions"} updated.`);
    setSelected(new Set());
    if (op === "tag") setTag("");
    router.refresh();
  };

  const label = async (id: string, patch: { sentiment?: string; intent?: string }) => {
    setLabels((cur) => ({ ...cur, [id]: { ...cur[id], ...patch } }));
    const r = await labelMentionAction(brandId, id, patch);
    if (!r.ok) setError(r.error);
  };

  const ticket = async (id: string) => {
    setBusy(`ticket:${id}`);
    setError(null);
    const r = await createTicketAction(brandId, id);
    setBusy(null);
    if (!r.ok) return setError(r.error);
    setNotice(r.data.existing ? `Already linked to ticket #${r.data.number}.` : `Ticket #${r.data.number} created in the inbox.`);
    router.refresh();
  };

  return (
    <div>
      <div className="sticky top-0 z-10 mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-border bg-surface px-3 py-2 shadow-card">
        <label className="flex items-center gap-2 text-[12.5px] text-text-2">
          <Checkbox checked={all} onChange={() => setSelected(all ? new Set() : new Set(mentions.map((m) => m.id)))} aria-label="Select all on this page" />
          {selected.size ? `${selected.size} selected` : "Select"}
        </label>
        <div className="flex flex-wrap items-center gap-1.5">
          <Button size="sm" disabled={busy === "read" || !selected.size} loading={busy === "read"} onClick={() => bulk("read")}>
            <MailOpen className="h-3.5 w-3.5" /> Mark read
          </Button>
          <Button size="sm" disabled={busy === "new" || !selected.size} loading={busy === "new"} onClick={() => bulk("new")}>
            Mark unread
          </Button>
          <Button size="sm" disabled={busy === "ignored" || !selected.size} loading={busy === "ignored"} onClick={() => bulk("ignored")}>
            <EyeOff className="h-3.5 w-3.5" /> Ignore
          </Button>
          <form
            className="flex items-center gap-1"
            onSubmit={(e) => {
              e.preventDefault();
              bulk("tag");
            }}
          >
            <Input value={tag} onChange={(e) => setTag(e.target.value)} placeholder="Tag" maxLength={40} className="h-7 w-28 text-[12.5px]" aria-label="Tag name" />
            <Button size="sm" type="submit" disabled={busy === "tag" || !selected.size || !tag.trim()} loading={busy === "tag"}>
              <Tag className="h-3.5 w-3.5" /> Tag
            </Button>
          </form>
        </div>
        {notice && (
          <span className="ml-auto flex items-center gap-1 text-[12.5px] text-good-ink">
            <Check className="h-3.5 w-3.5" /> {notice}
            <button onClick={() => setNotice(null)} aria-label="Dismiss" className="text-text-3 hover:text-text">
              <X className="h-3.5 w-3.5" />
            </button>
          </span>
        )}
      </div>
      {error && <Callout tone="critical" className="mb-3">{error}</Callout>}
      <ul className="grid grid-cols-1 gap-2.5">
        {mentions.map((m) => {
          const sentiment = labels[m.id]?.sentiment ?? m.sentiment ?? "neutral";
          const intent = labels[m.id]?.intent ?? m.intent ?? "other";
          const eng = Object.entries(m.engagement ?? {}).filter(([, v]) => v != null);
          return (
            <li
              key={m.id}
              className={cn(
                "min-w-0 overflow-hidden rounded-lg border bg-surface p-3.5 shadow-card",
                selected.has(m.id) ? "border-brand" : "border-border",
                m.status === "ignored" && "opacity-60",
              )}
            >
              <div className="flex gap-3">
                <Checkbox checked={selected.has(m.id)} onChange={() => toggle(m.id)} aria-label="Select mention" className="mt-1" />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[12.5px]">
                    <SourceIcon source={m.source} />
                    <span className="font-medium text-text">{m.author}</span>
                    {m.author_handle && <span className="max-w-48 truncate text-text-3">{m.author_handle}</span>}
                    {m.author_followers != null && <span className="text-text-3">{compact(m.author_followers)} followers</span>}
                    <span className="text-text-3" title={m.published_at ? dateTimeLabel(m.published_at) : undefined}>
                      · {m.published_at ? timeAgo(m.published_at) : "date n/a"}
                    </span>
                    {m.status === "new" && <Badge tone="brand">New</Badge>}
                    {m.status === "ignored" && <Badge>Ignored</Badge>}
                  </div>
                  {m.title && <div className="mt-1.5 text-[14px] leading-snug font-semibold [overflow-wrap:anywhere] text-text">{m.title}</div>}
                  {m.body && <p className="mt-1 line-clamp-4 text-[13px] leading-relaxed [overflow-wrap:anywhere] text-text-2">{m.body}</p>}
                  {m.translation && (
                    <p className="mt-1.5 line-clamp-4 border-l-2 border-border-strong pl-2 text-[12.5px] leading-relaxed [overflow-wrap:anywhere] text-text-2">
                      <span className="mr-1 text-[11px] font-semibold tracking-wide text-text-3 uppercase">English · Sarvam AI</span>
                      {m.translation}
                    </p>
                  )}
                  <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                    <select
                      value={sentiment}
                      onChange={(e) => label(m.id, { sentiment: e.target.value })}
                      className={cn(chip, SENT_CLASS[sentiment])}
                      aria-label="Sentiment"
                    >
                      {SENTIMENTS.map((s) => (
                        <option key={s} value={s}>
                          {s[0].toUpperCase() + s.slice(1)}
                        </option>
                      ))}
                    </select>
                    <select value={intent} onChange={(e) => label(m.id, { intent: e.target.value })} className={cn(chip, "border-border bg-surface-2 text-text-2")} aria-label="Intent">
                      {Object.entries(INTENTS).map(([k, v]) => (
                        <option key={k} value={k}>
                          {v}
                        </option>
                      ))}
                    </select>
                    {m.topic_name && <Badge tone={KIND_TONE[m.topic_kind ?? ""] ?? "neutral"}>{m.topic_name}</Badge>}
                    {m.language && m.language !== "en" && <Badge>{languageName(m.language)}</Badge>}
                    {m.tags.map((t) => (
                      <span key={t} className="inline-flex items-center gap-1 rounded bg-surface-3 px-1.5 py-0.5 text-[11.5px] text-text-2">
                        <Tag className="h-3 w-3" /> {t}
                      </span>
                    ))}
                    {eng.length > 0 && <span className="text-[12px] text-text-3">{eng.map(([k, v]) => `${compact(v)} ${k}`).join(" · ")}</span>}
                    <span className="ml-auto flex items-center gap-1">
                      {m.url && (
                        <a href={m.url} target="_blank" rel="noopener noreferrer" className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-[12.5px] text-link hover:bg-surface-3">
                          <ExternalLink className="h-3.5 w-3.5" /> Open
                        </a>
                      )}
                      {m.status === "new" && (
                        <Button size="sm" variant="ghost" onClick={() => bulk("read", [m.id])}>
                          Mark read
                        </Button>
                      )}
                      {m.ticket_id ? (
                        <Link href={`/cx/inbox?brand=${brandId}&ticket=${m.ticket_id}`} className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-[12.5px] text-link hover:bg-surface-3">
                          <Ticket className="h-3.5 w-3.5" /> Ticket #{m.ticket_number ?? ""}
                        </Link>
                      ) : (
                        <Button size="sm" loading={busy === `ticket:${m.id}`} onClick={() => ticket(m.id)}>
                          <Ticket className="h-3.5 w-3.5" /> Create ticket
                        </Button>
                      )}
                    </span>
                  </div>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export { SENT_TONE };
