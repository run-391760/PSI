import { getDomainOverview, type DomainOverview } from "@/lib/competitive/domain-overview";
import { database } from "@/lib/domain";
import { findProject, type Project } from "@/lib/projects";
import { projectSummaries } from "@/lib/projects/summaries";
import type { ToolSummary } from "@/lib/projects/summary-types";
import type { DataSource } from "@/lib/providers/labels";
import { anchors, backlinks, domainEntity, domainFacts, linkVelocity, referringDomains, toxicity } from "@/lib/seo/engine";
import { overview as blOverview, summary as blSummary } from "@/lib/backlinks/live";
import { query } from "@/lib/db";
import { demoAllowed } from "@/lib/data-mode";
import { cached, liveEnabled } from "@/lib/providers/source";
import { listCrawls } from "@/lib/site-audit/data";
import { backlinkReportFromLive, rankingRows, slimFromOverview, type BacklinkReportData, type SlimFacts } from "./data-map";
import { projectGoogle, type ProjectGoogleState } from "./google-project";
import { reportAvailability } from "./index";
import type { JobListRow } from "./kinds";
import { listJobRows } from "./platform";
import type { Availability, ReportRecord } from "./templates";

export type { BacklinkReportData, SlimFacts };

/**
 * Data behind a saved report, from real sources only: DataForSEO (domain, backlink, comparison
 * reports and project competitor/backlink sections), Search Console/GA4, Site Audit crawls and
 * Position Tracking's stored rankings. The demo engine is used only when DEMO_DATA=true.
 * Everything returned is serializable so charts (client components) can render it.
 */

export function slimFacts(domain: string, db: string): SlimFacts {
  const f = domainFacts(domain, db);
  return {
    domain,
    authorityScore: f.authorityScore,
    organicTraffic: f.organicTraffic,
    organicKeywords: f.organicKeywords,
    trafficChangePct: f.trafficChangePct,
    paidTraffic: f.paidTraffic,
    paidKeywords: f.paidKeywords,
    backlinks: f.backlinks,
    referringDomains: f.referringDomains,
    referringIps: f.referringIps,
    followRatio: f.followRatio,
    topicName: f.topicName,
    history: f.history.map((h) => ({
      month: h.month,
      organicTraffic: h.organicTraffic,
      organicKeywords: h.organicKeywords,
      top3: h.top3,
      top10: h.top10,
      referringDomains: h.referringDomains,
      backlinks: h.backlinks,
      authorityScore: h.authorityScore,
    })),
  };
}

function backlinkData(domain: string): BacklinkReportData {
  const home = domainEntity(domain).homeDb;
  const facts = slimFacts(domain, home);
  const rds = referringDomains(domain);
  const bl = backlinks(domain);
  const types = new Map<string, number>();
  for (const b of bl) types.set(b.type, (types.get(b.type) ?? 0) + 1);
  const blScale = facts.backlinks / Math.max(1, bl.length);
  const rdScale = facts.referringDomains / Math.max(1, rds.length);
  const scored = rds.map((r) => ({ domain: r.domain, ...toxicity(r) }));
  const band = (min: number, max: number) => Math.round(scored.filter((s) => s.score >= min && s.score <= max).length * rdScale);
  return {
    facts,
    velocity: linkVelocity(domain, 90),
    referring: [...rds]
      .sort((a, b) => b.authorityScore - a.authorityScore)
      .slice(0, 10)
      .map((r) => ({ domain: r.domain, authorityScore: r.authorityScore, backlinks: r.backlinks, country: r.country, firstSeen: r.firstSeen, follow: r.follow })),
    anchors: anchors(domain)
      .slice(0, 10)
      .map((a) => ({ anchor: a.anchor, type: a.type, referringDomains: a.referringDomains, backlinks: a.backlinks })),
    types: [...types.entries()].map(([type, n]) => ({ type, count: Math.round(n * blScale) })).sort((a, b) => b.count - a.count),
    toxicity: [
      { label: "Non-toxic (0–44)", value: band(0, 44) },
      { label: "Potentially toxic (45–59)", value: band(45, 59) },
      { label: "Toxic (60–100)", value: band(60, 100) },
    ],
    toxicSample: scored
      .filter((s) => s.score >= 45)
      .sort((a, b) => b.score - a.score)
      .slice(0, 8),
  };
}

export type AuditBrief = { id: string; health: number | null; errors: number; warnings: number; notices: number; pages: number; finishedAt: string | null; status: string };

export type ReportData =
  | { template: "needs"; providers: ("dataforseo" | "google")[]; reason: string }
  | { template: "domain"; source: DataSource; fetchedAt: string; overview: DomainOverview }
  | {
      template: "project";
      source: DataSource;
      fetchedAt: string;
      project: Pick<Project, "id" | "name" | "domain" | "country" | "device" | "location" | "competitors" | "brand_terms" | "created_at">;
      available: Availability;
      google: ProjectGoogleState;
      audit: AuditBrief[];
      rankings: (ReturnType<typeof rankingRows> & { source: string }) | null;
      overview: DomainOverview | null;
      summaries: ToolSummary[];
      competitors: SlimFacts[];
      jobs: JobListRow[];
    }
  | { template: "backlinks"; source: DataSource; fetchedAt: string; backlinks: BacklinkReportData }
  | { template: "comparison"; source: DataSource; fetchedAt: string; domains: SlimFacts[] }
  | { template: "missing"; reason: string };

