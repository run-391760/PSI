/**
 * Tables owned by the backlinks module. Use CREATE TABLE IF NOT EXISTS / ADD COLUMN IF NOT EXISTS only:
 * this SQL runs on every server start against existing data.
 *
 * bl_audit_*  Backlink Audit: settings, audit runs (history), latest per-domain results, user lists
 *             (whitelist / remove / disavow).
 * bl_lb_*     Link Building Tool: settings (keywords, competitors, email template), prospects the user
 *             acted on (outreach pipeline) and monitored links (verified by the real crawler).
 */
export const backlinksSchema = `
CREATE TABLE IF NOT EXISTS bl_audit_settings (
  project_id text PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  brand_terms jsonb NOT NULL DEFAULT '[]',
  country text NOT NULL DEFAULT 'US',
  weekly boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS bl_audit_runs (
  id text PRIMARY KEY,
  project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  job_id text,
  trigger text NOT NULL DEFAULT 'manual',
  analyzed integer NOT NULL DEFAULT 0,
  backlinks integer NOT NULL DEFAULT 0,
  toxic integer NOT NULL DEFAULT 0,
  potentially_toxic integer NOT NULL DEFAULT 0,
  non_toxic integer NOT NULL DEFAULT 0,
  toxic_score integer NOT NULL DEFAULT 0,
  level text NOT NULL DEFAULT 'low',
  new_toxic integer NOT NULL DEFAULT 0,
  distribution jsonb NOT NULL DEFAULT '[]',
  markers jsonb NOT NULL DEFAULT '[]',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS bl_audit_runs_project ON bl_audit_runs(project_id, created_at DESC);
ALTER TABLE bl_audit_runs ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'demo';
CREATE TABLE IF NOT EXISTS bl_audit_domains (
  project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  domain text NOT NULL,
  toxicity integer NOT NULL DEFAULT 0,
  markers jsonb NOT NULL DEFAULT '[]',
  authority_score integer NOT NULL DEFAULT 0,
  backlinks integer NOT NULL DEFAULT 0,
  country text NOT NULL DEFAULT '',
  ip text NOT NULL DEFAULT '',
  category text NOT NULL DEFAULT '',
  follow boolean NOT NULL DEFAULT true,
  first_seen text NOT NULL DEFAULT '',
  last_seen text NOT NULL DEFAULT '',
  sample_url text NOT NULL DEFAULT '',
  sample_anchor text NOT NULL DEFAULT '',
  first_audit_id text,
  last_audit_id text,
  detected_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(project_id, domain)
);
CREATE TABLE IF NOT EXISTS bl_audit_lists (
  project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  domain text NOT NULL,
  list text NOT NULL CHECK (list IN ('whitelist','remove','disavow')),
  contact text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'not_sent' CHECK (status IN ('not_sent','sent','replied','removed','no_response')),
  note text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(project_id, domain)
);

CREATE TABLE IF NOT EXISTS bl_lb_settings (
  project_id text PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  keywords jsonb NOT NULL DEFAULT '[]',
  competitors jsonb NOT NULL DEFAULT '[]',
  sender_name text NOT NULL DEFAULT '',
  template_subject text NOT NULL DEFAULT '',
  template_body text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE bl_lb_settings ADD COLUMN IF NOT EXISTS prospect_count integer;
CREATE TABLE IF NOT EXISTS bl_lb_prospects (
  project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  domain text NOT NULL,
  state text NOT NULL DEFAULT 'in_progress' CHECK (state IN ('in_progress','rejected')),
  status text NOT NULL DEFAULT 'to_contact' CHECK (status IN ('to_contact','sent','replied','acquired','rejected')),
  rating integer NOT NULL DEFAULT 0,
  reason text NOT NULL DEFAULT '',
  authority_score integer NOT NULL DEFAULT 0,
  contact_name text NOT NULL DEFAULT '',
  contact_email text NOT NULL DEFAULT '',
  notes text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(project_id, domain)
);
ALTER TABLE bl_lb_prospects ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'demo';
CREATE TABLE IF NOT EXISTS bl_lb_links (
  id text PRIMARY KEY,
  project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  prospect_domain text,
  source_url text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','active','lost','unknown')),
  reason text NOT NULL DEFAULT '',
  anchor text,
  rel jsonb NOT NULL DEFAULT '[]',
  target_url text,
  http_status integer,
  checks integer NOT NULL DEFAULT 0,
  last_checked_at timestamptz,
  first_active_at timestamptz,
  lost_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(project_id, source_url)
);
CREATE INDEX IF NOT EXISTS bl_lb_links_project ON bl_lb_links(project_id, created_at DESC);
`;
