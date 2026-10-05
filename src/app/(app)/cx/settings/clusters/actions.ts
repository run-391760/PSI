"use server";

import { settingsAction } from "@/lib/cx/admin/settings-guard";
import type { ClusterInput } from "@/lib/cx/admin/pure/settings";
import { deleteGroup, saveGroup, setGroupColor } from "@/lib/cx/ops/groups";

/** Clusters (profile groups with topics). Admins and supervisors (Settings: channels permission) manage them. */
const PATHS = ["/cx/settings/clusters", "/cx/inbox", "/cx/messages"];
const P = "page:settings.channels" as const;

export const saveClusterAction = async (brand: string, input: ClusterInput & { id?: string }) => settingsAction(brand, P, PATHS, (u) => saveGroup(brand, u.id, input));
export const deleteClusterAction = async (brand: string, id: string) => settingsAction(brand, P, PATHS, async () => { await deleteGroup(brand, id); return null; });
export const clusterColorAction = async (brand: string, id: string, color: string) => settingsAction(brand, P, PATHS, async () => { await setGroupColor(brand, id, color); return null; });
