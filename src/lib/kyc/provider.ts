import "server-only";

/**
 * The contract every KYC vendor integration implements.
 *
 * The vendor is undecided (Smile ID, Youverify, Dojah and Prembly are all on
 * the shortlist; see the roadmap's decisions list), so this is shaped around
 * what all of them do rather than any one API:
 *
 *   1. We start a check and get back either a hosted-flow URL to send the
 *      seller to, or a token the mobile SDK opens.
 *   2. The vendor captures the Ghana Card / selfie / registration document on
 *      its own surface — the images never touch SnapDuka.
 *   3. The vendor tells us the outcome by webhook; `getResult` is the polling
 *      fallback for when a webhook is lost.
 *
 * Data protection (Act 843) is part of the contract, not the adapter's good
 * manners: a `KycResult` has no field that can carry an ID number, a name, a
 * date of birth or an image. `maskedId` must be masked by the adapter
 * (see maskIdNumber) and `details` holds only flat vendor metadata. The
 * database refuses the obvious raw keys as a second line of defence.
 */

export const KYC_CHECK_TYPES = ["ghana_card", "liveness", "business_reg"] as const;
export type KycCheckType = (typeof KYC_CHECK_TYPES)[number];

export function isKycCheckType(value: unknown): value is KycCheckType {
  return typeof value === "string" && (KYC_CHECK_TYPES as readonly string[]).includes(value);
}

export type KycStatus = "pending" | "passed" | "failed" | "needs_review" | "expired" | "error";

export type KycSellerContext = {
  sellerAccountId: string;
  country: "GH" | "NG" | "CI";
  /** Where the hosted flow returns the seller to when it is done. */
  returnUrl: string;
};

export type KycStartResult = {
  providerRef: string;
  /** Hosted verification page (web). */
  redirectUrl: string | null;
  /** Token for the vendor's mobile SDK (Squad D). */
  sdkToken: string | null;
  /** When an unfinished check stops being resumable. */
  expiresAt: string | null;
};

export type KycResult = {
  providerRef: string;
  status: KycStatus;
  /** 0-100, the vendor's own confidence in the match. */
  matchScore: number | null;
  /** e.g. "GHA-*******12-3". Must contain at least one `*`. */
  maskedId: string | null;
  failureReason: string | null;
  /** Flat vendor metadata only: job ids, result codes. Never personal data. */
  details: Readonly<Record<string, string | number | boolean>>;
};

export type KycWebhookRequest = {
  rawBody: string;
  headers: Readonly<Record<string, string>>;
};

export interface KycProvider {
  readonly id: string;
  readonly supportedTypes: readonly KycCheckType[];
  status(): "ready" | "not_configured";
  startCheck(seller: KycSellerContext, type: KycCheckType): Promise<KycStartResult>;
  getResult(providerRef: string): Promise<KycResult>;
  /** Constant-time; false on any doubt. Never throws. */
  verifyWebhook(request: KycWebhookRequest): Promise<boolean>;
  /** Only called after verifyWebhook passed. */
  parseWebhook(request: KycWebhookRequest): KycResult[];
}

export class KycProviderError extends Error {
  readonly code: "not_configured" | "unsupported" | "unavailable" | "rejected";

  constructor(code: KycProviderError["code"], message: string) {
    super(message);
    this.name = "KycProviderError";
    this.code = code;
  }
}

/**
 * Mask an identifier down to its last `visible` characters, keeping
 * separators so it still reads like the document it came from:
 * `GHA-123456789-0` -> `GHA-*******89-0` with visible = 3.
 * The three-letter Ghana Card prefix is a country code, not personal data.
 */
export function maskIdNumber(id: string, visible = 3): string {
  const trimmed = id.trim();
  const prefix = /^[A-Z]{3}-/.exec(trimmed)?.[0] ?? "";
  const body = trimmed.slice(prefix.length);
  const alnumPositions = [...body].map((char, index) => (/[A-Za-z0-9]/.test(char) ? index : -1)).filter((i) => i >= 0);
  const keep = new Set(alnumPositions.slice(Math.max(0, alnumPositions.length - visible)));
  const masked = [...body].map((char, index) => (/[A-Za-z0-9]/.test(char) && !keep.has(index) ? "*" : char)).join("");
  // Guarantee at least one mask character, even for very short input.
  return prefix + (masked.includes("*") ? masked : `*${masked.slice(1)}`);
}

const DETAIL_KEY = /^[a-zA-Z][a-zA-Z0-9_]{0,40}$/;
const FORBIDDEN_DETAIL_KEYS = new Set([
  "id_number", "idnumber", "pin", "ghana_card_number", "ghanacardnumber", "image", "images",
  "selfie", "photo", "document_image", "documentimage", "full_name", "fullname", "name",
  "first_name", "firstname", "last_name", "lastname", "dob", "date_of_birth", "dateofbirth",
  "raw", "address", "phone",
]);

/**
 * Keep only flat, non-personal vendor metadata. Adapters call this on whatever
 * the vendor sent so a vendor adding a field to its payload can never leak it
 * into our database.
 */
export function sanitizeKycDetails(input: Record<string, unknown>): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(input)) {
    if (!DETAIL_KEY.test(key) || FORBIDDEN_DETAIL_KEYS.has(key.toLowerCase())) continue;
    if (typeof value === "string") out[key] = value.slice(0, 120);
    else if (typeof value === "number" && Number.isFinite(value)) out[key] = value;
    else if (typeof value === "boolean") out[key] = value;
  }
  return out;
}
