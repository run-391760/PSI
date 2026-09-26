"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { createRule, deleteRule, setRuleEnabled, updateRule } from "@/lib/position-tracking/alerts";
import { deleteNotifications, markNotifications, type NotificationFilter } from "@/lib/position-tracking/notifications";
import { failure, type ActionResult } from "@/lib/position-tracking/result";
import type { AlertRuleInput } from "@/lib/position-tracking/types";

const ruleSchema = z.object({
  projectId: z.string().min(1).max(64),
  name: z.string().max(80).default(""),
  kind: z.enum(["enter_top", "leave_top", "drop", "rise", "overtaken", "visibility_change"]),
  threshold: z.coerce.number(),
  device: z.enum(["desktop", "mobile"]).nullable().default(null),
  tagId: z.string().max(64).nullable().default(null),
  competitor: z.string().max(255).nullable().default(null),
  severity: z.enum(["info", "success", "warning", "critical"]).default("warning"),
  enabled: z.boolean().default(true),
});
const ids = z.array(z.string().min(1).max(64)).max(500);
const filterSchema = z.object({
  tool: z.string().max(64).optional(),
  severity: z.enum(["info", "success", "warning", "critical"]).optional(),
  project: z.string().max(64).optional(),
  unread: z.boolean().optional(),
});

function touch() {
  revalidatePath("/alerts");
  revalidatePath("/position-tracking");
}

export async function createRuleAction(input: AlertRuleInput): Promise<ActionResult<{ id: string }>> {
  try {
    const user = await requireUser();
    const id = await createRule(user.id, ruleSchema.parse(input) as AlertRuleInput);
    touch();
    return { ok: true, data: { id } };
  } catch (e) {
    return failure(e);
  }
}

export async function updateRuleAction(id: string, input: AlertRuleInput): Promise<ActionResult> {
  try {
    const user = await requireUser();
    await updateRule(user.id, String(id), ruleSchema.parse(input) as AlertRuleInput);
    touch();
    return { ok: true, data: null };
  } catch (e) {
    return failure(e);
  }
}

export async function toggleRuleAction(id: string, enabled: boolean): Promise<ActionResult> {
  try {
    const user = await requireUser();
    await setRuleEnabled(user.id, String(id), Boolean(enabled));
    touch();
    return { ok: true, data: null };
  } catch (e) {
    return failure(e);
  }
}

export async function deleteRuleAction(id: string): Promise<ActionResult> {
  try {
    const user = await requireUser();
    await deleteRule(user.id, String(id));
    touch();
    return { ok: true, data: null };
  } catch (e) {
    return failure(e);
  }
}

/** Mark specific notifications read/unread. */
export async function markReadAction(notificationIds: string[], read = true): Promise<ActionResult<{ count: number }>> {
  try {
    const user = await requireUser();
    const count = await markNotifications(user.id, { ids: ids.parse(notificationIds) }, Boolean(read));
    revalidatePath("/", "layout");
    return { ok: true, data: { count } };
  } catch (e) {
    return failure(e);
  }
}

/** Mark every notification matching the filters as read. */
export async function markAllReadAction(filter: NotificationFilter): Promise<ActionResult<{ count: number }>> {
  try {
    const user = await requireUser();
    const count = await markNotifications(user.id, { filter: filterSchema.parse(filter) }, true);
    revalidatePath("/", "layout");
    return { ok: true, data: { count } };
  } catch (e) {
    return failure(e);
  }
}

export async function deleteNotificationsAction(notificationIds: string[]): Promise<ActionResult<{ count: number }>> {
  try {
    const user = await requireUser();
    const count = await deleteNotifications(user.id, { ids: ids.parse(notificationIds) });
    revalidatePath("/", "layout");
    return { ok: true, data: { count } };
  } catch (e) {
    return failure(e);
  }
}

/** Delete all read notifications matching the filters. */
export async function deleteReadAction(filter: NotificationFilter): Promise<ActionResult<{ count: number }>> {
  try {
    const user = await requireUser();
    const count = await deleteNotifications(user.id, { filter: filterSchema.parse(filter), readOnly: true });
    revalidatePath("/", "layout");
    return { ok: true, data: { count } };
  } catch (e) {
    return failure(e);
  }
}
