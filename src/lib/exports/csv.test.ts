import { describe, expect, test } from "vitest";
import { toCsv } from "./csv";
describe("CSV export", () => {
  test("escapes commas, quotes and spreadsheet formulas", () => {
    expect(toCsv([["name", "note"], ["Ama, Inc", "=IMPORTXML()"]])).toBe('name,note\n"Ama, Inc","\'=IMPORTXML()"\n');
  });
});
