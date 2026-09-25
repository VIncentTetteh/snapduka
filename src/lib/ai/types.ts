import type Anthropic from "@anthropic-ai/sdk";

/**
 * The seam between SnapDuka's AI features and the model. Free of `server-only`
 * so pure modules (structured output, the WhatsApp agent loop) and the offline
 * eval harness can be driven by a fake caller, and so tests mock one function
 * instead of the SDK.
 *
 * A request carries no `model`: the caller binds it, so a feature cannot drift
 * onto another model by accident.
 */
export type ModelRequest = Omit<Anthropic.MessageCreateParamsNonStreaming, "stream" | "model">;

export type AiFailureReason =
  | "not_configured"
  | "budget_exceeded"
  | "refused"
  | "max_tokens"
  | "error";

export type AiCallResult =
  | { ok: true; message: Anthropic.Message }
  | { ok: false; reason: AiFailureReason; error?: string };

export type ModelCaller = (request: ModelRequest) => Promise<AiCallResult>;

/** Concatenated text blocks of a response, ignoring thinking and tool blocks. */
export function messageText(message: Anthropic.Message): string {
  return message.content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("")
    .trim();
}
