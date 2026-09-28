import type { JobHandler } from "./types";
import { jobs as siteAudit } from "@/lib/site-audit/jobs";
import { jobs as positionTracking } from "@/lib/position-tracking/jobs";
import { jobs as backlinks } from "@/lib/backlinks/jobs";
import { jobs as keywords } from "@/lib/keywords/jobs";
import { jobs as competitive } from "@/lib/competitive/jobs";
import { jobs as content } from "@/lib/content/jobs";
import { jobs as local } from "@/lib/local/jobs";
import { jobs as monitoring } from "@/lib/monitoring/jobs";
import { jobs as aiVisibility } from "@/lib/ai-visibility/jobs";
import { jobs as reports } from "@/lib/reports/jobs";
import { jobs as cxListening } from "@/lib/cx/listening/jobs";
import { jobs as cxInbox } from "@/lib/cx/inbox/jobs";
import { jobs as cxInboxWorkspace } from "@/lib/cx/inbox/workspace-jobs";
import { jobs as cxPublishing } from "@/lib/cx/publishing/jobs";
import { jobs as cxInsights } from "@/lib/cx/insights/jobs";
import { jobs as cxAdmin } from "@/lib/cx/admin/jobs";

/** Built-in: health check job used by /api/health. */
const core: Record<string, JobHandler> = {
  "core.ping": async (job, ctx) => {
    for (let i = 1; i <= 3; i++) {
      await new Promise((r) => setTimeout(r, 200));
      await ctx.progress(i, 3, `step ${i}`);
    }
    return { pong: true, at: new Date().toISOString(), payload: job.payload };
  },
};

export const handlers: Record<string, JobHandler> = {
  ...core,
  ...siteAudit,
  ...positionTracking,
  ...backlinks,
  ...keywords,
  ...competitive,
  ...content,
  ...local,
  ...monitoring,
  ...aiVisibility,
  ...reports,
  ...cxListening,
  ...cxInbox,
  ...cxInboxWorkspace,
  ...cxPublishing,
  ...cxInsights,
  ...cxAdmin,
};

// Publish the freshest handler set for the worker loop (which starts in a separate bundle and would
// otherwise keep the handlers it booted with during development hot reloads).
(globalThis as unknown as { synapseJobHandlers?: Record<string, JobHandler> }).synapseJobHandlers = handlers;
