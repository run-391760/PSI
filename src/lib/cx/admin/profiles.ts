import { query } from "@/lib/db";
import { AppError } from "@/lib/domain";
import { colorFor, isHexColor, profileHandle } from "./pure/settings";
import { iso } from "./util";

/**
 * Omni-Channel Setup profiles: every connected channel (cx_channels) with its card metadata from
 * cx_settings_profiles (color, created by). Other packages can read colors with:
 *   const colors = await profileColors(projectId);   // { [channelId]: "#rrggbb" }
 */
export type Profile = {
  id: string;
  kind: string;
  name: string;
  handle: string;
  config: Record<string, any>;
  status: "active" | "paused" | "error";
  last_error: string | null;
  last_synced_at: string | null;
  created_at: string;
  has_secret: boolean;
  color: string;
  created_by: string | null;
  creator: string | null;
  tickets: number;
  open: number;
};

export async function listProfiles(projectId: string): Promise<Profile[]> {
  const rows = await query<Omit<Profile, "handle"> & { color: string | null }>(
    `SELECT ch.id,ch.kind,ch.name,ch.config,ch.status,ch.last_error,ch.last_synced_at,ch.created_at,(ch.secret_enc IS NOT NULL) AS has_secret,
            m.color, m.created_by, COALESCE(NULLIF(u.name,''),u.email) AS creator,
            (SELECT count(*)::int FROM cx_tickets t WHERE t.channel_id=ch.id) AS tickets,
            (SELECT count(*)::int FROM cx_tickets t WHERE t.channel_id=ch.id AND t.status NOT IN ('solved','closed')) AS open
       FROM cx_channels ch LEFT JOIN cx_settings_profiles m ON m.channel_id=ch.id LEFT JOIN users u ON u.id=m.created_by
      WHERE ch.project_id=$1 ORDER BY ch.created_at`,
    [projectId],
  );
  return rows.map((r) => ({ ...r, color: isHexColor(r.color) ? r.color : colorFor(r.id), handle: profileHandle(r.kind, r.config ?? {}), last_synced_at: iso(r.last_synced_at), created_at: iso(r.created_at)! }));
}

export async function profileColors(projectId: string): Promise<Record<string, string>> {
  const rows = await query<{ id: string; color: string | null }>("SELECT ch.id, m.color FROM cx_channels ch LEFT JOIN cx_settings_profiles m ON m.channel_id=ch.id WHERE ch.project_id=$1", [projectId]);
  return Object.fromEntries(rows.map((r) => [r.id, isHexColor(r.color) ? r.color : colorFor(r.id)]));
}

/** Record who added a profile (first writer wins) and optionally its color. */
export async function claimProfile(projectId: string, channelId: string, userId: string, color?: string) {
  const [ch] = await query("SELECT 1 FROM cx_channels WHERE id=$1 AND project_id=$2", [channelId, projectId]);
  if (!ch) return;
  await query(
    `INSERT INTO cx_settings_profiles(channel_id,project_id,color,created_by) VALUES($1,$2,$3,$4)
     ON CONFLICT(channel_id) DO UPDATE SET created_by=COALESCE(cx_settings_profiles.created_by, excluded.created_by), color=CASE WHEN excluded.color<>'' THEN excluded.color ELSE cx_settings_profiles.color END`,
    [channelId, projectId, color && isHexColor(color) ? color.toLowerCase() : "", userId],
  );
}

export async function setProfileColor(projectId: string, channelId: string, color: string) {
  if (!isHexColor(color)) throw new AppError("Color must be a hex value like #3e63dd.");
  const [ch] = await query("SELECT 1 FROM cx_channels WHERE id=$1 AND project_id=$2", [channelId, projectId]);
  if (!ch) throw new AppError("Profile not found.", 404);
  await query(
    "INSERT INTO cx_settings_profiles(channel_id,project_id,color) VALUES($1,$2,$3) ON CONFLICT(channel_id) DO UPDATE SET color=excluded.color",
    [channelId, projectId, color.toLowerCase()],
  );
}
