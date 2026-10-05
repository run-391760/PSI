"use server";

import { saveGroupDetails, type GroupInput } from "@/lib/cx/admin/group";
import { settingsAction } from "@/lib/cx/admin/settings-guard";

export const saveGroupDetailsAction = async (brand: string, input: GroupInput) =>
  settingsAction(brand, "page:settings.team", ["/cx/settings/group", "/cx", "/cx/settings/team"], async (u, p) => {
    await saveGroupDetails(brand, u, p.role === "owner", input);
    return null;
  });
