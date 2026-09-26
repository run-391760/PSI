/**
 * Tables owned by the content module. Use CREATE TABLE IF NOT EXISTS / ADD COLUMN IF NOT EXISTS only:
 * this SQL runs on every server start against existing data.
 */
export const contentSchema = `
CREATE TABLE IF NOT EXISTS content_onpage_targets (
  id text PRIMARY KEY, project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  url text NOT NULL, keyword text NOT NULL, origin text NOT NULL DEFAULT 'manual',
  created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(project_id, url, keyword)
);
CREATE TABLE IF NOT EXISTS content_onpage_runs (
  id text PRIMARY KEY, project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  job_id text, status text NOT NULL DEFAULT 'running', db text NOT NULL DEFAULT 'US',
  pages integer NOT NULL DEFAULT 0, ideas integer NOT NULL DEFAULT 0, summary jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(), finished_at timestamptz
);
CREATE INDEX IF NOT EXISTS content_onpage_runs_project ON content_onpage_runs(project_id, created_at DESC);
CREATE TABLE IF NOT EXISTS content_onpage_results (
  run_id text NOT NULL REFERENCES content_onpage_runs(id) ON DELETE CASCADE,
  target_id text NOT NULL, project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  url text NOT NULL, keyword text NOT NULL, fetch_status integer, fetch_error text,
  page jsonb, benchmark jsonb NOT NULL DEFAULT '{}', ideas jsonb NOT NULL DEFAULT '[]',
  ideas_count integer NOT NULL DEFAULT 0, priority integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(run_id, target_id)
);
CREATE TABLE IF NOT EXISTS content_onpage_done (
  project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  target_id text NOT NULL, idea_id text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(project_id, target_id, idea_id)
);
CREATE TABLE IF NOT EXISTS content_documents (
  id text PRIMARY KEY, owner_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title text NOT NULL DEFAULT 'Untitled document', body text NOT NULL DEFAULT '',
  keywords jsonb NOT NULL DEFAULT '[]', settings jsonb NOT NULL DEFAULT '{}',
  words integer NOT NULL DEFAULT 0, score numeric NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS content_documents_owner ON content_documents(owner_id, updated_at DESC);
CREATE TABLE IF NOT EXISTS content_log_analyses (
  id text PRIMARY KEY, owner_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name text NOT NULL, origin text NOT NULL DEFAULT 'upload', size_bytes bigint NOT NULL DEFAULT 0,
  total_lines integer NOT NULL DEFAULT 0, parsed_lines integer NOT NULL DEFAULT 0, bot_hits integer NOT NULL DEFAULT 0,
  date_from text, date_to text, summary jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS content_log_analyses_owner ON content_log_analyses(owner_id, created_at DESC);
`;
