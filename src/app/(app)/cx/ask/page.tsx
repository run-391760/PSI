import { BookOpen, Database, Plus, ShieldCheck, Sparkles } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { requirePageUser } from "@/lib/auth";
import { aiConfigured } from "@/lib/cx/ai";
import { cxContext } from "@/lib/cx/context";
import { listShareLinks } from "@/lib/cx/insights/dashboards";
import { getAiSettings, listBriefs } from "@/lib/cx/insights/intelligence";
import { getMessages, listSessions } from "@/lib/cx/insights/assistant";
import { VAULT_LIMITS, VAULT_TYPES, listVault } from "@/lib/cx/insights/vault";
import { platformHub, readPeriod } from "@/lib/cx/listening/platforms";
import { sourceLabel } from "@/lib/cx/listening/sources";
import { query } from "@/lib/db";
import { brandMailer } from "@/lib/cx/insights/mailer";
import { brandSignals } from "@/lib/cx/insights/signals";
import { dateTimeLabel, num } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Grid, Page, PageHeader } from "@/components/shell/page";
import { Badge, type Tone } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Callout, EmptyState } from "@/components/ui/feedback";
import { Metric, MetricStrip } from "@/components/ui/metric";
import { MiniTable } from "@/components/ui/mini-table";
import { TabsNav } from "@/components/ui/tabs";
import { BrandMeta, NoBrand, cxHref, ticketHref } from "@/components/cx/insights/common";
import { AiSignalButton, BriefSettings, ConnectorTokens } from "@/components/cx/insights/ask-client";
import { AssistantComposer, SessionMenu, VaultAdd, VaultDelete } from "@/components/cx/insights/assistant-client";
import { Markdown } from "@/components/cx/insights/markdown";
import { ButtonLink } from "@/components/ui/button";

export const metadata: Metadata = { title: "Ask AI" };
const LEVEL: Record<string, Tone> = { high: "critical", medium: "warning", low: "good" };

function NoAi({ what }: { what: string }) {
  return (
    <Callout className="mb-4" title="Connect an AI key">
      {what} needs an AI key on the server: set ANTHROPIC_API_KEY (or OPENAI_API_KEY, GEMINI_API_KEY or SARVAM_API_KEY). Any one is enough; the others are used as fallbacks.
    </Callout>
  );
}

