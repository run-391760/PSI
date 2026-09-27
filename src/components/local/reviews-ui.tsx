"use client";

import { MessageSquareReply, Star } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { deleteReplyAction, saveReplyAction } from "@/app/(app)/local/actions";
import { dateLabel } from "@/lib/format";
import { SENTIMENT_META, type Sentiment } from "@/lib/monitoring/sentiment";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DataTable, type Column } from "@/components/ui/data-table";
import { Dialog } from "@/components/ui/dialog";
import { Callout } from "@/components/ui/feedback";
import { Select, Textarea } from "@/components/ui/input";

export type ReviewItem = {
  id: string;
  platform: string;
  platformName: string;
  author: string;
  rating: number;
  date: string;
  text: string;
  sentiment: Sentiment;
  sentimentScore: number;
  reply: { body: string; date: string; by: "demo" | "you" | "owner"; status: "posted" | "draft" } | null;
};
export type ReplyTemplate = { id: string; label: string; body: string };

export function Stars({ rating, size = 13, className }: { rating: number; size?: number; className?: string }) {
  return (
    <span className={cn("inline-flex items-center", className)} aria-label={`${rating} out of 5 stars`} title={`${rating} / 5`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <Star key={i} style={{ width: size, height: size, color: i <= Math.round(rating) ? "var(--warning)" : "var(--border-strong)" }} fill="currentColor" strokeWidth={0} />
      ))}
    </span>
  );
}

type ReplyFilter = "all" | "awaiting" | "draft" | "replied";
const replyState = (r: ReviewItem): Exclude<ReplyFilter, "all"> => (r.reply?.status === "posted" ? "replied" : r.reply?.status === "draft" ? "draft" : "awaiting");

export function ReviewsInbox({ projectId, reviews, templates, business, phone }: { projectId: string; reviews: ReviewItem[]; templates: ReplyTemplate[]; business: string; phone: string }) {
  const [platform, setPlatform] = useState("all");
  const [rating, setRating] = useState("all");
  const [sentiment, setSentiment] = useState("all");
  const [reply, setReply] = useState<ReplyFilter>("all");
  const [open, setOpen] = useState<ReviewItem | null>(null);
  const platforms = useMemo(() => [...new Map(reviews.map((r) => [r.platform, r.platformName])).entries()], [reviews]);
  const rows = useMemo(
    () =>
      reviews.filter(
        (r) =>
          (platform === "all" || r.platform === platform) &&
          (rating === "all" || (rating === "neg" ? r.rating <= 2 : String(r.rating) === rating)) &&
          (sentiment === "all" || r.sentiment === sentiment) &&
          (reply === "all" || replyState(r) === reply),
      ),
    [reviews, platform, rating, sentiment, reply],
  );
  const columns: Column<ReviewItem>[] = [
    {
      key: "date",
      header: "Review",
      sortValue: (r) => r.date,
      csv: (r) => r.text,
      render: (r) => (
        <button type="button" onClick={() => setOpen(r)} className="block max-w-[560px] min-w-[240px] text-left">
          <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <span className="font-medium text-text">{r.author}</span>
            <Badge>{r.platformName}</Badge>
            <Stars rating={r.rating} size={12} />
            <span className="text-[12px] text-text-3">{dateLabel(r.date)}</span>
          </span>
          <span className={cn("mt-0.5 line-clamp-2 text-[12.5px]", r.text ? "text-text-2" : "text-text-3 italic")}>{r.text || "Rating only, no text."}</span>
        </button>
      ),
    },
    { key: "rating", header: "Rating", align: "right", sortValue: (r) => r.rating, render: (r) => <span className="tabular font-medium">{r.rating}★</span> },
    {
      key: "sentiment",
      header: "Sentiment",
      sortValue: (r) => r.sentimentScore,
      csv: (r) => r.sentiment,
      render: (r) => (
        <Badge tone={SENTIMENT_META[r.sentiment].tone} title={`Lexicon score ${r.sentimentScore}`}>
          {SENTIMENT_META[r.sentiment].label}
        </Badge>
      ),
    },
    {
      key: "reply",
      header: "Reply",
      sortValue: (r) => replyState(r),
      csv: (r) => r.reply?.body ?? "",
      render: (r) => {
        const s = replyState(r);
        return s === "replied" ? <Badge tone="good">Replied{r.reply?.by === "you" ? " (you)" : ""}</Badge> : s === "draft" ? <Badge tone="info">Draft saved</Badge> : <Badge tone={r.rating <= 2 ? "critical" : "warning"}>Awaiting reply</Badge>;
      },
    },
    {
      key: "action",
      header: "",
      sortable: false,
      noExport: true,
      align: "right",
      render: (r) => (
        <Button size="sm" variant={replyState(r) === "awaiting" ? "secondary" : "ghost"} onClick={() => setOpen(r)}>
          <MessageSquareReply className="h-3.5 w-3.5" /> {replyState(r) === "replied" ? "View" : "Reply"}
        </Button>
      ),
    },
  ];
  const select = "h-8 w-auto text-[12.5px]";
  return (
    <>
      <DataTable
        rows={rows}
        columns={columns}
        rowKey={(r) => r.id}
        defaultSort={{ key: "date", dir: "desc" }}
        pageSize={10}
        searchable
        searchPlaceholder="Search reviews"
        searchText={(r) => `${r.author} ${r.text}`}
        exportName="reviews"
        toolbar={
          <>
            <Select value={platform} onChange={(e) => setPlatform(e.target.value)} className={select} aria-label="Platform">
              <option value="all">All platforms</option>
              {platforms.map(([id, name]) => (
                <option key={id} value={id}>
                  {name}
                </option>
              ))}
            </Select>
            <Select value={rating} onChange={(e) => setRating(e.target.value)} className={select} aria-label="Rating">
              <option value="all">All ratings</option>
              {[5, 4, 3, 2, 1].map((s) => (
                <option key={s} value={String(s)}>
                  {s} stars
                </option>
              ))}
              <option value="neg">1–2 stars</option>
            </Select>
            <Select value={sentiment} onChange={(e) => setSentiment(e.target.value)} className={select} aria-label="Sentiment">
              <option value="all">Any sentiment</option>
              <option value="positive">Positive</option>
              <option value="neutral">Neutral</option>
              <option value="negative">Negative</option>
            </Select>
            <Select value={reply} onChange={(e) => setReply(e.target.value as ReplyFilter)} className={select} aria-label="Reply status">
              <option value="all">Any reply status</option>
              <option value="awaiting">Awaiting reply</option>
              <option value="draft">Draft saved</option>
              <option value="replied">Replied</option>
            </Select>
          </>
        }
      />
      <ReplyDialog projectId={projectId} review={open} onClose={() => setOpen(null)} templates={templates} business={business} phone={phone} />
    </>
  );
}

