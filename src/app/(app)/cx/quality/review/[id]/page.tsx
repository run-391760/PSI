import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requirePageUser } from "@/lib/auth";
import { AppError } from "@/lib/domain";
import { aiConfigured } from "@/lib/cx/ai";
import { cxContext } from "@/lib/cx/context";
import { humanDuration } from "@/lib/cx/insights/metrics";
import { getReview, getScorecard, ticketThread } from "@/lib/cx/insights/quality";
import { dateTimeLabel } from "@/lib/format";
import { Page, PageHeader } from "@/components/shell/page";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Callout } from "@/components/ui/feedback";
import { BrandMeta, NoBrand, cxHref, ticketHref } from "@/components/cx/insights/common";
import { ReviewForm } from "@/components/cx/insights/review-form";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Review conversation" };

export default async function ReviewPage({ params, searchParams }: PageProps<"/cx/quality/review/[id]">) {
  const user = await requirePageUser();
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const { brand, switcher } = await cxContext(user.id, sp);
  if (!brand) return <NoBrand title="Quality assessment" />;
  const review = await getReview(brand.id, id).catch((e) => {
    if (e instanceof AppError && e.status === 404) notFound();
    throw e;
  });
  const [card, { ticket, messages }] = await Promise.all([review.scorecard_id ? getScorecard(brand.id, review.scorecard_id).catch(() => null) : null, ticketThread(brand.id, review.ticket_id)]);
  const frt = ticket.first_response_at ? (new Date(ticket.first_response_at).getTime() - new Date(ticket.created_at).getTime()) / 1000 : null;
  const art = ticket.resolved_at ? (new Date(ticket.resolved_at).getTime() - new Date(ticket.created_at).getTime()) / 1000 : null;

  return (
    <Page wide>
      <PageHeader
        breadcrumbs={[{ label: "CX", href: cxHref("/cx", brand.id) }, { label: "Quality assessment", href: cxHref("/cx/quality", brand.id, { tab: "queue" }) }, { label: `Ticket #${ticket.number}` }]}
        title={`Review ticket #${ticket.number}`}
        subject={card?.name}
        description={ticket.subject || undefined}
        meta={
          <BrandMeta switcher={switcher} current={brand.id}>
            <Badge>{ticket.channel_kind}</Badge>
            <Badge tone="info">Agent: {ticket.agent ?? "Unassigned"}</Badge>
            {review.reviewer && <Badge>Reviewer: {review.reviewer}</Badge>}
          </BrandMeta>
        }
        actions={<ButtonLink href={ticketHref(brand.id, ticket.id)}>Open in inbox</ButtonLink>}
      />
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
        <Card className="h-fit">
          <CardHeader title="Conversation" description={`${messages.length} messages · read-only`} />
          <CardBody className="pt-1">
            <div className="mb-3 grid grid-cols-3 gap-2 text-[12px]">
              <div className="rounded-md bg-surface-2 px-2 py-1.5"><div className="text-text-3">First response</div><div className="font-semibold text-text">{humanDuration(frt)}</div></div>
              <div className="rounded-md bg-surface-2 px-2 py-1.5"><div className="text-text-3">Resolution</div><div className="font-semibold text-text">{humanDuration(art)}</div></div>
              <div className="rounded-md bg-surface-2 px-2 py-1.5"><div className="text-text-3">CSAT</div><div className="font-semibold text-text">{ticket.csat ?? "n/a"}</div></div>
            </div>
            <div className="scroll-thin max-h-[70vh] space-y-2.5 overflow-y-auto pr-1">
              {messages.length === 0 && <p className="py-8 text-center text-[13px] text-text-3">This ticket has no messages.</p>}
              {messages.map((m) => (
                <div key={m.id} className={cn("flex", m.direction === "out" ? "justify-end" : "justify-start")}>
                  <div className={cn("max-w-[88%] rounded-lg px-3 py-2 text-[13px]", m.direction === "in" ? "bg-surface-3 text-text" : m.direction === "out" ? "bg-brand-soft text-text" : "border border-dashed border-warning bg-warning-soft text-text")}>
                    <div className="mb-0.5 text-[11.5px] text-text-3">
                      {m.direction === "note" ? "Internal note · " : ""}
                      {m.author_name || (m.direction === "in" ? ticket.contact ?? "Customer" : "Agent")} · {dateTimeLabel(m.created_at)}
                    </div>
                    <div className="break-words whitespace-pre-wrap">{m.body}</div>
                  </div>
                </div>
              ))}
            </div>
          </CardBody>
        </Card>
        <div className="min-w-0">
          {card ? (
            <ReviewForm
              brand={brand.id}
              review={JSON.parse(JSON.stringify({ id: review.id, status: review.status, answers: review.answers, comment: review.comment, coaching: review.coaching, dispute_reason: review.dispute_reason, dispute_response: review.dispute_response, ai_suggestion: review.ai_suggestion }))}
              sections={card.sections}
              passScore={card.pass_score}
              ai={aiConfigured()}
            />
          ) : (
            <Callout tone="warning" title="Scorecard deleted">This review&apos;s scorecard no longer exists. Its stored score ({review.score == null ? "n/a" : `${review.score.toFixed(0)}%`}) is kept for reporting.</Callout>
          )}
        </div>
      </div>
    </Page>
  );
}
