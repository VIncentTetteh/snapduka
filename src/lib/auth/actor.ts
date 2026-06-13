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
  country: "GH" | "NG";
  status: SellerAccountStatus;
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
  country: "GH" | "NG";
  status: SellerAccountStatus;
};

export type ActorResolverDependencies = {
  getVerifiedUser: () => Promise<VerifiedAuthUser | null>;
  getSellerByAuthUserId: (
    authUserId: string,
  ) => Promise<SellerAccountIdentity | null>;
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

  if (!seller) {
    return {
      kind: "unprovisioned",
      authenticated: true,
      userId: user.id,
      email: user.email,
    };
  }

  return {
    kind: "seller",
    authenticated: true,
    userId: user.id,
    email: user.email,
    sellerAccountId: seller.id,
    country: seller.country,
    status: seller.status,
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
  };
}

export async function resolveServerActor(
  dependencies?: ActorResolverDependencies,
): Promise<Actor> {
  return resolveActor(dependencies ?? (await createSupabaseDependencies()));
}
