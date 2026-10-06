import type { z } from "zod";
import type { CallRecord, ItemId, StageId } from "./types";

/** Contract between the agent pipeline and an LLM (client-safe, no provider imports; the tests implement it with mocks). */

export const MAX_CONCURRENT = 4;

export type Role = StageId | "tie-break";
export type CallRequest<T extends z.ZodType> = { role: Role; item: ItemId; schema: T; system: string; prompt: string; name: string; maxTokens?: number; effort?: "low" | "medium" | "high" };
export type CallResult<T extends z.ZodType> = { data: z.infer<T>; record: CallRecord };
/** What the pipeline needs from an LLM (the tests pass a mock). */
export type AgentLlm = { call<T extends z.ZodType>(req: CallRequest<T>): Promise<CallResult<T>> };

export class CancelledError extends Error {
  constructor() {
    super("The agent audit was cancelled.");
  }
}

/** Failed call: carries the record so the stage can show what was tried. */
export class AgentCallError extends Error {
  constructor(
    message: string,
    readonly record: CallRecord,
  ) {
    super(message);
  }
}

/** Counting semaphore. */
export function limiter(max: number) {
  let active = 0;
  const waiting: (() => void)[] = [];
  return async function run<T>(fn: () => Promise<T>): Promise<T> {
    if (active >= max) await new Promise<void>((resolve) => waiting.push(resolve));
    active++;
    try {
      return await fn();
    } finally {
      active--;
      waiting.shift()?.();
    }
  };
}