export default async function AskPage({ searchParams }: PageProps<"/cx/ask">) {
  const user = await requirePageUser();
  const sp = await searchParams;
  const { brand, switcher } = await cxContext(user.id, sp);
  if (!brand) return <NoBrand title="Ask AI" />;
  const tab = typeof sp.tab === "string" ? sp.tab : "ask";
  const ai = aiConfigured();
  const h = (t: string, extra: Record<string, string | number> = {}) => cxHref("/cx/ask", brand.id, { tab: t, ...extra });

  let body: React.ReactNode;
  if (tab === "signals") {
    const rows = await brandSignals(brand.id, 30);
    const high = rows.filter((r) => r.churn.level === "high").length;
    const esc = rows.filter((r) => r.escalation.level === "high").length;
    const predicted = rows.filter((r) => !r.csat.known);
    const avgPred = predicted.length ? predicted.reduce((s, r) => s + r.csat.value, 0) / predicted.length : null;
    body = (
      <>
        <Card className="mb-4">
          <CardBody className="py-4">
            <MetricStrip>
              <Metric label="Tickets scored" value={num(rows.length)} sub="Open + solved in 30 days" />
              <Metric label="High churn risk" value={num(high)} />
              <Metric label="Likely to escalate" value={num(esc)} />
              <Metric label="Predicted CSAT (unrated)" value={avgPred == null ? "n/a" : avgPred.toFixed(1)} sub={`${predicted.length} tickets without a rating`} />
            </MetricStrip>
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Ticket signals" description="Heuristic scores from sentiment, intent, reopens, SLA breaches, waiting time and repeat contacts. Ranked by churn risk." />
          <CardBody className="pt-1">
            {rows.length === 0 ? (
              <EmptyState title="No tickets to score" description="Signals appear for open tickets and tickets solved in the last 30 days." />
            ) : (
              <MiniTable
                columns={[{ header: "Ticket" }, { header: "Contact" }, { header: "CSAT (pred.)", align: "right" }, { header: "Churn risk" }, { header: "Escalation" }, { header: "Why" }, ...(ai ? [{ header: "" }] : [])]}
                rows={rows.slice(0, 100).map((r) => [
                  <Link key="t" href={ticketHref(brand.id, r.id)} className="text-link hover:underline">#{r.number} <span className="text-text-2">{(r.subject || "(no subject)").slice(0, 50)}</span></Link>,
                  r.contact ?? "n/a",
                  <span key="c" className="tabular-nums">{r.csat.value.toFixed(1)}{r.csat.known ? " ✓" : ""}</span>,
                  <Badge key="ch" tone={LEVEL[r.churn.level]}>{r.churn.level} · {r.churn.score}</Badge>,
                  <Badge key="es" tone={LEVEL[r.escalation.level]}>{r.escalation.level} · {r.escalation.score}</Badge>,
                  <span key="w" className="text-[12px] text-text-2">{[...new Set([...r.churn.reasons, ...r.escalation.reasons])].slice(0, 3).join(" · ") || "No risk factors"}</span>,
                  ...(ai ? [<AiSignalButton key="ai" brand={brand.id} ticketId={r.id} />] : []),
                ])}
              />
            )}
            <p className="mt-3 text-[12px] text-text-3">✓ = actual customer rating. Signals for one ticket are available to the inbox through <code>ticketSignals(projectId, ticketId)</code>.</p>
          </CardBody>
        </Card>
      </>
    );
  } else if (tab === "briefs") {
    const [settings, briefs, mailer] = await Promise.all([getAiSettings(brand.id), listBriefs(brand.id), brandMailer(brand.id)]);
    body = (
      <>
        {!ai && <NoAi what="Writing executive briefs" />}
        <Grid cols={2}>
          <Card>
            <CardHeader title="Executive brief schedule" description="A short leadership summary of volume, speed, SLA, satisfaction, quality and listening, with changes vs the previous period." />
            <CardBody className="pt-1">
              <BriefSettings brand={brand.id} cadence={settings.brief_cadence} recipients={settings.brief_recipients} ai={ai} mailbox={!!mailer} />
              {settings.brief_next_at && <p className="mt-3 text-[12px] text-text-3">Next brief: {dateTimeLabel(settings.brief_next_at)}{ai ? "" : " (skipped until an AI key is connected)"}</p>}
            </CardBody>
          </Card>
          <Card>
            <CardHeader title={`Past briefs (${briefs.length})`} />
            <CardBody className="space-y-3 pt-1">
              {briefs.length === 0 && <p className="py-6 text-center text-[13px] text-text-3">No briefs yet.</p>}
              {briefs.map((b) => (
                <details key={b.id} className="rounded-md border border-border p-2.5" open={b === briefs[0]}>
                  <summary className="cursor-pointer text-[13px] font-medium text-text">
                    {b.period === "weekly" ? "Weekly" : "Monthly"} brief · {dateTimeLabel(b.created_at)}
                  </summary>
                  <p className="mt-2 text-[13px] whitespace-pre-line text-text-2">{b.body}</p>
                </details>
              ))}
            </CardBody>
          </Card>
        </Grid>
      </>
    );
  } else if (tab === "connector") {
    const tokens = await listShareLinks(brand.id, "mcp");
    body = (
      <Grid cols={2}>
        <Card>
          <CardHeader title="MCP connector" description="Let an AI assistant (Claude, ChatGPT or any MCP client) query this brand's aggregated metrics with the get_cx_metrics tool." />
          <CardBody className="pt-1">
            <ConnectorTokens brand={brand.id} tokens={JSON.parse(JSON.stringify(tokens))} />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="What the connector can see" />
          <CardBody className="space-y-2 pt-1 text-[13px] text-text-2">
            <p className="flex gap-2"><ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-good-ink" /> Aggregates only: counts, averages and rates by channel, intent, priority, tag and agent.</p>
            <p className="flex gap-2"><ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-good-ink" /> No message text, contact names, emails or phone numbers are ever returned.</p>
            <p className="flex gap-2"><ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-good-ink" /> Scoped to this brand; revoking a token cuts access immediately. Rate limited to 60 calls per minute.</p>
          </CardBody>
        </Card>
      </Grid>
    );
  } else if (tab === "vault") {
    const [docs, kb] = await Promise.all([listVault(brand.id), query<{ n: number }>("SELECT count(*)::int n FROM cx_kb_articles WHERE project_id=$1 AND status='published'", [brand.id])]);
    body = (
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <Card className="min-w-0">
          <CardHeader title={`Knowledge vault (${docs.length})`} description="Your own reference material for the assistant: prospectus, fee and hostel rules, placement reports, FAQs, policies, press releases. Internal only: never shown to customers." />
          <CardBody className="space-y-4 pt-1">
            <VaultAdd brand={brand.id} accept={VAULT_TYPES} />
            {docs.length === 0 ? (
              <EmptyState icon={<BookOpen className="h-5 w-5" />} title="The vault is empty" description={`Upload ${VAULT_TYPES} files (up to ${VAULT_LIMITS.fileBytes / 1024 / 1024} MB each) or paste text. The assistant cites a document by its title when it uses it.`} />
            ) : (
              <MiniTable
                columns={[{ header: "Document" }, { header: "Size", align: "right" }, { header: "Passages", align: "right" }, { header: "Added" }, { header: "" }]}
                rows={docs.map((d) => [
                  <span key="t" className="block min-w-0"><span className="font-medium text-text">{d.title}</span>{d.filename && <span className="block truncate text-[11.5px] text-text-3">{d.filename}</span>}</span>,
                  d.chars < 1000 ? `${num(d.chars)} chars` : `${num(Math.round(d.chars / 1000))}k chars`,
                  num(d.chunks),
                  <span key="a" className="text-[12px] text-text-2">{dateTimeLabel(d.created_at)}{d.author ? ` · ${d.author}` : ""}</span>,
                  <VaultDelete key="x" brand={brand.id} id={d.id} title={d.title} />,
                ])}
              />
            )}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="How it is used" />
          <CardBody className="space-y-2 pt-1 text-[13px] text-text-2">
            <p>Each question searches the vault and your <Link className="text-link" href={cxHref("/cx/knowledge", brand.id)}>published knowledge base</Link> ({num(kb[0]?.n ?? 0)} articles) and sends only the best matching passages to the AI.</p>
            <p>Documents are split into passages of about 1,200 characters and ranked by keyword relevance, so clear headings and the words people actually use help.</p>
            <p>PDF: copy the text and use Paste text, or save it as .docx.</p>
          </CardBody>
        </Card>
      </div>
    );
  } else {
    const sessionId = typeof sp.session === "string" ? sp.session : null;
    const [sessions, chat, hub, docs] = await Promise.all([
      listSessions(brand.id, user.id),
      sessionId ? getMessages(brand.id, user.id, sessionId) : null,
      platformHub(brand.id, readPeriod({ days: "30" })),
      listVault(brand.id),
    ]);
    const active = hub.filter((c) => c.mentions > 0);
    body = (
      <div className="grid gap-4 lg:grid-cols-[260px_minmax(0,1fr)]">
        <Card className="h-fit min-w-0">
          <CardHeader title="Chats" description="Private to you" actions={<ButtonLink href={h("ask")} size="sm" variant="primary"><Plus className="h-3.5 w-3.5" /> New</ButtonLink>} />
          <CardBody className="pt-0">
            {sessions.length === 0 ? (
              <p className="py-3 text-[12.5px] text-text-3">No chats yet. Ask your first question.</p>
            ) : (
              <ul className="-mx-2 grid gap-0.5">
                {sessions.map((s) => {
                  const on = s.id === chat?.id;
                  return (
                    <li key={s.id} className={cn("flex items-center gap-1 rounded-md px-2 py-1.5", on ? "bg-brand-soft" : "hover:bg-surface-3")}>
                      <Link href={h("ask", { session: s.id })} className="min-w-0 flex-1" aria-current={on ? "page" : undefined}>
                        <span className="block truncate text-[13px] text-text">{s.title}</span>
                        <span className="block text-[11px] text-text-3">{num(Math.ceil(s.messages / 2))} {s.messages > 2 ? "questions" : "question"} · {dateTimeLabel(s.updated_at)}</span>
                      </Link>
                      <SessionMenu brand={brand.id} id={s.id} title={s.title} active={on} />
                    </li>
                  );
                })}
              </ul>
            )}
          </CardBody>
        </Card>

        <div className="min-w-0 space-y-4">
          {!ai && <NoAi what="The assistant" />}
          {sessionId && !chat && <Callout tone="warning" title="Chat not found">It may have been deleted. Start a new chat below.</Callout>}
          <Card>
            <CardHeader title={chat?.title ?? "New chat"} description="Answers from your platform data, support metrics and knowledge vault" />
            <CardBody className="space-y-4 pt-1">
              {chat?.messages.length ? (
                <div className="space-y-4">
                  {chat.messages.map((m) =>
                    m.role === "user" ? (
                      <div key={m.id} className="ml-auto w-fit max-w-[85%] rounded-lg bg-brand-soft px-3 py-2 text-[13.5px] whitespace-pre-line text-text">{m.content}</div>
                    ) : (
                      <div key={m.id} className="max-w-full rounded-lg border border-border bg-surface-2 px-3.5 py-3">
                        <Markdown text={m.content} />
                        {m.sources.length > 0 && (
                          <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-border pt-2.5">
                            <span className="text-[11px] font-semibold tracking-wide text-text-3 uppercase">Sources</span>
                            {m.sources.map((s, i) =>
                              s.url ? (
                                <Link key={i} href={s.url} className="rounded-full border border-border bg-surface px-2 py-0.5 text-[11.5px] text-link hover:underline">{s.label}</Link>
                              ) : (
                                <span key={i} className="flex items-center gap-1 rounded-full border border-border bg-surface px-2 py-0.5 text-[11.5px] text-text-2">
                                  {s.kind === "vault" ? <BookOpen className="h-3 w-3" /> : <Database className="h-3 w-3" />}
                                  {s.label}
                                </span>
                              ),
                            )}
                          </div>
                        )}
                      </div>
                    ),
                  )}
                </div>
              ) : (
                <div className="rounded-lg border border-dashed border-border px-4 py-5">
                  <div className="flex items-center gap-2 text-[15px] font-semibold text-text"><Sparkles className="h-4 w-4 text-brand" /> Your AI data analyst for {brand.name}</div>
                  <p className="mt-1 text-[13px] text-text-2">Ask in plain language. I look up the numbers first, then answer, and show which data and documents I used.</p>
                  <div className="mt-3 flex flex-wrap gap-1.5 text-[12px]">
                    <Badge tone={active.length ? "brand" : "neutral"}><Database className="mr-1 inline h-3 w-3" />{active.length ? `${num(active.reduce((a, c) => a + c.mentions, 0))} mentions on ${active.map((c) => sourceLabel(c.source)).join(", ")} (30d)` : "No mentions in the last 30 days"}</Badge>
                    <Badge tone={docs.length ? "brand" : "neutral"}><BookOpen className="mr-1 inline h-3 w-3" />{docs.length ? `${docs.length} vault ${docs.length === 1 ? "document" : "documents"}` : "Vault empty"}</Badge>
                    <Badge tone="good"><ShieldCheck className="mr-1 inline h-3 w-3" />Support data: aggregates only</Badge>
                  </div>
                  {!docs.length && <p className="mt-2 text-[12px] text-text-3">Add your prospectus, policies and FAQs in the <Link className="text-link" href={h("vault")}>Knowledge vault</Link> so I can answer questions about them.</p>}
                </div>
              )}
              <AssistantComposer brand={brand.id} sessionId={chat?.id ?? null} ai={ai} showSuggestions={!chat?.messages.length} />
            </CardBody>
          </Card>
        </div>
      </div>
    );
  }


  return (
    <Page>
      <PageHeader
        breadcrumbs={[{ label: "CX", href: cxHref("/cx", brand.id) }, { label: "Ask AI" }]}
        title="Ask AI"
        subject={brand.name}
        description="An AI analyst for your listening data, support metrics and own documents, plus executive briefs and predictive signals."
        meta={
          <BrandMeta switcher={switcher} current={brand.id}>
            <Badge tone={ai ? "good" : "neutral"}><Sparkles className="mr-1 inline h-3.5 w-3.5" />{ai ? "AI connected" : "AI not connected"}</Badge>
          </BrandMeta>
        }
      />
      <TabsNav
        className="mb-4"
        items={[
          { href: h("ask"), label: "Assistant" },
          { href: h("vault"), label: "Knowledge vault" },
          { href: h("briefs"), label: "Executive briefs" },
          { href: h("signals"), label: "Signals" },
          { href: h("connector"), label: "Connector (MCP)" },
        ]}
      />
      {body}
    </Page>
  );
}
