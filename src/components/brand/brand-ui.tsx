"use client";

import { Archive, CheckCheck, Download, ExternalLink, Inbox, RefreshCw, Settings2, Tags } from "lucide-react";
import { useRouter } from "next/navigation";
import { type FormEvent, useMemo, useState, useTransition } from "react";
import { fetchMentionsAction, saveBrandSettingsAction, setMentionStatusAction, setMentionTagsAction } from "@/app/(app)/brand-monitoring/actions";
import { downloadCsv } from "@/lib/csv";
import { compact, dateLabel, timeAgo } from "@/lib/format";
import { CHANNELS, type Mention, type MentionStatus } from "@/lib/monitoring/meta";
import { SENTIMENT_META } from "@/lib/monitoring/sentiment";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DataTable, type Column } from "@/components/ui/data-table";
import { Dialog } from "@/components/ui/dialog";
import { Callout } from "@/components/ui/feedback";
import { Checkbox, Field, Input, Select, Textarea } from "@/components/ui/input";
import { Segmented } from "@/components/ui/tabs";
import { BarChart } from "@/components/charts/bar-chart";

const split = (s: string) =>
  s
    .split(/\n|,/)
    .map((x) => x.trim())
    .filter(Boolean);

export function BrandSettingsForm({ projectId, initial, onDone, submitLabel = "Save & fetch mentions" }: { projectId: string; initial: { terms: string[]; competitorTerms: string[]; demoSocial: boolean; daily: boolean; demoAvailable?: boolean }; onDone?: () => void; submitLabel?: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const terms = split(String(f.get("terms") ?? ""));
    const competitorTerms = split(String(f.get("competitors") ?? ""));
    if (!terms.length) return setError("Add at least one brand term.");
    if (terms.length > 5 || competitorTerms.length > 5) return setError("Use at most 5 brand terms and 5 competitor names.");
    setError(null);
    start(async () => {
      const res = await saveBrandSettingsAction(projectId, { terms, competitorTerms, demoSocial: f.get("demo") === "on", daily: f.get("daily") === "on" });
      if (!res.ok) return setError(res.error);
      onDone?.();
      router.refresh();
    });
  };
  return (
    <form onSubmit={submit} className="space-y-4">
      {error && <Callout tone="critical">{error}</Callout>}
      <Field label="Brand terms" htmlFor="bm-terms" hint="Exact phrases to track, one per line (max 5). Saved as the project's brand terms.">
        <Textarea id="bm-terms" name="terms" defaultValue={initial.terms.join("\n")} rows={3} className="min-h-0" required />
      </Field>
      <Field label="Competitor brand names" htmlFor="bm-comp" hint="Used for share of voice, one per line (max 5).">
        <Textarea id="bm-comp" name="competitors" defaultValue={initial.competitorTerms.join("\n")} rows={3} className="min-h-0" placeholder={"Competitor One\nCompetitor Two"} />
      </Field>
      <div className="space-y-2 rounded-md border border-border p-3">
        <label className="flex items-start gap-2 text-[13px]">
          <Checkbox name="daily" defaultChecked={initial.daily} className="mt-0.5" />
          <span>
            <span className="font-medium text-text">Fetch new mentions daily</span>
            <span className="block text-[12px] text-text-3">You get an alert on mention spikes and new negative mentions.</span>
          </span>
        </label>
        {initial.demoAvailable && (
          <label className="flex items-start gap-2 text-[13px]">
            <Checkbox name="demo" defaultChecked={initial.demoSocial} className="mt-0.5" />
            <span>
              <span className="font-medium text-text">Include demo social &amp; forum mentions</span>
              <span className="block text-[12px] text-text-3">Development only (DEMO_DATA=true): synthetic posts labelled “Demo”.</span>
            </span>
          </label>
        )}
      </div>
      <div className="flex justify-end gap-2 border-t border-border pt-3">
        {onDone && (
          <Button type="button" variant="ghost" onClick={onDone}>
            Cancel
          </Button>
        )}
        <Button type="submit" variant="primary" loading={pending}>
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}

export function BrandSettingsButton(props: { projectId: string; initial: { terms: string[]; competitorTerms: string[]; demoSocial: boolean; daily: boolean; demoAvailable?: boolean } }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <Settings2 className="h-4 w-4" /> Settings
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)} title="Brand monitoring settings" description="Tracked terms, competitors and sources." size="lg">
        <BrandSettingsForm {...props} onDone={() => setOpen(false)} submitLabel="Save settings" />
      </Dialog>
    </>
  );
}

