/**
 * Model choices and prices. Deliberately free of `server-only` and of `@/`
 * imports so the offline eval harness (scripts/eval-wa-agent.mjs) can load it.
 *
 * Two models, chosen by job rather than by default:
 *  - Sonnet runs anything a seller or buyer reads as SnapDuka speaking: agent
 *    turns, and vision for Snap-to-list.
 *  - Haiku does cheap, high-volume judgement: classifying an inbound WhatsApp
 *    message, captions, translation.
 */
export const AI_MODELS = {
  agent: "claude-sonnet-5",
  vision: "claude-sonnet-5",
  fast: "claude-haiku-4-5-20251001",
} as const;

export type AiModel = (typeof AI_MODELS)[keyof typeof AI_MODELS];

/**
 * USD per million tokens. Cache writes (5-minute TTL) bill at 1.25x input and
 * cache reads at 0.1x input.
 *
 * Priced here and stored on each `ai_runs` row at write time, so a future
 * price change does not rewrite what last month cost. Update this table when
 * Anthropic's price list changes; nothing else needs to move.
 */
export const MODEL_PRICING_USD_PER_MTOK: Record<
  AiModel,
  { input: number; output: number; cacheWrite: number; cacheRead: number }
> = {
  "claude-sonnet-5": { input: 2, output: 10, cacheWrite: 2.5, cacheRead: 0.2 },
  "claude-haiku-4-5-20251001": { input: 1, output: 5, cacheWrite: 1.25, cacheRead: 0.1 },
};

export type TokenUsage = {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
};

/**
 * Cost in micro-USD. $/MTok x tokens is exactly micro-dollars, so no scaling
 * factor hides in here; rounded up so a stream of tiny calls never sums to
 * zero spend.
 */
export function costUsdMicros(model: AiModel, usage: TokenUsage): number {
  const price = MODEL_PRICING_USD_PER_MTOK[model];
  const micros =
    usage.inputTokens * price.input +
    usage.outputTokens * price.output +
    usage.cacheWriteTokens * price.cacheWrite +
    usage.cacheReadTokens * price.cacheRead;
  return Math.ceil(micros);
}
