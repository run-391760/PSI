"use client";

import { Shuffle } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { openReviewAction, sampleAction } from "@/app/(app)/cx/quality/actions";
import { Badge, type Tone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Callout } from "@/components/ui/feedback";
import { Field, Input, Select } from "@/components/ui/input";
import { DataTable, type Column } from "@/components/ui/data-table";
import { dateLabel } from "@/lib/format";

type Opt = { id: string; name: string };
export const STATUS_META: Record<string, { label: string; tone: Tone }> = {
  queued: { label: "To review", tone: "neutral" },
  draft: { label: "Draft", tone: "info" },
  submitted: { label: "Submitted", tone: "good" },
  disputed: { label: "Disputed", tone: "warning" },
  resolved: { label: "Dispute resolved", tone: "brand" },
};

export function SamplePanel({ brand, scorecards, agents, channels }: { brand: string; scorecards: Opt[]; agents: Opt[]; channels: string[] }) {
  const router = useRouter();
  const [card, setCard] = useState(scorecards[0]?.id ?? "");
  const [count, setCount] = useState(5);
  const [days, setDays] = useState(30);
  const [agent, setAgent] = useState("");
  const [channel, setChannel] = useState("");
  const [msg, setMsg] = useState<{ tone: "good" | "warning" | "critical"; text: string } | null>(null);
  const [pending, start] = useTransition();
  return (
    <Card>
      <CardHeader title="Random sample" description="Queue a random set of solved tickets (with at least one agent reply) that are not yet reviewed with the chosen scorecard." />
      <CardBody className="space-y-3 pt-1">
        {msg && <Callout tone={msg.tone}>{msg.text}</Callout>}
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          <Field label="Scorecard" htmlFor="smp-card">
            <Select id="smp-card" value={card} onChange={(e) => setCard(e.target.value)}>
              {scorecards.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </Select>
          </Field>
          <Field label="Tickets" htmlFor="smp-count"><Input id="smp-count" type="number" min={1} max={50} value={count} onChange={(e) => setCount(Number(e.target.value))} /></Field>
          <Field label="Solved in last (days)" htmlFor="smp-days"><Input id="smp-days" type="number" min={1} max={365} value={days} onChange={(e) => setDays(Number(e.target.value))} /></Field>
          <Field label="Agent" htmlFor="smp-agent">
            <Select id="smp-agent" value={agent} onChange={(e) => setAgent(e.target.value)}>
              <option value="">All agents</option>
              {agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </Select>
          </Field>
          <Field label="Channel" htmlFor="smp-ch">
            <Select id="smp-ch" value={channel} onChange={(e) => setChannel(e.target.value)}>
              <option value="">All channels</option>
              {channels.map((c) => <option key={c} value={c}>{c}</option>)}
            </Select>
          </Field>
        </div>
        <Button
          variant="primary"
          loading={pending}
          disabled={pending || !card}
          onClick={() =>
            start(async () => {
              const r = await sampleAction(brand, { scorecardId: card, count, days, agentId: agent, channel });
              if (!r.ok) return setMsg({ tone: "critical", text: r.error });
              setMsg(r.data.queued ? { tone: "good", text: `Queued ${r.data.queued} of ${r.data.eligible} eligible tickets.` } : { tone: "warning", text: "No eligible solved tickets match these filters." });
              router.refresh();
            })
          }
        >
          <Shuffle className="h-4 w-4" /> Sample tickets
        </Button>
      </CardBody>
    </Card>
  );
}

type TicketRow = { id: string; number: number; subject: string; channel_kind: string; agent: string | null; resolved_at: string | null; csat: number | null; reviews: number };
export function ReviewableTickets({ brand, tickets, scorecards }: { brand: string; tickets: TicketRow[]; scorecards: Opt[] }) {
  const router = useRouter();
  const [card, setCard] = useState(scorecards[0]?.id ?? "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const columns: Column<TicketRow>[] = [
    { key: "number", header: "Ticket", sortable: true, sortValue: (r) => r.number, render: (r) => <span className="font-medium text-text">#{r.number}</span>, csv: (r) => r.number },
    { key: "subject", header: "Subject", render: (r) => <span className="line-clamp-1 max-w-sm text-text">{r.subject || "(no subject)"}</span>, csv: (r) => r.subject },
    { key: "channel", header: "Channel", render: (r) => <Badge>{r.channel_kind}</Badge>, csv: (r) => r.channel_kind, hideOnMobile: true },
    { key: "agent", header: "Agent", render: (r) => <span className="text-text-2">{r.agent ?? "Unassigned"}</span>, csv: (r) => r.agent ?? "", hideOnMobile: true },
    { key: "resolved", header: "Solved", sortable: true, sortValue: (r) => (r.resolved_at ? new Date(r.resolved_at).getTime() : 0), render: (r) => <span className="text-text-2">{r.resolved_at ? dateLabel(r.resolved_at) : "—"}</span>, csv: (r) => (r.resolved_at ? new Date(r.resolved_at).toISOString() : ""), hideOnMobile: true },
    { key: "csat", header: "CSAT", align: "right", render: (r) => (r.csat == null ? <span className="text-text-3">—</span> : r.csat), csv: (r) => r.csat ?? "" },
    { key: "reviews", header: "Reviews", align: "right", sortable: true, sortValue: (r) => r.reviews, render: (r) => r.reviews, csv: (r) => r.reviews },
    {
      key: "act",
      header: "",
      noExport: true,
      align: "right",
      render: (r) => (
        <Button
          size="sm"
          loading={busy === r.id}
          disabled={busy === r.id || !card}
          onClick={async () => {
            setBusy(r.id);
            const res = await openReviewAction(brand, r.id, card);
            setBusy(null);
            if (!res.ok) return setError(res.error);
            router.push(`/cx/quality/review/${res.data.id}?brand=${brand}`);
          }}
        >
          Review
        </Button>
      ),
    },
  ];
  return (
    <div className="space-y-2">
      {error && <Callout tone="critical">{error}</Callout>}
      <DataTable
        title="Solved tickets"
        rows={tickets}
        columns={columns}
        rowKey={(r) => r.id}
        searchable
        searchText={(r) => `${r.number} ${r.subject} ${r.agent ?? ""}`}
        exportName="solved-tickets"
        toolbar={
          <Select aria-label="Scorecard to use" value={card} onChange={(e) => setCard(e.target.value)} className="h-8 w-52">
            {scorecards.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </Select>
        }
        emptyText="No solved tickets yet. Tickets appear here once conversations are solved in the inbox."
      />
    </div>
  );
}

type ReviewRow = { id: string; ticket_number: number; subject: string; scorecard: string | null; agent: string | null; reviewer: string | null; status: string; score: number | null; fatal: boolean; updated_at: string; dispute_reason: string | null };
export function ReviewsTable({ brand, rows, title, empty }: { brand: string; rows: ReviewRow[]; title: string; empty: string }) {
  const columns: Column<ReviewRow>[] = [
    { key: "ticket", header: "Ticket", sortable: true, sortValue: (r) => r.ticket_number, render: (r) => <Link className="font-medium text-link hover:underline" href={`/cx/quality/review/${r.id}?brand=${brand}`}>#{r.ticket_number}</Link>, csv: (r) => r.ticket_number },
    { key: "subject", header: "Subject", render: (r) => <span className="line-clamp-1 max-w-xs text-text">{r.subject || "(no subject)"}</span>, csv: (r) => r.subject, hideOnMobile: true },
    { key: "agent", header: "Agent", sortable: true, sortValue: (r) => r.agent ?? "", render: (r) => <span className="text-text-2">{r.agent ?? "Unassigned"}</span>, csv: (r) => r.agent ?? "" },
    { key: "scorecard", header: "Scorecard", render: (r) => <span className="text-text-2">{r.scorecard ?? "—"}</span>, csv: (r) => r.scorecard ?? "", hideOnMobile: true },
    { key: "status", header: "Status", render: (r) => <Badge tone={STATUS_META[r.status]?.tone}>{STATUS_META[r.status]?.label ?? r.status}</Badge>, csv: (r) => r.status },
    { key: "score", header: "Score", align: "right", sortable: true, sortValue: (r) => r.score, render: (r) => (r.score == null ? <span className="text-text-3">—</span> : <span className={r.fatal ? "font-semibold text-critical-ink" : "font-semibold text-text"}>{r.score.toFixed(0)}%{r.fatal ? " (fatal)" : ""}</span>), csv: (r) => (r.score == null ? "" : r.score.toFixed(1)) },
    { key: "reviewer", header: "Reviewer", render: (r) => <span className="text-text-2">{r.reviewer ?? "—"}</span>, csv: (r) => r.reviewer ?? "", hideOnMobile: true },
    { key: "updated", header: "Updated", sortable: true, sortValue: (r) => new Date(r.updated_at).getTime(), render: (r) => <span className="text-text-2">{dateLabel(r.updated_at)}</span>, csv: (r) => new Date(r.updated_at).toISOString(), hideOnMobile: true },
  ];
  return <DataTable title={title} rows={rows} columns={columns} rowKey={(r) => r.id} defaultSort={{ key: "updated", dir: "desc" }} searchable searchText={(r) => `${r.ticket_number} ${r.subject} ${r.agent ?? ""} ${r.dispute_reason ?? ""}`} exportName="qa-reviews" emptyText={empty} />;
}
