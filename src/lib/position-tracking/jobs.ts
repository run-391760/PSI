import type { JobHandler } from "@/lib/jobs/types";
import { runCheck } from "./check";
import { CHECK_JOB } from "./types";

export { CHECK_JOB };

/**
 * Background job handlers owned by the position-tracking module, keyed by job kind.
 * "position-tracking.check": demo backfill / daily demo positions, or live DataForSEO SERPs; then
 * per-day aggregates (pt_daily) and alert-rule evaluation.
 */
export const jobs: Record<string, JobHandler> = {
  [CHECK_JOB]: runCheck,
};
