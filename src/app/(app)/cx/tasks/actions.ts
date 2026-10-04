"use server";

import { AppError } from "@/lib/domain";
import { runOps } from "@/lib/cx/ops/run";
import { addTaskComment, createTask, deleteTask, getTask, updateTask, type TaskInput } from "@/lib/cx/ops/tasks";

const PATHS = ["/cx/tasks", "/cx/inbox"];

export const createTaskAction = async (brand: string, input: TaskInput) => runOps(brand, (u) => createTask(brand, u, input), { paths: PATHS });
export const updateTaskAction = async (brand: string, id: string, patch: Partial<TaskInput>) => runOps(brand, async (u) => { await updateTask(brand, u, id, patch); return null; }, { paths: PATHS });
export const commentTaskAction = async (brand: string, id: string, body: string) => runOps(brand, async (u) => { await addTaskComment(brand, u, id, body); return null; }, { paths: PATHS });
export const deleteTaskAction = async (brand: string, id: string) =>
  runOps(brand, async (u, role) => {
    const t = await getTask(brand, id);
    if (!t) return null;
    if (t.task.created_by !== u.id && !["owner", "admin", "supervisor"].includes(role)) throw new AppError("Only the task's creator or a brand admin/supervisor can delete it.", 403);
    await deleteTask(brand, u, id);
    return null;
  }, { paths: PATHS });
export const taskDetailAction = async (brand: string, id: string) => runOps(brand, async () => getTask(brand, id), { write: false });
