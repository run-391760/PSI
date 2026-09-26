/**
 * Tables owned by the monitoring module. Use CREATE TABLE IF NOT EXISTS / ADD COLUMN IF NOT EXISTS only:
 * this SQL runs on every server start against existing data.
 */
export const monitoringSchema = `
CREATE TABLE IF NOT EXISTS bm_settings (
  project_id text PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  competitor_terms jsonb NOT NULL DEFAULT '[]',
  demo_social boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_run_at timestamptz,
  last_error text
);
CREATE TABLE IF NOT EXISTS bm_mentions (
  id text PRIMARY KEY,
  project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  subject text NOT NULL DEFAULT '',
  term text NOT NULL,
  source text NOT NULL CHECK (source IN ('google-news','demo')),
  channel text NOT NULL,
  publisher text NOT NULL DEFAULT '',
  publisher_domain text,
  title text NOT NULL,
  snippet text NOT NULL DEFAULT '',
  url text NOT NULL,
  dedupe_key text NOT NULL,
  published_at timestamptz NOT NULL,
  sentiment text NOT NULL CHECK (sentiment IN ('positive','neutral','negative')),
  sentiment_score real NOT NULL DEFAULT 0,
  reach integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'new' CHECK (status IN ('new','reviewed','archived')),
  tags jsonb NOT NULL DEFAULT '[]',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(project_id, dedupe_key)
);
CREATE INDEX IF NOT EXISTS bm_mentions_project ON bm_mentions(project_id, subject, published_at DESC);
`;
