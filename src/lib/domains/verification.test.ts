import { describe, expect, test } from "vitest";

import { domainChallenge, normalizeHostname } from "./verification";

describe("custom domains", () => {
  test("normalizes hosts and creates a stable DNS challenge", () => {
    expect(normalizeHostname("Shop.Example.COM:443")).toBe("shop.example.com");
    expect(domainChallenge("abc")).toEqual({ name: "_snapduka", type: "TXT", value: "snapduka-verification=abc" });
  });
});
