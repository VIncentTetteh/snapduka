import { describe, expect, it } from "vitest";

import { decodeDraft, encodeDraft } from "@/lib/offline/drafts";

describe("offline drafts", () => {
  it("round-trips versioned non-sensitive drafts", () => {
    const encoded = encodeDraft({ name: "Market bag" }, new Date("2026-01-01T00:00:00Z"));
    expect(decodeDraft(encoded, new Date("2026-01-02T00:00:00Z"))).toEqual({ name: "Market bag" });
  });
  it("expires drafts after seven days", () => {
    const encoded = encodeDraft({ name: "Old" }, new Date("2026-01-01T00:00:00Z"));
    expect(decodeDraft(encoded, new Date("2026-01-09T00:00:00Z"))).toBeNull();
  });
});
