/**
 * Live crawler of the Pre-Publish Optimizer: finished crawls (pages with their snapshots, touches,
 * flags and scores) kept so they can be reopened and replayed. CREATE IF NOT EXISTS only.
 */
export const optimizerCrawlSchema = `
CREATE TABLE IF NOT EXISTS opt_crawls (
  id text PRIMARY KEY, owner_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  start_url text NOT NULL, domain text NOT NULL DEFAULT '', status text NOT NULL DEFAULT 'done',
  max_pages int NOT NULL DEFAULT 25, pages jsonb NOT NULL DEFAULT '[]', skips jsonb NOT NULL DEFAULT '[]',
  summary jsonb, created_at timestamptz NOT NULL DEFAULT now(), finished_at timestamptz
);
CREATE INDEX IF NOT EXISTS opt_crawls_owner ON opt_crawls(owner_id, created_at DESC);
`;
