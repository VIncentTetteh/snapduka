import { describe, expect, it } from "vitest";

import {
  SMS_BROADCAST_MAX_SEGMENTS,
  SMS_OPT_OUT_FOOTER,
  smsBroadcastBody,
  smsEncoding,
  smsSegmentCount,
  smsUnits,
} from "./sms";

describe("smsEncoding / smsUnits / smsSegmentCount", () => {
  it("plain text is GSM-7, one septet per character", () => {
    expect(smsEncoding("New stock! Come see.")).toBe("gsm7");
    expect(smsUnits("abc")).toBe(3);
  });

  it("extension characters cost two septets but stay GSM-7", () => {
    expect(smsEncoding("Save 10€ [today]")).toBe("gsm7");
    expect(smsUnits("€")).toBe(2);
    expect(smsUnits("{}")).toBe(4);
  });

  it("an emoji or a non-GSM character switches the whole message to UCS-2", () => {
    expect(smsEncoding("Sale 🎉")).toBe("ucs2");
    expect(smsEncoding("ça va")).toBe("ucs2");
    expect(smsUnits("🎉")).toBe(2);
  });

  it.each([
    ["a".repeat(160), 1],
    ["a".repeat(161), 2],
    ["a".repeat(306), 2],
    ["a".repeat(307), 3],
    ["é".repeat(160), 1],
    [`${"a".repeat(69)}🎉`, 2],
    [`${"a".repeat(68)}🎉`, 1],
    ["", 0],
  ])("%#: counts segments", (text, segments) => {
    expect(smsSegmentCount(text)).toBe(segments);
  });
});

describe("smsBroadcastBody", () => {
  it("collapses whitespace and appends the opt-out footer", () => {
    expect(smsBroadcastBody("New stock!\n\n  Come see  ")).toBe(`New stock! Come see ${SMS_OPT_OUT_FOOTER}`);
  });

  it("always carries the footer, even for an empty body", () => {
    expect(smsBroadcastBody("   ")).toBe(SMS_OPT_OUT_FOOTER);
  });

  it("truncates a long GSM-7 body to two segments, footer intact", () => {
    const text = smsBroadcastBody("a".repeat(1000));
    expect(smsEncoding(text)).toBe("gsm7");
    expect(smsSegmentCount(text)).toBe(SMS_BROADCAST_MAX_SEGMENTS);
    expect(smsUnits(text)).toBeLessThanOrEqual(306);
    expect(text.endsWith(`... ${SMS_OPT_OUT_FOOTER}`)).toBe(true);
  });

  it("budgets a UCS-2 body at 67 per part and never splits an emoji", () => {
    const text = smsBroadcastBody("🎉".repeat(200));
    expect(smsEncoding(text)).toBe("ucs2");
    expect(smsSegmentCount(text)).toBeLessThanOrEqual(SMS_BROADCAST_MAX_SEGMENTS);
    expect(text.length).toBeLessThanOrEqual(134);
    expect(text.endsWith(SMS_OPT_OUT_FOOTER)).toBe(true);
    // No lone surrogate: every code point is either an emoji or plain ASCII.
    expect([...text].every((char) => char === "🎉" || char.charCodeAt(0) < 128)).toBe(true);
  });

  it("counts extension characters as two when budgeting", () => {
    const text = smsBroadcastBody("€".repeat(400));
    expect(smsUnits(text)).toBeLessThanOrEqual(306);
    expect(smsSegmentCount(text)).toBe(2);
  });

  it("does not truncate a message that fits", () => {
    const body = "b".repeat(306 - SMS_OPT_OUT_FOOTER.length - 1);
    expect(smsBroadcastBody(body)).toBe(`${body} ${SMS_OPT_OUT_FOOTER}`);
  });
});
