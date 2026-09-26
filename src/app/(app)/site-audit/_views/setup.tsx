import { Bot, FileSearch, Gauge, ShieldCheck } from "lucide-react";
import type { Project } from "@/lib/projects";
import { CHECKS, THEMES } from "@/lib/site-audit/checks";
import type { AuditConfig } from "@/lib/site-audit/types";
import { AuditSettingsForm } from "@/components/site-audit/settings-form";
import { Grid } from "@/components/shell/page";
import { Card, CardBody, CardHeader } from "@/components/ui/card";

/** First-run view: crawl settings + what the audit checks. */
export function SetupView({ project, config }: { project: Project; config: AuditConfig }) {
  const bySev = { error: 0, warning: 0, notice: 0 };
  for (const c of CHECKS) bySev[c.severity]++;
  const byCat = new Map<string, number>();
  for (const c of CHECKS) byCat.set(c.category, (byCat.get(c.category) ?? 0) + 1);
  return (
    <Grid cols={2} className="lg:grid-cols-[1.7fr_1fr]">
      <Card>
        <CardHeader title="Set up Site Audit" description={`Configure how SynapseSEOBot crawls ${project.domain}, then start the audit. You can change these settings any time.`} />
        <CardBody>
          <AuditSettingsForm projectId={project.id} domain={project.domain} initial={config} mode="setup" />
        </CardBody>
      </Card>
      <div className="space-y-4">
        <Card>
          <CardHeader title={`${CHECKS.length} checks in ${byCat.size} categories`} description={`${bySev.error} errors · ${bySev.warning} warnings · ${bySev.notice} notices`} />
          <CardBody>
            <ul className="divide-y divide-border text-[13px]">
              {[...byCat.entries()].map(([cat, n]) => (
                <li key={cat} className="flex items-center justify-between py-1.5">
                  <span className="text-text-2">{cat}</span>
                  <span className="tabular font-medium text-text">{n}</span>
                </li>
              ))}
            </ul>
            <p className="mt-3 text-[12px] text-text-3">Thematic reports: {THEMES.map((t) => t.label).join(", ")}.</p>
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="How the crawl works" />
          <CardBody>
            <ul className="space-y-3 text-[12.5px] text-text-2">
              <li className="flex gap-2.5">
                <Bot className="mt-0.5 h-4 w-4 shrink-0 text-text-3" />
                <span>
                  Identifies honestly as <span className="font-mono text-[12px] text-text">SynapseSEOBot/1.0</span>, always obeys robots.txt (including Crawl-delay) and spaces requests to each host.
                </span>
              </li>
              <li className="flex gap-2.5">
                <FileSearch className="mt-0.5 h-4 w-4 shrink-0 text-text-3" />
                <span>Breadth-first from the start URL (and/or your XML sitemap), recording status codes, redirect chains, meta tags, headings, canonicals, hreflang, structured data, links and security headers.</span>
              </li>
              <li className="flex gap-2.5">
                <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-text-3" />
                <span>Also checks robots.txt, sitemap.xml, llms.txt, HTTPS redirect, the TLS certificate and www/non-www consistency, plus a sample of external links.</span>
              </li>
              <li className="flex gap-2.5">
                <Gauge className="mt-0.5 h-4 w-4 shrink-0 text-text-3" />
                <span>Measures Core Web Vitals for the homepage and top pages with Google PageSpeed Insights when available.</span>
              </li>
            </ul>
          </CardBody>
        </Card>
      </div>
    </Grid>
  );
}
