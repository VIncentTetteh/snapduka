import { describe, expect, it } from "vitest";

import {
  decodeCursor,
  encodeCursor,
  keysetAfterFilter,
  nextCursorFor,
  parseLimit,
  resolveCursor,
} from "./keyset-cursor";

const ID = "3f1c2b7e-9a0d-4e6f-8b1a-2c3d4e5f6a7b";
const AT = "2026-09-25T10:00:00.123456+00:00";

describe("keyset cursor", () => {
  it("round-trips the timestamp with its microseconds intact", () => {
    const cursor = encodeCursor({ createdAt: AT, id: ID });
    expect(cursor.startsWith("v2.")).toBe(true);
    expect(decodeCursor(cursor)).toEqual({ kind: "keyset", position: { createdAt: AT, id: ID } });
  });

  it("recognises the pre-v2 bare-id cursor as legacy", () => {
    expect(decodeCursor(ID.toUpperCase())).toEqual({ kind: "legacy", id: ID });
  });

  it.each([
    "",
    "v2.",
    "v2.bm90IGpzb24",
    `v2.${Buffer.from(JSON.stringify([AT])).toString("base64url")}`,
    `v2.${Buffer.from(JSON.stringify([`${AT}",id.gt.0`, ID])).toString("base64url")}`,
    `v2.${Buffer.from(JSON.stringify([AT, "x),or(id.gt.0"])).toString("base64url")}`,
  ])("rejects %s — nothing unvalidated reaches the filter string", (raw) => {
    expect(decodeCursor(raw)).toBeNull();
  });

  it("spells the tuple comparison as PostgREST needs it, with the timestamp quoted", () => {
    expect(keysetAfterFilter({ createdAt: AT, id: ID })).toBe(
      `created_at.gt."${AT}",and(created_at.eq."${AT}",id.gt.${ID})`,
    );
  });

  it("issues a next cursor only for a full page", () => {
    const rows = [{ created_at: AT, id: ID }];
    expect(nextCursorFor(rows, 2)).toBeNull();
    expect(nextCursorFor(null, 2)).toBeNull();
    expect(decodeCursor(nextCursorFor(rows, 1)!)).toEqual({ kind: "keyset", position: { createdAt: AT, id: ID } });
  });

  it.each([
    [null, 50],
    ["10", 10],
    ["0", 1],
    ["-5", 1],
    ["1000", 100],
    ["abc", 50],
  ])("parseLimit(%s) = %i", (raw, expected) => {
    expect(parseLimit(raw)).toBe(expected);
  });

  it("resolves a legacy cursor through the caller's scoped lookup", async () => {
    const lookup = async (id: string) => (id === ID ? AT : null);
    expect(await resolveCursor(ID, lookup)).toEqual({ ok: true, position: { createdAt: AT, id: ID } });
    expect(await resolveCursor("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", lookup)).toEqual({ ok: false });
    expect(await resolveCursor(null, lookup)).toEqual({ ok: true, position: null });
  });
});
