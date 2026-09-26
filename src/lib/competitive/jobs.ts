import type { JobHandler } from "@/lib/jobs/types";

/** Background job handlers owned by the competitive module, keyed by job kind (prefix kinds with "competitive."). */
export const jobs: Record<string, JobHandler> = {};
