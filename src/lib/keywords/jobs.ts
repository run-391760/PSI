import type { JobHandler } from "@/lib/jobs/types";

/** Background job handlers owned by the keywords module, keyed by job kind (prefix kinds with "keywords."). */
export const jobs: Record<string, JobHandler> = {};
