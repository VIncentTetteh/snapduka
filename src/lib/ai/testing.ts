import type Anthropic from "@anthropic-ai/sdk";

import type { AiCallResult } from "./types";

/**
 * Builders for fake model responses, shared by tests and the offline eval
 * harness. Fully typed rather than cast, so a change to the SDK's Message shape
 * breaks the fakes at compile time instead of letting tests drift from reality.
 */

export function fakeUsage(partial: Partial<Anthropic.Usage> = {}): Anthropic.Usage {
  return {
    cache_creation: null,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 0,
    inference_geo: null,
    input_tokens: 10,
    output_tokens: 5,
    output_tokens_details: null,
    server_tool_use: null,
    service_tier: "standard",
    ...partial,
  };
}

export function fakeMessage(
  content: Anthropic.ContentBlock[],
  stopReason: Anthropic.StopReason = "end_turn",
  usage: Partial<Anthropic.Usage> = {},
): Anthropic.Message {
  return {
    id: `msg_${Math.random().toString(36).slice(2, 10)}`,
    container: null,
    content,
    model: "claude-sonnet-5",
    role: "assistant",
    stop_details: null,
    stop_reason: stopReason,
    stop_sequence: null,
    type: "message",
    usage: fakeUsage(usage),
  };
}

export function textBlock(text: string): Anthropic.TextBlock {
  return { type: "text", text, citations: null };
}

export function toolUseBlock(name: string, input: unknown, id = `toolu_${name}`): Anthropic.ToolUseBlock {
  return { type: "tool_use", id, name, input, caller: { type: "direct" } };
}

export function textReply(text: string): AiCallResult {
  return { ok: true, message: fakeMessage([textBlock(text)]) };
}
