/**
 * GhanaPostGPS digital addresses: `GA-123-4567`, `AK-485-9321`.
 *
 * Shape: two letters (region letter, then district letter), a 3-4 digit area
 * code, then a 4-digit unique code. Buyers type them every way imaginable —
 * `ga1234567`, `GA 123 4567`, `ga-123-4567 ` — because the code is printed on
 * a wall plate and read out over the phone. We accept all of those and store
 * one canonical form, so the seller and the courier see the same string.
 *
 * This validates *shape* only. It does not prove the code exists: that needs
 * the GhanaPost API, whose access route is still an open decision (see the
 * roadmap's "decisions needed"). A well-formed code that points nowhere is
 * caught by the rider, not by us, and the address fields remain the source of
 * truth for the delivery.
 */

/**
 * First letter of a GhanaPostGPS code → region, as the 2017 launch published
 * them for the original ten regions.
 *
 * ⚠ NEEDS VERIFICATION against the official GhanaPost list before anything
 * relies on the region for money or routing. Ghana went from 10 to 16 regions
 * in 2019 (Ahafo, Bono East, Oti, Savannah, North East, Western North), and we
 * have not confirmed whether those were given new letters or kept their parent
 * region's. Until then the region label is advisory: shown to the seller as a
 * hint, never used to reject an address or price a delivery.
 */
export const GHANA_POST_REGION_PREFIXES: Readonly<Record<string, string>> = {
  A: "Ashanti",
  B: "Bono / Brong-Ahafo",
  C: "Central",
  E: "Eastern",
  G: "Greater Accra",
  N: "Northern",
  U: "Upper East",
  V: "Volta",
  W: "Western",
  X: "Upper West",
};

/** Separators are optional and may be a hyphen, a space, or both. */
const PATTERN = /^([A-Z])([A-Z])[-\s]*(\d{3,4})[-\s]*(\d{4})$/;

export type GhanaPostAddress = {
  /** Canonical form, e.g. `GA-123-4567`. */
  code: string;
  regionLetter: string;
  districtLetter: string;
  areaCode: string;
  uniqueCode: string;
  /** Advisory only — see GHANA_POST_REGION_PREFIXES. */
  regionName: string | null;
};

export type GhanaPostParseResult =
  | { ok: true; address: GhanaPostAddress }
  | { ok: false; reason: "empty" | "format" | "region" };

export function parseGhanaPostGps(input: string | null | undefined): GhanaPostParseResult {
  const cleaned = (input ?? "").trim().toUpperCase().replace(/\s+/g, " ");
  if (!cleaned) return { ok: false, reason: "empty" };

  const match = PATTERN.exec(cleaned);
  if (!match) return { ok: false, reason: "format" };
  const [, regionLetter, districtLetter, areaCode, uniqueCode] = match;

  const regionName = GHANA_POST_REGION_PREFIXES[regionLetter] ?? null;
  // An unknown first letter is rejected rather than accepted as "advisory":
  // it is far more likely to be a typo (O for G, I for A) than a region we do
  // not know, and catching the typo while the buyer is still on the page is the
  // whole point of validating here.
  if (!regionName) return { ok: false, reason: "region" };

  return {
    ok: true,
    address: {
      code: `${regionLetter}${districtLetter}-${areaCode}-${uniqueCode}`,
      regionLetter,
      districtLetter,
      areaCode,
      uniqueCode,
      regionName,
    },
  };
}

/** The canonical code, or null if the input is not a valid digital address. */
export function normalizeGhanaPostGps(input: string | null | undefined): string | null {
  const parsed = parseGhanaPostGps(input);
  return parsed.ok ? parsed.address.code : null;
}

/** A buyer-facing message for a failed parse, or null when it parsed. */
export function ghanaPostGpsError(input: string | null | undefined): string | null {
  const parsed = parseGhanaPostGps(input);
  if (parsed.ok || parsed.reason === "empty") return null;
  return "Enter a GhanaPostGPS code like GA-123-4567, or leave it blank.";
}