async function trackedRankings(project: Project) {
  try {
    const [campaign] = await query<{ device: string }>("SELECT device FROM pt_campaigns WHERE project_id=$1", [project.id]);
    if (!campaign) return null;
    const device = campaign.device === "mobile" ? "mobile" : "desktop";
    const rows = await query<{ keyword: string; day: string; pos: string | null; url: string | null; source: string }>(
      `SELECT k.keyword, r.day, r.positions->>$2 AS pos, r.urls->>$2 AS url, r.source
         FROM pt_rankings r JOIN pt_keywords k ON k.id=r.keyword_id
        WHERE r.project_id=$1 AND r.device=$3 AND ($4::boolean OR r.source <> 'demo')
          AND r.day IN (SELECT DISTINCT day FROM pt_rankings WHERE project_id=$1 AND device=$3 AND ($4::boolean OR source <> 'demo') ORDER BY day DESC LIMIT 2)
        LIMIT 2000`,
      [project.id, project.domain, device, demoAllowed()],
    );
    if (!rows.length) return null;
    return { ...rankingRows(rows), source: rows[0].source };
  } catch {
    return null;
  }
}

async function auditHistory(projectId: string): Promise<AuditBrief[]> {
  try {
    const crawls = await listCrawls(projectId, 12);
    return crawls
      .filter((c) => c.status === "done" || c.status === "stopped")
      .map((c) => ({ id: c.id, health: c.health, errors: c.errors, warnings: c.warnings, notices: c.notices, pages: c.pages_crawled, finishedAt: c.finished_at ?? c.started_at, status: c.status }));
  } catch {
    return [];
  }
}

const liveOrDemo = () => liveEnabled() || demoAllowed();

export async function loadReportData(ownerId: string, report: ReportRecord): Promise<ReportData> {
  const db = database(report.db).code;
  const now = new Date().toISOString();
  const available = reportAvailability();
  const needsDfs = { template: "needs" as const, providers: ["dataforseo" as const], reason: "This report is built from web-scale index data (DataForSEO), which is not connected on this server." };
  switch (report.template) {
    case "domain": {
      if (!liveOrDemo()) return needsDfs;
      const o = await getDomainOverview(ownerId, report.subject, db);
      return { template: "domain", source: o.source, fetchedAt: o.fetchedAt, overview: o.data };
    }
    case "project": {
      const project = report.project_id ? await findProject(ownerId, report.project_id) : null;
      if (!project) return { template: "missing", reason: "The project for this report was deleted." };
      const has = (id: string) => report.sections.includes(id);
      const wantsIndex = (has("competitors") || has("backlinks")) && liveOrDemo();
      const [google, audit, rankings, summaries, jobs, overview] = await Promise.all([
        has("summary") || has("search") || has("queries") || has("pages") ? projectGoogle(project) : Promise.resolve({ state: "not-linked" } as ProjectGoogleState),
        has("audit") ? auditHistory(project.id) : Promise.resolve([]),
        has("rankings") ? trackedRankings(project) : Promise.resolve(null),
        has("tools") ? projectSummaries(project) : Promise.resolve([]),
        has("activity") ? listJobRows(ownerId, { projectId: project.id, limit: 10 }) : Promise.resolve([]),
        wantsIndex ? getDomainOverview(ownerId, project.domain, project.country).catch(() => null) : Promise.resolve(null),
      ]);
      let competitors: SlimFacts[] = [];
      if (has("competitors") && liveOrDemo())
        competitors = demoAllowed() && !liveEnabled()
          ? [project.domain, ...project.competitors].slice(0, 6).map((d) => slimFacts(d, project.country))
          : (await Promise.all([project.domain, ...project.competitors].slice(0, 6).map((d) => getDomainOverview(ownerId, d, project.country).then((o) => slimFromOverview(o.data)).catch(() => null)))).filter((x): x is SlimFacts => !!x);
      const source: DataSource = google.state === "ready" ? "search-console" : overview?.source ?? "user";
      return {
        template: "project",
        source,
        fetchedAt: google.state === "ready" ? google.fetchedAt : (overview?.fetchedAt ?? now),
        project: { id: project.id, name: project.name, domain: project.domain, country: project.country, device: project.device, location: project.location, competitors: project.competitors, brand_terms: project.brand_terms, created_at: project.created_at },
        available,
        google,
        audit,
        rankings,
        overview: overview?.data ?? null,
        summaries,
        competitors,
        jobs,
      };
    }
    case "backlinks": {
      if (liveEnabled()) {
        const r = await cached(`report-backlinks:v1:${report.subject}`, "dataforseo", 24, async () => {
          const [s, o] = await Promise.all([blSummary(ownerId, report.subject), blOverview(ownerId, report.subject)]);
          return backlinkReportFromLive(s, o);
        });
        return { template: "backlinks", source: "dataforseo", fetchedAt: r.fetchedAt, backlinks: r.data };
      }
      if (!demoAllowed()) return needsDfs;
      return { template: "backlinks", source: "demo", fetchedAt: now, backlinks: backlinkData(report.subject) };
    }
    case "comparison": {
      const domains = [report.subject, ...(report.options.competitors ?? [])].slice(0, 5);
      if (liveEnabled()) {
        const rows = await Promise.all(domains.map((d) => getDomainOverview(ownerId, d, db).then((o) => slimFromOverview(o.data)).catch(() => null)));
        return { template: "comparison", source: "dataforseo", fetchedAt: now, domains: rows.filter((x): x is SlimFacts => !!x) };
      }
      if (!demoAllowed()) return needsDfs;
      return { template: "comparison", source: "demo", fetchedAt: now, domains: domains.map((d) => slimFacts(d, db)) };
    }
    default:
      return { template: "missing", reason: "Unknown report template." };
  }
}
