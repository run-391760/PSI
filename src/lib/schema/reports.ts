/**
 * Tables owned by the reports / platform module. Use CREATE TABLE IF NOT EXISTS / ADD COLUMN IF NOT EXISTS only:
 * this SQL runs on every server start against existing data.
 *
 * - reports: saved My Reports documents (template + subject + sections + branding).
 * - platform_prefs: per-user UI preferences stored server-side (e.g. dismissed onboarding checklist).
 * - sensor_serps: SERP Sensor market panel, one real top-10 Google snapshot (DataForSEO) per
 *   regional database × device × UTC day × panel keyword.
 */
export const reportsSchema = `
CREATE TABLE IF NOT EXISTS reports (
  id text PRIMARY KEY,
  owner_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id text REFERENCES projects(id) ON DELETE CASCADE,
  template text NOT NULL,
  title text NOT NULL,
  subject text NOT NULL DEFAULT '',
  db text NOT NULL DEFAULT 'US',
  options jsonb NOT NULL DEFAULT '{}',
  sections jsonb NOT NULL DEFAULT '[]',
  branding jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS reports_owner ON reports(owner_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS platform_prefs (
  user_id text PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  prefs jsonb NOT NULL DEFAULT '{}',
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS sensor_serps (
  db text NOT NULL,
  device text NOT NULL,
  day text NOT NULL,
  keyword text NOT NULL,
  results jsonb NOT NULL DEFAULT '[]',
  features jsonb NOT NULL DEFAULT '[]',
  fetched_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(db, device, day, keyword)
);
`;
