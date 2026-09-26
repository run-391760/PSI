import type { JobHandler } from "@/lib/jobs/types";
import { AUDIT_JOB, runAuditJob } from "./audit";
import { VERIFY_JOB } from "./link-building";
import { runVerifyJob } from "./verify";

/** Background job handlers owned by the backlinks module, keyed by job kind (prefix kinds with "backlinks."). */
export const jobs: Record<string, JobHandler> = {
  /** Snapshot the project's referring domains with toxicity scores; notify on new toxic domains. */
  [AUDIT_JOB]: runAuditJob,
  /** Crawl monitored link sources (real fetch, robots.txt respected); notify when a link is lost. */
  [VERIFY_JOB]: runVerifyJob,
};
