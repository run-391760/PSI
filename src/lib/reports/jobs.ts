import type { JobHandler } from "@/lib/jobs/types";
import { sensorJobs } from "@/lib/sensor/market";

/**
 * Background job handlers owned by the reports/platform module, keyed by job kind. The SERP Sensor's
 * daily panel collection ("sensor.snapshot") is registered here because the platform module owns it.
 */
export const jobs: Record<string, JobHandler> = { ...sensorJobs };
