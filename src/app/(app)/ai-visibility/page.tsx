import { Bot, KeyRound, ShieldCheck } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { requirePageUser } from "@/lib/auth";
import { database } from "@/lib/domain";
import { compact, displayUrl, timeAgo } from "@/lib/format";
import { latestJob } from "@/lib/jobs/queue";
import { param, projectContext } from "@/lib/local/project-context";
import { aiCompetitorNames, loadAiContext } from "@/lib/ai-visibility/context";
import { suggestPrompts } from "@/lib/ai-visibility/engine";
import { AI_BOTS, ENGINES, type ReadinessResult } from "@/lib/ai-visibility/meta";
import { visibilityReport } from "@/lib/ai-visibility/report";
import { getReadiness, listPrompts, liveResults } from "@/lib/ai-visibility/store";
import { LIVE_ENGINES } from "@/lib/providers/ai-engines";
import type { DataSource } from "@/lib/providers/labels";
import { DomainAvatar } from "@/components/seo/badges";
import { DataSourceBadge, DemoNotice } from "@/components/seo/source-badge";
import { Grid, Page, PageHeader } from "@/components/shell/page";
import { ProjectGate } from "@/components/projects/project-gate";
import { ProjectSwitcher } from "@/components/projects/project-switcher";
import { BarChart } from "@/components/charts/bar-chart";
import { TrendChart } from "@/components/charts/trend-chart";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Callout, EmptyState } from "@/components/ui/feedback";
import { Metric, MetricStrip } from "@/components/ui/metric";
import { MiniTable } from "@/components/ui/mini-table";
import { Bar, ScoreRing } from "@/components/ui/progress";
import { TabsNav } from "@/components/ui/tabs";
import { JobProgress } from "@/components/local/job-progress";
import { LiveResultsTable, LiveRunButton, PromptManager, PromptSetup, PromptsTable, Ratio, ReadinessButton } from "@/components/ai/ai-ui";

export const metadata: Metadata = { title: "AI Visibility" };

const BREADCRUMBS = [{ label: "AI search" }, { label: "AI Visibility", href: "/ai-visibility" }];
const TREND_RANGES = [
  { id: "7d", label: "7D", points: 7 },
  { id: "30d", label: "30D", points: 30 },
];
const pctDelta = (cur: number, prev: number) => (prev ? ((cur - prev) / prev) * 100 : null);
const ratePct = (n: number, d: number) => (d ? Math.round((n / d) * 1000) / 10 : 0);

