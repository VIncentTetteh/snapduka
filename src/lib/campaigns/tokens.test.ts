import { describe, expect, it, vi } from "vitest";

import { generateCampaignToken, isUniqueViolation, withUniqueToken } from "./tokens";

describe("generateCampaignToken", () => {
  it("defaults to 8 characters", () => {
    expect(generateCampaignToken()).toHaveLength(8);
    expect(generateCampaignToken(12)).toHaveLength(12);
  });

  // These tokens get read aloud over WhatsApp and typed off printed QR flyers.
  it("omits glyphs that are misread: 0 O 1 i l u", () => {
    const sample = Array.from({ length: 400 }, () => generateCampaignToken()).join("");

    expect(sample).not.toMatch(/[01ilou]/);
    expect(sample).toMatch(/^[23456789abcdefghjkmnpqrstvwxyz]+$/);
  });

  it("is not obviously biased across the alphabet", () => {
    const counts = new Map<string, number>();
    for (const char of Array.from({ length: 3000 }, () => generateCampaignToken()).join("")) {
      counts.set(char, (counts.get(char) ?? 0) + 1);
    }
    // 30 symbols over 24k draws — every symbol should appear, and none should
    // dominate the way a naive `% alphabet.length` would skew the first 16.
    expect(counts.size).toBe(30);
    const frequencies = [...counts.values()];
    expect(Math.max(...frequencies) / Math.min(...frequencies)).toBeLessThan(1.5);
  });

  it("does not repeat across many draws", () => {
    const tokens = Array.from({ length: 2000 }, () => generateCampaignToken());

    expect(new Set(tokens).size).toBe(tokens.length);
  });
});

describe("isUniqueViolation", () => {
  it("recognises only 23505", () => {
    expect(isUniqueViolation({ code: "23505" })).toBe(true);
    expect(isUniqueViolation({ code: "23514" })).toBe(false);
    expect(isUniqueViolation(null)).toBe(false);
    expect(isUniqueViolation(undefined)).toBe(false);
  });
});

describe("withUniqueToken", () => {
  it("returns on first success", async () => {
    const attempt = vi.fn().mockResolvedValue({ data: { id: "1" }, error: null });

    await expect(withUniqueToken(attempt)).resolves.toEqual({ id: "1" });
    expect(attempt).toHaveBeenCalledTimes(1);
  });

  it("retries with a fresh token on collision", async () => {
    const attempt = vi
      .fn()
      .mockResolvedValueOnce({ data: null, error: { code: "23505" } })
      .mockResolvedValueOnce({ data: { id: "2" }, error: null });

    await expect(withUniqueToken(attempt)).resolves.toEqual({ id: "2" });
    expect(attempt).toHaveBeenCalledTimes(2);
    expect(attempt.mock.calls[0][0]).not.toBe(attempt.mock.calls[1][0]);
  });

  // The old code swallowed every insert error, so a failure looked to the
  // seller like a link that silently never appeared.
  it("surfaces a non-collision error immediately", async () => {
    const attempt = vi.fn().mockResolvedValue({ data: null, error: { code: "23514" } });

    await expect(withUniqueToken(attempt)).rejects.toThrow("Could not create the link");
    expect(attempt).toHaveBeenCalledTimes(1);
  });

  it("gives up after the retry budget", async () => {
    const attempt = vi.fn().mockResolvedValue({ data: null, error: { code: "23505" } });

    await expect(withUniqueToken(attempt, { retries: 3 })).rejects.toThrow("unique link");
    expect(attempt).toHaveBeenCalledTimes(3);
  });
});
