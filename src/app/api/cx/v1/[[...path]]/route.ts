import { handleApi } from "@/lib/cx/admin/api";

/** Public CX REST API (token auth). See GET /api/cx/v1 for the endpoint list. */
async function handler(req: Request, ctx: { params: Promise<{ path?: string[] }> }) {
  const { path = [] } = await ctx.params;
  try {
    const [status, body] = await handleApi(req, path);
    return Response.json(body, { status, headers: { "cache-control": "no-store" } });
  } catch (e) {
    console.error("[cx api]", e);
    return Response.json({ error: "Internal error" }, { status: 500 });
  }
}
export const GET = handler;
export const POST = handler;
