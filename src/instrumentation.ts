export async function register() {
  // Background jobs (site audits, rank checks, monitors) run inside the Node.js server process.
  if (process.env.NEXT_RUNTIME !== "nodejs" || process.env.LOCAL_WORKER === "false") return;
  if (process.env.NEXT_PHASE === "phase-production-build") return;
  const { startWorker } = await import("./lib/jobs/worker");
  startWorker();
}
