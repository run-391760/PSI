/** Account connections (Google Search Console / Analytics) and per-project property links. */
export const integrationsSchema = `
CREATE TABLE IF NOT EXISTS oauth_states (
  state text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider text NOT NULL,
  return_to text NOT NULL DEFAULT '/settings?tab=integrations',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS google_connections (
  user_id text PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  email text NOT NULL DEFAULT '',
  scopes text NOT NULL DEFAULT '',
  refresh_token_enc text NOT NULL,
  access_token_enc text,
  access_expires_at timestamptz,
  connected_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS project_google (
  project_id text PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  gsc_site text,
  ga4_property text,
  ga4_property_name text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
`;
