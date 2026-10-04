/**
 * Tables owned by the CX operational modules (WP-B): profile groups, bookmarks, CRM tasks, post keys for
 * "view all comments on this post", tracked brand handles/posts (Mentions Tracker), A/B tests and per-user
 * notification preferences. Idempotent SQL: every table is CREATE TABLE IF NOT EXISTS and every column is
 * also added with ALTER TABLE … ADD COLUMN IF NOT EXISTS (NOT NULL only when the column has a default).
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

export const cxOpsSchema = [
  table("cx_ops_profile_groups", [["id", "text PRIMARY KEY"]], [
    PROJECT,
    ["name", "text NOT NULL DEFAULT ''"],
    ["description", "text NOT NULL DEFAULT ''"],
    ["channel_ids", "jsonb NOT NULL DEFAULT '[]'"],
    ["sources", "jsonb NOT NULL DEFAULT '[]'"],
    ["is_default", "boolean NOT NULL DEFAULT false"],
    ["created_by", "text REFERENCES users(id) ON DELETE SET NULL"],
    ["created_at", "timestamptz NOT NULL DEFAULT now()"],
    ["updated_at", "timestamptz NOT NULL DEFAULT now()"],
  ], ["CREATE INDEX IF NOT EXISTS cx_ops_profile_groups_project ON cx_ops_profile_groups(project_id, name);"]),

  table("cx_ops_bookmarks", [["id", "text PRIMARY KEY"]], [
    PROJECT,
    ["user_id", "text NOT NULL REFERENCES users(id) ON DELETE CASCADE"],
    ["ticket_id", "text REFERENCES cx_tickets(id) ON DELETE CASCADE"],
    ["message_id", "text REFERENCES cx_messages(id) ON DELETE CASCADE"],
    ["note", "text NOT NULL DEFAULT ''"],
    ["created_at", "timestamptz NOT NULL DEFAULT now()"],
  ], [
    "CREATE INDEX IF NOT EXISTS cx_ops_bookmarks_user ON cx_ops_bookmarks(project_id, user_id, created_at DESC);",
    "CREATE UNIQUE INDEX IF NOT EXISTS cx_ops_bookmarks_unique ON cx_ops_bookmarks(user_id, ticket_id, (COALESCE(message_id, '')));",
  ]),

  table("cx_ops_tasks", [["id", "text PRIMARY KEY"]], [
    PROJECT,
    ["number", "integer NOT NULL DEFAULT 0"],
    ["title", "text NOT NULL DEFAULT ''"],
    ["description", "text NOT NULL DEFAULT ''"],
    ["status", "text NOT NULL DEFAULT 'open'"],
    ["priority", "text NOT NULL DEFAULT 'normal'"],
    ["due_at", "timestamptz"],
    ["remind_minutes", "integer NOT NULL DEFAULT 0"],
    ["reminded_at", "timestamptz"],
    ["overdue_notified_at", "timestamptz"],
    ["assignee_id", "text REFERENCES users(id) ON DELETE SET NULL"],
    ["classification_id", "text"],
    ["classification_path", "text NOT NULL DEFAULT ''"],
    ["ticket_id", "text REFERENCES cx_tickets(id) ON DELETE SET NULL"],
    ["contact_id", "text REFERENCES cx_contacts(id) ON DELETE SET NULL"],
    ["created_by", "text REFERENCES users(id) ON DELETE SET NULL"],
    ["created_by_name", "text NOT NULL DEFAULT ''"],
    ["completed_at", "timestamptz"],
    ["created_at", "timestamptz NOT NULL DEFAULT now()"],
    ["updated_at", "timestamptz NOT NULL DEFAULT now()"],
  ], [
    "CREATE INDEX IF NOT EXISTS cx_ops_tasks_project ON cx_ops_tasks(project_id, status, due_at);",
    "CREATE INDEX IF NOT EXISTS cx_ops_tasks_ticket ON cx_ops_tasks(ticket_id);",
    "CREATE INDEX IF NOT EXISTS cx_ops_tasks_assignee ON cx_ops_tasks(assignee_id, status);",
  ]),

  table("cx_ops_task_events", [["id", "text PRIMARY KEY"]], [
    ["task_id", "text NOT NULL REFERENCES cx_ops_tasks(id) ON DELETE CASCADE"],
    ["actor", "text NOT NULL DEFAULT ''"],
    ["kind", "text NOT NULL DEFAULT ''"],
    ["detail", "text NOT NULL DEFAULT ''"],
    ["created_at", "timestamptz NOT NULL DEFAULT now()"],
  ], ["CREATE INDEX IF NOT EXISTS cx_ops_task_events_task ON cx_ops_task_events(task_id, created_at);"]),

  table("cx_ops_ticket_posts", [["ticket_id", "text PRIMARY KEY REFERENCES cx_tickets(id) ON DELETE CASCADE"]], [
    PROJECT,
    ["post_key", "text"],
    ["post_url", "text"],
    ["computed_at", "timestamptz NOT NULL DEFAULT now()"],
  ], ["CREATE INDEX IF NOT EXISTS cx_ops_ticket_posts_key ON cx_ops_ticket_posts(project_id, post_key);"]),

  table("cx_ops_tracked", [["id", "text PRIMARY KEY"]], [
    PROJECT,
    ["kind", "text NOT NULL DEFAULT 'handle'"],
    ["platform", "text NOT NULL DEFAULT ''"],
    ["value", "text NOT NULL DEFAULT ''"],
    ["label", "text NOT NULL DEFAULT ''"],
    ["created_at", "timestamptz NOT NULL DEFAULT now()"],
  ], ["CREATE UNIQUE INDEX IF NOT EXISTS cx_ops_tracked_unique ON cx_ops_tracked(project_id, kind, (lower(value)));"]),

  table("cx_ops_ab_tests", [["id", "text PRIMARY KEY"]], [
    PROJECT,
    ["name", "text NOT NULL DEFAULT ''"],
    ["hypothesis", "text NOT NULL DEFAULT ''"],
    ["channels", "jsonb NOT NULL DEFAULT '[]'"],
    ["link_url", "text"],
    ["post_a_id", "text REFERENCES cx_pub_posts(id) ON DELETE SET NULL"],
    ["post_b_id", "text REFERENCES cx_pub_posts(id) ON DELETE SET NULL"],
    ["metric", "text NOT NULL DEFAULT 'clicks'"],
    ["min_clicks", "integer NOT NULL DEFAULT 30"],
    ["confidence", "real NOT NULL DEFAULT 0.95"],
    ["status", "text NOT NULL DEFAULT 'draft'"],
    ["winner", "text"],
    ["started_at", "timestamptz"],
    ["ends_at", "timestamptz"],
    ["decided_at", "timestamptz"],
    ["created_by", "text REFERENCES users(id) ON DELETE SET NULL"],
    ["created_at", "timestamptz NOT NULL DEFAULT now()"],
    ["updated_at", "timestamptz NOT NULL DEFAULT now()"],
  ], ["CREATE INDEX IF NOT EXISTS cx_ops_ab_tests_project ON cx_ops_ab_tests(project_id, created_at DESC);"]),

  table("cx_ops_user_prefs", [["user_id", "text PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE"]], [
    ["prefs", "jsonb NOT NULL DEFAULT '{}'"],
    ["updated_at", "timestamptz NOT NULL DEFAULT now()"],
  ]),
].join("\n\n");
