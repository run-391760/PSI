/** Core platform tables: accounts, projects, jobs, provider cache, spend ledger, notifications. */
export const coreSchema = `
CREATE TABLE IF NOT EXISTS users (
  id text PRIMARY KEY, email text UNIQUE NOT NULL, name text NOT NULL DEFAULT '',
  password_hash text NOT NULL,
  monthly_budget_micros bigint NOT NULL DEFAULT 25000000 CHECK (monthly_budget_micros >= 0),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash text PRIMARY KEY, user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS rate_limits (key text PRIMARY KEY, hits integer NOT NULL, reset_at timestamptz NOT NULL);

CREATE TABLE IF NOT EXISTS projects (
  id text PRIMARY KEY, owner_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name text NOT NULL, domain text NOT NULL,
  country text NOT NULL DEFAULT 'US', language text NOT NULL DEFAULT 'en',
  device text NOT NULL DEFAULT 'desktop' CHECK (device IN ('desktop','mobile')),
  location text NOT NULL DEFAULT '', brand_terms jsonb NOT NULL DEFAULT '[]',
  settings jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(owner_id, domain)
);
CREATE TABLE IF NOT EXISTS project_competitors (
  project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  domain text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(project_id, domain)
);

CREATE TABLE IF NOT EXISTS jobs (
  id text PRIMARY KEY, owner_id text REFERENCES users(id) ON DELETE CASCADE,
  project_id text REFERENCES projects(id) ON DELETE CASCADE,
  kind text NOT NULL, status text NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued','running','done','failed','cancelled')),
  payload jsonb NOT NULL DEFAULT '{}', result jsonb,
  progress integer NOT NULL DEFAULT 0, total integer NOT NULL DEFAULT 0,
  message text, attempts integer NOT NULL DEFAULT 0, error text,
  dedupe_key text UNIQUE, run_after timestamptz NOT NULL DEFAULT now(),
  lease_until timestamptz, created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz, finished_at timestamptz
);
CREATE INDEX IF NOT EXISTS jobs_pending ON jobs(status, run_after);
CREATE INDEX IF NOT EXISTS jobs_project ON jobs(project_id, kind, created_at DESC);

CREATE TABLE IF NOT EXISTS schedules (
  id text PRIMARY KEY, project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  kind text NOT NULL, cadence text NOT NULL DEFAULT 'daily' CHECK (cadence IN ('hourly','daily','weekly')),
  enabled boolean NOT NULL DEFAULT true, payload jsonb NOT NULL DEFAULT '{}',
  last_run_at timestamptz, next_run_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(project_id, kind)
);

CREATE TABLE IF NOT EXISTS provider_cache (
  key text PRIMARY KEY, source text NOT NULL, payload jsonb NOT NULL,
  fetched_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS monthly_usage (
  owner_id text REFERENCES users(id) ON DELETE CASCADE, month text NOT NULL,
  reserved_micros bigint NOT NULL DEFAULT 0, PRIMARY KEY(owner_id, month)
);
CREATE TABLE IF NOT EXISTS account_usage (month text PRIMARY KEY, reserved_micros bigint NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS usage_events (
  id text PRIMARY KEY, owner_id text REFERENCES users(id) ON DELETE CASCADE,
  endpoint text NOT NULL, reserved_micros bigint NOT NULL, actual_micros bigint,
  status text NOT NULL DEFAULT 'reserved', created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS notifications (
  id text PRIMARY KEY, owner_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id text REFERENCES projects(id) ON DELETE CASCADE,
  tool text NOT NULL, severity text NOT NULL DEFAULT 'info'
    CHECK (severity IN ('info','success','warning','critical')),
  title text NOT NULL, body text NOT NULL DEFAULT '', link text,
  read_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS notifications_owner ON notifications(owner_id, created_at DESC);
`;
