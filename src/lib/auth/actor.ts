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
  country: "GH" | "NG" | "CI";
  status: SellerAccountStatus;
};

export type ActorResolverDependencies = {
  getVerifiedUser: () => Promise<VerifiedAuthUser | null>;
  getSellerByAuthUserId: (
    authUserId: string,
  ) => Promise<SellerAccountIdentity | null>;
  getMembershipByAuthUserId?: (authUserId: string) => Promise<(SellerAccountIdentity & { role: NonNullable<SellerActor["role"]> }) | null>;
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
  const { createClient } = await import("@/lib/supabase/server");
  const supabase = await createClient();

  return {
    async getVerifiedUser() {
      const { data, error } = await supabase.auth.getUser();

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
  };
}

export async function resolveServerActor(
  dependencies?: ActorResolverDependencies,
): Promise<Actor> {
  return resolveActor(dependencies ?? (await createSupabaseDependencies()));
}
