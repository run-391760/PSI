import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { AppError } from "@/lib/domain";
import { cancelJob, getJob } from "./queue";

type Context = { params: Promise<{ id: string }> };
type Dependencies = {
  requireUser: () => Promise<{ id: string }>;
  getJob: typeof getJob;
  cancelJob: typeof cancelJob;
};

/** Owner-scoped polling and cancellation, restricted to one module's job kinds. */
export function jobHandlers(
  prefix: string,
  { includeResult = false, errorMessage = "error" }: { includeResult?: boolean; errorMessage?: string } = {},
  deps: Dependencies = { requireUser, getJob, cancelJob },
) {
  async function ownedJob(ctx: Context) {
    const user = await deps.requireUser();
    const { id } = await ctx.params;
    const job = await deps.getJob(user.id, id);
    if (!job.kind.startsWith(prefix)) throw new AppError("Job not found.", 404);
    return { user, job, id };
  }

  function fail(e: unknown) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : errorMessage },
      { status: e instanceof AppError ? e.status : 500 },
    );
  }

  return {
    async GET(_req: Request, ctx: Context) {
      try {
        const { job } = await ownedJob(ctx);
        return NextResponse.json(
          {
            id: job.id, kind: job.kind, status: job.status, progress: job.progress,
            total: job.total, message: job.message, error: job.error,
            ...(includeResult ? { result: job.result } : {}),
          },
          { headers: { "Cache-Control": "no-store" } },
        );
      } catch (e) {
        return fail(e);
      }
    },
    async DELETE(_req: Request, ctx: Context) {
      try {
        const { user, id } = await ownedJob(ctx);
        await deps.cancelJob(user.id, id);
        return NextResponse.json({ ok: true });
      } catch (e) {
        return fail(e);
      }
    },
  };
}
