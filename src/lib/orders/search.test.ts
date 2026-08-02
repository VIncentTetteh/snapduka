import { describe, expect, it } from "vitest";

import {
  ORDER_SEARCH_COLUMNS,
  buildOrderSearchFilter,
  escapeSearchTerm,
  isOrderRange,
  normalizeSearchTerm,
  rangeCutoff,
} from "./search";

const ID_A = "11111111-1111-4111-8111-111111111111";
const ID_B = "22222222-2222-4222-8222-222222222222";

describe("escapeSearchTerm", () => {
  it("wraps the term in ilike wildcards", () => {
    expect(escapeSearchTerm("ama")).toBe('"%ama%"');
  });

  /**
   * `,` ends a clause and `.` separates column/operator/value in the PostgREST
   * filter grammar. A buyer called "Mensah, Ama Jr." must not be able to
   * restructure the query just by existing.
   */
  it("survives the characters that delimit the filter grammar", () => {
    expect(escapeSearchTerm("Mensah, Ama Jr.")).toBe('"%Mensah, Ama Jr.%"');
    expect(escapeSearchTerm("shop(1)")).toBe('"%shop(1)%"');
  });

  it("escapes the quote that would end the quoted value", () => {
    expect(escapeSearchTerm('say "hi"')).toBe('"%say \\"hi\\"%"');
  });

  it("escapes backslashes before they can escape something else", () => {
    // The backslash must be doubled first, or escaping the quote would produce
    // a stray escape of its own.
    expect(escapeSearchTerm('a\\"b')).toBe('"%a\\\\\\"b%"');
  });

});

describe("normalizeSearchTerm", () => {
  it("trims, so trailing spaces are not searched for", () => {
    expect(normalizeSearchTerm("  ama  ")).toBe("ama");
    expect(normalizeSearchTerm(undefined)).toBe("");
  });

  // PostgREST has no escape for an ilike wildcard, so a single stray character
  // would otherwise turn a search into "match every order".
  it("strips wildcards instead of trusting them", () => {
    expect(normalizeSearchTerm("a*b%c")).toBe("abc");
  });

  /**
   * A term of nothing but wildcards must normalise to empty. Left in, `%`
   * becomes `ilike '%%'` — every order comes back while the search box still
   * shows a term, which reads as "% matched all 51 orders".
   */
  it("reduces an all-wildcard term to no search at all", () => {
    expect(normalizeSearchTerm("%")).toBe("");
    expect(normalizeSearchTerm(" ** ")).toBe("");
    expect(buildOrderSearchFilter(normalizeSearchTerm("%"))).toBeNull();
  });
});

describe("buildOrderSearchFilter", () => {
  it("searches reference, name, phone and email", () => {
    const filter = buildOrderSearchFilter("ama");

    for (const column of ORDER_SEARCH_COLUMNS) {
      expect(filter).toContain(`${column}.ilike."%ama%"`);
    }
  });

  it("returns null for an empty term so the caller skips the filter", () => {
    // An empty `.or()` would match everything, which is the same as no filter
    // but costs a malformed query to find out.
    expect(buildOrderSearchFilter("")).toBeNull();
  });

  it("folds in orders matched by product name", () => {
    const filter = buildOrderSearchFilter("dress", [ID_A, ID_B]);

    expect(filter).toContain(`id.in.(${ID_A},${ID_B})`);
  });

  it("omits the id clause when no product matched", () => {
    expect(buildOrderSearchFilter("dress", [])).not.toContain("id.in.");
  });

  it("drops anything that is not a UUID before interpolating it", () => {
    const filter = buildOrderSearchFilter("dress", [ID_A, "not-an-id,total_minor.gt.0"]);

    expect(filter).toContain(`id.in.(${ID_A})`);
    expect(filter).not.toContain("total_minor");
  });

  it("keeps the seller's term escaped once it is combined with ids", () => {
    const filter = buildOrderSearchFilter("a,b", [ID_A]);

    expect(filter).toContain('"%a,b%"');
  });
});

describe("isOrderRange", () => {
  it("accepts the ranges the UI offers", () => {
    expect(isOrderRange("24h")).toBe(true);
    expect(isOrderRange("30d")).toBe(true);
  });

  it("rejects anything else, including inherited property names", () => {
    expect(isOrderRange("all")).toBe(false);
    expect(isOrderRange(undefined)).toBe(false);
    // `"constructor" in ORDER_RANGES` is true via the prototype chain.
    expect(isOrderRange("constructor")).toBe(false);
  });
});

describe("rangeCutoff", () => {
  const now = new Date("2026-08-02T10:00:00.000Z");

  it("counts back from now, not from midnight", () => {
    expect(rangeCutoff("24h", now)).toBe("2026-08-01T10:00:00.000Z");
    expect(rangeCutoff("7d", now)).toBe("2026-07-26T10:00:00.000Z");
    expect(rangeCutoff("30d", now)).toBe("2026-07-03T10:00:00.000Z");
  });

  it("returns null for any time, so no date filter is applied", () => {
    expect(rangeCutoff(undefined, now)).toBeNull();
    expect(rangeCutoff("", now)).toBeNull();
    expect(rangeCutoff("bogus", now)).toBeNull();
  });
});
