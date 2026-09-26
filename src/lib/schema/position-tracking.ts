/**
 * Tables owned by the position-tracking module. Use CREATE TABLE IF NOT EXISTS / ADD COLUMN IF NOT EXISTS only:
 * this SQL runs on every server start against existing data.
 *
 * pt_campaigns     one tracking campaign per project (targeting, device mode, competitors, data source)
 * pt_keywords      tracked keywords (+ keyword metrics captured when added / refreshed by live checks)
 * pt_tags          per-project keyword tags; pt_keyword_tags links them
 * pt_rankings      daily snapshot per keyword × device × day: positions/URLs of every tracked domain,
 *                  all URLs of the project domain (cannibalization), SERP features present/owned
 * pt_serps         latest top-20 organic SERP per keyword × device (competitor discovery)
 * pt_daily         precomputed per-day aggregates per domain (visibility, traffic, avg position, bands)
 * pt_alert_rules   alert rules evaluated after every check
 */
export const positionTrackingSchema = `
CREATE TABLE IF NOT EXISTS pt_campaigns (
  project_id text PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  engine text NOT NULL DEFAULT 'google',
  db text NOT NULL DEFAULT 'US',
  location text NOT NULL DEFAULT '',
  device text NOT NULL DEFAULT 'desktop' CHECK (device IN ('desktop','mobile','both')),
  competitors jsonb NOT NULL DEFAULT '[]',
  source text NOT NULL DEFAULT 'demo',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  last_check_at timestamptz,
  first_day text,
  last_day text
);

CREATE TABLE IF NOT EXISTS pt_keywords (
  id text PRIMARY KEY,
  project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  keyword text NOT NULL,
  volume integer,
  cpc real,
  kd integer,
  intents jsonb NOT NULL DEFAULT '[]',
  metrics_source text NOT NULL DEFAULT 'demo',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(project_id, keyword)
);
CREATE INDEX IF NOT EXISTS pt_keywords_project ON pt_keywords(project_id);

CREATE TABLE IF NOT EXISTS pt_tags (
  id text PRIMARY KEY,
  project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(project_id, name)
);
CREATE TABLE IF NOT EXISTS pt_keyword_tags (
  keyword_id text NOT NULL REFERENCES pt_keywords(id) ON DELETE CASCADE,
  tag_id text NOT NULL REFERENCES pt_tags(id) ON DELETE CASCADE,
  PRIMARY KEY(keyword_id, tag_id)
);
CREATE INDEX IF NOT EXISTS pt_keyword_tags_tag ON pt_keyword_tags(tag_id);

CREATE TABLE IF NOT EXISTS pt_rankings (
  project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  keyword_id text NOT NULL REFERENCES pt_keywords(id) ON DELETE CASCADE,
  device text NOT NULL,
  day text NOT NULL,
  positions jsonb NOT NULL DEFAULT '{}',
  urls jsonb NOT NULL DEFAULT '{}',
  own_urls jsonb NOT NULL DEFAULT '[]',
  features jsonb NOT NULL DEFAULT '[]',
  owned jsonb NOT NULL DEFAULT '[]',
  fs_owner text,
  source text NOT NULL DEFAULT 'demo',
  PRIMARY KEY(keyword_id, device, day)
);
CREATE INDEX IF NOT EXISTS pt_rankings_project_day ON pt_rankings(project_id, device, day);

CREATE TABLE IF NOT EXISTS pt_serps (
  project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  keyword_id text NOT NULL REFERENCES pt_keywords(id) ON DELETE CASCADE,
  device text NOT NULL,
  day text NOT NULL,
  results jsonb NOT NULL DEFAULT '[]',
  PRIMARY KEY(keyword_id, device)
);
CREATE INDEX IF NOT EXISTS pt_serps_project ON pt_serps(project_id, device);

CREATE TABLE IF NOT EXISTS pt_daily (
  project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  device text NOT NULL,
  day text NOT NULL,
  domain text NOT NULL,
  keywords integer NOT NULL DEFAULT 0,
  ranked integer NOT NULL DEFAULT 0,
  top3 integer NOT NULL DEFAULT 0,
  top10 integer NOT NULL DEFAULT 0,
  top20 integer NOT NULL DEFAULT 0,
  top100 integer NOT NULL DEFAULT 0,
  visibility real NOT NULL DEFAULT 0,
  traffic real NOT NULL DEFAULT 0,
  avg_position real,
  PRIMARY KEY(project_id, device, day, domain)
);

CREATE TABLE IF NOT EXISTS pt_alert_rules (
  id text PRIMARY KEY,
  project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  owner_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('enter_top','leave_top','drop','rise','overtaken','visibility_change')),
  threshold real NOT NULL DEFAULT 10,
  device text,
  tag_id text REFERENCES pt_tags(id) ON DELETE SET NULL,
  competitor text,
  severity text NOT NULL DEFAULT 'warning' CHECK (severity IN ('info','success','warning','critical')),
  enabled boolean NOT NULL DEFAULT true,
  last_triggered_at timestamptz,
  trigger_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE pt_alert_rules ADD COLUMN IF NOT EXISTS last_eval_day text;
CREATE INDEX IF NOT EXISTS pt_alert_rules_owner ON pt_alert_rules(owner_id, created_at DESC);
CREATE INDEX IF NOT EXISTS pt_alert_rules_project ON pt_alert_rules(project_id);
`;
