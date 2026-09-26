import { z } from "zod";
import { AppError } from "@/lib/domain";
import type { Project } from "@/lib/projects";
import type { AuditConfig } from "./types";
import { hostOf, normalizeUrl, registrable } from "./url";

export const CRAWL_KIND = "site-audit.crawl";
export const CWV_KIND = "site-audit.cwv";

const masks = z
  .array(z.string().trim().max(200))
  .max(30)
  .transform((a) => [...new Set(a.filter(Boolean))]);

export const configInput = z.object({
  startUrl: z.string().trim().max(500).default(""),
  limit: z.coerce.number().int().min(10, "Crawl at least 10 pages.").max(500, "The page limit is 500.").default(100),
  source: z.enum(["website", "sitemap", "both"]).default("website"),
  device: z.enum(["desktop", "mobile"]).default("desktop"),
  subdomains: z.boolean().default(true),
  allow: masks.default([]),
  disallow: masks.default([]),
  delayMs: z.coerce.number().int().min(250).max(10000).default(1000),
  checkExternal: z.boolean().default(true),
  schedule: z.enum(["off", "daily", "weekly"]).default("off"),
});
export type ConfigInput = z.input<typeof configInput>;

export function defaultConfig(project: Pick<Project, "domain" | "device">): AuditConfig {
  return {
    startUrl: `https://${project.domain}/`,
    limit: 100,
    source: "website",
    device: project.device ?? "desktop",
    subdomains: true,
    allow: [],
    disallow: [],
    delayMs: 1000,
    checkExternal: true,
    schedule: "off",
  };
}

/** The project's saved Site Audit settings merged over defaults. */
export function getConfig(project: Project): AuditConfig {
  const saved = (project.settings?.siteAudit ?? {}) as Partial<AuditConfig>;
  const merged = { ...defaultConfig(project), ...saved };
  const parsed = configInput.safeParse(merged);
  const cfg = parsed.success ? (parsed.data as AuditConfig) : defaultConfig(project);
  if (!cfg.startUrl) cfg.startUrl = `https://${project.domain}/`;
  return cfg;
}

/** Validates user input for a project; the start URL must belong to the project's domain. */
export function parseConfig(project: Project, raw: ConfigInput): AuditConfig {
  const cfg = configInput.parse(raw) as AuditConfig;
  let start = cfg.startUrl || `https://${project.domain}/`;
  if (!/^https?:\/\//i.test(start)) start = `https://${start}`;
  const url = normalizeUrl(start);
  if (!url) throw new AppError("Enter a valid start URL (http or https, standard port).");
  if (registrable(hostOf(url)) !== project.domain) throw new AppError(`The start URL must be on ${project.domain}.`);
  cfg.startUrl = url;
  return cfg;
}
