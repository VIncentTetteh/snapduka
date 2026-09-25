import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { costUsdMicros } from "./models";
import { extractJsonObject, generateStructured } from "./structured";
import { textReply } from "./testing";
import type { ModelRequest } from "./types";

const reply = textReply;

const schema = z.object({ title: z.string().min(1), tags: z.array(z.string()) });
const request: ModelRequest = { max_tokens: 100, messages: [{ role: "user", content: "draft" }] };

describe("extractJsonObject", () => {
  it("reads fenced JSON", () => {
    expect(extractJsonObject('```json\n{"a":1}\n```')).toEqual({ a: 1 });
  });

  it("reads JSON wrapped in prose", () => {
    expect(extractJsonObject('Here you go: {"a":{"b":2}} hope that helps')).toEqual({ a: { b: 2 } });
  });

  it("throws when there is no object", () => {
    expect(() => extractJsonObject("no json here")).toThrow();
  });
});

describe("generateStructured", () => {
  it("returns validated data on the first try", async () => {
    const call = vi.fn().mockResolvedValue(reply('{"title":"Shea butter","tags":["skin"]}'));
    await expect(generateStructured({ call, schema, request })).resolves.toEqual({
      ok: true,
      data: { title: "Shea butter", tags: ["skin"] },
      repaired: false,
    });
    expect(call).toHaveBeenCalledTimes(1);
  });

  it("repairs once, showing the model its own output and the errors", async () => {
    const call = vi
      .fn()
      .mockResolvedValueOnce(reply('{"title":""}'))
      .mockResolvedValueOnce(reply('{"title":"Fixed","tags":[]}'));

    const result = await generateStructured({ call, schema, request });

    expect(result).toEqual({ ok: true, data: { title: "Fixed", tags: [] }, repaired: true });
    const repair = call.mock.calls[1][0] as ModelRequest;
    expect(repair.messages).toHaveLength(3);
    expect(repair.messages[1]).toEqual({ role: "assistant", content: '{"title":""}' });
    expect(String(repair.messages[2].content)).toMatch(/tags/);
  });

  // One retry, not a loop: two failures mean the prompt is wrong, and looping
  // only spends the seller's budget discovering that.
  it("gives up after one repair", async () => {
    const call = vi.fn().mockResolvedValue(reply("not json"));
    const result = await generateStructured({ call, schema, request });
    expect(result).toMatchObject({ ok: false, reason: "invalid_output" });
    expect(call).toHaveBeenCalledTimes(2);
  });

  it("passes a caller failure straight through without retrying", async () => {
    const call = vi.fn().mockResolvedValue({ ok: false, reason: "not_configured" });
    await expect(generateStructured({ call, schema, request })).resolves.toEqual({
      ok: false,
      reason: "not_configured",
      error: undefined,
    });
    expect(call).toHaveBeenCalledTimes(1);
  });
});

describe("costUsdMicros", () => {
  it("prices every token class", () => {
    // Sonnet: 1000 in x2 + 100 out x10 + 2000 cache-write x2.5 + 10000 cache-read x0.2
    expect(
      costUsdMicros("claude-sonnet-5", {
        inputTokens: 1000,
        outputTokens: 100,
        cacheWriteTokens: 2000,
        cacheReadTokens: 10000,
      }),
    ).toBe(2000 + 1000 + 5000 + 2000);
  });

  it("never rounds a real call down to free", () => {
    expect(
      costUsdMicros("claude-haiku-4-5-20251001", {
        inputTokens: 0,
        outputTokens: 0,
        cacheWriteTokens: 0,
        cacheReadTokens: 1,
      }),
    ).toBe(1);
  });
});
