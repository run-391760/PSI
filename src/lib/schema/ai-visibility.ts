/**
 * Tables owned by the ai-visibility module. Use CREATE TABLE IF NOT EXISTS / ADD COLUMN IF NOT EXISTS only:
 * this SQL runs on every server start against existing data.
 */
export const aiVisibilitySchema = `
CREATE TABLE IF NOT EXISTS ai_prompts (
  id text PRIMARY KEY,
  project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  prompt text NOT NULL,
  source text NOT NULL DEFAULT 'custom' CHECK (source IN ('suggested','custom')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(project_id, prompt)
);
CREATE TABLE IF NOT EXISTS ai_live_results (
  id text PRIMARY KEY,
  project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  prompt_id text REFERENCES ai_prompts(id) ON DELETE SET NULL,
  prompt text NOT NULL,
  engine text NOT NULL DEFAULT 'claude',
  model text NOT NULL DEFAULT '',
  job_id text,
  mentioned boolean NOT NULL DEFAULT false,
  cited boolean NOT NULL DEFAULT false,
  position integer,
  cited_urls jsonb NOT NULL DEFAULT '[]',
  competitors jsonb NOT NULL DEFAULT '[]',
  sources jsonb NOT NULL DEFAULT '[]',
  sentiment text,
  answer text NOT NULL DEFAULT '',
  error text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ai_live_results_project ON ai_live_results(project_id, created_at DESC);
CREATE TABLE IF NOT EXISTS ai_settings (
  project_id text PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  competitor_names jsonb NOT NULL DEFAULT '[]',
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS ai_readiness (
  project_id text PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  result jsonb NOT NULL,
  checked_at timestamptz NOT NULL DEFAULT now()
);
`;