function fillTemplate(body: string, r: ReviewItem, business: string, phone: string) {
  return body.replaceAll("{first}", r.author.split(" ")[0]).replaceAll("{rating}", String(r.rating)).replaceAll("{business}", business).replaceAll("{phone}", phone).replaceAll("{platform}", r.platformName);
}

function ReplyDialog({ projectId, review, onClose, templates, business, phone }: { projectId: string; review: ReviewItem | null; onClose: () => void; templates: ReplyTemplate[]; business: string; phone: string }) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [template, setTemplate] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [lastId, setLastId] = useState<string | null>(null);
  if (review && review.id !== lastId) {
    // Reset the editor when a different review opens.
    setLastId(review.id);
    const t = review.rating >= 4 ? "thanks" : review.rating === 3 ? "neutral" : "apology";
    setTemplate(review.reply ? "" : t);
    setText(review.reply?.by === "you" ? review.reply.body : review.reply ? "" : fillTemplate(templates.find((x) => x.id === t)?.body ?? "", review, business, phone));
    setError(null);
  }
  const save = (status: "draft" | "posted") =>
    start(async () => {
      if (!review) return;
      const res = await saveReplyAction(projectId, review.id, text, status);
      if (!res.ok) return setError(res.error);
      router.refresh();
      onClose();
    });
  const remove = () =>
    start(async () => {
      if (!review) return;
      await deleteReplyAction(projectId, review.id);
      router.refresh();
      onClose();
    });
  const readOnly = review?.reply?.by === "demo";
  return (
    <Dialog
      open={!!review}
      onClose={() => (setLastId(null), onClose())}
      title={review ? `Review by ${review.author}` : ""}
      description={review ? `${review.platformName} · ${dateLabel(review.date)} · Demo review` : undefined}
      size="lg"
      footer={
        review &&
        !readOnly && (
          <>
            {review.reply?.by === "you" && (
              <Button variant="ghost" onClick={remove} disabled={pending} className="mr-auto text-critical-ink">
                Delete reply
              </Button>
            )}
            <Button onClick={() => save("draft")} loading={pending}>
              Save draft
            </Button>
            <Button variant="primary" onClick={() => save("posted")} loading={pending}>
              Mark as replied
            </Button>
          </>
        )
      }
    >
      {review && (
        <div className="space-y-4">
          <div className="rounded-lg border border-border bg-surface-2 p-3">
            <div className="flex flex-wrap items-center gap-2">
              <Stars rating={review.rating} />
              <Badge tone={SENTIMENT_META[review.sentiment].tone}>{SENTIMENT_META[review.sentiment].label}</Badge>
            </div>
            <p className={cn("mt-1.5 text-[13.5px]", review.text ? "text-text" : "text-text-3 italic")}>{review.text || "The reviewer left a rating without text."}</p>
          </div>
          {readOnly ? (
            <div className="rounded-lg border border-border p-3">
              <div className="text-[12px] font-medium text-text-3">Owner response · {dateLabel(review.reply!.date)}</div>
              <p className="mt-1 text-[13.5px] text-text">{review.reply!.body}</p>
            </div>
          ) : (
            <>
              {error && <Callout tone="critical">{error}</Callout>}
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[12.5px] font-medium text-text-2">Template</span>
                <Select
                  value={template}
                  onChange={(e) => {
                    setTemplate(e.target.value);
                    const t = templates.find((x) => x.id === e.target.value);
                    if (t) setText(fillTemplate(t.body, review, business, phone));
                  }}
                  className="h-8 w-auto text-[12.5px]"
                >
                  <option value="">Choose a template…</option>
                  {templates.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.label}
                    </option>
                  ))}
                </Select>
              </div>
              <div>
                <Textarea value={text} onChange={(e) => setText(e.target.value)} rows={6} maxLength={4000} aria-label="Reply" placeholder="Write a reply…" />
                <div className="mt-1 flex justify-between text-[12px] text-text-3">
                  <span>Personalise the reply; mention specifics from the review.</span>
                  <span className="tabular">{text.length}/4000</span>
                </div>
              </div>
              <p className="text-[12px] text-text-3">Replies are saved in SynapseSEO. Review platforms are not connected, so “Mark as replied” records that you posted it yourself.</p>
            </>
          )}
        </div>
      )}
    </Dialog>
  );
}
