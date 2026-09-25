import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { INTENTS, LANGUAGES } from "./classifier";

/**
 * The eval harness's labelled set (scripts/eval-wa-agent.fixtures.json) must
 * use labels the classifier can produce, and every Twi/Pidgin fixture must be
 * flagged for native-speaker review until one has checked it.
 */
const fixtures = JSON.parse(
  readFileSync(path.resolve(__dirname, "../../../../scripts/eval-wa-agent.fixtures.json"), "utf8"),
) as { classifier: { id: string; language: string; intent: string; needsNativeReview?: boolean }[] };

describe("eval fixtures", () => {
  it("has about twenty labelled messages across all three languages", () => {
    expect(fixtures.classifier.length).toBeGreaterThanOrEqual(18);
    expect(new Set(fixtures.classifier.map((fixture) => fixture.language))).toEqual(new Set(LANGUAGES));
  });

  it("uses only labels the classifier can produce", () => {
    for (const fixture of fixtures.classifier) {
      expect(LANGUAGES).toContain(fixture.language);
      expect(INTENTS).toContain(fixture.intent);
    }
  });

  it("flags every Twi and Pidgin fixture for native-speaker review", () => {
    for (const fixture of fixtures.classifier.filter((entry) => entry.language !== "en")) {
      expect(fixture.needsNativeReview, fixture.id).toBe(true);
    }
  });
});
