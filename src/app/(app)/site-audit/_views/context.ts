import type { Project } from "@/lib/projects";
import type { CrawlBrief, CrawlRow } from "@/lib/site-audit/data";
import type { AuditConfig } from "@/lib/site-audit/types";

export type AuditCtx = {
  project: Project;
  config: AuditConfig;
  crawl: CrawlRow;
  previous: CrawlBrief | null;
  crawls: CrawlBrief[];
  sp: Record<string, string | undefined>;
  /** Build a /site-audit URL keeping project (+ crawl when viewing an older one). */
  href: (params?: Record<string, string | number | null | undefined>) => string;
  runningCwvJob: string | null;
};

export function makeHref(projectId: string, crawlParam: string | null) {
  return (params: Record<string, string | number | null | undefined> = {}) => {
    const p = new URLSearchParams({ project: projectId });
    if (crawlParam) p.set("crawl", crawlParam);
    for (const [k, v] of Object.entries(params)) if (v != null && v !== "") p.set(k, String(v));
    return `/site-audit?${p.toString()}`;
  };
}

export const crawlLabel = (c: { started_at: string; status: string }) =>
  `${new Date(c.started_at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "UTC" })} UTC${c.status === "stopped" ? " (partial)" : ""}`;
