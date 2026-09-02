// Ported from Snapduka/src/lib/billing/entitlements.ts — pure plan/entitlement logic
// shared by web + mobile so gating behaviour cannot drift between clients.
export type EntitlementValue = boolean | number | string | string[];

export type EntitlementSnapshot = {
  planCode: string;
  version: number;
  values: Record<string, EntitlementValue>;
  effectiveAt: string;
  expiresAt: string | null;
  readOnlyCapabilities: string[];
};

export function resolveEntitlement(
  snapshot: EntitlementSnapshot,
  capability: string,
) {
  return snapshot.values[capability];
}

export function hasCapability(
  snapshot: EntitlementSnapshot,
  capability: string,
  options: { write?: boolean } = {},
) {
  if (options.write && snapshot.readOnlyCapabilities.includes(capability)) {
    return false;
  }
  return snapshot.values[capability] === true;
}

export function withinLimit(
  snapshot: EntitlementSnapshot,
  capability: string,
  currentUsage: number,
) {
  const limit = snapshot.values[capability];
  return typeof limit === "number" && currentUsage < limit;
}
