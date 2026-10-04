/**
 * Per-user UI preferences (WP-A declutter): focus mode, density, sidebar collapse, CX menu customisation
 * and hidden/collapsed panels. One jsonb document per user, normalised by `normalizePrefs`
 * (src/lib/cx/ui/prefs-logic.ts). CREATE TABLE IF NOT EXISTS only.
 */
export const cxUiSchema = `
CREATE TABLE IF NOT EXISTS cx_ui_prefs (
  user_id text PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  prefs jsonb NOT NULL DEFAULT '{}',
  updated_at timestamptz NOT NULL DEFAULT now()
);
`;
