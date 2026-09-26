/**
 * Tables owned by the keywords module. Use CREATE TABLE IF NOT EXISTS / ADD COLUMN IF NOT EXISTS only:
 * this SQL runs on every server start against existing data.
 */
export const keywordsSchema = `
CREATE TABLE IF NOT EXISTS kw_lists (
  id text PRIMARY KEY, owner_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name text NOT NULL, db text NOT NULL DEFAULT 'US',
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS kw_lists_owner ON kw_lists(owner_id, updated_at DESC);
CREATE TABLE IF NOT EXISTS kw_list_items (
  list_id text NOT NULL REFERENCES kw_lists(id) ON DELETE CASCADE,
  keyword text NOT NULL,
  volume integer, kd integer, cpc real, competition real,
  intents jsonb NOT NULL DEFAULT '[]', serp_features jsonb NOT NULL DEFAULT '[]', trend jsonb NOT NULL DEFAULT '[]',
  results bigint, metrics_source text NOT NULL DEFAULT 'demo', added_from text NOT NULL DEFAULT 'manual',
  added_at timestamptz NOT NULL DEFAULT now(), metrics_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(list_id, keyword)
);

CREATE TABLE IF NOT EXISTS kw_ppc_campaigns (
  id text PRIMARY KEY, owner_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name text NOT NULL, db text NOT NULL DEFAULT 'US', ctr real NOT NULL DEFAULT 0.035,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS kw_ppc_campaigns_owner ON kw_ppc_campaigns(owner_id, updated_at DESC);
CREATE TABLE IF NOT EXISTS kw_ppc_groups (
  id text PRIMARY KEY, campaign_id text NOT NULL REFERENCES kw_ppc_campaigns(id) ON DELETE CASCADE,
  name text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS kw_ppc_groups_campaign ON kw_ppc_groups(campaign_id, created_at);
CREATE TABLE IF NOT EXISTS kw_ppc_keywords (
  id text PRIMARY KEY, campaign_id text NOT NULL REFERENCES kw_ppc_campaigns(id) ON DELETE CASCADE,
  group_id text NOT NULL REFERENCES kw_ppc_groups(id) ON DELETE CASCADE,
  keyword text NOT NULL, match_type text NOT NULL DEFAULT 'broad' CHECK (match_type IN ('broad','phrase','exact')),
  volume integer, cpc real, competition real, metrics_source text NOT NULL DEFAULT 'demo',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(group_id, keyword)
);
CREATE INDEX IF NOT EXISTS kw_ppc_keywords_campaign ON kw_ppc_keywords(campaign_id);
CREATE TABLE IF NOT EXISTS kw_ppc_negatives (
  id text PRIMARY KEY, campaign_id text NOT NULL REFERENCES kw_ppc_campaigns(id) ON DELETE CASCADE,
  group_id text REFERENCES kw_ppc_groups(id) ON DELETE CASCADE,
  keyword text NOT NULL, match_type text NOT NULL DEFAULT 'phrase' CHECK (match_type IN ('broad','phrase','exact')),
  origin text NOT NULL DEFAULT 'manual' CHECK (origin IN ('manual','cross-group')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS kw_ppc_negatives_campaign ON kw_ppc_negatives(campaign_id);
CREATE UNIQUE INDEX IF NOT EXISTS kw_ppc_negatives_unique ON kw_ppc_negatives(campaign_id, COALESCE(group_id, ''), keyword, match_type);

CREATE TABLE IF NOT EXISTS kw_topic_favorites (
  id text PRIMARY KEY, owner_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  topic text NOT NULL, db text NOT NULL DEFAULT 'US',
  kind text NOT NULL CHECK (kind IN ('headline','question','subtopic','related')),
  text text NOT NULL, subtopic text NOT NULL DEFAULT '', meta jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(owner_id, topic, db, kind, text)
);
CREATE INDEX IF NOT EXISTS kw_topic_favorites_owner ON kw_topic_favorites(owner_id, created_at DESC);
`;
