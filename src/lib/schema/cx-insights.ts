/** Tables owned by the CX insights module (team/SLA, dashboards, surveys, quality). IF NOT EXISTS only. */
export const cxInsightsSchema = `
CREATE TABLE IF NOT EXISTS cx_teams (
  id text PRIMARY KEY,
  project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS cx_teams_project ON cx_teams(project_id);

CREATE TABLE IF NOT EXISTS cx_members (
  id text PRIMARY KEY,
  project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'agent' CHECK (role IN ('admin','supervisor','agent','viewer')),
  team_id text REFERENCES cx_teams(id) ON DELETE SET NULL,
  invited_by text REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(project_id, user_id)
);

CREATE TABLE IF NOT EXISTS cx_insight_settings (
  project_id text PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  timezone text NOT NULL DEFAULT 'UTC',
  hours jsonb NOT NULL DEFAULT '[]',
  holidays jsonb NOT NULL DEFAULT '[]',
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS cx_sla_policies (
  id text PRIMARY KEY,
  project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  priority text NOT NULL CHECK (priority IN ('low','normal','high','urgent')),
  first_response_minutes integer,
  resolution_minutes integer,
  business_hours boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(project_id, priority)
);

CREATE TABLE IF NOT EXISTS cx_dashboards (
  id text PRIMARY KEY,
  project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  widgets jsonb NOT NULL DEFAULT '[]',
  shared boolean NOT NULL DEFAULT true,
  created_by text REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS cx_dashboards_project ON cx_dashboards(project_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS cx_surveys (
  id text PRIMARY KEY,
  project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('csat','nps','custom')),
  question text NOT NULL DEFAULT '',
  questions jsonb NOT NULL DEFAULT '[]',
  thank_you text NOT NULL DEFAULT 'Thank you for your feedback!',
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused')),
  auto_send boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS cx_surveys_project ON cx_surveys(project_id, created_at DESC);

CREATE TABLE IF NOT EXISTS cx_survey_invites (
  token text PRIMARY KEY,
  survey_id text NOT NULL REFERENCES cx_surveys(id) ON DELETE CASCADE,
  project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  ticket_id text REFERENCES cx_tickets(id) ON DELETE CASCADE,
  contact_id text REFERENCES cx_contacts(id) ON DELETE SET NULL,
  source text NOT NULL DEFAULT 'manual',
  created_at timestamptz NOT NULL DEFAULT now(),
  responded_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS cx_survey_invites_ticket ON cx_survey_invites(survey_id, ticket_id) WHERE ticket_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS cx_survey_responses (
  id text PRIMARY KEY,
  survey_id text NOT NULL REFERENCES cx_surveys(id) ON DELETE CASCADE,
  project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  ticket_id text REFERENCES cx_tickets(id) ON DELETE SET NULL,
  contact_id text REFERENCES cx_contacts(id) ON DELETE SET NULL,
  score integer,
  answers jsonb NOT NULL DEFAULT '{}',
  comment text NOT NULL DEFAULT '',
  sentiment text,
  sentiment_score real,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS cx_survey_responses_survey ON cx_survey_responses(survey_id, created_at DESC);
CREATE INDEX IF NOT EXISTS cx_survey_responses_project ON cx_survey_responses(project_id, created_at DESC);

CREATE TABLE IF NOT EXISTS cx_qa_scorecards (
  id text PRIMARY KEY,
  project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  sections jsonb NOT NULL DEFAULT '[]',
  pass_score integer NOT NULL DEFAULT 80,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS cx_qa_reviews (
  id text PRIMARY KEY,
  project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  ticket_id text NOT NULL REFERENCES cx_tickets(id) ON DELETE CASCADE,
  scorecard_id text REFERENCES cx_qa_scorecards(id) ON DELETE SET NULL,
  agent_id text REFERENCES users(id) ON DELETE SET NULL,
  reviewer_id text REFERENCES users(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','draft','submitted','disputed','resolved')),
  answers jsonb NOT NULL DEFAULT '{}',
  score real,
  fatal boolean NOT NULL DEFAULT false,
  ai_suggestion jsonb,
  comment text NOT NULL DEFAULT '',
  coaching text NOT NULL DEFAULT '',
  dispute_reason text,
  dispute_response text,
  submitted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(ticket_id, scorecard_id)
);
CREATE INDEX IF NOT EXISTS cx_qa_reviews_project ON cx_qa_reviews(project_id, status, updated_at DESC);

-- ---------------------------------------------------------------- WP5 (insights v2)
ALTER TABLE cx_dashboards ADD COLUMN IF NOT EXISTS theme text NOT NULL DEFAULT 'default';
ALTER TABLE cx_dashboards ADD COLUMN IF NOT EXISTS filters jsonb NOT NULL DEFAULT '{}';

CREATE TABLE IF NOT EXISTS cx_share_links (
  token text PRIMARY KEY,
  project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('dashboard','mcp')),
  target_id text,
  label text NOT NULL DEFAULT '',
  created_by text REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);
CREATE INDEX IF NOT EXISTS cx_share_links_target ON cx_share_links(project_id, kind, target_id);

CREATE TABLE IF NOT EXISTS cx_export_templates (
  id text PRIMARY KEY,
  project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name text NOT NULL,
  source text NOT NULL CHECK (source IN ('tickets','messages')),
  columns jsonb NOT NULL DEFAULT '[]',
  basis text NOT NULL DEFAULT 'calendar',
  created_by text REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS cx_export_schedules (
  id text PRIMARY KEY,
  project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  template_id text NOT NULL REFERENCES cx_export_templates(id) ON DELETE CASCADE,
  period text NOT NULL CHECK (period IN ('yesterday','7','30','31','month')),
  cadence text NOT NULL DEFAULT 'daily' CHECK (cadence IN ('daily','weekly','monthly')),
  recipients jsonb NOT NULL DEFAULT '[]',
  enabled boolean NOT NULL DEFAULT true,
  next_run_at timestamptz NOT NULL DEFAULT now(),
  last_run_at timestamptz,
  last_status text,
  created_by text REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS cx_export_files (
  id text PRIMARY KEY,
  project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name text NOT NULL,
  rows integer NOT NULL DEFAULT 0,
  csv text NOT NULL DEFAULT '',
  schedule_id text REFERENCES cx_export_schedules(id) ON DELETE SET NULL,
  created_by text REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS cx_export_files_project ON cx_export_files(project_id, created_at DESC);

ALTER TABLE cx_surveys ADD COLUMN IF NOT EXISTS settings jsonb NOT NULL DEFAULT '{}';
ALTER TABLE cx_survey_invites ADD COLUMN IF NOT EXISTS sent_at timestamptz;
ALTER TABLE cx_survey_invites ADD COLUMN IF NOT EXISTS sent_via text;
ALTER TABLE cx_survey_invites ADD COLUMN IF NOT EXISTS agent_id text REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE cx_qa_scorecards ADD COLUMN IF NOT EXISTS form_type text NOT NULL DEFAULT 'evaluation';
ALTER TABLE cx_qa_scorecards ADD COLUMN IF NOT EXISTS team_id text REFERENCES cx_teams(id) ON DELETE SET NULL;
ALTER TABLE cx_qa_scorecards ADD COLUMN IF NOT EXISTS due_days integer;
ALTER TABLE cx_qa_scorecards ADD COLUMN IF NOT EXISTS auto_accept boolean NOT NULL DEFAULT false;
ALTER TABLE cx_qa_scorecards ADD COLUMN IF NOT EXISTS tags jsonb NOT NULL DEFAULT '[]';
ALTER TABLE cx_qa_reviews ADD COLUMN IF NOT EXISTS tags jsonb NOT NULL DEFAULT '[]';
ALTER TABLE cx_qa_reviews ADD COLUMN IF NOT EXISTS supervisor_id text REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE cx_qa_reviews ADD COLUMN IF NOT EXISTS text_answers jsonb NOT NULL DEFAULT '{}';
ALTER TABLE cx_qa_reviews ADD COLUMN IF NOT EXISTS due_at timestamptz;
ALTER TABLE cx_qa_reviews ADD COLUMN IF NOT EXISTS accepted_at timestamptz;
ALTER TABLE cx_qa_reviews ADD COLUMN IF NOT EXISTS auto_accepted boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS cx_qa_coaching (
  id text PRIMARY KEY,
  project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  agent_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  scorecard_id text REFERENCES cx_qa_scorecards(id) ON DELETE SET NULL,
  supervisor_id text REFERENCES users(id) ON DELETE SET NULL,
  assigned_by text REFERENCES users(id) ON DELETE SET NULL,
  notes text NOT NULL DEFAULT '',
  outcome text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'assigned' CHECK (status IN ('assigned','completed')),
  due_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS cx_qa_coaching_project ON cx_qa_coaching(project_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS cx_kb_categories (
  id text PRIMARY KEY,
  project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  parent_id text REFERENCES cx_kb_categories(id) ON DELETE CASCADE,
  name text NOT NULL,
  position integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS cx_kb_articles (
  id text PRIMARY KEY,
  project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  category_id text REFERENCES cx_kb_categories(id) ON DELETE SET NULL,
  title text NOT NULL,
  body text NOT NULL DEFAULT '',
  tags jsonb NOT NULL DEFAULT '[]',
  status text NOT NULL DEFAULT 'published' CHECK (status IN ('draft','published')),
  views integer NOT NULL DEFAULT 0,
  created_by text REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS cx_kb_articles_project ON cx_kb_articles(project_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS cx_ai_briefs (
  id text PRIMARY KEY,
  project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  period text NOT NULL,
  body text NOT NULL,
  metrics jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS cx_ai_settings (
  project_id text PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  brief_cadence text NOT NULL DEFAULT 'off' CHECK (brief_cadence IN ('off','weekly','monthly')),
  brief_recipients jsonb NOT NULL DEFAULT '[]',
  brief_next_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS cx_ask_log (
  id text PRIMARY KEY,
  project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id text REFERENCES users(id) ON DELETE SET NULL,
  question text NOT NULL,
  answer text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS cx_ask_log_project ON cx_ask_log(project_id, created_at DESC);
`;
