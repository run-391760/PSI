"use server";

import { AppError } from "@/lib/domain";
import { runOps } from "@/lib/cx/ops/run";
import { deleteGroup, saveGroup } from "@/lib/cx/ops/groups";
import type { ProfileGroupInput } from "@/lib/cx/ops/model";

const PATHS = ["/cx/settings/profile-groups", "/cx/settings/clusters", "/cx/inbox"];
const admin = (role: string) => { if (!["owner", "admin", "supervisor"].includes(role)) throw new AppError("Only brand admins and supervisors can manage profile groups.", 403); };

export const saveGroupAction = async (brand: string, input: ProfileGroupInput & { id?: string }) => runOps(brand, async (u, role) => { admin(role); return saveGroup(brand, u.id, input); }, { paths: PATHS });
export const deleteGroupAction = async (brand: string, id: string) => runOps(brand, async (_u, role) => { admin(role); await deleteGroup(brand, id); return null; }, { paths: PATHS });