export default async function AiVisibilityPage({ searchParams }: PageProps<"/ai-visibility">) {
  const user = await requirePageUser();
  const sp = await searchParams;
  const { projects, project, requested, switcher } = await projectContext(user.id, sp);

  if (!project)
    return (
      <Page>
        <PageHeader breadcrumbs={BREADCRUMBS} title="AI Visibility" description="Track how often ChatGPT, Gemini, Perplexity, Google AI Overviews and Claude mention and cite your brand, and whether AI crawlers can reach your site." />
        {requested && <Callout tone="warning" className="mb-4">That project was not found. Choose one of your projects below.</Callout>}
        <ProjectGate projects={projects} basePath="/ai-visibility" title="AI Visibility" description="Choose the brand to track in AI answers." />
      </Page>
    );

  const tab = param(sp, "tab") ?? "overview";
  const [ctx, prompts, readiness, live, names] = await Promise.all([loadAiContext(project), listPrompts(project.id), getReadiness(project.id), liveResults(project.id), aiCompetitorNames(project.id)]);
  const liveJob = await latestJob(project.id, "ai-visibility.run");
  const liveRunning = !!liveJob && (liveJob.status === "queued" || liveJob.status === "running");
  const engineStatus = LIVE_ENGINES.map((e) => ({ id: e.id, name: e.name, env: e.env, enabled: e.enabled(), model: e.model() }));
  const connected = engineStatus.filter((e) => e.enabled);
  const liveOn = connected.length > 0;
  const ENGINE_SOURCE: Record<string, DataSource> = { chatgpt: "openai", gemini: "gemini", perplexity: "perplexity", "google-aio": "dataforseo", claude: "anthropic" };

  const tabs = [
    { href: "/ai-visibility?tab=overview", label: "Overview" },
    { href: "/ai-visibility?tab=prompts", label: "Prompts", count: prompts.length },
    { href: "/ai-visibility?tab=sources", label: "Cited sources" },
    { href: "/ai-visibility?tab=readiness", label: "AI crawler readiness" },
    { href: "/ai-visibility?tab=live", label: "Live answers", count: live.length || undefined },
  ];
  const sourceBadge =
    tab === "readiness" ? (
      <DataSourceBadge source="crawler" fetchedAt={readiness?.checkedAt} />
    ) : tab === "live" ? (
      live.some((r) => !r.error) ? (
        <>
          {[...new Set(live.filter((r) => !r.error).map((r) => r.engine))].map((engine) => {
            const latest = live.find((r) => r.engine === engine && !r.error)!;
            return <DataSourceBadge key={engine} source={ENGINE_SOURCE[engine] ?? "anthropic"} fetchedAt={latest.createdAt} note={latest.model} />;
          })}
        </>
      ) : live.length ? (
        <Badge tone="critical">No successful live answers yet</Badge>
      ) : (
        <Badge>{liveOn ? `${connected.length} engine${connected.length === 1 ? "" : "s"} connected · no checks yet` : "No AI engine connected"}</Badge>
      )
    ) : (
      <DataSourceBadge source="demo" />
    );
  const header = (
    <PageHeader
      breadcrumbs={BREADCRUMBS}
      title="AI Visibility:"
      subject={ctx.brand}
      meta={
        <>
          {sourceBadge}
          <Badge>
            {database(project.country).flag} {database(project.country).name}
          </Badge>
          <Badge>{ctx.category[0].toUpperCase() + ctx.category.slice(1)}</Badge>
          {prompts.length > 0 && (
            <Badge>
              {prompts.length} prompts × {ENGINES.length} engines
            </Badge>
          )}
        </>
      }
      actions={
        <>
          <ProjectSwitcher projects={switcher} current={project.id} />
          {tab === "readiness" && <ReadinessButton projectId={project.id} label={readiness ? "Re-run check" : "Run check"} />}
          {tab === "live" && <LiveRunButton projectId={project.id} engines={engineStatus.map(({ id, name, enabled }) => ({ id, name, enabled }))} enabled={liveOn && prompts.length > 0} running={liveRunning} />}
        </>
      }
    >
      <TabsNav items={tabs} />
    </PageHeader>
  );

  // ------------------------------------------------------------------ readiness (real)
  if (tab === "readiness")
    return (
      <Page>
        {header}
        <ReadinessView domain={project.domain} data={readiness} projectId={project.id} />
      </Page>
    );

  // ------------------------------------------------------------------ live answers (real)
  if (tab === "live") {
    const latestRun = liveJob ? live.filter((r) => r.createdAt >= new Date(liveJob.started_at ?? liveJob.created_at).toISOString()) : [];
    const run = latestRun.length ? latestRun : live.filter((r) => r.createdAt.slice(0, 13) === live[0]?.createdAt.slice(0, 13));
    const perEngine = engineStatus
      .map((e) => {
        const rows = run.filter((r) => r.engine === e.id);
        const ok = rows.filter((r) => !r.error);
        const positions = ok.filter((r) => r.position);
        return {
          ...e,
          checked: rows.length,
          answered: ok.length,
          errors: rows.length - ok.length,
          mentioned: ok.filter((r) => r.mentioned).length,
          cited: ok.filter((r) => r.cited).length,
          avgPosition: positions.length ? positions.reduce((s, r) => s + (r.position ?? 0), 0) / positions.length : null,
        };
      })
      .filter((e) => e.enabled || e.checked);
    const ok = run.filter((r) => !r.error);
    return (
      <Page>
        {header}
        <Card className="mb-4">
          <CardHeader title="Connected AI engines" description="Live checks ask each connected engine your tracked prompts with web search turned on. Add a key in the server environment (.env.local) and restart to connect an engine." />
          <CardBody>
            <MiniTable
              columns={[{ header: "Engine" }, { header: "Status" }, { header: "Model" }, { header: "Environment variables" }]}
              rows={engineStatus.map((e) => [
                <span key="n" className="font-medium text-text">{e.name}</span>,
                e.enabled ? <Badge key="s" tone="good">Connected</Badge> : <Badge key="s">Not connected</Badge>,
                <span key="m" className="text-[12.5px] text-text-2">{e.enabled ? e.model : "n/a"}</span>,
                <code key="v" className="rounded bg-surface-3 px-1 text-[12px]">{e.env.join(", ")}</code>,
              ])}
            />
            <p className="mt-3 text-[12px] text-text-3">API answers can differ from what people see in the consumer apps (personalisation, app-only features). Results here are real and labelled per engine; demo numbers are never mixed in.</p>
          </CardBody>
        </Card>
        {liveRunning && liveJob && <JobProgress jobId={liveJob.id} endpoint="/api/ai/jobs" title="Asking AI engines your prompts" className="mb-4" />}
        {!liveRunning && liveJob?.status === "failed" && (
          <Callout tone="critical" className="mb-4" title="The last live check failed">
            {liveJob.error}
          </Callout>
        )}
        {live.length === 0 ? (
          <Card>
            <EmptyState
              icon={liveOn ? <Bot className="h-5 w-5" /> : <KeyRound className="h-5 w-5" />}
              title={liveOn ? "No live checks yet" : "Connect an AI engine to see real answers"}
              description={liveOn ? (prompts.length ? `Run a live check to ask ${connected.map((e) => e.name).join(", ")} your ${prompts.length} tracked prompts.` : "Add prompts first, then run a live check.") : "Everything else on this page is demo data; this tab only ever shows real answers from the engines you connect."}
            />
          </Card>
        ) : (
          <>
            <Card className="mb-4">
              <MetricStrip>
                <Metric label="Mention rate (latest run)" value={`${ratePct(ok.filter((r) => r.mentioned).length, ok.length)}%`} sub={`${ok.filter((r) => r.mentioned).length} of ${ok.length} answers`} />
                <Metric label="Citation rate" value={`${ratePct(ok.filter((r) => r.cited).length, ok.length)}%`} sub={`${ok.filter((r) => r.cited).length} of ${ok.length} answers cite ${project.domain}`} />
                <Metric label="Engines checked" value={new Set(run.map((r) => r.engine)).size} sub={`${run.length - ok.length} error(s) in the latest run`} />
                <Metric label="Last run" value={timeAgo(live[0].createdAt)} sub={`${live.length} results stored`} />
              </MetricStrip>
            </Card>
            <Card className="mb-4">
              <CardHeader title="By engine (latest run)" description="Rates use answered prompts as the denominator." />
              <CardBody>
                <MiniTable
                  columns={[{ header: "Engine" }, { header: "Answered", align: "right" }, { header: "Mentioned", align: "right" }, { header: "Cited", align: "right" }, { header: "Avg. position", align: "right" }, { header: "Errors", align: "right" }]}
                  rows={perEngine.map((e) => [
                    <span key="n" className="font-medium text-text">{e.name}</span>,
                    `${e.answered} / ${e.checked}`,
                    e.answered ? `${ratePct(e.mentioned, e.answered)}% (${e.mentioned})` : "n/a",
                    e.answered ? `${ratePct(e.cited, e.answered)}% (${e.cited})` : "n/a",
                    e.avgPosition != null ? e.avgPosition.toFixed(1) : "n/a",
                    e.errors,
                  ])}
                />
              </CardBody>
            </Card>
            <Card>
              <CardHeader title="Answers" description="Real responses with web search. Click a prompt to read the answer and its sources." />
              <LiveResultsTable rows={live} brand={ctx.brand} engines={engineStatus.map(({ id, name }) => ({ id, name }))} />
            </Card>
          </>
        )}
      </Page>
    );
  }

  // ------------------------------------------------------------------ demo tracking
  if (!prompts.length)
    return (
      <Page>
        {header}
        <Grid cols={2} className="lg:grid-cols-[1.5fr_1fr]">
          <Card>
            <CardHeader title="Choose prompts to track" description="Prompts are the questions customers ask AI assistants. We check each one across five AI engines every day." />
            <CardBody>
              <PromptSetup projectId={project.id} suggestions={suggestPrompts(ctx, project)} />
            </CardBody>
          </Card>
          <div className="space-y-4">
            <Card>
              <CardHeader title="What you'll measure" />
              <CardBody>
                <ul className="space-y-2 text-[13px] text-text-2">
                  <li>
                    <span className="font-medium text-text">Mention rate</span> — share of AI answers that name {ctx.brand}.
                  </li>
                  <li>
                    <span className="font-medium text-text">Citation rate</span> — share of answers linking to {project.domain}.
                  </li>
                  <li>
                    <span className="font-medium text-text">Share of voice</span> — your mentions vs competitors&apos;.
                  </li>
                  <li>
                    <span className="font-medium text-text">Cited sources</span> — the sites AI engines trust for your topic.
                  </li>
                </ul>
              </CardBody>
            </Card>
            <Callout tone="warning" title="Demo data">
              Answers on this tab are simulated deterministically. Real answers from ChatGPT, Gemini, Perplexity, Google AI Overviews and Claude appear on the Live answers tab for every engine you connect, and the AI crawler readiness check is real.
            </Callout>
          </div>
        </Grid>
      </Page>
    );

  const r = visibilityReport(ctx, prompts);
  const cur = r.current;
  const prev = r.previous;

  if (tab === "prompts")
    return (
      <Page>
        {header}
        <Card className="mb-4">
          <CardHeader title="Manage prompts" description="Add the questions your customers ask; remove ones that are not relevant." />
          <CardBody>
            <PromptManager projectId={project.id} count={prompts.length} competitorNames={names.names.length ? names.names : ctx.competitors.filter((c) => c.domain && project.competitors.includes(c.domain)).map((c) => c.name)} namesSource={names.source} />
          </CardBody>
        </Card>
        <Card className="mb-4">
          <CardHeader title="Prompt-level results" description="Today's answer per engine and the last 7 days. Click a prompt for the answer detail." />
          <PromptsTable projectId={project.id} rows={r.prompts} brand={ctx.brand} />
        </Card>
        <DemoNotice />
      </Page>
    );

  if (tab === "sources")
    return (
      <Page>
        {header}
        <Grid cols={2} className="mb-4 lg:grid-cols-[1.5fr_1fr]">
          <Card>
            <CardHeader title="Cited sources" description={`Domains cited in ${cur.answers} AI answers over the last 7 days`} info="Share = answers citing the domain ÷ all answers with an AI response." />
            <CardBody>
              <MiniTable
                columns={[{ header: "Domain" }, { header: "Cited in", className: "w-44" }, { header: "Engines", align: "right" }, { header: "Type", align: "right" }]}
                rows={r.sources.slice(0, 20).map((s) => [
                  <span key="d" className="inline-flex min-w-0 items-center gap-2">
                    <DomainAvatar domain={s.domain} />
                    <Link href={`/domain-overview?q=${s.domain}&db=${project.country}`} className={s.type === "you" ? "font-semibold text-link hover:underline" : "text-link hover:underline"}>
                      {s.domain}
                    </Link>
                  </span>,
                  <div key="b" className="flex items-center gap-2">
                    <Bar value={s.share} className="w-20" color={s.type === "you" ? "var(--series-1)" : "var(--text-3)"} />
                    <span className="tabular text-[12px] text-text-2">
                      {s.answers}/{cur.answers}
                    </span>
                  </div>,
                  `${s.engines.length}/5`,
                  s.type === "you" ? <Badge key="t" tone="brand">You</Badge> : s.type === "competitor" ? <Badge key="t" tone="warning">Competitor</Badge> : <span key="t" className="text-text-3">Other</span>,
                ])}
              />
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Your cited pages" description={`${cur.cited} of ${cur.answers} answers cite ${project.domain}`} />
            <CardBody>
              <MiniTable
                empty="Your pages were not cited in the last 7 days."
                columns={[{ header: "Page" }, { header: "Citations", align: "right" }]}
                rows={r.pages.map((p) => [
                  <a key="u" href={p.url} target="_blank" rel="noopener noreferrer" className="block max-w-[300px] truncate text-link hover:underline" title={p.url}>
                    {displayUrl(p.url)}
                  </a>,
                  p.citations,
                ])}
              />
              <p className="mt-3 text-[12px] text-text-3">Pages that AI engines cite tend to answer questions directly, with clear headings, facts and structured data. Check yours with the readiness tab and Site Audit.</p>
            </CardBody>
          </Card>
        </Grid>
        <DemoNotice />
      </Page>
    );

  // ------------------------------------------------------------------ overview
  const avgPos = cur.positionN ? (cur.positionSum / cur.positionN).toFixed(1) : "n/a";
  const prevAvgPos = prev.positionN ? prev.positionSum / prev.positionN : null;
  const lowest = [...r.prompts].sort((a, b) => a.score - b.score).slice(0, 5);
  return (
    <Page>
      {header}
      <Card className="mb-4">
        <MetricStrip>
          <div className="flex items-center gap-3">
            <ScoreRing value={r.score} size={64} stroke={7} label={String(r.score)} color="var(--series-1)" />
            <Metric label="AI visibility score" value={`${r.score}/100`} delta={pctDelta(r.score, r.prevScore)} deltaLabel="vs prior 7d" info="50% mention rate + 30% citation rate + 20% prominence (1 ÷ position) across all AI answers in the last 7 days." />
          </div>
          <Metric label="Mention rate" value={`${ratePct(cur.mentioned, cur.answers)}%`} delta={pctDelta(ratePct(cur.mentioned, cur.answers), ratePct(prev.mentioned, prev.answers))} sub={`${cur.mentioned} of ${cur.answers} answers`} />
          <Metric label="Citation rate" value={`${ratePct(cur.cited, cur.answers)}%`} delta={pctDelta(ratePct(cur.cited, cur.answers), ratePct(prev.cited, prev.answers))} sub={`${cur.cited} of ${cur.answers} answers cite your site`} />
          <Metric label="Avg. position" value={avgPos} delta={prevAvgPos && cur.positionN ? pctDelta(cur.positionSum / cur.positionN, prevAvgPos) : null} upIsGood={false} sub={`Across ${cur.positionN} answers naming you`} />
          <Metric label="Share of voice" value={`${r.sov}%`} delta={pctDelta(r.sov, r.prevSov)} sub={`${cur.brandMentions[ctx.brand]} of ${Object.values(cur.brandMentions).reduce((s, v) => s + v, 0)} brand mentions`} />
        </MetricStrip>
      </Card>

      <Grid cols={2} className="mb-4 lg:grid-cols-[1.6fr_1fr]">
        <Card>
          <CardHeader title="Mention rate by engine" description="Share of answers naming your brand, per day" />
          <CardBody>
            <TrendChart data={r.trend} xKey="day" xFormat="day" yFormat="percent" ranges={TREND_RANGES} defaultRange="30d" series={ENGINES.map((e) => ({ key: e.id, label: e.name }))} height={250} yDomain={[0, 100]} />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Share of voice" description={`Brand mentions in ${cur.answers} answers, last 7 days`} />
          <CardBody>
            <BarChart data={r.sovRows.map((s) => ({ name: s.name, mentions: s.mentions }))} xKey="name" layout="bars" series={[{ key: "mentions", label: "Mentions" }]} yFormat="number" valueLabels highlight={ctx.brand} categoryWidth={120} height={Math.max(170, r.sovRows.length * 40)} />
          </CardBody>
        </Card>
      </Grid>

      <Card className="mb-4">
        <CardHeader title="Engines" description="Last 7 days · denominators are answers where the engine showed an AI response" />
        <CardBody>
          <MiniTable
            columns={[{ header: "Engine" }, { header: "Answers", align: "right" }, { header: "Mentioned", align: "right" }, { header: "Cited", align: "right" }, { header: "Avg. pos.", align: "right" }, { header: "Share of voice", align: "right" }, { header: "Score", align: "right" }]}
            rows={r.engines.map((e) => [
              <span key="n" className="font-medium">
                {e.name}
              </span>,
              <span key="a" className="tabular">
                {e.answers}
                {e.answers < e.possible && <span className="ml-1 text-[11.5px] text-text-3">of {e.possible} checks</span>}
              </span>,
              <Ratio key="m" n={e.mentioned} d={e.answers} />,
              <Ratio key="c" n={e.cited} d={e.answers} />,
              e.avgPosition?.toFixed(1) ?? "n/a",
              `${e.sov}%`,
              <span key="s" className="tabular inline-flex items-center gap-1.5">
                <span className="font-semibold">{e.score}</span>
                {e.prevScore > 0 && (e.score === e.prevScore ? <span className="text-[11.5px] text-text-3">±0</span> : <span className={e.score > e.prevScore ? "text-[11.5px] text-good-ink" : "text-[11.5px] text-critical-ink"}>{e.score > e.prevScore ? "▲" : "▼"} {Math.abs(e.score - e.prevScore)}</span>)}
              </span>,
            ])}
          />
        </CardBody>
      </Card>

      <Grid cols={2} className="mb-4">
        <Card>
          <CardHeader title="Top cited sources" description="Where AI engines get their answers" href={`/ai-visibility?project=${project.id}&tab=sources`} />
          <CardBody>
            <MiniTable
              columns={[{ header: "Domain" }, { header: "Cited in", align: "right" }, { header: "Type", align: "right" }]}
              rows={r.sources.slice(0, 7).map((s) => [
                <span key="d" className="inline-flex items-center gap-2">
                  <DomainAvatar domain={s.domain} />
                  <span className={s.type === "you" ? "font-semibold" : ""}>{s.domain}</span>
                </span>,
                <span key="c" className="tabular">
                  {s.answers}/{cur.answers} <span className="text-[11.5px] text-text-3">{s.share}%</span>
                </span>,
                s.type === "you" ? <Badge key="t" tone="brand">You</Badge> : s.type === "competitor" ? <Badge key="t" tone="warning">Competitor</Badge> : <span key="t" className="text-text-3">Other</span>,
              ])}
            />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Biggest opportunities" description="Prompts where AI engines rarely mention you" href={`/ai-visibility?project=${project.id}&tab=prompts`} />
          <CardBody>
            <MiniTable
              columns={[{ header: "Prompt" }, { header: "Mentioned", align: "right" }, { header: "Top competitor", align: "right" }]}
              rows={lowest.map((p) => [<span key="p" className="block max-w-[280px] truncate" title={p.prompt}>{p.prompt}</span>, <Ratio key="m" n={p.mentioned} d={p.answers} />, <span key="c" className="text-text-2">{p.topCompetitor ?? "—"}</span>])}
            />
          </CardBody>
        </Card>
      </Grid>
      {readiness && <ReadinessStrip data={readiness.result} projectId={project.id} />}
      <p className="text-[12px] text-text-3">
        AI answers on this tab are <span className="font-medium text-warning-ink">Demo data</span> generated deterministically per prompt, engine and day. {liveOn ? `Real answers from ${connected.map((e) => e.name).join(", ")} are on the Live answers tab.` : "Connect an AI engine (API key) to add real answers on the Live answers tab."}
      </p>
      <DemoNotice className="mt-2" />
    </Page>
  );
}

