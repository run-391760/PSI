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
`;
