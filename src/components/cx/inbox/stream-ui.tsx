"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { createContext, useCallback, useContext, type ReactNode } from "react";
import type { Agent } from "@/lib/cx/inbox/store";
import { patchQuery } from "@/lib/cx/inbox/stream";
import type { TreeNode } from "@/components/cx/ops/task-dialog";

/**
 * Shared client context and style tokens of the Konnect-style streams. The CX shell (WP-K1) defines --cx-accent /
 * --cx-active-* for the Konnect blue; outside it they fall back to the brand tokens.
 */
export const ACCENT_BG = "bg-[var(--cx-accent,var(--brand))] text-white";
export const ACCENT_TEXT = "text-[var(--cx-accent,var(--link))]";
export const ACTIVE_ROW = "bg-[var(--cx-active-bg,var(--brand-soft))] text-[var(--cx-active-ink,var(--link))]";

export type AgentState = { id: string; name: string; status: string; statusName: string; paused: boolean };
export type StreamCtx = {
  brand: string;
  me: { id: string; name: string };
  agents: Agent[];
  agentStates: AgentState[];
  tree: TreeNode[];
  readOnly: boolean;
};
const Ctx = createContext<StreamCtx | null>(null);
export function StreamProvider({ value, children }: { value: StreamCtx; children: ReactNode }) {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
export function useStream(): StreamCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error("useStream outside StreamProvider");
  return v;
}

/** href builder for URL filter state on the current page: drops ?page= and ?act= unless patched. */
export function useStreamHref() {
  const pathname = usePathname();
  const search = useSearchParams();
  const router = useRouter();
  const href = useCallback((patch: Record<string, string | null | undefined>) => {
    const qs = patchQuery(search.toString(), { act: null, ...patch });
    return `${pathname}${qs === "?" ? "" : qs}`;
  }, [pathname, search]);
  const go = useCallback((patch: Record<string, string | null | undefined>) => router.push(href(patch), { scroll: false }), [router, href]);
  return { href, go, search };
}
