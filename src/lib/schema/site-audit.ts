/**
 * Tables owned by the site-audit module. Use CREATE TABLE IF NOT EXISTS / ADD COLUMN IF NOT EXISTS only:
 * this SQL runs on every server start against existing data.
 *
 * audit_crawls  — one row per crawl (config, totals, scores, site-level facts, Core Web Vitals, live progress)
 * audit_pages   — one row per crawled/blocked URL; most per-page facts live in `data` (jsonb)
 * audit_links   — unique <a href> links per source page (internal + external) with the target status
 * audit_issues  — one row per affected URL (or link) per check; page_id NULL for site-wide issues
 */
export const siteAuditSchema = `
CREATE TABLE IF NOT EXISTS audit_crawls (
  id text PRIMARY KEY,
  project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  job_id text,
  status text NOT NULL DEFAULT 'running' CHECK (status IN ('running','done','stopped','failed')),
  config jsonb NOT NULL DEFAULT '{}',
  start_url text NOT NULL,
  pages_crawled integer NOT NULL DEFAULT 0,
  health integer,
  errors integer NOT NULL DEFAULT 0,
  warnings integer NOT NULL DEFAULT 0,
  notices integer NOT NULL DEFAULT 0,
  stats jsonb NOT NULL DEFAULT '{}',
  site jsonb NOT NULL DEFAULT '{}',
  cwv jsonb,
  live jsonb NOT NULL DEFAULT '{}',
  error text,
  details_pruned boolean NOT NULL DEFAULT false,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);
CREATE INDEX IF NOT EXISTS audit_crawls_project ON audit_crawls(project_id, started_at DESC);
CREATE INDEX IF NOT EXISTS audit_crawls_job ON audit_crawls(job_id);

CREATE TABLE IF NOT EXISTS audit_pages (
  crawl_id text NOT NULL REFERENCES audit_crawls(id) ON DELETE CASCADE,
  id integer NOT NULL,
  url text NOT NULL,
  final_url text,
  status integer,
  depth integer,
  content_type text,
  response_ms integer,
  size_bytes integer,
  title text,
  indexable boolean NOT NULL DEFAULT false,
  in_sitemap boolean NOT NULL DEFAULT false,
  inlinks integer NOT NULL DEFAULT 0,
  errors integer NOT NULL DEFAULT 0,
  warnings integer NOT NULL DEFAULT 0,
  notices integer NOT NULL DEFAULT 0,
  data jsonb NOT NULL DEFAULT '{}',
  PRIMARY KEY (crawl_id, id)
);

CREATE TABLE IF NOT EXISTS audit_links (
  crawl_id text NOT NULL REFERENCES audit_crawls(id) ON DELETE CASCADE,
  source_id integer NOT NULL,
  target text NOT NULL,
  target_id integer,
  anchor text NOT NULL DEFAULT '',
  internal boolean NOT NULL,
  nofollow boolean NOT NULL DEFAULT false,
  status integer
);
ALTER TABLE audit_links ADD COLUMN IF NOT EXISTS rel text NOT NULL DEFAULT '';
CREATE INDEX IF NOT EXISTS audit_links_source ON audit_links(crawl_id, source_id);
CREATE INDEX IF NOT EXISTS audit_links_target ON audit_links(crawl_id, target_id);

CREATE TABLE IF NOT EXISTS audit_issues (
  crawl_id text NOT NULL REFERENCES audit_crawls(id) ON DELETE CASCADE,
  check_id text NOT NULL,
  page_id integer,
  url text NOT NULL,
  detail text NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS audit_issues_check ON audit_issues(crawl_id, check_id);
CREATE INDEX IF NOT EXISTS audit_issues_page ON audit_issues(crawl_id, page_id);
`;
