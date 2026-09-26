import type { JobHandler } from "@/lib/jobs/types";

/** Background job handlers owned by the reports module, keyed by job kind (prefix kinds with "reports."). */
export const jobs: Record<string, JobHandler> = {};