function ReadinessStrip({ data, projectId }: { data: ReadinessResult; projectId: string }) {
  const blocked = data.bots.filter((b) => b.status === "blocked");
  return (
    <Callout tone={blocked.length ? "warning" : "good"} className="mb-4" title="AI crawler readiness (live check)" action={<Link href={`/ai-visibility?project=${projectId}&tab=readiness`} className="text-[12.5px] text-link hover:underline">Details →</Link>}>
      {blocked.length ? `${blocked.length} of ${data.bots.length} AI crawlers are blocked by robots.txt (${blocked.map((b) => b.agent).join(", ")}).` : `All ${data.bots.length} AI crawlers can access ${data.domain}.`} llms.txt {data.llms.found ? "is present" : "is missing"}.
    </Callout>
  );
}

const STATUS_BADGE = {
  allowed: { label: "Allowed", tone: "good" },
  partial: { label: "Allowed", tone: "good" },
  blocked: { label: "Blocked", tone: "critical" },
  unknown: { label: "Unknown", tone: "neutral" },
} as const;

function ReadinessView({ domain, data, projectId }: { domain: string; data: { result: ReadinessResult; checkedAt: string } | null; projectId: string }) {
  if (!data)
    return (
      <Card>
        <EmptyState
          icon={<ShieldCheck className="h-5 w-5" />}
          title="Check whether AI crawlers can reach your site"
          description={`We fetch ${domain}/robots.txt, /llms.txt and your homepage (live) and report access for GPTBot, OAI-SearchBot, ClaudeBot, PerplexityBot, Google-Extended, CCBot, Applebot-Extended and more.`}
          action={<ReadinessButton projectId={projectId} />}
        />
      </Card>
    );
  const d = data.result;
  const allowed = d.bots.filter((b) => b.status === "allowed" || b.status === "partial").length;
  const searchBlocked = d.bots.filter((b) => b.status === "blocked" && AI_BOTS.find((x) => x.agent === b.agent)?.kind !== "training");
  const recs: string[] = [];
  if (searchBlocked.length) recs.push(`Unblock ${searchBlocked.map((b) => b.agent).join(", ")}: these crawlers power AI search answers and citations, not model training.`);
  if (d.bots.some((b) => b.status === "blocked" && AI_BOTS.find((x) => x.agent === b.agent)?.kind === "training")) recs.push("Training crawlers are blocked. That is a valid choice; it does not stop AI search engines from citing you if their search crawlers are allowed.");
  if (!d.llms.found) recs.push("Publish /llms.txt: a Markdown summary of your most important pages that AI tools can read quickly.");
  if (!d.robots.found) recs.push("Add a robots.txt with a Sitemap line so crawlers find all of your pages.");
  else if (!d.robots.sitemaps.length) recs.push("Add a Sitemap: line to robots.txt.");
  if (d.homepage.words < 150) recs.push("Your homepage has little text in the HTML. Server-render key content so AI crawlers that don't run JavaScript can read it.");
  if (d.homepage.noai) recs.push("Your pages carry a noai / noimageai directive, which asks AI systems not to use the content.");
  if (!d.homepage.structured.length) recs.push("Add Organization and WebSite structured data (JSON-LD) so AI engines can identify your brand.");
  return (
    <>
      <p className="mb-3 text-[12.5px] text-text-3">
        Checked {d.checkedUrl} {timeAgo(data.checkedAt)} · live fetch of robots.txt, llms.txt and the homepage.
      </p>
      <Card className="mb-4">
        <MetricStrip>
          <Metric label="AI crawlers allowed" value={`${allowed}/${d.bots.length}`} sub={d.robots.found ? "From robots.txt" : "No robots.txt: everything allowed"} />
          <Metric label="robots.txt" value={d.robots.found ? "Found" : d.robots.status === 404 ? "Missing" : d.robots.error ? "Error" : `HTTP ${d.robots.status ?? "n/a"}`} sub={d.robots.found ? `${compact(d.robots.bytes)} bytes · ${d.robots.sitemaps.length} sitemap(s)` : (d.robots.error ?? "")} />
          <Metric label="llms.txt" value={d.llms.found ? "Present" : "Missing"} sub={d.llms.found ? `${d.llms.sections} sections · ${d.llms.links} links` : `HTTP ${d.llms.status ?? "n/a"}`} />
          <Metric label="Homepage text" value={d.homepage.status === 200 ? compact(d.homepage.words) : `HTTP ${d.homepage.status ?? "n/a"}`} sub={d.homepage.status === 200 ? "Words in the raw HTML" : (d.homepage.error ?? "Not readable")} />
        </MetricStrip>
      </Card>
      <Grid cols={2} className="mb-4 lg:grid-cols-[1.6fr_1fr]">
        <Card>
          <CardHeader title="AI crawler access" description="What each crawler may fetch according to robots.txt" />
          <CardBody>
            <MiniTable
              columns={[{ header: "Crawler" }, { header: "Purpose" }, { header: "Access" }, { header: "Rule", align: "right" }]}
              rows={d.bots.map((b) => {
                const meta = AI_BOTS.find((x) => x.agent === b.agent)!;
                return [
                  <span key="a">
                    <span className="font-medium text-text">{b.agent}</span>
                    <span className="block text-[11.5px] text-text-3">{meta.owner}</span>
                  </span>,
                  <span key="p" className="block max-w-[260px] text-[12.5px] text-text-2">
                    <Badge className="mr-1.5">{meta.kind === "training" ? "Training" : meta.kind === "search" ? "AI search" : "User fetch"}</Badge>
                    {meta.purpose}
                  </span>,
                  <span key="s" className="inline-flex flex-col items-start gap-0.5">
                    <Badge tone={STATUS_BADGE[b.status].tone}>{STATUS_BADGE[b.status].label}</Badge>
                    {b.status === "partial" && (
                      <span className="text-[11px] text-text-3" title={b.disallowed.join("  ")}>
                        except {b.disallowed.length} path{b.disallowed.length > 1 ? "s" : ""}
                      </span>
                    )}
                  </span>,
                  <span key="r" className="text-[12px] text-text-3">
                    {b.rule === "explicit" ? "Own rule" : b.rule === "wildcard" ? "User-agent: *" : "No rule"}
                  </span>,
                ];
              })}
            />
          </CardBody>
        </Card>
        <div className="space-y-4">
          <Card>
            <CardHeader title="Recommendations" />
            <CardBody>
              {recs.length ? (
                <ul className="space-y-2 text-[13px] text-text-2">
                  {recs.map((t) => (
                    <li key={t} className="flex gap-2">
                      <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-warning" />
                      {t}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-[13px] text-good-ink">Your site is open to AI crawlers and publishes llms.txt. Nice.</p>
              )}
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="llms.txt" description={d.llms.found ? `${compact(d.llms.bytes)} bytes${d.llmsFull.found ? " · llms-full.txt also present" : ""}` : "Not found"} />
            <CardBody className="text-[13px] text-text-2">
              {d.llms.found ? (
                <>
                  <div className="font-medium text-text">{d.llms.title ?? "Untitled"}</div>
                  <div className="mt-1">
                    {d.llms.sections} sections · {d.llms.links} links
                  </div>
                  <a href={`${d.checkedUrl}/llms.txt`} target="_blank" rel="noopener noreferrer" className="mt-2 inline-block text-link hover:underline">
                    Open llms.txt →
                  </a>
                </>
              ) : (
                <p>
                  llms.txt is a proposed standard: a Markdown file at your site root that lists key pages with short descriptions, helping AI tools find authoritative content. {d.llms.status ? `The request returned HTTP ${d.llms.status}.` : ""}
                </p>
              )}
            </CardBody>
          </Card>
          {d.homepage.structured.length > 0 && (
            <Card>
              <CardHeader title="Structured data on the homepage" />
              <CardBody className="flex flex-wrap gap-1.5">
                {d.homepage.structured.map((s) => (
                  <Badge key={s}>{s}</Badge>
                ))}
              </CardBody>
            </Card>
          )}
        </div>
      </Grid>
    </>
  );
}
