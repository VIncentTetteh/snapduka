import type Anthropic from "@anthropic-ai/sdk";

import { messageText, type AiFailureReason, type ModelCaller } from "../../ai/types";

import { checkReply, type GuardrailVerdict } from "./guardrails";
import { AGENT_TOOLS, HANDOFF_TOOL, MAX_TOOL_CALLS_PER_TURN, executeTool, type ToolBackend } from "./tools";

/**
 * One agent turn: the model answers the buyer, calling tools as it needs, and
 * the final text is checked before anyone sees it. Pure — the caller supplies
 * the model and the tool backend — so the eval harness runs the real loop.
 *
 * Bounded by tool calls, not model calls: at most MAX_TOOL_CALLS_PER_TURN (8)
 * tools run per turn. A model still asking for tools after that gets no more;
 * the turn ends in a handoff rather than a bill.
 */

export type AgentTurnResult =
  | { kind: "reply"; text: string; toolCalls: number; paidOrderConfirmed: boolean }
  | { kind: "handoff"; reason: string; toolCalls: number }
  | { kind: "failed"; reason: AiFailureReason | "no_reply"; toolCalls: number };

export async function runAgentTurn(input: {
  call: ModelCaller;
  system: Anthropic.TextBlockParam[];
  history: Anthropic.MessageParam[];
  backend: ToolBackend;
  /** Price texts the catalogue summary already states. */
  catalogPrices: string[];
  maxToolCalls?: number;
}): Promise<AgentTurnResult> {
  const maxToolCalls = input.maxToolCalls ?? MAX_TOOL_CALLS_PER_TURN;
  const messages: Anthropic.MessageParam[] = [...input.history];
  const allowedPriceTexts = [...input.catalogPrices];
  let toolCalls = 0;
  let paidOrderConfirmed = false;

  // Each round is one model call; the tool budget ends the loop long before
  // this bound would.
  for (let round = 0; round <= maxToolCalls; round += 1) {
    const result = await input.call({
      max_tokens: 1024,
      system: input.system,
      tools: AGENT_TOOLS,
      // Short, latency-sensitive replies: shallow thinking is enough.
      thinking: { type: "adaptive" },
      output_config: { effort: "low" },
      messages,
    });
    if (!result.ok) return { kind: "failed", reason: result.reason, toolCalls };

    const response = result.message;
    const toolUses = response.content.filter(
      (block): block is Anthropic.ToolUseBlock => block.type === "tool_use",
    );

    if (response.stop_reason !== "tool_use" || toolUses.length === 0) {
      const text = messageText(response);
      if (!text) return { kind: "failed", reason: "no_reply", toolCalls };
      const verdict: GuardrailVerdict = checkReply(text, { allowedPriceTexts, paidOrderConfirmed });
      if (!verdict.ok) return { kind: "handoff", reason: `guardrail:${verdict.violation}`, toolCalls };
      return { kind: "reply", text, toolCalls, paidOrderConfirmed };
    }

    if (toolCalls + toolUses.length > maxToolCalls) {
      return { kind: "handoff", reason: "tool_budget_exhausted", toolCalls };
    }

    // The assistant turn goes back verbatim (thinking blocks included), then
    // every tool_result in ONE user message.
    messages.push({ role: "assistant", content: response.content });
    const results: Anthropic.ToolResultBlockParam[] = [];
    let handoffReason: string | null = null;
    for (const use of toolUses) {
      toolCalls += 1;
      const outcome = await executeTool(use.name, use.input, input.backend);
      allowedPriceTexts.push(...outcome.prices);
      if (outcome.confirmedPaidOrder) paidOrderConfirmed = true;
      if (outcome.handoffReason && use.name === HANDOFF_TOOL) handoffReason = outcome.handoffReason;
      results.push({ type: "tool_result", tool_use_id: use.id, content: outcome.content, is_error: outcome.isError });
    }
    if (handoffReason) return { kind: "handoff", reason: handoffReason, toolCalls };
    messages.push({ role: "user", content: results });
  }

  return { kind: "handoff", reason: "tool_budget_exhausted", toolCalls };
}
