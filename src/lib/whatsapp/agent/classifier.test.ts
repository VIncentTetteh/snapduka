import { describe, expect, it, vi } from "vitest";

import { textReply } from "../../ai/testing";

import { classifyMessage, heuristicClassify, isHandoffKeyword, shouldHandOff } from "./classifier";

describe("heuristicClassify", () => {
  it.each([
    ["How much is the black bag?", "en", "price_question"],
    ["Abeg how much for this one?", "pcm", "price_question"],
    ["Ɛte sɛn? Me pɛ mpaboa no", "tw", "greeting"],
    ["Where is my order SD-ABC123XYZ", "en", "complaint"],
    ["I want to talk to a real person", "en", "human_request"],
    ["Can you deliver to Kumasi?", "en", "delivery"],
  ])("%s -> %s / %s", (text, language, intent) => {
    expect(heuristicClassify(text)).toMatchObject({ language, intent, source: "heuristic" });
  });

  // Conservative by design: a complaint answered by a bot costs more than a
  // buyer handed to the seller unnecessarily.
  it("escalates complaints and human requests", () => {
    expect(shouldHandOff(heuristicClassify("This is a scam, I want a refund"))).toBe(true);
    expect(shouldHandOff(heuristicClassify("human"))).toBe(true);
  });

  it("escalates what it does not understand", () => {
    expect(shouldHandOff(heuristicClassify("qwerty zxcv"))).toBe(true);
  });
});

describe("isHandoffKeyword", () => {
  it.each(["HUMAN", "human.", "Agent", "customer care please", "make I talk to person"])("%s hands off", (text) => {
    expect(isHandoffKeyword(text)).toBe(true);
  });

  it("is not triggered by a normal question", () => {
    expect(isHandoffKeyword("do you have size 42?")).toBe(false);
  });
});

describe("classifyMessage", () => {
  it("uses the model's classification", async () => {
    const call = vi.fn().mockResolvedValue(
      textReply('{"language":"pcm","intent":"availability","needsHuman":false,"confidence":0.9}'),
    );
    await expect(classifyMessage(call, "You get am for size 42?")).resolves.toEqual({
      language: "pcm",
      intent: "availability",
      needsHuman: false,
      confidence: 0.9,
      source: "model",
    });
  });

  // The model may under-call escalation; the keyword rules are a floor.
  it("does not let the model overrule a complaint keyword", async () => {
    const call = vi.fn().mockResolvedValue(
      textReply('{"language":"en","intent":"order_status","needsHuman":false,"confidence":0.95}'),
    );
    const result = await classifyMessage(call, "My parcel never arrived, this is a scam");
    expect(result.needsHuman).toBe(true);
  });

  it("falls back to the heuristic when the model is unavailable", async () => {
    const call = vi.fn().mockResolvedValue({ ok: false, reason: "not_configured" });
    await expect(classifyMessage(call, "How much?")).resolves.toMatchObject({
      intent: "price_question",
      source: "heuristic",
    });
  });
});
