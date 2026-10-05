"use server";

import { setSchedule } from "@/lib/jobs/queue";
import { settingsAction } from "@/lib/cx/admin/settings-guard";
import { deleteSocialProfile, fetchSocialProfile, saveSocialProfile, setSocialProfileActive, type SocialProfileInput } from "@/lib/cx/admin/social-profiles";
import { isHexColor } from "@/lib/cx/admin/pure/settings";
import { query } from "@/lib/db";
import { AppError } from "@/lib/domain";

/** More Social Profiles: public profiles tracked without login. */
const PATHS = ["/cx/settings/social-profiles", "/cx/listening"];
const P = "page:settings.channels" as const;

export const saveSocialProfileAction = async (brand: string, input: SocialProfileInput & { id?: string }) =>
  settingsAction(brand, P, PATHS, async (u) => {
    const id = await saveSocialProfile(brand, u, input);
    // Profiles are refreshed by the hourly listening fetch; make sure the brand is on that schedule.
    await setSchedule(brand, "cx.listening.fetch", { cadence: "hourly" });
    let fetched: { fetched: number; inserted: number } | null = null;
    let fetchError: string | null = null;
    try {
      fetched = await fetchSocialProfile(brand, id);
    } catch (e) {
      fetchError = e instanceof Error ? e.message : String(e);
    }
    return { id, fetched, fetchError };
  });
export const fetchSocialProfileAction = async (brand: string, id: string) => settingsAction(brand, P, PATHS, () => fetchSocialProfile(brand, id));
export const socialProfileActiveAction = async (brand: string, id: string, active: boolean) => settingsAction(brand, P, PATHS, async () => { await setSocialProfileActive(brand, id, active); return null; });
export const deleteSocialProfileAction = async (brand: string, id: string) => settingsAction(brand, P, PATHS, async (u) => { await deleteSocialProfile(brand, u, id); return null; });
export const socialProfileColorAction = async (brand: string, id: string, color: string) =>
  settingsAction(brand, P, PATHS, async () => {
    if (!isHexColor(color)) throw new AppError("Color must be a hex value like #3e63dd.");
    await query("UPDATE cx_settings_social_profiles SET color=$3 WHERE id=$1 AND project_id=$2", [id, brand, color.toLowerCase()]);
    return null;
  });
