import { ArrowLeft, Download } from "lucide-react";
import Link from "next/link";
import { CHECK_MAP, CHECKS, SEVERITY_ORDER } from "@/lib/site-audit/checks";
import { issueRows, issueSamples } from "@/lib/site-audit/data";
import { IssueTable } from "@/components/site-audit/issue-table";
import { IssuesList, type IssueItem } from "@/components/site-audit/issues-list";
import { CountDelta, SEV_TONE, SeverityIcon, SEV_LABEL } from "@/components/site-audit/ui";
import { Grid } from "@/components/shell/page";
import { Badge } from "@/components/ui/badge";
import { buttonClass } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Callout } from "@/components/ui/feedback";
import type { AuditCtx } from "./context";

export async function IssuesView({ ctx }: { ctx: AuditCtx }) {
  const { crawl, previous, href, sp } = ctx;
  const exportBase = `/api/site-audit/export?crawl=${crawl.id}`;
  const fetched = crawl.stats.fetched ?? crawl.pages_crawled;
  const check = sp.issue ? CHECK_MAP[sp.issue] : null;

  if (check) {
    const rows = crawl.details_pruned ? [] : await issueRows(crawl.id, check.id);
    const count = crawl.stats.byCheck[check.id] ?? 0;
    const pages = crawl.stats.pagesByCheck?.[check.id] ?? 0;
    const prev = previous ? (previous.byCheck?.[check.id] ?? 0) : null;
    return (
      <>
        <Link href={href({ tab: "issues" })} className="mb-3 inline-flex items-center gap-1 text-[12.5px] text-link hover:underline">
          <ArrowLeft className="h-3.5 w-3.5" /> All issues
        </Link>
        <Card className="mb-4">
          <div className="flex flex-wrap items-start gap-3 px-4 py-4">
            <SeverityIcon severity={check.severity} className="mt-1 h-5 w-5" />
            <div className="min-w-0 flex-1">
              <h2 className="text-[18px] font-semibold text-text">{check.title}</h2>
              <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[12.5px] text-text-3">
                <Badge tone={SEV_TONE[check.severity]}>{SEV_LABEL[check.severity]}</Badge>
                <Badge>{check.category}</Badge>
                <span>
                  {count.toLocaleString()} {check.scope === "link" ? "affected links" : check.scope === "site" ? "site-wide finding" + (count === 1 ? "" : "s") : "affected pages"}
                  {check.scope !== "site" && fetched ? ` · ${Math.round((pages / fetched) * 1000) / 10}% of crawled pages` : ""}
                </span>
                {prev != null && (
                  <span>
                    · previous crawl {prev.toLocaleString()} <CountDelta delta={count - prev} />
                  </span>
                )}
                <span className="font-mono text-[11.5px]">{check.id}</span>
              </div>
            </div>
            <a href={`${exportBase}&type=issue&check=${check.id}`} className={buttonClass("secondary", "sm")}>
              <Download className="h-3.5 w-3.5" /> Export CSV
            </a>
          </div>
        </Card>
        <Grid cols={2} className="mb-4 lg:grid-cols-[1fr_2.2fr]">
          <Card>
            <CardHeader title="Why and how to fix it" />
            <CardBody className="space-y-3 text-[13px] leading-relaxed text-text-2">
              <div>
                <div className="mb-0.5 text-[12px] font-semibold tracking-wide text-text-3 uppercase">Why it matters</div>
                <p>{check.why}</p>
              </div>
              <div>
                <div className="mb-0.5 text-[12px] font-semibold tracking-wide text-text-3 uppercase">How to fix</div>
                <p>{check.how}</p>
              </div>
            </CardBody>
          </Card>
          <Card>
            <CardHeader title={check.scope === "link" ? "Affected links" : check.scope === "site" ? "Affected resource" : "Affected URLs"} description={rows.length ? `${rows.length.toLocaleString()} rows${rows.length >= 20000 ? " (first 20,000)" : ""}` : undefined} />
            {crawl.details_pruned ? (
              <CardBody>
                <Callout tone="warning">URL-level details of this older crawl were pruned.</Callout>
              </CardBody>
            ) : rows.length ? (
              <IssueTable rows={rows} exportName={`site-audit-${ctx.project.domain}-${check.id}`} scope={check.scope} />
            ) : (
              <CardBody>
                <p className="py-8 text-center text-[13px] text-good-ink">No affected URLs in this crawl — this check passed.</p>
              </CardBody>
            )}
          </Card>
        </Grid>
      </>
    );
  }

  const samples = crawl.details_pruned ? [] : await issueSamples(crawl.id, 3);
  const byCheck = new Map<string, { url: string; detail: string }[]>();
  for (const s of samples) (byCheck.get(s.check_id) ?? byCheck.set(s.check_id, []).get(s.check_id)!).push({ url: s.url, detail: s.detail });
  const items: IssueItem[] = CHECKS.map((c) => ({
    id: c.id,
    title: c.title,
    severity: c.severity,
    category: c.category,
    scope: c.scope,
    count: crawl.stats.byCheck[c.id] ?? 0,
    pages: crawl.stats.pagesByCheck?.[c.id] ?? 0,
    prev: previous ? (previous.byCheck?.[c.id] ?? 0) : null,
    why: c.why,
    how: c.how,
    samples: byCheck.get(c.id) ?? [],
  })).sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || b.count - a.count || a.title.localeCompare(b.title));

  return (
    <Card>
      <CardHeader
        title="Issues"
        description={`${CHECKS.length} checks · ${crawl.errors.toLocaleString()} errors, ${crawl.warnings.toLocaleString()} warnings, ${crawl.notices.toLocaleString()} notices${previous ? " · change vs previous crawl on the right" : ""}`}
      />
      <IssuesList items={items} totalPages={fetched} exportBase={exportBase} initialSeverity={sp.severity} initialCategory={sp.category} />
    </Card>
  );
}
