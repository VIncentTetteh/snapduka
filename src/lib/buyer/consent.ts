/**
 * The shared-profile consent a buyer gives under Ghana's Data Protection Act,
 * 2012 (Act 843). Kept as data so the page renders exactly the words whose
 * version is recorded in buyer_profiles.consent_version and the audit trail.
 *
 * Changing the wording in any way that changes its meaning REQUIRES a new
 * version string: consent is to specific text, and an old timestamp must never
 * be read as agreement to new terms.
 */
export const SHARED_PROFILE_CONSENT_VERSION = "2026-09-v1";

export const SHARED_PROFILE_CONSENT_POINTS: readonly string[] = [
  "SnapDuka links orders placed with your verified phone number, at any SnapDuka shop, into one order history that only you can see.",
  "Each shop continues to receive only the details you give it when you order from it. No shop can see your SnapDuka profile, your saved addresses, or your orders from other shops.",
  "Your saved addresses and payment methods are used only to fill in checkout for you.",
  "You can withdraw this consent at any time. Your orders are then unlinked from your profile, and each shop keeps its own record of the orders you placed with it.",
  "You can download everything we hold in your profile, or delete it, from this page.",
];
