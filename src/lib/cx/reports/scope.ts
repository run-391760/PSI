import { scopeFromParams, scopeOptions } from "@/lib/cx/ops/scope";
import { buildScope, type Scope } from "./scope-model";

export * from "./scope-model";

type SP = Record<string, string | string[] | undefined>;

export async function resolveReportScope(projectId: string, brandName: string, sp: SP, keywords: string[] = []): Promise<Scope> {
  const options = await scopeOptions(projectId);
  const value = scopeFromParams(sp);
  return buildScope(value, options, brandName, keywords);
}

