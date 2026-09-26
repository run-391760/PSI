export type JobStatus = "queued" | "running" | "done" | "failed" | "cancelled";
export type JobRow<P = Record<string, any>, R = unknown> = {
  id: string;
  owner_id: string | null;
  project_id: string | null;
  kind: string;
  status: JobStatus;
  payload: P;
  result: R | null;
  progress: number;
  total: number;
  message: string | null;
  attempts: number;
  error: string | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
};
export type JobContext = {
  /** Report progress; also extends the job lease. */
  progress(done: number, total?: number, message?: string): Promise<void>;
  /** True once the user cancelled the job; long handlers should check it and stop. */
  cancelled(): Promise<boolean>;
};
/** A handler runs one job to completion and returns its JSON result (stored in jobs.result). */
export type JobHandler = (job: JobRow, ctx: JobContext) => Promise<unknown>;
export type Cadence = "hourly" | "daily" | "weekly";
