import { NextResponse } from "next/server";
import { rateLimit } from "@/lib/auth";
import { resolveShareLink } from "@/lib/cx/insights/dashboards";
import { metricsSnapshot } from "@/lib/cx/insights/intelligence";

/**
 * Minimal MCP server (JSON-RPC over HTTP, streamable-HTTP style single responses) exposing one read-only
 * tool, `get_cx_metrics`, that returns aggregated brand metrics only (trust layer: no raw messages or PII).
 * Auth: `Authorization: Bearer <token>` with a connector token created in CX → Ask → Connector.
 */
const TOOLS = [
  {
    name: "get_cx_metrics",
    description: "Aggregated customer-experience metrics for the brand: ticket volume, response and resolution times, SLA compliance, CSAT, NPS, QA scores, listening volume and sentiment, and per-agent aggregates.",
    inputSchema: { type: "object", properties: { days: { type: "integer", minimum: 1, maximum: 365, description: "Trailing days (default 30)" } } },
  },
];

type Rpc = { jsonrpc?: string; id?: string | number | null; method?: string; params?: { name?: string; arguments?: { days?: number } } };

export async function POST(req: Request) {
  const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  const link = token ? await resolveShareLink(token, "mcp") : null;
  if (!link) return NextResponse.json({ jsonrpc: "2.0", id: null, error: { code: -32001, message: "Invalid or revoked token" } }, { status: 401 });
  try {
    await rateLimit(`cx-mcp:${token.slice(0, 12)}`, 60, 60);
  } catch {
    return NextResponse.json({ jsonrpc: "2.0", id: null, error: { code: -32002, message: "Rate limited" } }, { status: 429 });
  }
  const body = (await req.json().catch(() => null)) as Rpc | Rpc[] | null;
  if (!body) return NextResponse.json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }, { status: 400 });
  const handle = async (m: Rpc) => {
    const id = m.id ?? null;
    if (m.method === "initialize") return { jsonrpc: "2.0", id, result: { protocolVersion: "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "synapse-cx-metrics", version: "1.0.0" } } };
    if (m.method === "notifications/initialized" || m.id === undefined) return null;
    if (m.method === "ping") return { jsonrpc: "2.0", id, result: {} };
    if (m.method === "tools/list") return { jsonrpc: "2.0", id, result: { tools: TOOLS } };
    if (m.method === "tools/call" && m.params?.name === "get_cx_metrics") {
      const days = Math.min(365, Math.max(1, Math.round(Number(m.params.arguments?.days) || 30)));
      const snap = await metricsSnapshot(link.project_id, days);
      return { jsonrpc: "2.0", id, result: { content: [{ type: "text", text: JSON.stringify(snap) }], structuredContent: snap } };
    }
    return { jsonrpc: "2.0", id, error: { code: -32601, message: "Method not found" } };
  };
  if (Array.isArray(body)) return NextResponse.json((await Promise.all(body.map(handle))).filter(Boolean));
  const r = await handle(body);
  return r ? NextResponse.json(r) : new NextResponse(null, { status: 202 });
}

export function GET() {
  return NextResponse.json({ error: "Use POST (MCP JSON-RPC)." }, { status: 405 });
}
