import { query } from "@/lib/db";
import { DEFAULT_PREFS, normalizePrefs, type UiPrefs } from "./prefs-logic";

/** The user's UI preferences (defaults when none stored or the table isn't ready yet). */
export async function getUiPrefs(userId: string): Promise<UiPrefs> {
  try {
    const [row] = await query<{ prefs: unknown }>("SELECT prefs FROM cx_ui_prefs WHERE user_id=$1", [userId]);
    return row ? normalizePrefs(row.prefs) : DEFAULT_PREFS;
  } catch {
    return DEFAULT_PREFS;
  }
}

/** Merge already-normalised top-level keys into the stored document. */
export async function saveUiPrefs(userId: string, patch: Partial<UiPrefs>) {
  await query(
    `INSERT INTO cx_ui_prefs (user_id, prefs, updated_at) VALUES ($1, $2::jsonb, now())
     ON CONFLICT (user_id) DO UPDATE SET prefs = cx_ui_prefs.prefs || EXCLUDED.prefs, updated_at = now()`,
    [userId, JSON.stringify(patch)],
  );
}
