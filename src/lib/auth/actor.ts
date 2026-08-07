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
  country: "GH" | "NG" | "CI";
  status: SellerAccountStatus;
  role?: "manager" | "catalog" | "fulfillment" | "support" | "analyst";
};

export type CreatorActor = {
  kind: "creator";
  authenticated: true;
  userId: string;
  email: string | null;
  creatorId: string;
  handle: string;
  country: "GH" | "NG" | "CI";
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
  | CreatorActor
  | OperatorActor;

export type VerifiedAuthUser = {
  id: string;
  email: string | null;
  appMetadata: Record<string, unknown>;
};

export type CreatorIdentity = {
  id: string;
  handle: string;
  country: "GH" | "NG" | "CI";
};

export type SellerAccountIdentity = {
  id: string;
  country: "GH" | "NG" | "CI";
  status: SellerAccountStatus;
};

export type ActorResolverDependencies = {
  getVerifiedUser: () => Promise<VerifiedAuthUser | null>;
  getSellerByAuthUserId: (
    authUserId: string,
  ) => Promise<SellerAccountIdentity | null>;
  getMembershipByAuthUserId?: (authUserId: string) => Promise<(SellerAccountIdentity & { role: NonNullable<SellerActor["role"]> }) | null>;
  /** Optional so existing callers that only inject the seller deps still typecheck. */
  getCreatorByAuthUserId?: (authUserId: string) => Promise<CreatorIdentity | null>;
};

export async function resolveActor(
  dependencies: ActorResolverDependencies,
): Promise<Actor> {
  const user = await dependencies.getVerifiedUser();

  if (!user) {
    return {
      kind: "anonymous",
      authenticated: false,
    };
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
  const membership = seller ? null : await dependencies.getMembershipByAuthUserId?.(user.id);

  if (!seller && !membership) {
    // Checked after seller and team membership, so a user who is both keeps
    // resolving as a seller and every `actor.kind !== "seller"` guard in the
    // dashboard keeps rejecting creators with no edit.
    const creator = await dependencies.getCreatorByAuthUserId?.(user.id);
    if (creator) {
      return {
        kind: "creator",
        authenticated: true,
        userId: user.id,
        email: user.email,
        creatorId: creator.id,
        handle: creator.handle,
        country: creator.country,
      };
    }

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

async function createSupabaseDependencies(): Promise<ActorResolverDependencies> {
  // Request-scoped rather than cookie-only, so the same resolver serves the web
  // dashboard (cookies) and the mobile app (Authorization: Bearer <jwt>).
  const { createRequestScopedClient, requestBearerJwt } = await import(
    "@/lib/supabase/request"
  );
  const [supabase, bearerJwt] = await Promise.all([
    createRequestScopedClient(),
    requestBearerJwt(),
  ]);

  return {
    async getVerifiedUser() {
      // A Bearer client has no stored session, so the token must be passed
      // explicitly; `getUser(undefined)` is the cookie path unchanged. Either
      // way this round-trips to Supabase Auth, which verifies signature and
      // expiry — the token is never trusted as presented.
      const { data, error } = await supabase.auth.getUser(bearerJwt ?? undefined);

      if (error || !data.user) {
        return null;
      }

      return {
        id: data.user.id,
        email: data.user.email ?? null,
        appMetadata: data.user.app_metadata,
      };
    },
    async getSellerByAuthUserId(authUserId) {
      const { data, error } = await supabase
        .from("seller_accounts")
        .select("id, country, status")
        .eq("auth_user_id", authUserId)
        .maybeSingle();

      if (error) {
        throw new Error("Unable to resolve the seller account.", {
          cause: error,
        });
      }

      return data as SellerAccountIdentity | null;
    },
    async getMembershipByAuthUserId(authUserId) {
      const { data, error } = await supabase.from("team_memberships").select("role,seller_accounts(id,country,status)").eq("auth_user_id",authUserId).eq("active",true).limit(1).maybeSingle();
      if (error || !data?.seller_accounts) return null;
      const seller=data.seller_accounts as unknown as SellerAccountIdentity;
      return {...seller,role:data.role as NonNullable<SellerActor["role"]>};
    },
    async getCreatorByAuthUserId(authUserId) {
      const { data, error } = await supabase
        .from("creators")
        .select("id, handle, country")
        .eq("auth_user_id", authUserId)
        .eq("status", "active")
        .maybeSingle();

      if (error) return null;
      return data as CreatorIdentity | null;
    },
  };
}

export async function resolveServerActor(
  dependencies?: ActorResolverDependencies,
): Promise<Actor> {
  return resolveActor(dependencies ?? (await createSupabaseDependencies()));
}