export function FetchNowButton({ projectId, disabled }: { projectId: string; disabled?: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <span className="inline-flex flex-col items-end">
      <Button
        variant="primary"
        loading={pending}
        disabled={disabled}
        onClick={() =>
          start(async () => {
            const res = await fetchMentionsAction(projectId);
            if (!res.ok) setError(res.error);
            router.refresh();
          })
        }
      >
        <RefreshCw className="h-4 w-4" /> Fetch now
      </Button>
      {error && <span className="mt-1 text-[12px] text-critical-ink">{error}</span>}
    </span>
  );
}

function exportMentions(rows: Mention[]) {
  downloadCsv("brand-mentions", [
    ["Published", "Source", "Channel", "Publisher", "Title", "Snippet", "URL", "Term", "Sentiment", "Sentiment score", "Est. reach", "Status", "Tags"],
    ...rows.map((m) => [m.publishedAt, m.source === "demo" ? "Demo" : "Google News", CHANNELS[m.channel] ?? m.channel, m.publisher, m.title, m.snippet, m.url, m.term, m.sentiment, m.sentimentScore, m.reach || "n/a", m.status, m.tags.join("; ")]),
  ]);
}

const STATUS_META: Record<MentionStatus, { label: string; tone: "info" | "neutral" | "good" }> = {
  new: { label: "New", tone: "info" },
  reviewed: { label: "Reviewed", tone: "good" },
  archived: { label: "Archived", tone: "neutral" },
};

