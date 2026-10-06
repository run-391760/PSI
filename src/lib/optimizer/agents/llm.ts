import type { z } from "zod";
import * as llm from "@/lib/providers/llm";
import { AgentCallError, type AgentLlm, type CallRequest, type CallResult, CancelledError, type Role } from "./call";
import { callBudget } from "./pipeline";
import type { AgentPlan } from "./types";

/**
 * The agents' access to the shared AI layer (server-only): which provider plays which role, one retry
 * per failed call, cancellation between attempts and a record of provider / model / latency / tokens
 * for every call (the pipeline limits concurrency). Keys never leave providers/llm.
 */

/** Configured providers, most preferred first (Anthropic → OpenAI → Gemini → Sarvam). */
export const configuredProviders = (): llm.LlmProvider[] => llm.providersFor(3);

export const label = (p: string) => {
  try {
    return llm.providerLabel(p as llm.LlmProvider) ?? p;
  } catch {
    return p;
  }
};

/**
 * Provider asked to play each role: the reviewer and the tie-breaker run on providers other than the
 * analyst's whenever more than one is configured (with two, the tie-breaker shares the reviewer's; with
 * three or more it has its own).
 */
export function rolePlan(providers: llm.LlmProvider[] = configuredProviders()): Record<Role, llm.LlmProvider | null> {
  const [a, b, c] = providers;
  return { analyst: a ?? null, reviewer: b ?? a ?? null, "tie-break": c ?? b ?? a ?? null, verifier: c ?? b ?? a ?? null, finalizer: a ?? null };
}

/** Live AI caller used by the background job. */
export function liveLlm(opts: { cancelled?: () => Promise<boolean> } = {}): AgentLlm {
  const plan = rolePlan();
  return {
    async call<T extends z.ZodType>(req: CallRequest<T>): Promise<CallResult<T>> {
      const prefer = plan[req.role];
      let attempts = 0;
      let lastError: unknown = null;
      const started = Date.now();
      while (attempts < 2) {
        if (opts.cancelled && (await opts.cancelled())) throw new CancelledError();
        attempts++;
        try {
          // First attempt pinned to the role's provider; the retry may fall back to any configured one.
          const res = await llm.structured(req.schema, req.system, req.prompt, { maxTokens: req.maxTokens ?? 8000, effort: req.effort ?? "medium", name: req.name, timeoutMs: 150_000, providers: attempts === 1 && prefer ? [prefer] : undefined });
          const usage = (res as { usage?: Record<string, number | undefined> }).usage;
          return {
            data: res.data as z.infer<T>,
            record: {
              role: req.role,
              provider: res.provider,
              providerLabel: label(res.provider),
              model: res.model,
              latencyMs: Date.now() - started,
              attempts,
              inputTokens: usage?.inputTokens ?? usage?.input_tokens ?? null,
              outputTokens: usage?.outputTokens ?? usage?.output_tokens ?? null,
              ok: true,
              error: null,
            },
          };
        } catch (e) {
          if (e instanceof CancelledError) throw e;
          lastError = e;
          // A rejected key or request will not fix itself on the same provider; an unpinned retry can still reach another one.
          const status = (e as { status?: number }).status;
          if ((status === 400 || status === 401) && !(attempts === 1 && prefer)) break;
        }
      }
      const message = llm.llmError(lastError).message;
      throw new AgentCallError(message, {
        role: req.role,
        provider: prefer ?? "none",
        providerLabel: prefer ? label(prefer) : "none",
        model: "",
        latencyMs: Date.now() - started,
        attempts,
        inputTokens: null,
        outputTokens: null,
        ok: false,
        error: message.slice(0, 300),
      });
    },
  };
}

/** What a run would use, shown before it starts. */
export function agentPlan(): AgentPlan {
  const providers = configuredProviders();
  const { min, max } = callBudget();
  return { configured: providers.length > 0, providers: providers.map(label), minCalls: min, maxCalls: max, independentReviewer: providers.length > 1 };
}
