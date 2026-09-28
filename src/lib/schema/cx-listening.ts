/** Tables owned by the CX listening module. CREATE TABLE IF NOT EXISTS / ADD COLUMN IF NOT EXISTS only. */
export const cxListeningSchema = `
CREATE TABLE IF NOT EXISTS cx_listening_settings (
  project_id text PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  volume_z real NOT NULL DEFAULT 3,
  negative_z real NOT NULL DEFAULT 3,
  min_mentions integer NOT NULL DEFAULT 5,
  baseline_days integer NOT NULL DEFAULT 14,
  window_hours integer NOT NULL DEFAULT 24,
  escalation_owner text NOT NULL DEFAULT '',
  notify boolean NOT NULL DEFAULT true,
  first_fetch_at timestamptz,
  last_fetch_at timestamptz,
  last_fetch jsonb NOT NULL DEFAULT '{}',
  last_detect_at timestamptz,
  last_detect jsonb NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS cx_listening_topic_opts (
  topic_id text PRIMARY KEY REFERENCES cx_topics(id) ON DELETE CASCADE,
  app_ids jsonb NOT NULL DEFAULT '[]'
);
CREATE INDEX IF NOT EXISTS cx_mentions_topic ON cx_mentions(project_id, topic_id, published_at DESC);

CREATE TABLE IF NOT EXISTS cx_crisis_events (
  id text PRIMARY KEY,
  project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  topic_id text REFERENCES cx_topics(id) ON DELETE SET NULL,
  scope_key text NOT NULL,
  title text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('volume','negative','both')),
  severity text NOT NULL DEFAULT 'warning' CHECK (severity IN ('warning','critical')),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','monitoring','resolved')),
  owner text NOT NULL DEFAULT '',
  metrics jsonb NOT NULL DEFAULT '{}',
  window_start timestamptz NOT NULL,
  window_end timestamptz NOT NULL,
  peak_z real NOT NULL DEFAULT 0,
  detected_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz
);
CREATE INDEX IF NOT EXISTS cx_crisis_events_project ON cx_crisis_events(project_id, status, detected_at DESC);

CREATE TABLE IF NOT EXISTS cx_crisis_mentions (
  event_id text NOT NULL REFERENCES cx_crisis_events(id) ON DELETE CASCADE,
  mention_id text NOT NULL REFERENCES cx_mentions(id) ON DELETE CASCADE,
  PRIMARY KEY (event_id, mention_id)
);

CREATE TABLE IF NOT EXISTS cx_crisis_notes (
  id text PRIMARY KEY,
  event_id text NOT NULL REFERENCES cx_crisis_events(id) ON DELETE CASCADE,
  author_user_id text REFERENCES users(id) ON DELETE SET NULL,
  author_name text NOT NULL DEFAULT '',
  kind text NOT NULL DEFAULT 'note' CHECK (kind IN ('note','status','system')),
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS cx_crisis_notes_event ON cx_crisis_notes(event_id, created_at);
`;
