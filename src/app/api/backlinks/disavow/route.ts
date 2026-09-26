import { requireUser } from "@/lib/auth";
import { disavowText } from "@/lib/backlinks/audit";
import { AppError } from "@/lib/domain";
import { getProject } from "@/lib/projects";

export const dynamic = "force-dynamic";

/** Download the project's disavow.txt (Google Search Console format). */
export async function GET(request: Request) {
  try {
    const user = await requireUser();
    const id = new URL(request.url).searchParams.get("project");
    if (!id) throw new AppError("Missing project.", 400);
    const project = await getProject(user.id, id);
    const { text } = await disavowText(project);
    return new Response(text, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Content-Disposition": `attachment; filename="disavow-${project.domain}.txt"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    const status = e instanceof AppError ? e.status : 500;
    return new Response(e instanceof Error ? e.message : "error", { status });
  }
}
