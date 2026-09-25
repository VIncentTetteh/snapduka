import type Anthropic from "@anthropic-ai/sdk";
import type { ZodType } from "zod";

import { messageText, type AiFailureReason, type ModelCaller, type ModelRequest } from "./types";

/**
 * JSON out of a model, validated, with exactly one repair attempt.
 *
 * Pure (no `server-only`) so the eval harness and tests can drive it with a
 * fake caller. The prompt asks for JSON; this extracts it, validates it with
 * zod, and — once — sends the model its own output plus the validation errors
 * and asks for a corrected object. One retry, not a loop: a model that fails
 * twice on the same schema is telling us the prompt is wrong, and looping just
 * spends the seller's budget finding that out.
 */

export type StructuredResult<T> =
  | { ok: true; data: T; repaired: boolean }
  | { ok: false; reason: AiFailureReason | "invalid_output"; error?: string };

/** Pull a JSON object out of text that may be fenced or wrapped in prose. */
export function extractJsonObject(text: string): unknown {
  const unfenced = text.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "");
  const start = unfenced.indexOf("{");
  const end = unfenced.lastIndexOf("}");
  if (start === -1 || end <= start) throw new Error("No JSON object in the response.");
  return JSON.parse(unfenced.slice(start, end + 1));
}

function validate<T>(schema: ZodType<T>, text: string): { ok: true; data: T } | { ok: false; error: string } {
  let raw: unknown;
  try {
    raw = extractJsonObject(text);
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Unparseable JSON." };
  }
  const parsed = schema.safeParse(raw);
  if (parsed.success) return { ok: true, data: parsed.data };
  const issues = parsed.error.issues
    .slice(0, 10)
    .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
    .join("; ");
  return { ok: false, error: issues };
}

export async function generateStructured<T>(input: {
  call: ModelCaller;
  schema: ZodType<T>;
  request: ModelRequest;
}): Promise<StructuredResult<T>> {
  const first = await input.call(input.request);
  if (!first.ok) return { ok: false, reason: first.reason, error: first.error };

  const firstText = messageText(first.message);
  const firstCheck = validate(input.schema, firstText);
  if (firstCheck.ok) return { ok: true, data: firstCheck.data, repaired: false };

  // The repair turn replays the conversation with the model's own answer, so
  // any cached system prompt is reused and only the short correction is new.
  const repairMessages: Anthropic.MessageParam[] = [
    ...input.request.messages,
    { role: "assistant", content: firstText || "(empty)" },
    {
      role: "user",
      content: `That response was not valid: ${firstCheck.error}. Reply with only the corrected JSON object, no prose.`,
    },
  ];
  const second = await input.call({ ...input.request, messages: repairMessages });
  if (!second.ok) return { ok: false, reason: second.reason, error: second.error };

  const secondCheck = validate(input.schema, messageText(second.message));
  if (secondCheck.ok) return { ok: true, data: secondCheck.data, repaired: true };
  return { ok: false, reason: "invalid_output", error: secondCheck.error };
}
