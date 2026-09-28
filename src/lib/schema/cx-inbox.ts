/** Tables owned by the CX inbox module. CREATE TABLE IF NOT EXISTS / ADD COLUMN IF NOT EXISTS only. */
export const cxInboxSchema = `
CREATE TABLE IF NOT EXISTS cx_inbox_rules (
  id text PRIMARY KEY,
  project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  kind text NOT NULL DEFAULT 'route' CHECK (kind IN ('route','tag')),
  name text NOT NULL,
  position integer NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  match text NOT NULL DEFAULT 'all' CHECK (match IN ('all','any')),
  conditions jsonb NOT NULL DEFAULT '[]',
  actions jsonb NOT NULL DEFAULT '{}',
  hits integer NOT NULL DEFAULT 0,
  last_hit_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS cx_inbox_rules_project ON cx_inbox_rules(project_id, kind, position);

CREATE TABLE IF NOT EXISTS cx_inbox_canned (
  id text PRIMARY KEY,
  project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title text NOT NULL,
  shortcut text NOT NULL DEFAULT '',
  body text NOT NULL,
  uses integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS cx_inbox_canned_project ON cx_inbox_canned(project_id, title);

CREATE TABLE IF NOT EXISTS cx_inbox_chat_sessions (
  id text PRIMARY KEY,
  channel_id text NOT NULL REFERENCES cx_channels(id) ON DELETE CASCADE,
  project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  ticket_id text REFERENCES cx_tickets(id) ON DELETE SET NULL,
  contact_id text REFERENCES cx_contacts(id) ON DELETE SET NULL,
  name text NOT NULL DEFAULT '',
  email text,
  page_url text,
  user_agent text,
  visitor_seen_at timestamptz NOT NULL DEFAULT now(),
  visitor_typing_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS cx_inbox_chat_ticket ON cx_inbox_chat_sessions(ticket_id);

CREATE TABLE IF NOT EXISTS cx_inbox_presence (
  ticket_id text NOT NULL REFERENCES cx_tickets(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  user_name text NOT NULL DEFAULT '',
  typing boolean NOT NULL DEFAULT false,
  seen_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (ticket_id, user_id)
);

CREATE TABLE IF NOT EXISTS cx_inbox_sla_alerts (
  ticket_id text NOT NULL REFERENCES cx_tickets(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('first_response','resolution')),
  notified_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (ticket_id, kind)
);

CREATE TABLE IF NOT EXISTS cx_inbox_events (
  id text PRIMARY KEY,
  ticket_id text NOT NULL REFERENCES cx_tickets(id) ON DELETE CASCADE,
  actor text NOT NULL DEFAULT '',
  kind text NOT NULL,
  detail text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS cx_inbox_events_ticket ON cx_inbox_events(ticket_id, created_at);

CREATE TABLE IF NOT EXISTS cx_contact_notes (
  id text PRIMARY KEY,
  contact_id text NOT NULL REFERENCES cx_contacts(id) ON DELETE CASCADE,
  author_user_id text REFERENCES users(id) ON DELETE SET NULL,
  author_name text NOT NULL DEFAULT '',
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS cx_contact_notes_contact ON cx_contact_notes(contact_id, created_at DESC);

-- Agent workspace (WP1): CRM status overlay, severity, parent-child, escalation per ticket.
CREATE TABLE IF NOT EXISTS cx_inbox_ticket_meta (
  ticket_id text PRIMARY KEY REFERENCES cx_tickets(id) ON DELETE CASCADE,
  crm_status text,
  severity text,
  parent_id text REFERENCES cx_tickets(id) ON DELETE SET NULL,
  escalated_at timestamptz,
  escalated_to text,
  sentiment_manual boolean NOT NULL DEFAULT false,
  reopen_count integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS cx_inbox_ticket_meta_parent ON cx_inbox_ticket_meta(parent_id) WHERE parent_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS cx_inbox_reminders (
  id text PRIMARY KEY,
  project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  ticket_id text NOT NULL REFERENCES cx_tickets(id) ON DELETE CASCADE,
  created_by text REFERENCES users(id) ON DELETE SET NULL,
  created_by_name text NOT NULL DEFAULT '',
  remind_at timestamptz NOT NULL,
  note text NOT NULL DEFAULT '',
  user_ids jsonb NOT NULL DEFAULT '[]',
  fired_at timestamptz,
  dismissed jsonb NOT NULL DEFAULT '[]',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS cx_inbox_reminders_due ON cx_inbox_reminders(project_id, remind_at) WHERE fired_at IS NULL;
CREATE INDEX IF NOT EXISTS cx_inbox_reminders_ticket ON cx_inbox_reminders(ticket_id);

CREATE TABLE IF NOT EXISTS cx_inbox_files (
  id text PRIMARY KEY,
  project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  ticket_id text REFERENCES cx_tickets(id) ON DELETE SET NULL,
  filename text NOT NULL,
  mime text NOT NULL,
  size bigint NOT NULL DEFAULT 0,
  file text NOT NULL,
  public_token text NOT NULL UNIQUE,
  uploaded_by text REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS cx_inbox_files_project ON cx_inbox_files(project_id, created_at DESC);

CREATE TABLE IF NOT EXISTS cx_inbox_emails (
  id text PRIMARY KEY,
  project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  ticket_id text NOT NULL REFERENCES cx_tickets(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('escalate','forward','compose')),
  to_addrs jsonb NOT NULL DEFAULT '[]',
  cc_addrs jsonb NOT NULL DEFAULT '[]',
  bcc_addrs jsonb NOT NULL DEFAULT '[]',
  subject text NOT NULL DEFAULT '',
  body text NOT NULL DEFAULT '',
  attachments jsonb NOT NULL DEFAULT '[]',
  status text NOT NULL DEFAULT 'sent' CHECK (status IN ('sent','failed')),
  error text,
  message_id text,
  sent_by text REFERENCES users(id) ON DELETE SET NULL,
  sent_by_name text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS cx_inbox_emails_ticket ON cx_inbox_emails(ticket_id, created_at);

CREATE TABLE IF NOT EXISTS cx_inbox_message_meta (
  message_id text PRIMARY KEY REFERENCES cx_messages(id) ON DELETE CASCADE,
  reply_to text,
  mentions jsonb NOT NULL DEFAULT '[]',
  email_id text
);

CREATE TABLE IF NOT EXISTS cx_inbox_translations (
  message_id text NOT NULL REFERENCES cx_messages(id) ON DELETE CASCADE,
  lang text NOT NULL,
  text text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (message_id, lang)
);

CREATE TABLE IF NOT EXISTS cx_inbox_locks (
  ticket_id text PRIMARY KEY REFERENCES cx_tickets(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  user_name text NOT NULL DEFAULT '',
  acquired_at timestamptz NOT NULL DEFAULT now(),
  seen_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS cx_inbox_prefs (
  user_id text PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  prefs jsonb NOT NULL DEFAULT '{}',
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS cx_inbox_signatures (
  project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body text NOT NULL DEFAULT '',
  image_file_id text,
  enabled boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, user_id)
);

CREATE TABLE IF NOT EXISTS cx_inbox_settings (
  project_id text PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  settings jsonb NOT NULL DEFAULT '{}',
  updated_at timestamptz NOT NULL DEFAULT now()
);
`;
