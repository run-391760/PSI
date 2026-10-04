"use server";

import { AppError } from "@/lib/domain";
import { requirePermission } from "@/lib/cx/admin/roles";
import { runQueue, setAgentStatus } from "@/lib/cx/admin/queue";
import { updateTickets } from "@/lib/cx/inbox/store";
import { runOps } from "@/lib/cx/ops/run";
import { markQueueAssigned, queueAllUnassigned } from "@/lib/cx/ops/queued";

const PATHS = ["/cx/inbox/queued", "/cx/inbox"];

/** Agent picks queued tickets for themselves. */
export const pickQueuedAction = async (brand: string, ids: string[]) =>
  runOps(brand, async (u) => {
    const n = await updateTickets(brand, ids.slice(0, 200), { assignee_id: u.id }, u.name);
    await markQueueAssigned(ids.slice(0, 200), u.id);
    return n;
  }, { paths: PATHS });

/** Assign queued tickets to another agent (or back to the waiting queue with null): needs "manage_queue". */
export const assignQueuedAction = async (brand: string, ids: string[], agentId: string | null) =>
  runOps(brand, async (u) => {
    await requirePermission(brand, u.id, "manage_queue", "assign queued tickets");
    const n = await updateTickets(brand, ids.slice(0, 200), { assignee_id: agentId }, u.name);
    await markQueueAssigned(ids.slice(0, 200), agentId);
    return n;
  }, { paths: PATHS });

export const runQueueAction = async (brand: string) =>
  runOps(brand, async (u) => { await requirePermission(brand, u.id, "manage_queue", "run the queue"); return runQueue(brand); }, { paths: PATHS });

export const queueUnassignedAction = async (brand: string) =>
  runOps(brand, async (u) => { await requirePermission(brand, u.id, "manage_queue", "queue tickets"); return queueAllUnassigned(brand); }, { paths: PATHS });

/** The signed-in agent's own availability (available / offline / custom status id). */
export const setMyStatusAction = async (brand: string, status: string) =>
  runOps(brand, async (u) => { if (!status) throw new AppError("Pick a status."); await setAgentStatus(brand, u.id, status, u.name); return null; }, { paths: PATHS });
