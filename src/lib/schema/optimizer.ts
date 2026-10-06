/**
 * Tables of the AI Pre-Publish SEO & Content Optimizer. CREATE/ADD IF NOT EXISTS only: this SQL runs
 * on every server start against existing data.
 */
export const optimizerSchema = `
CREATE TABLE IF NOT EXISTS opt_drafts (
  id text PRIMARY KEY, owner_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title text NOT NULL DEFAULT '', keyword text NOT NULL DEFAULT '', keywords jsonb NOT NULL DEFAULT '[]',
  meta_description text NOT NULL DEFAULT '', slug text NOT NULL DEFAULT '', url text NOT NULL DEFAULT '',
  body text NOT NULL DEFAULT '', meta jsonb NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'draft', score numeric, baseline_score numeric, summary jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), published_at timestamptz
);
CREATE INDEX IF NOT EXISTS opt_drafts_owner ON opt_drafts(owner_id, updated_at DESC);
CREATE TABLE IF NOT EXISTS opt_revisions (
  id text PRIMARY KEY, draft_id text NOT NULL REFERENCES opt_drafts(id) ON DELETE CASCADE,
  note text NOT NULL DEFAULT '', kind text NOT NULL DEFAULT 'edit', snapshot jsonb NOT NULL,
  score numeric, summary jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS opt_revisions_draft ON opt_revisions(draft_id, created_at DESC);
CREATE TABLE IF NOT EXISTS opt_research (
  draft_id text PRIMARY KEY REFERENCES opt_drafts(id) ON DELETE CASCADE,
  research jsonb, ai jsonb, links jsonb, live jsonb, updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS opt_briefs (
  id text PRIMARY KEY, owner_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  keyword text NOT NULL, db text NOT NULL DEFAULT 'US', brief jsonb NOT NULL, draft_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS opt_briefs_owner ON opt_briefs(owner_id, created_at DESC);
-- Multi-agent scoring runs (Analyst → Reviewer → Verifier → Finalizer); the latest 20 per draft are kept.
CREATE TABLE IF NOT EXISTS opt_agent_runs (
  id text PRIMARY KEY, draft_id text NOT NULL REFERENCES opt_drafts(id) ON DELETE CASCADE,
  owner_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE, job_id text,
  status text NOT NULL DEFAULT 'queued', body_hash text NOT NULL DEFAULT '',
  items jsonb NOT NULL DEFAULT '[]', stages jsonb NOT NULL DEFAULT '{}', summary jsonb NOT NULL DEFAULT '{}',
  error text, created_at timestamptz NOT NULL DEFAULT now(), started_at timestamptz, finished_at timestamptz
);
CREATE INDEX IF NOT EXISTS opt_agent_runs_draft ON opt_agent_runs(draft_id, created_at DESC);
`;
