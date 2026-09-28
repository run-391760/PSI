"use server";

import { adminAction } from "@/lib/cx/admin/guard";
import { deleteStatus, pauseAgent, resetQueue, runQueue, saveQueueSettings, saveStatus, saveTeamZone, setAgentSettings, setAgentStatus, type QueueSettings } from "@/lib/cx/admin/queue";
import { requirePermission } from "@/lib/cx/admin/roles";
import { saveAdminSettings } from "@/lib/cx/admin/settings";

const P = "/cx/settings/queue";
const act = <T,>(brand: string, fn: (u: { id: string; name: string }) => Promise<T>) => adminAction(brand, "page:settings.queue", P, fn);
/** Queue operations on people also need the "manage_queue" action permission. */
const manage = <T,>(brand: string, fn: (u: { id: string; name: string }) => Promise<T>) =>
  act(brand, async (u) => { await requirePermission(brand, u.id, "manage_queue", "manage agents' queues"); return fn(u); });

export const saveQueueSettingsAction = async (brand: string, s: Omit<QueueSettings, "rrCursor">, timer: { showQueueTimer: boolean; queueTimerMinutes: number }) =>
  act(brand, async (u) => { await saveQueueSettings(brand, s, u); await saveAdminSettings(brand, timer, u); });
export const saveStatusAction = async (brand: string, s: { id?: string; name: string; available: boolean; limit_minutes: number | null }) => act(brand, () => saveStatus(brand, s));
export const deleteStatusAction = async (brand: string, id: string) => act(brand, () => deleteStatus(brand, id));
export const saveTeamZoneAction = async (brand: string, teamId: string, z: { timezone: string; start: string; end: string }) => act(brand, () => saveTeamZone(brand, teamId, z));

export const pauseAgentAction = async (brand: string, userId: string, paused: boolean) => manage(brand, (u) => pauseAgent(brand, userId, paused, u));
export const resetAgentQueueAction = async (brand: string, userId: string) => manage(brand, (u) => resetQueue(brand, userId, `${u.name} (reset queue)`));
export const setAgentStatusAction = async (brand: string, userId: string, status: string) => manage(brand, (u) => setAgentStatus(brand, userId, status, u.name));
export const setAgentSettingsAction = async (brand: string, userId: string, p: { capacity?: number | null; officeStart?: string | null; officeEnd?: string | null; timezone?: string | null }) =>
  manage(brand, (u) => setAgentSettings(brand, userId, p, u));
export const runQueueNowAction = async (brand: string) => manage(brand, () => runQueue(brand));
