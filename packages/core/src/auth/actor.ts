// Ported (pure portion) from Snapduka/src/lib/auth/actor.ts.
// The web binds `ActorResolverDependencies` to its cookie-based server client;
// mobile binds the same interface to its SecureStore-backed supabase-js client.
// The resolution logic itself is identical and lives here so it cannot drift.
import type { CountryCode } from "../countries/types";

export type SellerAccountStatus = "pending" | "active" | "suspended" | "closed";

export type AnonymousActor = {
  kind: "anonymous";
  authenticated: false;
};

export type UnprovisionedActor = {
  kind: "unprovisioned";
  authenticated: true;
  userId: string;
  email: string | null;
};

export type SellerActor = {
  kind: "seller";
  authenticated: true;
  userId: string;
  email: string | null;
  sellerAccountId: string;
  country: CountryCode;
  status: SellerAccountStatus;
  role?: "manager" | "catalog" | "fulfillment" | "support" | "analyst";
};

export type OperatorActor = {
  kind: "operator";
  authenticated: true;
  userId: string;
  email: string | null;
  role: "operator";
};

export type Actor =
  | AnonymousActor
  | UnprovisionedActor
  | SellerActor
  | OperatorActor;

export type VerifiedAuthUser = {
  id: string;
  email: string | null;
  appMetadata: Record<string, unknown>;
};

export type SellerAccountIdentity = {
  id: string;
  country: CountryCode;
  status: SellerAccountStatus;
};

export type ActorResolverDependencies = {
  getVerifiedUser: () => Promise<VerifiedAuthUser | null>;
  getSellerByAuthUserId: (
    authUserId: string,
  ) => Promise<SellerAccountIdentity | null>;
  getMembershipByAuthUserId?: (
    authUserId: string,
  ) => Promise<(SellerAccountIdentity & { role: NonNullable<SellerActor["role"]> }) | null>;
};

export async function resolveActor(
  dependencies: ActorResolverDependencies,
): Promise<Actor> {
  const user = await dependencies.getVerifiedUser();

  if (!user) {
    return { kind: "anonymous", authenticated: false };
  }

  if (user.appMetadata.snapduka_role === "operator") {
    return {
      kind: "operator",
      authenticated: true,
      userId: user.id,
      email: user.email,
      role: "operator",
    };
  }

  const seller = await dependencies.getSellerByAuthUserId(user.id);
  const membership = seller
    ? null
    : await dependencies.getMembershipByAuthUserId?.(user.id);

  if (!seller && !membership) {
    return {
      kind: "unprovisioned",
      authenticated: true,
      userId: user.id,
      email: user.email,
    };
  }

  const identity = seller ?? membership!;
  return {
    kind: "seller",
    authenticated: true,
    userId: user.id,
    email: user.email,
    sellerAccountId: identity.id,
    country: identity.country,
    status: identity.status,
    ...(membership ? { role: membership.role } : {}),
  };
}
