/**
 * Tables owned by the CX settings package (WP-K3): group details, profile metadata (color, creator),
 * pending user invites, user groups, the per-brand IP allowlist and public social profiles tracked
 * without login. Idempotent SQL: every table is CREATE TABLE IF NOT EXISTS and every column is also
 * added with ALTER TABLE … ADD COLUMN IF NOT EXISTS (NOT NULL only when the column has a default).
 * Extensions of existing tables live in their own files (cx-ops.ts profile groups, cx-listening.ts topic options).
 */
type Col = [name: string, def: string];

function table(name: string, pk: Col[], cols: Col[], extra: string[] = []) {
  const all = [...pk, ...cols];
  const create = `CREATE TABLE IF NOT EXISTS ${name} (\n  ${all.map(([n, d]) => `${n} ${d}`).join(",\n  ")}\n);`;
  const alters = cols.map(([n, d]) => {
    const safe = /DEFAULT/i.test(d) ? d : d.replace(/\s+NOT NULL/i, "");
    return `ALTER TABLE ${name} ADD COLUMN IF NOT EXISTS ${n} ${safe};`;
  });
  return [create, ...alters, ...extra].join("\n");
}

const PROJECT: Col = ["project_id", "text NOT NULL REFERENCES projects(id) ON DELETE CASCADE"];
const CREATED: Col[] = [
  ["created_by", "text REFERENCES users(id) ON DELETE SET NULL"],
  ["created_at", "timestamptz NOT NULL DEFAULT now()"],
];

export const cxSettingsSchema = [
  table("cx_settings_group", [["project_id", "text PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE"]], [
    ["logo", "text NOT NULL DEFAULT ''"],
    ["description", "text NOT NULL DEFAULT ''"],
    ["industry", "text NOT NULL DEFAULT ''"],
    ["support_email", "text NOT NULL DEFAULT ''"],
    ["updated_by", "text REFERENCES users(id) ON DELETE SET NULL"],
    ["updated_at", "timestamptz NOT NULL DEFAULT now()"],
  ]),

  table("cx_settings_profiles", [["channel_id", "text PRIMARY KEY REFERENCES cx_channels(id) ON DELETE CASCADE"]], [
    PROJECT,
    ["color", "text NOT NULL DEFAULT ''"],
    ...CREATED,
  ], ["CREATE INDEX IF NOT EXISTS cx_settings_profiles_project ON cx_settings_profiles(project_id);"]),

  table("cx_settings_invites", [["id", "text PRIMARY KEY"]], [
    PROJECT,
    ["email", "text NOT NULL DEFAULT ''"],
    ["role", "text NOT NULL DEFAULT 'agent'"],
    ["custom_role_id", "text"],
    ["team_id", "text"],
    ["token_hash", "text NOT NULL DEFAULT ''"],
    ["invited_by", "text REFERENCES users(id) ON DELETE SET NULL"],
    ["created_at", "timestamptz NOT NULL DEFAULT now()"],
    ["expires_at", "timestamptz NOT NULL DEFAULT (now() + interval '14 days')"],
    ["accepted_at", "timestamptz"],
    ["accepted_by", "text REFERENCES users(id) ON DELETE SET NULL"],
  ], [
    "CREATE INDEX IF NOT EXISTS cx_settings_invites_project ON cx_settings_invites(project_id, created_at DESC);",
    "CREATE INDEX IF NOT EXISTS cx_settings_invites_token ON cx_settings_invites(token_hash);",
  ]),

  table("cx_settings_user_groups", [["id", "text PRIMARY KEY"]], [
    PROJECT,
    ["name", "text NOT NULL DEFAULT ''"],
    ["description", "text NOT NULL DEFAULT ''"],
    ["member_ids", "jsonb NOT NULL DEFAULT '[]'"],
    ...CREATED,
    ["updated_at", "timestamptz NOT NULL DEFAULT now()"],
  ], ["CREATE INDEX IF NOT EXISTS cx_settings_user_groups_project ON cx_settings_user_groups(project_id, name);"]),

  table("cx_settings_ip", [["project_id", "text PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE"]], [
    ["enabled", "boolean NOT NULL DEFAULT false"],
    ["cidrs", "jsonb NOT NULL DEFAULT '[]'"],
    ["updated_by", "text REFERENCES users(id) ON DELETE SET NULL"],
    ["updated_at", "timestamptz NOT NULL DEFAULT now()"],
  ]),

  table("cx_settings_social_profiles", [["id", "text PRIMARY KEY"]], [
    PROJECT,
    ["network", "text NOT NULL DEFAULT ''"],
    ["handle", "text NOT NULL DEFAULT ''"],
    ["name", "text NOT NULL DEFAULT ''"],
    ["url", "text NOT NULL DEFAULT ''"],
    ["relation", "text NOT NULL DEFAULT 'competitor'"],
    ["color", "text NOT NULL DEFAULT ''"],
    ["active", "boolean NOT NULL DEFAULT true"],
    ["external_id", "text NOT NULL DEFAULT ''"],
    ["posts", "integer NOT NULL DEFAULT 0"],
    ["last_fetched_at", "timestamptz"],
    ["last_error", "text"],
    ...CREATED,
  ], ["CREATE UNIQUE INDEX IF NOT EXISTS cx_settings_social_profiles_unique ON cx_settings_social_profiles(project_id, network, lower(handle));"]),

  table("cx_settings_profile_mentions", [["profile_id", "text NOT NULL REFERENCES cx_settings_social_profiles(id) ON DELETE CASCADE"], ["mention_id", "text NOT NULL REFERENCES cx_mentions(id) ON DELETE CASCADE"]], [
    PROJECT,
  ], [
    "CREATE UNIQUE INDEX IF NOT EXISTS cx_settings_profile_mentions_pk ON cx_settings_profile_mentions(profile_id, mention_id);",
    "CREATE INDEX IF NOT EXISTS cx_settings_profile_mentions_mention ON cx_settings_profile_mentions(mention_id);",
  ]),
].join("\n\n");
