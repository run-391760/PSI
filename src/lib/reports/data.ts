import { getDomainOverview, type DomainOverview } from "@/lib/competitive/domain-overview";
import { database } from "@/lib/domain";
import { findProject, type Project } from "@/lib/projects";
import { projectSummaries } from "@/lib/projects/summaries";
import type { ToolSummary } from "@/lib/projects/summary-types";
import type { DataSource } from "@/lib/providers/labels";
import { anchors, backlinks, domainEntity, domainFacts, linkVelocity, referringDomains, toxicity } from "@/lib/seo/engine";
import type { JobListRow } from "./kinds";
import { listJobRows } from "./platform";
import type { ReportRecord } from "./templates";

/**
 * Data behind a saved report. Domain reports use getDomainOverview (live when DataForSEO is
 * configured, otherwise demo); backlink and comparison reports use the demo engine. Everything
 * returned is serializable so charts (client components) can render it.
 */

export type SlimFacts = {
  domain: string;
  authorityScore: number;
  organicTraffic: number;
  organicKeywords: number;
  trafficChangePct: number;
  paidTraffic: number;
  paidKeywords: number;
  backlinks: number;
  referringDomains: number;
  referringIps: number;
  followRatio: number;
  topicName: string;
  history: { month: string; organicTraffic: number; organicKeywords: number; top3: number; top10: number; referringDomains: number; backlinks: number; authorityScore: number }[];
};

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

export type BacklinkReportData = {
  facts: SlimFacts;
  velocity: ReturnType<typeof linkVelocity>;
  referring: { domain: string; authorityScore: number; backlinks: number; country: string; firstSeen: string; follow: boolean }[];
  anchors: { anchor: string; type: string; referringDomains: number; backlinks: number }[];
  types: { type: string; count: number }[];
  toxicity: { label: string; value: number }[];
  toxicSample: { domain: string; score: number; markers: string[] }[];
};

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

export type ReportData =
  | { template: "domain"; source: DataSource; fetchedAt: string; overview: DomainOverview }
  | {
      template: "project";
      source: DataSource;
      fetchedAt: string;
      project: Pick<Project, "id" | "name" | "domain" | "country" | "device" | "location" | "competitors" | "brand_terms" | "created_at">;
      overview: DomainOverview;
      summaries: ToolSummary[];
      competitors: SlimFacts[];
      jobs: JobListRow[];
    }
  | { template: "backlinks"; source: DataSource; fetchedAt: string; backlinks: BacklinkReportData }
  | { template: "comparison"; source: DataSource; fetchedAt: string; domains: SlimFacts[] }
  | { template: "missing"; reason: string };

export async function loadReportData(ownerId: string, report: ReportRecord): Promise<ReportData> {
  const db = database(report.db).code;
  const now = new Date().toISOString();
  switch (report.template) {
    case "domain": {
      const o = await getDomainOverview(ownerId, report.subject, db);
      return { template: "domain", source: o.source, fetchedAt: o.fetchedAt, overview: o.data };
    }
    case "project": {
      const project = report.project_id ? await findProject(ownerId, report.project_id) : null;
      if (!project) return { template: "missing", reason: "The project for this report was deleted." };
      const [o, summaries, jobs] = await Promise.all([
        getDomainOverview(ownerId, project.domain, project.country),
        projectSummaries(project),
        report.sections.includes("activity") ? listJobRows(ownerId, { projectId: project.id, limit: 10 }) : Promise.resolve([]),
      ]);
      return {
        template: "project",
        source: o.source,
        fetchedAt: o.fetchedAt,
        project: { id: project.id, name: project.name, domain: project.domain, country: project.country, device: project.device, location: project.location, competitors: project.competitors, brand_terms: project.brand_terms, created_at: project.created_at },
        overview: o.data,
        summaries,
        competitors: [project.domain, ...project.competitors].slice(0, 6).map((d) => slimFacts(d, project.country)),
        jobs,
      };
    }
    case "backlinks":
      return { template: "backlinks", source: "demo", fetchedAt: now, backlinks: backlinkData(report.subject) };
    case "comparison":
      return { template: "comparison", source: "demo", fetchedAt: now, domains: [report.subject, ...(report.options.competitors ?? [])].slice(0, 5).map((d) => slimFacts(d, db)) };
    default:
      return { template: "missing", reason: "Unknown report template." };
  }
}
