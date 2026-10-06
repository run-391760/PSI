/**
 * CX workspace core tables (shared by all CX modules). A CX "brand" is an existing project.
 * Module-specific tables live in schema/cx-<module>.ts.
 */
export const cxSchema = `
CREATE TABLE IF NOT EXISTS cx_channels (
  id text PRIMARY KEY,
  project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  kind text NOT NULL,
  name text NOT NULL,
  config jsonb NOT NULL DEFAULT '{}',
  secret_enc text,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused','error')),
  last_error text,
  last_synced_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS cx_channels_project ON cx_channels(project_id, kind);

CREATE TABLE IF NOT EXISTS cx_contacts (
  id text PRIMARY KEY,
  project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name text NOT NULL DEFAULT '',
  email text,
  phone text,
  handles jsonb NOT NULL DEFAULT '{}',
  avatar_url text,
  tags jsonb NOT NULL DEFAULT '[]',
  attributes jsonb NOT NULL DEFAULT '{}',
  notes text NOT NULL DEFAULT '',
  first_seen timestamptz NOT NULL DEFAULT now(),
  last_seen timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS cx_contacts_project ON cx_contacts(project_id, last_seen DESC);
CREATE UNIQUE INDEX IF NOT EXISTS cx_contacts_email ON cx_contacts(project_id, lower(email)) WHERE email IS NOT NULL;

CREATE TABLE IF NOT EXISTS cx_tickets (
  id text PRIMARY KEY,
  project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  number integer NOT NULL,
  subject text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'new' CHECK (status IN ('new','open','pending','on_hold','solved','closed')),
  priority text NOT NULL DEFAULT 'normal' CHECK (priority IN ('low','normal','high','urgent')),
  channel_kind text NOT NULL,
  channel_id text REFERENCES cx_channels(id) ON DELETE SET NULL,
  contact_id text REFERENCES cx_contacts(id) ON DELETE SET NULL,
  assignee_id text REFERENCES users(id) ON DELETE SET NULL,
  team text,
  tags jsonb NOT NULL DEFAULT '[]',
  sentiment text,
  intent text,
  language text,
  external_thread_id text,
  first_response_due timestamptz,
  resolution_due timestamptz,
  first_response_at timestamptz,
  resolved_at timestamptz,
  csat integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(project_id, number)
);
CREATE INDEX IF NOT EXISTS cx_tickets_queue ON cx_tickets(project_id, status, updated_at DESC);

CREATE TABLE IF NOT EXISTS cx_messages (
  id text PRIMARY KEY,
  ticket_id text NOT NULL REFERENCES cx_tickets(id) ON DELETE CASCADE,
  direction text NOT NULL CHECK (direction IN ('in','out','note')),
  author_user_id text REFERENCES users(id) ON DELETE SET NULL,
  author_name text NOT NULL DEFAULT '',
  body text NOT NULL DEFAULT '',
  html text,
  attachments jsonb NOT NULL DEFAULT '[]',
  external_id text,
  delivery text NOT NULL DEFAULT 'stored' CHECK (delivery IN ('stored','queued','sent','failed')),
  delivery_error text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS cx_messages_ticket ON cx_messages(ticket_id, created_at);

CREATE TABLE IF NOT EXISTS cx_topics (
  id text PRIMARY KEY,
  project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name text NOT NULL,
  kind text NOT NULL DEFAULT 'brand' CHECK (kind IN ('brand','competitor','campaign','industry')),
  keywords jsonb NOT NULL DEFAULT '[]',
  excluded jsonb NOT NULL DEFAULT '[]',
  sources jsonb NOT NULL DEFAULT '[]',
  languages jsonb NOT NULL DEFAULT '[]',
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS cx_mentions (
  id text PRIMARY KEY,
  project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  topic_id text REFERENCES cx_topics(id) ON DELETE SET NULL,
  source text NOT NULL,
  external_id text NOT NULL,
  url text,
  author text NOT NULL DEFAULT '',
  author_handle text,
  author_followers integer,
  title text NOT NULL DEFAULT '',
  body text NOT NULL DEFAULT '',
  language text,
  country text,
  published_at timestamptz,
  sentiment text,
  sentiment_score real,
  intent text,
  engagement jsonb NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'new' CHECK (status IN ('new','read','actioned','ignored')),
  tags jsonb NOT NULL DEFAULT '[]',
  ticket_id text REFERENCES cx_tickets(id) ON DELETE SET NULL,
  fetched_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(project_id, source, external_id)
);
CREATE INDEX IF NOT EXISTS cx_mentions_feed ON cx_mentions(project_id, published_at DESC);
-- English translation of Indian-language mentions (Sarvam AI), shown under the original text.
ALTER TABLE cx_mentions ADD COLUMN IF NOT EXISTS translation text;
`;
