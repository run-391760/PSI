import type { Project } from "./index";
import type { ToolSummary } from "./summary-types";
import { summaries as siteAudit } from "@/lib/site-audit/summary";
import { summaries as positionTracking } from "@/lib/position-tracking/summary";
import { summaries as content } from "@/lib/content/summary";
import { summaries as backlinks } from "@/lib/backlinks/summary";
import { summaries as monitoring } from "@/lib/monitoring/summary";
import { summaries as local } from "@/lib/local/summary";
import { summaries as aiVisibility } from "@/lib/ai-visibility/summary";
import { summaries as google } from "@/lib/google/summary";

const PROVIDERS = [...siteAudit, ...positionTracking, ...google, ...content, ...backlinks, ...monitoring, ...local, ...aiVisibility];

/** All tool widgets for a project. A failing provider yields an error widget instead of breaking the page. */
export async function projectSummaries(project: Project): Promise<ToolSummary[]> {
  return Promise.all(
    PROVIDERS.map((p, i) =>
      p(project).catch((e) => ({ tool: `error-${i}`, label: "Tool", href: "#", state: "error" as const, note: e instanceof Error ? e.message : String(e) })),
    ),
  );
}
