import "server-only";

import Anthropic from "@anthropic-ai/sdk";

import { createAdminClient } from "@/lib/supabase/admin";

import { checkAiBudget } from "./budget";
import { costUsdMicros, type AiModel, type TokenUsage } from "./models";
import type { AiCallResult, ModelCaller, ModelRequest } from "./types";

export { AI_MODELS } from "./models";
export type { AiCallResult, ModelCaller, ModelRequest } from "./types";

/**
 * The only place SnapDuka talks to Anthropic.
 *
 * Every call goes through `callModel`, which does three things no feature is
 * allowed to skip:
 *  1. reports `not_configured` (never throws) when ANTHROPIC_API_KEY is unset,
 *     so every AI feature degrades to "off" in an environment without a key;
 *  2. refuses the call when the seller's monthly budget is spent;
 *  3. writes an `ai_runs` row — tokens, cache hits, cost, latency, outcome —
 *     for every call that reaches the API *and* every budget refusal, because a
 *     budget is only as good as the record it is checked against.
 */

let cached: Anthropic | null | undefined;

export function isAiConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

function anthropic(): Anthropic | null {
  if (cached !== undefined) return cached;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  // Explicit key only. The SDK would otherwise fall back to a developer's local
  // `ant auth login` profile, and a server that bills sellers must never
  // quietly run on whoever last logged in on the build machine.
  cached = apiKey ? new Anthropic({ apiKey, maxRetries: 2, timeout: 60_000 }) : null;
  return cached;
}

/** Test seam: forget the memoised client after changing the environment. */
export function resetAiClientForTests(): void {
  cached = undefined;
}

/**
 * Mark a large, stable system prompt as cacheable. Caching is a prefix match,
 * so callers must keep anything volatile (timestamps, the buyer's message) out
 * of this block — put it in `messages` instead.
 */
export function cachedSystem(text: string): Anthropic.TextBlockParam[] {
  return [{ type: "text", text, cache_control: { type: "ephemeral" } }];
}

export type CallModelOptions = {
  /** Whose budget pays. Null only for calls on nobody's behalf. */
  sellerAccountId: string | null;
  /** `ai_runs.purpose`, e.g. `listing_draft`, `wa.classify`, `wa.agent`. */
  purpose: string;
  model: AiModel;
  /** Correlation ids only — never prompt text or buyer messages. */
  context?: Record<string, string | number | boolean | null>;
};

function usageOf(message: Anthropic.Message): TokenUsage {
  return {
    inputTokens: message.usage.input_tokens ?? 0,
    outputTokens: message.usage.output_tokens ?? 0,
    cacheReadTokens: message.usage.cache_read_input_tokens ?? 0,
    cacheWriteTokens: message.usage.cache_creation_input_tokens ?? 0,
  };
}

const ZERO_USAGE: TokenUsage = {
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
};

async function recordRun(
  options: CallModelOptions,
  row: {
    usage: TokenUsage;
    latencyMs: number;
    outcome: "ok" | "error" | "refused" | "budget_exceeded" | "max_tokens";
    error?: string;
  },
): Promise<void> {
  const { error } = await createAdminClient()
    .from("ai_runs")
    .insert({
      seller_account_id: options.sellerAccountId,
      purpose: options.purpose,
      model: options.model,
      input_tokens: row.usage.inputTokens,
      output_tokens: row.usage.outputTokens,
      cache_read_tokens: row.usage.cacheReadTokens,
      cache_write_tokens: row.usage.cacheWriteTokens,
      cost_usd_micros: costUsdMicros(options.model, row.usage),
      latency_ms: Math.max(0, Math.round(row.latencyMs)),
      outcome: row.outcome,
      error: row.error?.slice(0, 1000) ?? null,
      context: options.context ?? {},
    });
  // A lost row under-reports spend, so it is logged loudly — but the buyer's
  // reply or the seller's draft is not thrown away because accounting hiccuped.
  if (error) console.error("[ai] could not record ai_runs row", { purpose: options.purpose, error });
}

/** Human-readable reason from an SDK error without leaking request bodies. */
function describeError(error: unknown): string {
  if (error instanceof Anthropic.APIError) return `${error.status ?? "network"}: ${error.name}`;
  return error instanceof Error ? error.name : "unknown";
}

export async function callModel(
  options: CallModelOptions,
  request: ModelRequest,
): Promise<AiCallResult> {
  const client = anthropic();
  if (!client) return { ok: false, reason: "not_configured" };

  if (options.sellerAccountId) {
    const budget = await checkAiBudget(options.sellerAccountId);
    if (!budget.ok) {
      await recordRun(options, { usage: ZERO_USAGE, latencyMs: 0, outcome: "budget_exceeded" });
      return { ok: false, reason: "budget_exceeded" };
    }
  }

  const started = Date.now();
  let message: Anthropic.Message;
  try {
    message = await client.messages.create({ ...request, model: options.model, stream: false });
  } catch (error) {
    const description = describeError(error);
    await recordRun(options, {
      usage: ZERO_USAGE,
      latencyMs: Date.now() - started,
      outcome: "error",
      error: description,
    });
    console.error(`[ai] ${options.purpose} failed`, description);
    return { ok: false, reason: "error", error: description };
  }

  const latencyMs = Date.now() - started;
  const usage = usageOf(message);
  if (message.stop_reason === "refusal") {
    await recordRun(options, { usage, latencyMs, outcome: "refused" });
    return { ok: false, reason: "refused" };
  }
  if (message.stop_reason === "max_tokens") {
    // Billed but unusable: a truncated JSON draft or half a WhatsApp reply is
    // worse than none. Recorded so a too-low max_tokens shows up in ai_runs.
    await recordRun(options, { usage, latencyMs, outcome: "max_tokens" });
    return { ok: false, reason: "max_tokens" };
  }
  await recordRun(options, { usage, latencyMs, outcome: "ok" });
  return { ok: true, message };
}

/** Bind options once, for code that takes a plain `ModelCaller`. */
export function modelCaller(options: CallModelOptions): ModelCaller {
  return (request) => callModel(options, request);
}
