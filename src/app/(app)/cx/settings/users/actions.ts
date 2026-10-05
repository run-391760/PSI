"use server";

import type { Role } from "@/lib/cx/insights/team";
import { currentIp, saveIpSettings } from "@/lib/cx/admin/ip";
import { settingsAction } from "@/lib/cx/admin/settings-guard";
import { addExistingUsers, changeUserRole, deleteUserGroup, inviteUser, removeUser, revokeInvite, saveUserGroup, uploadUsers, type InviteInput } from "@/lib/cx/admin/users";
import { requestOrigin } from "../_admin/settings-page";

/** Settings → Users: members, invites, CSV upload, user groups (Settings: team permission) and IP allowlist (roles & security). */
const PATHS = ["/cx/settings/users", "/cx/settings/team", "/cx/settings/queue"];
const TEAM = "page:settings.team" as const;

export const inviteUserAction = async (brand: string, input: InviteInput) =>
  settingsAction(brand, TEAM, PATHS, async (u, p) => inviteUser(brand, u, input, await requestOrigin(), p.name));
export const revokeInviteAction = async (brand: string, inviteId: string) => settingsAction(brand, TEAM, PATHS, async (u) => { await revokeInvite(brand, inviteId, u); return null; });
export const addExistingUsersAction = async (brand: string, userIds: string[], role: Role, customRoleId: string | null) => settingsAction(brand, TEAM, PATHS, (u) => addExistingUsers(brand, u, userIds, role, customRoleId));
export const changeUserRoleAction = async (brand: string, userId: string, role: Role, customRoleId: string | null) => settingsAction(brand, TEAM, PATHS, async (u) => { await changeUserRole(brand, u, userId, role, customRoleId); return null; });
export const removeUserAction = async (brand: string, userId: string) => settingsAction(brand, TEAM, PATHS, async (u) => { await removeUser(brand, u, userId); return null; });
export const uploadUsersAction = async (brand: string, csv: string) =>
  settingsAction(brand, TEAM, PATHS, async (u, p) => uploadUsers(brand, u, csv.slice(0, 500_000), await requestOrigin(), p.name));
export const saveUserGroupAction = async (brand: string, input: { id?: string; name: string; description?: string; memberIds: string[] }) => settingsAction(brand, TEAM, PATHS, (u) => saveUserGroup(brand, u, input));
export const deleteUserGroupAction = async (brand: string, id: string) => settingsAction(brand, TEAM, PATHS, async (u) => { await deleteUserGroup(brand, u, id); return null; });

export const saveIpAction = async (brand: string, input: { enabled: boolean; lines: string[] }) =>
  settingsAction(brand, "page:settings.roles", ["/cx/settings/users/ip"], async (u) => saveIpSettings(brand, input, await currentIp(), u));
