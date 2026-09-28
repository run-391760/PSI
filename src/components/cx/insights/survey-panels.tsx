"use client";

import { Check, Copy, ExternalLink, Link2, Pause, Play, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { deleteSurveyAction, ticketLinkAction, updateSurveyFlagsAction } from "@/app/(app)/cx/surveys/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Callout } from "@/components/ui/feedback";
import { Checkbox, Input } from "@/components/ui/input";
import { DataTable, type Column } from "@/components/ui/data-table";
import { dateTimeLabel } from "@/lib/format";
import type { ResponseRow, Survey } from "@/lib/cx/insights/surveys";

function CopyField({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-center gap-1.5">
      <Input readOnly value={value} aria-label={label} className="min-w-0 flex-1 font-mono text-[12px]" onFocus={(e) => e.currentTarget.select()} />
      <Button
        size="icon"
        aria-label={`Copy ${label}`}
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(value);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          } catch {
            /* clipboard blocked; the field is selectable */
          }
        }}
      >
        {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
      </Button>
    </div>
  );
}

export function SurveySharePanel({ brand, survey, origin, invites }: { brand: string; survey: Survey; origin: string; invites: { token: string; ticket_number: number | null; contact: string | null; source: string; created_at: string; responded_at: string | null }[] }) {
  const router = useRouter();
  const [ticket, setTicket] = useState("");
  const [link, setLink] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const publicUrl = `${origin}/s/${survey.id}`;
  const flag = (patch: { status?: "active" | "paused"; auto_send?: boolean }) =>
    start(async () => {
      const r = await updateSurveyFlagsAction(brand, survey.id, patch);
      if (!r.ok) setError(r.error);
      else router.refresh();
    });
  const pendingInvites = invites.filter((i) => !i.responded_at);
  return (
    <Card>
      <CardHeader
        title="Share & send"
        actions={
          <div className="flex gap-1">
            <Button size="sm" disabled={pending} onClick={() => flag({ status: survey.status === "active" ? "paused" : "active" })}>
              {survey.status === "active" ? <><Pause className="h-3.5 w-3.5" /> Pause</> : <><Play className="h-3.5 w-3.5" /> Resume</>}
            </Button>
            <Button
              size="icon"
              variant="ghost"
              aria-label="Delete survey"
              disabled={pending}
              onClick={() =>
                confirm("Delete this survey and all its responses?") &&
                start(async () => {
                  const r = await deleteSurveyAction(brand, survey.id);
                  if (r.ok) router.push(`/cx/surveys?brand=${brand}`);
                  else setError(r.error);
                })
              }
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        }
      />
      <CardBody className="space-y-4 pt-1">
        {error && <Callout tone="critical">{error}</Callout>}
        {survey.status === "paused" && <Callout tone="warning">Paused: the links show a closed message and no responses are accepted.</Callout>}
        <div>
          <div className="mb-1 flex items-center justify-between text-[12.5px] font-semibold text-text">
            Public link
            <a href={publicUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[12px] font-normal text-link hover:underline">
              Open <ExternalLink className="h-3 w-3" />
            </a>
          </div>
          <CopyField value={publicUrl} label="public link" />
          <p className="mt-1 text-[12px] text-text-3">Anonymous responses — for websites, emails, QR codes.</p>
        </div>
        <div>
          <div className="mb-1 text-[12.5px] font-semibold text-text">Personal link for a ticket</div>
          <div className="flex gap-1.5">
            <Input type="number" min={1} value={ticket} onChange={(e) => setTicket(e.target.value)} placeholder="Ticket number" aria-label="Ticket number" className="w-36" />
            <Button
              loading={pending}
              disabled={!ticket}
              onClick={() =>
                start(async () => {
                  setError(null);
                  const r = await ticketLinkAction(brand, survey.id, Number(ticket));
                  if (!r.ok) return setError(r.error);
                  setLink(`${origin}${r.data.path}`);
                  router.refresh();
                })
              }
            >
              <Link2 className="h-4 w-4" /> Create link
            </Button>
          </div>
          {link && <CopyField value={link} label="ticket link" />}
          <p className="mt-1 text-[12px] text-text-3">Linked to the ticket and its contact{survey.kind === "csat" ? "; the rating is written to the ticket's CSAT" : ""}.</p>
        </div>
        <label className="flex items-start gap-2 text-[13px] text-text">
          <Checkbox className="mt-0.5" checked={survey.auto_send} disabled={pending} onChange={(e) => flag({ auto_send: e.target.checked })} />
          <span>
            Auto-send after tickets are solved
            <span className="block text-[12px] text-text-3">
              Every hour, solved tickets from the last 14 days get a personal link. The inbox sends it with its reply channel when available; otherwise copy the links below. Message template:
            </span>
            <code className="mt-1 block rounded bg-surface-3 px-2 py-1 text-[12px] whitespace-pre-wrap text-text-2">{`${survey.question || "We'd love your feedback."}\n${origin}/s/${survey.id}?t={token}`}</code>
          </span>
        </label>
        {invites.length > 0 && (
          <div>
            <div className="mb-1 text-[12.5px] font-semibold text-text">
              Personal links <Badge>{pendingInvites.length} awaiting answer</Badge>
            </div>
            <div className="scroll-thin max-h-56 divide-y divide-border overflow-auto rounded-md border border-border">
              {invites.slice(0, 50).map((i) => (
                <div key={i.token} className="flex items-center justify-between gap-2 px-2.5 py-1.5 text-[12.5px]">
                  <span className="min-w-0 truncate text-text">
                    {i.ticket_number ? `#${i.ticket_number}` : "—"} {i.contact && <span className="text-text-3">· {i.contact}</span>}
                  </span>
                  <span className="flex shrink-0 items-center gap-2">
                    <Badge tone={i.responded_at ? "good" : "neutral"}>{i.responded_at ? "Answered" : i.source === "auto" ? "Auto" : "Sent manually"}</Badge>
                    <Button size="sm" variant="ghost" aria-label="Copy link" onClick={() => navigator.clipboard?.writeText(`${origin}/s/${survey.id}?t=${i.token}`).catch(() => {})}>
                      <Copy className="h-3.5 w-3.5" />
                    </Button>
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </CardBody>
    </Card>
  );
}

const SENT: Record<string, "good" | "critical" | "neutral"> = { positive: "good", negative: "critical", neutral: "neutral" };

export function SurveyResponsesTable({ brand, survey, rows }: { brand: string; survey: Survey; rows: ResponseRow[] }) {
  const qs = survey.questions;
  const columns: Column<ResponseRow>[] = [
    { key: "created_at", header: "Date", sortable: true, sortValue: (r) => new Date(r.created_at).getTime(), render: (r) => <span className="whitespace-nowrap text-text-2">{dateTimeLabel(r.created_at)}</span>, csv: (r) => new Date(r.created_at).toISOString() },
    {
      key: "score",
      header: "Score",
      align: "right",
      sortable: true,
      sortValue: (r) => r.score,
      render: (r) =>
        r.score == null ? <span className="text-text-3">n/a</span> : (
          <Badge tone={survey.kind === "nps" ? (r.score >= 9 ? "good" : r.score <= 6 ? "critical" : "warning") : r.score >= 4 ? "good" : r.score <= 2 ? "critical" : "warning"}>{r.score}</Badge>
        ),
      csv: (r) => r.score,
    },
    ...qs.filter((q) => q.type !== "rating5" || qs.filter((x) => x.type === "rating5").length > 1).map<Column<ResponseRow>>((q) => ({
      key: `q_${q.id}`,
      header: q.label.length > 30 ? `${q.label.slice(0, 29)}…` : q.label,
      csvHeader: q.label,
      render: (r) => <span className="text-text-2">{r.answers[q.id] == null ? "—" : String(r.answers[q.id])}</span>,
      csv: (r) => (r.answers[q.id] == null ? "" : String(r.answers[q.id])),
    })),
    { key: "comment", header: "Comment", render: (r) => <span className="line-clamp-2 max-w-md text-text">{r.comment || <span className="text-text-3">—</span>}</span>, csv: (r) => r.comment },
    { key: "sentiment", header: "Sentiment", render: (r) => (r.sentiment ? <Badge tone={SENT[r.sentiment] ?? "neutral"}>{r.sentiment}</Badge> : <span className="text-text-3">—</span>), csv: (r) => r.sentiment ?? "" },
    { key: "ticket", header: "Ticket", render: (r) => (r.ticket_id ? <a className="text-link hover:underline" href={`/cx/inbox?brand=${brand}&ticket=${r.ticket_id}`}>#{r.ticket_number}</a> : <span className="text-text-3">Public link</span>), csv: (r) => r.ticket_number ?? "", hideOnMobile: true },
    { key: "contact", header: "Contact", render: (r) => <span className="text-text-2">{r.contact ?? "—"}</span>, csv: (r) => r.contact ?? "", hideOnMobile: true },
    { key: "agent", header: "Agent", render: (r) => <span className="text-text-2">{r.agent ?? "—"}</span>, csv: (r) => r.agent ?? "", hideOnMobile: true },
  ];
  return (
    <DataTable
      title={`Responses (${rows.length})`}
      rows={rows}
      columns={columns}
      rowKey={(r) => r.id}
      defaultSort={{ key: "created_at", dir: "desc" }}
      searchable
      searchPlaceholder="Search comments…"
      searchText={(r) => `${r.comment} ${Object.values(r.answers).join(" ")} ${r.contact ?? ""}`}
      exportName={`${survey.name.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-responses`}
      emptyText="No responses yet. Share the public link or create a personal link for a ticket."
    />
  );
}