export function MentionsTable({ projectId, mentions, terms, initialSentiment }: { projectId: string; mentions: Mention[]; terms: string[]; initialSentiment?: string }) {
  const router = useRouter();
  const [source, setSource] = useState("all");
  const [channel, setChannel] = useState("all");
  const [sentiment, setSentiment] = useState(initialSentiment && ["positive", "neutral", "negative"].includes(initialSentiment) ? initialSentiment : "all");
  const [status, setStatus] = useState("active");
  const [term, setTerm] = useState("all");
  const [range, setRange] = useState("all");
  const [tagsFor, setTagsFor] = useState<Mention | null>(null);
  const [tagText, setTagText] = useState("");
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const channels = useMemo(() => [...new Set(mentions.map((m) => m.channel))], [mentions]);
  const hasDemo = mentions.some((m) => m.source === "demo");
  const rows = useMemo(() => {
    const now = Date.now();
    const maxAge = range === "all" ? Infinity : Number(range) * 86400000;
    return mentions.filter(
      (m) =>
        (source === "all" || m.source === source) &&
        (channel === "all" || m.channel === channel) &&
        (sentiment === "all" || m.sentiment === sentiment) &&
        (status === "all" || (status === "active" ? m.status !== "archived" : m.status === status)) &&
        (term === "all" || m.term === term) &&
        now - new Date(m.publishedAt).getTime() <= maxAge,
    );
  }, [mentions, source, channel, sentiment, status, term, range]);

  const bulk = (ids: string[], next: MentionStatus, clear: () => void) =>
    start(async () => {
      setError(null);
      const res = await setMentionStatusAction(projectId, ids, next);
      if (!res.ok) setError(res.error);
      clear();
      router.refresh();
    });

  const columns: Column<Mention>[] = [
    {
      key: "publishedAt",
      header: "Date",
      sortValue: (m) => m.publishedAt,
      render: (m) => (
        <span className="text-[12.5px] whitespace-nowrap text-text-2">
          {dateLabel(m.publishedAt)}
          <span className="block text-[11.5px] text-text-3" suppressHydrationWarning>
            {timeAgo(m.publishedAt)}
          </span>
        </span>
      ),
    },
    {
      key: "title",
      header: "Mention",
      sortValue: (m) => m.title,
      render: (m) => (
        <div className="max-w-[560px] min-w-[260px]">
          <div className="mb-0.5 flex flex-wrap items-center gap-1.5">
            {m.source === "demo" ? <Badge tone="warning">Demo · {CHANNELS[m.channel] ?? m.channel}</Badge> : <Badge tone="info">Google News</Badge>}
            <span className="truncate text-[12px] text-text-3">{m.publisher}</span>
          </div>
          <a href={m.url} target="_blank" rel="noopener noreferrer" className={cn("line-clamp-2 text-[13px] hover:underline", m.status === "new" ? "font-medium text-text" : "text-text-2")}>
            {m.title}
            <ExternalLink className="ml-1 inline h-3 w-3 text-text-3" />
          </a>
          {m.snippet && <p className="mt-0.5 line-clamp-1 text-[12px] text-text-3">{m.snippet}</p>}
          {m.tags.length > 0 && (
            <div className="mt-1 flex flex-wrap gap-1">
              {m.tags.map((t) => (
                <span key={t} className="rounded bg-surface-3 px-1.5 text-[11px] text-text-2">
                  {t}
                </span>
              ))}
            </div>
          )}
        </div>
      ),
      csv: (m) => m.title,
    },
    {
      key: "sentiment",
      header: "Sentiment",
      sortValue: (m) => m.sentimentScore,
      csv: (m) => m.sentiment,
      render: (m) => (
        <Badge tone={SENTIMENT_META[m.sentiment].tone} title={`Lexicon score ${m.sentimentScore}`}>
          {SENTIMENT_META[m.sentiment].label}
        </Badge>
      ),
    },
    { key: "reach", header: "Est. reach", align: "right", info: "Audience reach is not measured by any connected source (n/a).", sortValue: (m) => m.reach, render: (m) => (m.reach ? compact(m.reach) : <span className="text-text-3">n/a</span>) },
    { key: "status", header: "Status", sortValue: (m) => m.status, render: (m) => <Badge tone={STATUS_META[m.status].tone}>{STATUS_META[m.status].label}</Badge> },
    {
      key: "actions",
      header: "",
      sortable: false,
      noExport: true,
      align: "right",
      render: (m) => (
        <span className="inline-flex gap-0.5">
          <Button size="sm" variant="ghost" aria-label="Edit tags" title="Edit tags" onClick={() => (setTagsFor(m), setTagText(m.tags.join(", ")))}>
            <Tags className="h-3.5 w-3.5" />
          </Button>
          {m.status !== "reviewed" && (
            <Button size="sm" variant="ghost" aria-label="Mark reviewed" title="Mark reviewed" disabled={pending} onClick={() => bulk([m.id], "reviewed", () => undefined)}>
              <CheckCheck className="h-3.5 w-3.5" />
            </Button>
          )}
          {m.status !== "archived" && (
            <Button size="sm" variant="ghost" aria-label="Archive" title="Archive" disabled={pending} onClick={() => bulk([m.id], "archived", () => undefined)}>
              <Archive className="h-3.5 w-3.5" />
            </Button>
          )}
        </span>
      ),
    },
  ];
  const sel = "h-8 w-auto text-[12.5px]";
  return (
    <>
      {error && <Callout tone="critical" className="mx-4 mb-3">{error}</Callout>}
      <DataTable
        rows={rows}
        columns={columns}
        rowKey={(m) => m.id}
        defaultSort={{ key: "publishedAt", dir: "desc" }}
        pageSize={25}
        searchable
        searchPlaceholder="Search mentions"
        searchText={(m) => `${m.title} ${m.snippet} ${m.publisher} ${m.tags.join(" ")}`}
        selectable
        selectionActions={(selected, clear) => (
          <>
            <Button size="sm" disabled={pending} onClick={() => bulk(selected.map((m) => m.id), "reviewed", clear)}>
              <CheckCheck className="h-3.5 w-3.5" /> Mark reviewed
            </Button>
            <Button size="sm" disabled={pending} onClick={() => bulk(selected.map((m) => m.id), "archived", clear)}>
              <Archive className="h-3.5 w-3.5" /> Archive
            </Button>
            <Button size="sm" variant="ghost" disabled={pending} onClick={() => bulk(selected.map((m) => m.id), "new", clear)}>
              <Inbox className="h-3.5 w-3.5" /> Mark new
            </Button>
          </>
        )}
        toolbar={
          <>
            {hasDemo && (
              <Select value={source} onChange={(e) => setSource(e.target.value)} className={sel} aria-label="Source">
                <option value="all">All sources</option>
                <option value="google-news">Google News</option>
                <option value="demo">Demo social</option>
              </Select>
            )}
            {channels.length > 1 && (
              <Select value={channel} onChange={(e) => setChannel(e.target.value)} className={sel} aria-label="Channel">
                <option value="all">All channels</option>
                {channels.map((c) => (
                  <option key={c} value={c}>
                    {CHANNELS[c] ?? c}
                  </option>
                ))}
              </Select>
            )}
            <Select value={sentiment} onChange={(e) => setSentiment(e.target.value)} className={sel} aria-label="Sentiment">
              <option value="all">Any sentiment</option>
              <option value="positive">Positive</option>
              <option value="neutral">Neutral</option>
              <option value="negative">Negative</option>
            </Select>
            <Select value={status} onChange={(e) => setStatus(e.target.value)} className={sel} aria-label="Status">
              <option value="active">New &amp; reviewed</option>
              <option value="new">New only</option>
              <option value="reviewed">Reviewed</option>
              <option value="archived">Archived</option>
              <option value="all">All statuses</option>
            </Select>
            {terms.length > 1 && (
              <Select value={term} onChange={(e) => setTerm(e.target.value)} className={sel} aria-label="Term">
                <option value="all">All terms</option>
                {terms.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </Select>
            )}
            <Button size="sm" onClick={() => exportMentions(rows)} title="Export the mentions matching the filters as CSV" className="order-last">
              <Download className="h-3.5 w-3.5" /> Export CSV
            </Button>
            <Select value={range} onChange={(e) => setRange(e.target.value)} className={sel} aria-label="Date range">
              <option value="all">Any time</option>
              <option value="7">Last 7 days</option>
              <option value="30">Last 30 days</option>
              <option value="90">Last 90 days</option>
            </Select>
          </>
        }
        emptyText="No mentions match these filters."
      />
      <Dialog
        open={!!tagsFor}
        onClose={() => setTagsFor(null)}
        title="Edit tags"
        description={tagsFor?.title}
        size="sm"
        footer={
          <Button
            variant="primary"
            loading={pending}
            onClick={() =>
              start(async () => {
                if (!tagsFor) return;
                const res = await setMentionTagsAction(projectId, tagsFor.id, split(tagText));
                if (!res.ok) return setError(res.error);
                setTagsFor(null);
                router.refresh();
              })
            }
          >
            Save tags
          </Button>
        }
      >
        <Field label="Tags" htmlFor="bm-tags" hint="Comma separated, up to 8.">
          <Input id="bm-tags" value={tagText} onChange={(e) => setTagText(e.target.value)} placeholder="PR, Crisis, Campaign" />
        </Field>
      </Dialog>
    </>
  );
}

/** Daily mentions by sentiment as stacked columns, with a 7/30/90-day range switch. */
export function MentionsChart({ days }: { days: { day: string; positive: number; neutral: number; negative: number }[] }) {
  const [range, setRange] = useState("30");
  const data = days.slice(-Number(range));
  return (
    <div>
      <div className="mb-2 flex justify-end">
        <Segmented
          options={[
            { value: "7", label: "7D" },
            { value: "30", label: "30D" },
            { value: "90", label: "90D" },
          ]}
          value={range}
          onChange={setRange}
        />
      </div>
      <BarChart
        data={data}
        xKey="day"
        xFormat="day"
        stacked
        yFormat="number"
        series={[
          { key: "positive", label: "Positive", color: "var(--good)" },
          { key: "neutral", label: "Neutral", color: "var(--text-3)" },
          { key: "negative", label: "Negative", color: "var(--critical)" },
        ]}
        height={230}
      />
    </div>
  );
}
