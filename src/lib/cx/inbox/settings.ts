import { query, type Query } from "@/lib/db";
import { normPrefs, normSettings, type InboxPrefs, type InboxSettings } from "./model";

/**
 * Ticket settings per brand (status required with reply, reopen WIP, lock after N days, allowed email
 * domains, auto-merge on phone, public/private tabs) and per-user workspace preferences.
 * Public contract for Settings pages (WP2): getInboxSettings / saveInboxSettings.
 */
export async function getInboxSettings(projectId: string, q: Query = query): Promise<InboxSettings> {
  const [r] = await q<{ settings: Partial<InboxSettings> }>("SELECT settings FROM cx_inbox_settings WHERE project_id=$1", [projectId]);
  return normSettings(r?.settings);
}
export async function saveInboxSettings(projectId: string, patch: Partial<InboxSettings>) {
  const next = normSettings({ ...(await getInboxSettings(projectId)), ...patch });
  await query(
    "INSERT INTO cx_inbox_settings(project_id,settings,updated_at) VALUES($1,$2::jsonb,now()) ON CONFLICT(project_id) DO UPDATE SET settings=excluded.settings, updated_at=now()",
    [projectId, JSON.stringify(next)],
  );
  return next;
}

export async function getPrefs(userId: string): Promise<InboxPrefs> {
  const [r] = await query<{ prefs: Partial<InboxPrefs> }>("SELECT prefs FROM cx_inbox_prefs WHERE user_id=$1", [userId]);
  return normPrefs(r?.prefs);
}
export async function savePrefs(userId: string, patch: Partial<InboxPrefs>) {
  const next = normPrefs({ ...(await getPrefs(userId)), ...patch });
  await query("INSERT INTO cx_inbox_prefs(user_id,prefs,updated_at) VALUES($1,$2::jsonb,now()) ON CONFLICT(user_id) DO UPDATE SET prefs=excluded.prefs, updated_at=now()", [userId, JSON.stringify(next)]);
  return next;
}
