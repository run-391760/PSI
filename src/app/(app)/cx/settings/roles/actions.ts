"use server";

import { adminAction } from "@/lib/cx/admin/guard";
import { assignRole, deleteRole, importUsers, saveRole } from "@/lib/cx/admin/roles";
import { saveAdminSettings } from "@/lib/cx/admin/settings";

const P = "/cx/settings/roles";
const act = <T,>(brand: string, fn: (u: { id: string; name: string }) => Promise<T>) => adminAction(brand, "page:settings.roles", P, fn);

export const saveRoleAction = async (brand: string, r: { id?: string; name: string; description: string; pages: string[]; actions: string[] }) => act(brand, (u) => saveRole(brand, r, u));
export const deleteRoleAction = async (brand: string, id: string) => act(brand, (u) => deleteRole(brand, id, u));
export const assignRoleAction = async (brand: string, userId: string, roleId: string | null) => act(brand, (u) => assignRole(brand, userId, roleId, u));
export const importUsersAction = async (brand: string, csv: string) => act(brand, (u) => importUsers(brand, csv, u));
export const saveSecurityAction = async (brand: string, s: { piiMask: boolean; allowedDomains: string[]; statusRequiredWithReply: boolean }) =>
  act(brand, async (u) => { await saveAdminSettings(brand, s, u); });
