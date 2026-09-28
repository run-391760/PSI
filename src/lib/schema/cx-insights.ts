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
`;
