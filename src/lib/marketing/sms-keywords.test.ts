import { describe, expect, it } from "vitest";

import { classifySmsKeyword, normalizeSmsPhone } from "./sms-keywords";

describe("classifySmsKeyword", () => {
  it.each(["STOP", "stop", "Stop.", " stop please", "STOPALL", "unsubscribe", "Cancel", "END", "quit!", "STOP SENDING ME THIS"])(
    "%j opts out",
    (text) => {
      expect(classifySmsKeyword(text).action).toBe("opt_out");
    },
  );

  it("reports the matched keyword in upper case", () => {
    expect(classifySmsKeyword("unsubscribe me")).toEqual({ action: "opt_out", keyword: "UNSUBSCRIBE" });
  });

  it.each(["START", "start", " Start! "])("%j opts back in", (text) => {
    expect(classifySmsKeyword(text)).toEqual({ action: "opt_in", keyword: "START" });
  });

  it.each(["start my order again", "Start delivery tomorrow?", "Hello", "", "   ", "please stop", "STOPPING by later", "12345"])(
    "%j is not a keyword",
    (text) => {
      expect(classifySmsKeyword(text)).toEqual({ action: "ignored", keyword: null });
    },
  );
});

describe("normalizeSmsPhone", () => {
  it.each([
    ["233201234567", "+233201234567"],
    ["+233 20 123 4567", "+233201234567"],
    ["00233201234567", "+233201234567"],
    ["+2348031234567", "+2348031234567"],
  ])("%s -> %s", (raw, expected) => {
    expect(normalizeSmsPhone(raw)).toBe(expected);
  });

  it.each(["0201234567", "", null, undefined, "abc", "+0123456789", "12"])("%j is refused", (raw) => {
    expect(normalizeSmsPhone(raw)).toBeNull();
  });
});
