import { describe, expect, it } from "vitest";

import { canTransitionCase } from "@/lib/support/transitions";

describe("support case transitions", () => {
  it("supports buyer-opened mediation through closure", () => {
    expect(canTransitionCase("opened","seller_response_due")).toBe(true);
    expect(canTransitionCase("seller_response_due","under_review")).toBe(true);
    expect(canTransitionCase("under_review","resolved")).toBe(true);
    expect(canTransitionCase("resolved","closed")).toBe(true);
  });
  it("does not reopen closed cases", () => {
    expect(canTransitionCase("closed","opened")).toBe(false);
  });
});
