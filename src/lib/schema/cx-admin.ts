/** Tables owned by the CX admin package (WP2). CREATE TABLE IF NOT EXISTS / ADD COLUMN IF NOT EXISTS only. */
export const cxAdminSchema = `
CREATE TABLE IF NOT EXISTS cx_admin_settings (
  project_id text PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  pii_mask boolean NOT NULL DEFAULT false,
  allowed_domains jsonb NOT NULL DEFAULT '[]',
  status_required_with_reply boolean NOT NULL DEFAULT false,
  show_queue_timer boolean NOT NULL DEFAULT true,
  queue_timer_minutes integer NOT NULL DEFAULT 10,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS cx_admin_classifications (
  id text PRIMARY KEY,
  project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  parent_id text REFERENCES cx_admin_classifications(id) ON DELETE CASCADE,
  label text NOT NULL,
  level integer NOT NULL DEFAULT 1,
  sentiment text CHECK (sentiment IN ('positive','neutral','negative')),
  hidden boolean NOT NULL DEFAULT false,
  topic_id text,
  position integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS cx_admin_class_project ON cx_admin_classifications(project_id, parent_id, position);

CREATE TABLE IF NOT EXISTS cx_admin_fields (
  id text PRIMARY KEY,
  project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  key text NOT NULL,
  label text NOT NULL,
  scope text NOT NULL DEFAULT 'ticket' CHECK (scope IN ('ticket','contact')),
  grp text NOT NULL DEFAULT 'additional_info' CHECK (grp IN ('additional_info','custom_info','system')),
  type text NOT NULL DEFAULT 'text',
  options jsonb NOT NULL DEFAULT '[]',
  required boolean NOT NULL DEFAULT false,
  validation jsonb,
  encrypted boolean NOT NULL DEFAULT false,
  hidden boolean NOT NULL DEFAULT false,
  position integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(project_id, scope, key)
);

CREATE TABLE IF NOT EXISTS cx_admin_ticket_fields (
  ticket_id text PRIMARY KEY REFERENCES cx_tickets(id) ON DELETE CASCADE,
  project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  classification_ids jsonb NOT NULL DEFAULT '[]',
  field_values jsonb NOT NULL DEFAULT '{}',
  values_enc text,
  updated_by text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS cx_admin_automations (
  id text PRIMARY KEY,
  project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name text NOT NULL,
  trigger text NOT NULL DEFAULT 'created' CHECK (trigger IN ('created','customer_reply')),
  social_type text NOT NULL DEFAULT 'any',
  position integer NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  stop boolean NOT NULL DEFAULT false,
  match text NOT NULL DEFAULT 'all' CHECK (match IN ('all','any')),
  conditions jsonb NOT NULL DEFAULT '[]',
  actions jsonb NOT NULL DEFAULT '{}',
  hits integer NOT NULL DEFAULT 0,
  last_hit_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS cx_admin_quick_actions (
  id text PRIMARY KEY,
  project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  actions jsonb NOT NULL DEFAULT '{}',
  position integer NOT NULL DEFAULT 0,
  uses integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS cx_admin_ticket_state (
  ticket_id text PRIMARY KEY REFERENCES cx_tickets(id) ON DELETE CASCADE,
  project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  automated_at timestamptz,
  replied_msg_at timestamptz,
  queued_at timestamptz,
  in_queue boolean NOT NULL DEFAULT false,
  queue_agent text,
  assigned_at timestamptz,
  segment text,
  sla_rule_id text,
  next_response_due timestamptz,
  prebreach_sent jsonb NOT NULL DEFAULT '[]',
  escalation_level integer NOT NULL DEFAULT 0,
  last_status text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS cx_admin_state_queue ON cx_admin_ticket_state(project_id, queue_agent);

CREATE TABLE IF NOT EXISTS cx_admin_queue_settings (
  project_id text PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  enabled boolean NOT NULL DEFAULT false,
  assignment_type text NOT NULL DEFAULT 'round_robin',
  max_per_agent integer NOT NULL DEFAULT 10,
  cleanup_minutes integer,
  reset_on_status boolean NOT NULL DEFAULT true,
  reset_after_minutes integer NOT NULL DEFAULT 0,
  remove_on jsonb NOT NULL DEFAULT '["pending","on_hold","solved","closed"]',
  segments jsonb NOT NULL DEFAULT '[]',
  by_timezone boolean NOT NULL DEFAULT false,
  rr_cursor integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS cx_admin_user_statuses (
  id text PRIMARY KEY,
  project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name text NOT NULL,
  available boolean NOT NULL DEFAULT false,
  limit_minutes integer,
  position integer NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS cx_admin_agents (
  project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'offline',
  status_id text,
  since timestamptz NOT NULL DEFAULT now(),
  paused boolean NOT NULL DEFAULT false,
  paused_by text,
  capacity integer,
  office_start text,
  office_end text,
  timezone text,
  last_assigned_at timestamptz,
  overrun_notified boolean NOT NULL DEFAULT false,
  PRIMARY KEY (project_id, user_id)
);

CREATE TABLE IF NOT EXISTS cx_admin_status_log (
  id text PRIMARY KEY,
  project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status text NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz
);
CREATE INDEX IF NOT EXISTS cx_admin_status_log_user ON cx_admin_status_log(project_id, user_id, started_at DESC);

CREATE TABLE IF NOT EXISTS cx_admin_team_settings (
  team_id text PRIMARY KEY REFERENCES cx_teams(id) ON DELETE CASCADE,
  project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  timezone text NOT NULL DEFAULT 'UTC',
  start_time text NOT NULL DEFAULT '09:00',
  end_time text NOT NULL DEFAULT '18:00'
);

CREATE TABLE IF NOT EXISTS cx_admin_sla_rules (
  id text PRIMARY KEY,
  project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name text NOT NULL,
  priority text,
  channels jsonb NOT NULL DEFAULT '[]',
  segment text,
  team text,
  first_response_minutes integer,
  every_response_minutes integer,
  resolution_minutes integer,
  business_hours boolean NOT NULL DEFAULT true,
  start_from text NOT NULL DEFAULT 'created' CHECK (start_from IN ('created','queued')),
  valid_from date,
  valid_to date,
  windows jsonb NOT NULL DEFAULT '[]',
  active boolean NOT NULL DEFAULT true,
  position integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS cx_admin_escalations (
  id text PRIMARY KEY,
  project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name text NOT NULL,
  match text NOT NULL DEFAULT 'all',
  conditions jsonb NOT NULL DEFAULT '[]',
  prebreach jsonb NOT NULL DEFAULT '[75,90]',
  levels jsonb NOT NULL DEFAULT '[]',
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS cx_admin_roles (
  id text PRIMARY KEY,
  project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  pages jsonb NOT NULL DEFAULT '[]',
  actions jsonb NOT NULL DEFAULT '[]',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS cx_admin_member_roles (
  project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_id text NOT NULL REFERENCES cx_admin_roles(id) ON DELETE CASCADE,
  PRIMARY KEY (project_id, user_id)
);

CREATE TABLE IF NOT EXISTS cx_admin_audit (
  id text PRIMARY KEY,
  project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  actor_id text,
  actor_name text NOT NULL DEFAULT '',
  action text NOT NULL,
  target text NOT NULL DEFAULT '',
  detail text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS cx_admin_audit_project ON cx_admin_audit(project_id, created_at DESC);

CREATE TABLE IF NOT EXISTS cx_admin_integrations (
  project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  kind text NOT NULL,
  config jsonb NOT NULL DEFAULT '{}',
  secret_enc text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, kind)
);

CREATE TABLE IF NOT EXISTS cx_admin_alerts (
  id text PRIMARY KEY,
  project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name text NOT NULL,
  source text NOT NULL DEFAULT 'tickets' CHECK (source IN ('tickets','mentions')),
  filters jsonb NOT NULL DEFAULT '{}',
  delivery jsonb NOT NULL DEFAULT '{}',
  format text NOT NULL DEFAULT 'text' CHECK (format IN ('text','csv')),
  delay_minutes integer NOT NULL DEFAULT 0,
  active_hours jsonb,
  active boolean NOT NULL DEFAULT true,
  checked_at timestamptz NOT NULL DEFAULT now(),
  last_fired_at timestamptz,
  fired integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS cx_admin_alert_log (
  id text PRIMARY KEY,
  alert_id text REFERENCES cx_admin_alerts(id) ON DELETE CASCADE,
  project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  channel text NOT NULL,
  items integer NOT NULL DEFAULT 0,
  ok boolean NOT NULL DEFAULT true,
  error text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS cx_admin_alert_log_project ON cx_admin_alert_log(project_id, created_at DESC);

CREATE TABLE IF NOT EXISTS cx_admin_webhooks (
  id text PRIMARY KEY,
  project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name text NOT NULL DEFAULT '',
  url text NOT NULL,
  events jsonb NOT NULL DEFAULT '[]',
  secret_enc text,
  active boolean NOT NULL DEFAULT true,
  failures integer NOT NULL DEFAULT 0,
  last_status integer,
  last_error text,
  last_delivery_at timestamptz,
  deactivated_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS cx_admin_webhook_deliveries (
  id text PRIMARY KEY,
  webhook_id text NOT NULL REFERENCES cx_admin_webhooks(id) ON DELETE CASCADE,
  project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  event text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}',
  attempts integer NOT NULL DEFAULT 0,
  state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','delivered','failed')),
  response_code integer,
  error text,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS cx_admin_wh_due ON cx_admin_webhook_deliveries(state, next_attempt_at);
CREATE INDEX IF NOT EXISTS cx_admin_wh_hook ON cx_admin_webhook_deliveries(webhook_id, created_at DESC);

CREATE TABLE IF NOT EXISTS cx_admin_cursors (
  project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name text NOT NULL,
  at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, name)
);

CREATE TABLE IF NOT EXISTS cx_admin_api_tokens (
  id text PRIMARY KEY,
  project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id text REFERENCES users(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('account','user')),
  name text NOT NULL,
  prefix text NOT NULL,
  token_hash text NOT NULL UNIQUE,
  last_used_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS cx_admin_external_apis (
  id text PRIMARY KEY,
  project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name text NOT NULL,
  target text NOT NULL DEFAULT 'ticket' CHECK (target IN ('ticket','contact')),
  method text NOT NULL DEFAULT 'GET' CHECK (method IN ('GET','POST')),
  url text NOT NULL,
  headers_enc text,
  body text NOT NULL DEFAULT '',
  mapping jsonb NOT NULL DEFAULT '[]',
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Catch up tables created by earlier drafts of this schema (no-ops on fresh databases).
ALTER TABLE cx_admin_settings ADD COLUMN IF NOT EXISTS pii_mask boolean NOT NULL DEFAULT false;
ALTER TABLE cx_admin_settings ADD COLUMN IF NOT EXISTS allowed_domains jsonb NOT NULL DEFAULT '[]';
ALTER TABLE cx_admin_settings ADD COLUMN IF NOT EXISTS status_required_with_reply boolean NOT NULL DEFAULT false;
ALTER TABLE cx_admin_settings ADD COLUMN IF NOT EXISTS show_queue_timer boolean NOT NULL DEFAULT true;
ALTER TABLE cx_admin_settings ADD COLUMN IF NOT EXISTS queue_timer_minutes integer NOT NULL DEFAULT 10;
ALTER TABLE cx_admin_settings ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE cx_admin_classifications ADD COLUMN IF NOT EXISTS project_id text REFERENCES projects(id) ON DELETE CASCADE;
ALTER TABLE cx_admin_classifications ADD COLUMN IF NOT EXISTS parent_id text REFERENCES cx_admin_classifications(id) ON DELETE CASCADE;
ALTER TABLE cx_admin_classifications ADD COLUMN IF NOT EXISTS label text;
ALTER TABLE cx_admin_classifications ADD COLUMN IF NOT EXISTS level integer NOT NULL DEFAULT 1;
ALTER TABLE cx_admin_classifications ADD COLUMN IF NOT EXISTS sentiment text CHECK (sentiment IN ('positive','neutral','negative'));
ALTER TABLE cx_admin_classifications ADD COLUMN IF NOT EXISTS hidden boolean NOT NULL DEFAULT false;
ALTER TABLE cx_admin_classifications ADD COLUMN IF NOT EXISTS topic_id text;
ALTER TABLE cx_admin_classifications ADD COLUMN IF NOT EXISTS position integer NOT NULL DEFAULT 0;
ALTER TABLE cx_admin_classifications ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE cx_admin_fields ADD COLUMN IF NOT EXISTS project_id text REFERENCES projects(id) ON DELETE CASCADE;
ALTER TABLE cx_admin_fields ADD COLUMN IF NOT EXISTS key text;
ALTER TABLE cx_admin_fields ADD COLUMN IF NOT EXISTS label text;
ALTER TABLE cx_admin_fields ADD COLUMN IF NOT EXISTS scope text NOT NULL DEFAULT 'ticket' CHECK (scope IN ('ticket','contact'));
ALTER TABLE cx_admin_fields ADD COLUMN IF NOT EXISTS grp text NOT NULL DEFAULT 'additional_info' CHECK (grp IN ('additional_info','custom_info','system'));
ALTER TABLE cx_admin_fields ADD COLUMN IF NOT EXISTS type text NOT NULL DEFAULT 'text';
ALTER TABLE cx_admin_fields ADD COLUMN IF NOT EXISTS options jsonb NOT NULL DEFAULT '[]';
ALTER TABLE cx_admin_fields ADD COLUMN IF NOT EXISTS required boolean NOT NULL DEFAULT false;
ALTER TABLE cx_admin_fields ADD COLUMN IF NOT EXISTS validation jsonb;
ALTER TABLE cx_admin_fields ADD COLUMN IF NOT EXISTS encrypted boolean NOT NULL DEFAULT false;
ALTER TABLE cx_admin_fields ADD COLUMN IF NOT EXISTS hidden boolean NOT NULL DEFAULT false;
ALTER TABLE cx_admin_fields ADD COLUMN IF NOT EXISTS position integer NOT NULL DEFAULT 0;
ALTER TABLE cx_admin_fields ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE cx_admin_ticket_fields ADD COLUMN IF NOT EXISTS project_id text REFERENCES projects(id) ON DELETE CASCADE;
ALTER TABLE cx_admin_ticket_fields ADD COLUMN IF NOT EXISTS classification_ids jsonb NOT NULL DEFAULT '[]';
ALTER TABLE cx_admin_ticket_fields ADD COLUMN IF NOT EXISTS field_values jsonb NOT NULL DEFAULT '{}';
ALTER TABLE cx_admin_ticket_fields ADD COLUMN IF NOT EXISTS values_enc text;
ALTER TABLE cx_admin_ticket_fields ADD COLUMN IF NOT EXISTS updated_by text;
ALTER TABLE cx_admin_ticket_fields ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE cx_admin_automations ADD COLUMN IF NOT EXISTS project_id text REFERENCES projects(id) ON DELETE CASCADE;
ALTER TABLE cx_admin_automations ADD COLUMN IF NOT EXISTS name text;
ALTER TABLE cx_admin_automations ADD COLUMN IF NOT EXISTS trigger text NOT NULL DEFAULT 'created' CHECK (trigger IN ('created','customer_reply'));
ALTER TABLE cx_admin_automations ADD COLUMN IF NOT EXISTS social_type text NOT NULL DEFAULT 'any';
ALTER TABLE cx_admin_automations ADD COLUMN IF NOT EXISTS position integer NOT NULL DEFAULT 0;
ALTER TABLE cx_admin_automations ADD COLUMN IF NOT EXISTS active boolean NOT NULL DEFAULT true;
ALTER TABLE cx_admin_automations ADD COLUMN IF NOT EXISTS stop boolean NOT NULL DEFAULT false;
ALTER TABLE cx_admin_automations ADD COLUMN IF NOT EXISTS match text NOT NULL DEFAULT 'all' CHECK (match IN ('all','any'));
ALTER TABLE cx_admin_automations ADD COLUMN IF NOT EXISTS conditions jsonb NOT NULL DEFAULT '[]';
ALTER TABLE cx_admin_automations ADD COLUMN IF NOT EXISTS actions jsonb NOT NULL DEFAULT '{}';
ALTER TABLE cx_admin_automations ADD COLUMN IF NOT EXISTS hits integer NOT NULL DEFAULT 0;
ALTER TABLE cx_admin_automations ADD COLUMN IF NOT EXISTS last_hit_at timestamptz;
ALTER TABLE cx_admin_automations ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE cx_admin_quick_actions ADD COLUMN IF NOT EXISTS project_id text REFERENCES projects(id) ON DELETE CASCADE;
ALTER TABLE cx_admin_quick_actions ADD COLUMN IF NOT EXISTS name text;
ALTER TABLE cx_admin_quick_actions ADD COLUMN IF NOT EXISTS description text NOT NULL DEFAULT '';
ALTER TABLE cx_admin_quick_actions ADD COLUMN IF NOT EXISTS actions jsonb NOT NULL DEFAULT '{}';
ALTER TABLE cx_admin_quick_actions ADD COLUMN IF NOT EXISTS position integer NOT NULL DEFAULT 0;
ALTER TABLE cx_admin_quick_actions ADD COLUMN IF NOT EXISTS uses integer NOT NULL DEFAULT 0;
ALTER TABLE cx_admin_quick_actions ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE cx_admin_ticket_state ADD COLUMN IF NOT EXISTS project_id text REFERENCES projects(id) ON DELETE CASCADE;
ALTER TABLE cx_admin_ticket_state ADD COLUMN IF NOT EXISTS automated_at timestamptz;
ALTER TABLE cx_admin_ticket_state ADD COLUMN IF NOT EXISTS replied_msg_at timestamptz;
ALTER TABLE cx_admin_ticket_state ADD COLUMN IF NOT EXISTS queued_at timestamptz;
ALTER TABLE cx_admin_ticket_state ADD COLUMN IF NOT EXISTS in_queue boolean NOT NULL DEFAULT false;
ALTER TABLE cx_admin_ticket_state ADD COLUMN IF NOT EXISTS queue_agent text;
ALTER TABLE cx_admin_ticket_state ADD COLUMN IF NOT EXISTS assigned_at timestamptz;
ALTER TABLE cx_admin_ticket_state ADD COLUMN IF NOT EXISTS segment text;
ALTER TABLE cx_admin_ticket_state ADD COLUMN IF NOT EXISTS sla_rule_id text;
ALTER TABLE cx_admin_ticket_state ADD COLUMN IF NOT EXISTS next_response_due timestamptz;
ALTER TABLE cx_admin_ticket_state ADD COLUMN IF NOT EXISTS prebreach_sent jsonb NOT NULL DEFAULT '[]';
ALTER TABLE cx_admin_ticket_state ADD COLUMN IF NOT EXISTS escalation_level integer NOT NULL DEFAULT 0;
ALTER TABLE cx_admin_ticket_state ADD COLUMN IF NOT EXISTS last_status text;
ALTER TABLE cx_admin_ticket_state ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE cx_admin_queue_settings ADD COLUMN IF NOT EXISTS enabled boolean NOT NULL DEFAULT false;
ALTER TABLE cx_admin_queue_settings ADD COLUMN IF NOT EXISTS assignment_type text NOT NULL DEFAULT 'round_robin';
ALTER TABLE cx_admin_queue_settings ADD COLUMN IF NOT EXISTS max_per_agent integer NOT NULL DEFAULT 10;
ALTER TABLE cx_admin_queue_settings ADD COLUMN IF NOT EXISTS cleanup_minutes integer;
ALTER TABLE cx_admin_queue_settings ADD COLUMN IF NOT EXISTS reset_on_status boolean NOT NULL DEFAULT true;
ALTER TABLE cx_admin_queue_settings ADD COLUMN IF NOT EXISTS reset_after_minutes integer NOT NULL DEFAULT 0;
ALTER TABLE cx_admin_queue_settings ADD COLUMN IF NOT EXISTS remove_on jsonb NOT NULL DEFAULT '["pending","on_hold","solved","closed"]';
ALTER TABLE cx_admin_queue_settings ADD COLUMN IF NOT EXISTS segments jsonb NOT NULL DEFAULT '[]';
ALTER TABLE cx_admin_queue_settings ADD COLUMN IF NOT EXISTS by_timezone boolean NOT NULL DEFAULT false;
ALTER TABLE cx_admin_queue_settings ADD COLUMN IF NOT EXISTS rr_cursor integer NOT NULL DEFAULT 0;
ALTER TABLE cx_admin_queue_settings ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE cx_admin_user_statuses ADD COLUMN IF NOT EXISTS project_id text REFERENCES projects(id) ON DELETE CASCADE;
ALTER TABLE cx_admin_user_statuses ADD COLUMN IF NOT EXISTS name text;
ALTER TABLE cx_admin_user_statuses ADD COLUMN IF NOT EXISTS available boolean NOT NULL DEFAULT false;
ALTER TABLE cx_admin_user_statuses ADD COLUMN IF NOT EXISTS limit_minutes integer;
ALTER TABLE cx_admin_user_statuses ADD COLUMN IF NOT EXISTS position integer NOT NULL DEFAULT 0;
ALTER TABLE cx_admin_agents ADD COLUMN IF NOT EXISTS project_id text REFERENCES projects(id) ON DELETE CASCADE;
ALTER TABLE cx_admin_agents ADD COLUMN IF NOT EXISTS user_id text REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE cx_admin_agents ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'offline';
ALTER TABLE cx_admin_agents ADD COLUMN IF NOT EXISTS status_id text;
ALTER TABLE cx_admin_agents ADD COLUMN IF NOT EXISTS since timestamptz NOT NULL DEFAULT now();
ALTER TABLE cx_admin_agents ADD COLUMN IF NOT EXISTS paused boolean NOT NULL DEFAULT false;
ALTER TABLE cx_admin_agents ADD COLUMN IF NOT EXISTS paused_by text;
ALTER TABLE cx_admin_agents ADD COLUMN IF NOT EXISTS capacity integer;
ALTER TABLE cx_admin_agents ADD COLUMN IF NOT EXISTS office_start text;
ALTER TABLE cx_admin_agents ADD COLUMN IF NOT EXISTS office_end text;
ALTER TABLE cx_admin_agents ADD COLUMN IF NOT EXISTS timezone text;
ALTER TABLE cx_admin_agents ADD COLUMN IF NOT EXISTS last_assigned_at timestamptz;
ALTER TABLE cx_admin_agents ADD COLUMN IF NOT EXISTS overrun_notified boolean NOT NULL DEFAULT false;
ALTER TABLE cx_admin_status_log ADD COLUMN IF NOT EXISTS project_id text REFERENCES projects(id) ON DELETE CASCADE;
ALTER TABLE cx_admin_status_log ADD COLUMN IF NOT EXISTS user_id text REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE cx_admin_status_log ADD COLUMN IF NOT EXISTS status text;
ALTER TABLE cx_admin_status_log ADD COLUMN IF NOT EXISTS started_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE cx_admin_status_log ADD COLUMN IF NOT EXISTS ended_at timestamptz;
ALTER TABLE cx_admin_team_settings ADD COLUMN IF NOT EXISTS project_id text REFERENCES projects(id) ON DELETE CASCADE;
ALTER TABLE cx_admin_team_settings ADD COLUMN IF NOT EXISTS timezone text NOT NULL DEFAULT 'UTC';
ALTER TABLE cx_admin_team_settings ADD COLUMN IF NOT EXISTS start_time text NOT NULL DEFAULT '09:00';
ALTER TABLE cx_admin_team_settings ADD COLUMN IF NOT EXISTS end_time text NOT NULL DEFAULT '18:00';
ALTER TABLE cx_admin_sla_rules ADD COLUMN IF NOT EXISTS project_id text REFERENCES projects(id) ON DELETE CASCADE;
ALTER TABLE cx_admin_sla_rules ADD COLUMN IF NOT EXISTS name text;
ALTER TABLE cx_admin_sla_rules ADD COLUMN IF NOT EXISTS priority text;
ALTER TABLE cx_admin_sla_rules ADD COLUMN IF NOT EXISTS channels jsonb NOT NULL DEFAULT '[]';
ALTER TABLE cx_admin_sla_rules ADD COLUMN IF NOT EXISTS segment text;
ALTER TABLE cx_admin_sla_rules ADD COLUMN IF NOT EXISTS team text;
ALTER TABLE cx_admin_sla_rules ADD COLUMN IF NOT EXISTS first_response_minutes integer;
ALTER TABLE cx_admin_sla_rules ADD COLUMN IF NOT EXISTS every_response_minutes integer;
ALTER TABLE cx_admin_sla_rules ADD COLUMN IF NOT EXISTS resolution_minutes integer;
ALTER TABLE cx_admin_sla_rules ADD COLUMN IF NOT EXISTS business_hours boolean NOT NULL DEFAULT true;
ALTER TABLE cx_admin_sla_rules ADD COLUMN IF NOT EXISTS start_from text NOT NULL DEFAULT 'created' CHECK (start_from IN ('created','queued'));
ALTER TABLE cx_admin_sla_rules ADD COLUMN IF NOT EXISTS valid_from date;
ALTER TABLE cx_admin_sla_rules ADD COLUMN IF NOT EXISTS valid_to date;
ALTER TABLE cx_admin_sla_rules ADD COLUMN IF NOT EXISTS windows jsonb NOT NULL DEFAULT '[]';
ALTER TABLE cx_admin_sla_rules ADD COLUMN IF NOT EXISTS active boolean NOT NULL DEFAULT true;
ALTER TABLE cx_admin_sla_rules ADD COLUMN IF NOT EXISTS position integer NOT NULL DEFAULT 0;
ALTER TABLE cx_admin_sla_rules ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE cx_admin_escalations ADD COLUMN IF NOT EXISTS project_id text REFERENCES projects(id) ON DELETE CASCADE;
ALTER TABLE cx_admin_escalations ADD COLUMN IF NOT EXISTS name text;
ALTER TABLE cx_admin_escalations ADD COLUMN IF NOT EXISTS match text NOT NULL DEFAULT 'all';
ALTER TABLE cx_admin_escalations ADD COLUMN IF NOT EXISTS conditions jsonb NOT NULL DEFAULT '[]';
ALTER TABLE cx_admin_escalations ADD COLUMN IF NOT EXISTS prebreach jsonb NOT NULL DEFAULT '[75,90]';
ALTER TABLE cx_admin_escalations ADD COLUMN IF NOT EXISTS levels jsonb NOT NULL DEFAULT '[]';
ALTER TABLE cx_admin_escalations ADD COLUMN IF NOT EXISTS active boolean NOT NULL DEFAULT true;
ALTER TABLE cx_admin_escalations ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE cx_admin_roles ADD COLUMN IF NOT EXISTS project_id text REFERENCES projects(id) ON DELETE CASCADE;
ALTER TABLE cx_admin_roles ADD COLUMN IF NOT EXISTS name text;
ALTER TABLE cx_admin_roles ADD COLUMN IF NOT EXISTS description text NOT NULL DEFAULT '';
ALTER TABLE cx_admin_roles ADD COLUMN IF NOT EXISTS pages jsonb NOT NULL DEFAULT '[]';
ALTER TABLE cx_admin_roles ADD COLUMN IF NOT EXISTS actions jsonb NOT NULL DEFAULT '[]';
ALTER TABLE cx_admin_roles ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE cx_admin_member_roles ADD COLUMN IF NOT EXISTS project_id text REFERENCES projects(id) ON DELETE CASCADE;
ALTER TABLE cx_admin_member_roles ADD COLUMN IF NOT EXISTS user_id text REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE cx_admin_member_roles ADD COLUMN IF NOT EXISTS role_id text REFERENCES cx_admin_roles(id) ON DELETE CASCADE;
ALTER TABLE cx_admin_audit ADD COLUMN IF NOT EXISTS project_id text REFERENCES projects(id) ON DELETE CASCADE;
ALTER TABLE cx_admin_audit ADD COLUMN IF NOT EXISTS actor_id text;
ALTER TABLE cx_admin_audit ADD COLUMN IF NOT EXISTS actor_name text NOT NULL DEFAULT '';
ALTER TABLE cx_admin_audit ADD COLUMN IF NOT EXISTS action text;
ALTER TABLE cx_admin_audit ADD COLUMN IF NOT EXISTS target text NOT NULL DEFAULT '';
ALTER TABLE cx_admin_audit ADD COLUMN IF NOT EXISTS detail text NOT NULL DEFAULT '';
ALTER TABLE cx_admin_audit ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE cx_admin_integrations ADD COLUMN IF NOT EXISTS project_id text REFERENCES projects(id) ON DELETE CASCADE;
ALTER TABLE cx_admin_integrations ADD COLUMN IF NOT EXISTS kind text;
ALTER TABLE cx_admin_integrations ADD COLUMN IF NOT EXISTS config jsonb NOT NULL DEFAULT '{}';
ALTER TABLE cx_admin_integrations ADD COLUMN IF NOT EXISTS secret_enc text;
ALTER TABLE cx_admin_integrations ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE cx_admin_alerts ADD COLUMN IF NOT EXISTS project_id text REFERENCES projects(id) ON DELETE CASCADE;
ALTER TABLE cx_admin_alerts ADD COLUMN IF NOT EXISTS name text;
ALTER TABLE cx_admin_alerts ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'tickets' CHECK (source IN ('tickets','mentions'));
ALTER TABLE cx_admin_alerts ADD COLUMN IF NOT EXISTS filters jsonb NOT NULL DEFAULT '{}';
ALTER TABLE cx_admin_alerts ADD COLUMN IF NOT EXISTS delivery jsonb NOT NULL DEFAULT '{}';
ALTER TABLE cx_admin_alerts ADD COLUMN IF NOT EXISTS format text NOT NULL DEFAULT 'text' CHECK (format IN ('text','csv'));
ALTER TABLE cx_admin_alerts ADD COLUMN IF NOT EXISTS delay_minutes integer NOT NULL DEFAULT 0;
ALTER TABLE cx_admin_alerts ADD COLUMN IF NOT EXISTS active_hours jsonb;
ALTER TABLE cx_admin_alerts ADD COLUMN IF NOT EXISTS active boolean NOT NULL DEFAULT true;
ALTER TABLE cx_admin_alerts ADD COLUMN IF NOT EXISTS checked_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE cx_admin_alerts ADD COLUMN IF NOT EXISTS last_fired_at timestamptz;
ALTER TABLE cx_admin_alerts ADD COLUMN IF NOT EXISTS fired integer NOT NULL DEFAULT 0;
ALTER TABLE cx_admin_alerts ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE cx_admin_alert_log ADD COLUMN IF NOT EXISTS alert_id text REFERENCES cx_admin_alerts(id) ON DELETE CASCADE;
ALTER TABLE cx_admin_alert_log ADD COLUMN IF NOT EXISTS project_id text REFERENCES projects(id) ON DELETE CASCADE;
ALTER TABLE cx_admin_alert_log ADD COLUMN IF NOT EXISTS channel text;
ALTER TABLE cx_admin_alert_log ADD COLUMN IF NOT EXISTS items integer NOT NULL DEFAULT 0;
ALTER TABLE cx_admin_alert_log ADD COLUMN IF NOT EXISTS ok boolean NOT NULL DEFAULT true;
ALTER TABLE cx_admin_alert_log ADD COLUMN IF NOT EXISTS error text;
ALTER TABLE cx_admin_alert_log ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE cx_admin_webhooks ADD COLUMN IF NOT EXISTS project_id text REFERENCES projects(id) ON DELETE CASCADE;
ALTER TABLE cx_admin_webhooks ADD COLUMN IF NOT EXISTS name text NOT NULL DEFAULT '';
ALTER TABLE cx_admin_webhooks ADD COLUMN IF NOT EXISTS url text;
ALTER TABLE cx_admin_webhooks ADD COLUMN IF NOT EXISTS events jsonb NOT NULL DEFAULT '[]';
ALTER TABLE cx_admin_webhooks ADD COLUMN IF NOT EXISTS secret_enc text;
ALTER TABLE cx_admin_webhooks ADD COLUMN IF NOT EXISTS active boolean NOT NULL DEFAULT true;
ALTER TABLE cx_admin_webhooks ADD COLUMN IF NOT EXISTS failures integer NOT NULL DEFAULT 0;
ALTER TABLE cx_admin_webhooks ADD COLUMN IF NOT EXISTS last_status integer;
ALTER TABLE cx_admin_webhooks ADD COLUMN IF NOT EXISTS last_error text;
ALTER TABLE cx_admin_webhooks ADD COLUMN IF NOT EXISTS last_delivery_at timestamptz;
ALTER TABLE cx_admin_webhooks ADD COLUMN IF NOT EXISTS deactivated_at timestamptz;
ALTER TABLE cx_admin_webhooks ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE cx_admin_webhook_deliveries ADD COLUMN IF NOT EXISTS webhook_id text REFERENCES cx_admin_webhooks(id) ON DELETE CASCADE;
ALTER TABLE cx_admin_webhook_deliveries ADD COLUMN IF NOT EXISTS project_id text REFERENCES projects(id) ON DELETE CASCADE;
ALTER TABLE cx_admin_webhook_deliveries ADD COLUMN IF NOT EXISTS event text;
ALTER TABLE cx_admin_webhook_deliveries ADD COLUMN IF NOT EXISTS payload jsonb NOT NULL DEFAULT '{}';
ALTER TABLE cx_admin_webhook_deliveries ADD COLUMN IF NOT EXISTS attempts integer NOT NULL DEFAULT 0;
ALTER TABLE cx_admin_webhook_deliveries ADD COLUMN IF NOT EXISTS state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','delivered','failed'));
ALTER TABLE cx_admin_webhook_deliveries ADD COLUMN IF NOT EXISTS response_code integer;
ALTER TABLE cx_admin_webhook_deliveries ADD COLUMN IF NOT EXISTS error text;
ALTER TABLE cx_admin_webhook_deliveries ADD COLUMN IF NOT EXISTS next_attempt_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE cx_admin_webhook_deliveries ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE cx_admin_cursors ADD COLUMN IF NOT EXISTS project_id text REFERENCES projects(id) ON DELETE CASCADE;
ALTER TABLE cx_admin_cursors ADD COLUMN IF NOT EXISTS name text;
ALTER TABLE cx_admin_cursors ADD COLUMN IF NOT EXISTS at timestamptz NOT NULL DEFAULT now();
ALTER TABLE cx_admin_api_tokens ADD COLUMN IF NOT EXISTS project_id text REFERENCES projects(id) ON DELETE CASCADE;
ALTER TABLE cx_admin_api_tokens ADD COLUMN IF NOT EXISTS user_id text REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE cx_admin_api_tokens ADD COLUMN IF NOT EXISTS kind text CHECK (kind IN ('account','user'));
ALTER TABLE cx_admin_api_tokens ADD COLUMN IF NOT EXISTS name text;
ALTER TABLE cx_admin_api_tokens ADD COLUMN IF NOT EXISTS prefix text;
ALTER TABLE cx_admin_api_tokens ADD COLUMN IF NOT EXISTS token_hash text;
ALTER TABLE cx_admin_api_tokens ADD COLUMN IF NOT EXISTS last_used_at timestamptz;
ALTER TABLE cx_admin_api_tokens ADD COLUMN IF NOT EXISTS revoked_at timestamptz;
ALTER TABLE cx_admin_api_tokens ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE cx_admin_external_apis ADD COLUMN IF NOT EXISTS project_id text REFERENCES projects(id) ON DELETE CASCADE;
ALTER TABLE cx_admin_external_apis ADD COLUMN IF NOT EXISTS name text;
ALTER TABLE cx_admin_external_apis ADD COLUMN IF NOT EXISTS target text NOT NULL DEFAULT 'ticket' CHECK (target IN ('ticket','contact'));
ALTER TABLE cx_admin_external_apis ADD COLUMN IF NOT EXISTS method text NOT NULL DEFAULT 'GET' CHECK (method IN ('GET','POST'));
ALTER TABLE cx_admin_external_apis ADD COLUMN IF NOT EXISTS url text;
ALTER TABLE cx_admin_external_apis ADD COLUMN IF NOT EXISTS headers_enc text;
ALTER TABLE cx_admin_external_apis ADD COLUMN IF NOT EXISTS body text NOT NULL DEFAULT '';
ALTER TABLE cx_admin_external_apis ADD COLUMN IF NOT EXISTS mapping jsonb NOT NULL DEFAULT '[]';
ALTER TABLE cx_admin_external_apis ADD COLUMN IF NOT EXISTS active boolean NOT NULL DEFAULT true;
ALTER TABLE cx_admin_external_apis ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
`;
