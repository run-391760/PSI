import Anthropic from "@anthropic-ai/sdk";
import { AppError } from "@/lib/domain";
import { anthropicClient, CLAUDE_MODEL, llmError } from "./llm";

/**
 * Claude (Anthropic Messages API) with the server-side web search tool — used by AI Visibility to ask
 * tracked prompts the way a user would and record which brands and URLs the answer mentions/cites.
 * Enabled when ANTHROPIC_API_KEY is set.
 */
export { CLAUDE_MODEL };
const MAX_CONTINUATIONS = 3;

export const anthropicEnabled = () => Boolean(process.env.ANTHROPIC_API_KEY);

export type ClaudeCitation = { url: string; title: string; citedText: string };
export type ClaudeAnswer = {
  text: string;
  /** URLs Claude cited inline in its answer. */
  citations: ClaudeCitation[];
  /** Every web search result Claude looked at. */
  searchResults: { url: string; title: string }[];
  model: string;
  stopReason: string;
  usage: { inputTokens: number; outputTokens: number; webSearches: number };
};

/** Ask Claude a prompt with web search enabled and collect the answer, citations and sources. */
export async function askClaude(prompt: string, opts: { country?: string; maxSearches?: number } = {}): Promise<ClaudeAnswer> {
  if (!anthropicEnabled()) throw new AppError("Set ANTHROPIC_API_KEY to run live Claude checks.", 400);
  const tools: Anthropic.Beta.BetaToolUnion[] = [
    {
      type: "web_search_20260209",
      name: "web_search",
      max_uses: opts.maxSearches ?? 5,
      ...(opts.country ? { user_location: { type: "approximate" as const, country: opts.country } } : {}),
    },
  ];
  const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: "user", content: prompt }];
  const blocks: Anthropic.Beta.BetaContentBlock[] = [];
  let response: Anthropic.Beta.BetaMessage | null = null;
  const usage = { inputTokens: 0, outputTokens: 0, webSearches: 0 };
  for (let i = 0; i <= MAX_CONTINUATIONS; i++) {
    try {
      response = await anthropicClient().beta.messages.create({
        model: CLAUDE_MODEL,
        max_tokens: 16000,
        // Server-side refusal fallbacks: a declined prompt is re-run on Anthropic's recommended model.
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        tools,
        messages,
      });
    } catch (error) {
      throw llmError(error);
    }
    usage.inputTokens += response.usage.input_tokens ?? 0;
    usage.outputTokens += response.usage.output_tokens ?? 0;
    usage.webSearches += response.usage.server_tool_use?.web_search_requests ?? 0;
    blocks.push(...response.content);
    // The server-side tool loop can pause; resend the turn so it resumes where it left off.
    if (response.stop_reason !== "pause_turn") break;
    messages.splice(1, messages.length - 1, { role: "assistant", content: blocks.slice() as Anthropic.Beta.BetaContentBlockParam[] });
  }
  if (!response) throw new AppError("Claude returned no response.", 502);
  if (response.stop_reason === "refusal") throw new AppError("Claude declined to answer this prompt.", 422);

  const text = blocks
    .flatMap((b) => (b.type === "text" ? [b.text] : []))
    .join("")
    .trim();
  const citations: ClaudeCitation[] = [];
  const seen = new Set<string>();
  for (const b of blocks) {
    if (b.type !== "text" || !b.citations) continue;
    for (const c of b.citations) {
      const cite = c as { url?: string; title?: string | null; cited_text?: string };
      if (!cite.url || seen.has(cite.url)) continue;
      seen.add(cite.url);
      citations.push({ url: cite.url, title: cite.title ?? "", citedText: cite.cited_text ?? "" });
    }
  }
  const searchResults: { url: string; title: string }[] = [];
  for (const b of blocks) {
    // Success: content is a list of web_search_result; an error is a single object.
    if (b.type !== "web_search_tool_result" || !Array.isArray(b.content)) continue;
    for (const r of b.content) if (r.type === "web_search_result" && r.url) searchResults.push({ url: r.url, title: r.title ?? "" });
  }
  return { text, citations, searchResults, model: response.model ?? CLAUDE_MODEL, stopReason: response.stop_reason ?? "", usage };
}
