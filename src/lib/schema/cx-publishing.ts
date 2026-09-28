/** Tables owned by the CX publishing module. CREATE TABLE IF NOT EXISTS / ADD COLUMN IF NOT EXISTS only. */
export const cxPublishingSchema = `
CREATE TABLE IF NOT EXISTS cx_pub_campaigns (
  id text PRIMARY KEY,
  project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name text NOT NULL,
  color integer NOT NULL DEFAULT 1,
  starts_on date,
  ends_on date,
  notes text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS cx_pub_campaigns_project ON cx_pub_campaigns(project_id);

CREATE TABLE IF NOT EXISTS cx_pub_assets (
  id text PRIMARY KEY,
  project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  filename text NOT NULL,
  mime text NOT NULL,
  size bigint NOT NULL DEFAULT 0,
  file text NOT NULL,
  public_token text NOT NULL,
  tags jsonb NOT NULL DEFAULT '[]',
  uploaded_by text REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS cx_pub_assets_project ON cx_pub_assets(project_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS cx_pub_assets_token ON cx_pub_assets(public_token);

CREATE TABLE IF NOT EXISTS cx_pub_posts (
  id text PRIMARY KEY,
  project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  campaign_id text REFERENCES cx_pub_campaigns(id) ON DELETE SET NULL,
  author_id text REFERENCES users(id) ON DELETE SET NULL,
  approver_id text REFERENCES users(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','pending','approved','scheduled','published','failed')),
  title text NOT NULL DEFAULT '',
  body text NOT NULL DEFAULT '',
  variants jsonb NOT NULL DEFAULT '{}',
  channels jsonb NOT NULL DEFAULT '[]',
  media jsonb NOT NULL DEFAULT '[]',
  first_comment text NOT NULL DEFAULT '',
  link_url text,
  utm jsonb NOT NULL DEFAULT '{}',
  links jsonb NOT NULL DEFAULT '{}',
  origin text,
  scheduled_at timestamptz,
  published_at timestamptz,
  results jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS cx_pub_posts_project ON cx_pub_posts(project_id, updated_at DESC);
ALTER TABLE cx_pub_posts ADD COLUMN IF NOT EXISTS dispatching_until timestamptz;
CREATE INDEX IF NOT EXISTS cx_pub_posts_due ON cx_pub_posts(status, scheduled_at);

CREATE TABLE IF NOT EXISTS cx_pub_comments (
  id text PRIMARY KEY,
  post_id text NOT NULL REFERENCES cx_pub_posts(id) ON DELETE CASCADE,
  user_id text REFERENCES users(id) ON DELETE SET NULL,
  author_name text NOT NULL DEFAULT '',
  kind text NOT NULL DEFAULT 'comment',
  body text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS cx_pub_comments_post ON cx_pub_comments(post_id, created_at);

CREATE TABLE IF NOT EXISTS cx_pub_links (
  id text PRIMARY KEY,
  project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  code text NOT NULL UNIQUE,
  target_url text NOT NULL,
  label text NOT NULL DEFAULT '',
  channel text,
  post_id text REFERENCES cx_pub_posts(id) ON DELETE SET NULL,
  campaign_id text REFERENCES cx_pub_campaigns(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS cx_pub_links_project ON cx_pub_links(project_id, created_at DESC);

CREATE TABLE IF NOT EXISTS cx_pub_clicks (
  id bigserial PRIMARY KEY,
  link_id text NOT NULL REFERENCES cx_pub_links(id) ON DELETE CASCADE,
  clicked_at timestamptz NOT NULL DEFAULT now(),
  referrer_host text,
  device text
);
CREATE INDEX IF NOT EXISTS cx_pub_clicks_link ON cx_pub_clicks(link_id, clicked_at);

CREATE TABLE IF NOT EXISTS cx_pub_roles (
  project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('author','approver')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, user_id, role)
);

CREATE TABLE IF NOT EXISTS cx_pub_settings (
  project_id text PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  require_approval boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS cx_pub_accounts (
  project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  kind text NOT NULL,
  external_id text NOT NULL,
  label text NOT NULL DEFAULT '',
  token_enc text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, kind)
);

CREATE TABLE IF NOT EXISTS cx_pub_stats (
  project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  kind text NOT NULL,
  day date NOT NULL,
  followers bigint,
  views bigint,
  posts bigint,
  PRIMARY KEY (project_id, kind, day)
);
`;
