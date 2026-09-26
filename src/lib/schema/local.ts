/**
 * Tables owned by the local module. Use CREATE TABLE IF NOT EXISTS / ADD COLUMN IF NOT EXISTS only:
 * this SQL runs on every server start against existing data.
 */
export const localSchema = `
CREATE TABLE IF NOT EXISTS local_profiles (
  project_id text PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  data jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS local_listings (
  project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  directory text NOT NULL,
  status text NOT NULL DEFAULT 'synced' CHECK (status IN ('synced','pending')),
  snapshot jsonb NOT NULL,
  duplicates_suppressed integer NOT NULL DEFAULT 0,
  synced_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(project_id, directory)
);
CREATE TABLE IF NOT EXISTS local_scans (
  id text PRIMARY KEY,
  project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  keywords jsonb NOT NULL,
  grid_size integer NOT NULL CHECK (grid_size IN (3,5,7,9)),
  radius_km real NOT NULL,
  center jsonb NOT NULL,
  seq integer NOT NULL DEFAULT 1,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','done','failed','cancelled')),
  job_id text,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);
CREATE INDEX IF NOT EXISTS local_scans_project ON local_scans(project_id, created_at DESC);
CREATE TABLE IF NOT EXISTS local_scan_results (
  scan_id text NOT NULL REFERENCES local_scans(id) ON DELETE CASCADE,
  keyword text NOT NULL,
  cells jsonb NOT NULL,
  metrics jsonb NOT NULL,
  competitors jsonb NOT NULL,
  PRIMARY KEY(scan_id, keyword)
);
CREATE TABLE IF NOT EXISTS local_review_replies (
  project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  review_id text NOT NULL,
  body text NOT NULL,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','posted')),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(project_id, review_id)
);
`;
