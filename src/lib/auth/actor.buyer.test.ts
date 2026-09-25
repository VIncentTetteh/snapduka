import { describe, expect, it, vi } from "vitest";

import {
  resolveActor,
  resolveBuyerActor,
  resolveCreatorContext,
  type ActorResolverDependencies,
  type BuyerProfileIdentity,
  type CreatorIdentity,
  type SellerAccountIdentity,
  type VerifiedAuthUser,
} from "./actor";

/**
 * Buyer identity was added to a resolver that 85 call sites depend on. The
 * property that matters: a user who ALSO has a buyer profile resolves through
 * `resolveActor` exactly as they did before, for every kind, and the buyer
 * lookup is never even made there. Each case below runs the same user twice —
 * with and without a buyer profile — and demands identical output.
 */

const user: VerifiedAuthUser = {
  id: "00000000-0000-0000-0000-000000000701",
  email: "both@example.com",
  appMetadata: {},
};
const operatorUser: VerifiedAuthUser = { ...user, appMetadata: { snapduka_role: "operator" } };
const seller: SellerAccountIdentity = {
  id: "00000000-0000-0000-0000-000000000702",
  country: "GH",
  status: "active",
};
const creator: CreatorIdentity = { id: "creator-9", handle: "ama_buys", country: "GH" };
const buyerProfile: BuyerProfileIdentity = {
  id: "00000000-0000-0000-0000-000000000703",
  phone: "+233241234567",
  consentedAt: "2026-09-25T10:00:00.000Z",
};

type Shape = {
  user: VerifiedAuthUser | null;
  seller?: SellerAccountIdentity | null;
  membership?: (SellerAccountIdentity & { role: "manager" | "catalog" | "fulfillment" | "support" | "analyst" }) | null;
  creator?: CreatorIdentity | null;
  buyer?: BuyerProfileIdentity | null;
};

function deps(shape: Shape) {
  const getBuyerProfileByAuthUserId = vi.fn().mockResolvedValue(shape.buyer ?? null);
  const dependencies: ActorResolverDependencies = {
    getVerifiedUser: vi.fn().mockResolvedValue(shape.user),
    getSellerByAuthUserId: vi.fn().mockResolvedValue(shape.seller ?? null),
    getMembershipByAuthUserId: vi.fn().mockResolvedValue(shape.membership ?? null),
    getCreatorByAuthUserId: vi.fn().mockResolvedValue(shape.creator ?? null),
    getBuyerProfileByAuthUserId,
  };
  return { dependencies, getBuyerProfileByAuthUserId };
}

const KINDS: { name: string; shape: Shape; expectedKind: string }[] = [
  { name: "anonymous", shape: { user: null }, expectedKind: "anonymous" },
  { name: "unprovisioned", shape: { user }, expectedKind: "unprovisioned" },
  { name: "shop owner", shape: { user, seller }, expectedKind: "seller" },
  { name: "suspended shop owner", shape: { user, seller: { ...seller, status: "suspended" } }, expectedKind: "seller" },
  { name: "pending shop owner", shape: { user, seller: { ...seller, status: "pending" } }, expectedKind: "seller" },
  {
    name: "team member",
    shape: { user, membership: { ...seller, role: "analyst" } },
    expectedKind: "seller",
  },
  { name: "creator", shape: { user, creator }, expectedKind: "creator" },
  { name: "seller who is also a creator", shape: { user, seller, creator }, expectedKind: "seller" },
  { name: "operator", shape: { user: operatorUser, seller }, expectedKind: "operator" },
];

describe("resolveActor is unchanged by a buyer profile", () => {
  it.each(KINDS)("$name resolves identically with and without a buyer profile", async ({ shape, expectedKind }) => {
    const without = deps({ ...shape, buyer: null });
    const withBuyer = deps({ ...shape, buyer: buyerProfile });

    const before = await resolveActor(without.dependencies);
    const after = await resolveActor(withBuyer.dependencies);

    expect(after).toEqual(before);
    expect(after.kind).toBe(expectedKind);
    // Not just the same answer: seller page loads must not pay for the lookup.
    expect(withBuyer.getBuyerProfileByAuthUserId).not.toHaveBeenCalled();
  });

  it("keeps a team member carrying the OWNER's account id and their role", async () => {
    const { dependencies } = deps({ user, membership: { ...seller, role: "analyst" }, buyer: buyerProfile });

    await expect(resolveActor(dependencies)).resolves.toMatchObject({
      kind: "seller",
      sellerAccountId: seller.id,
      role: "analyst",
    });
  });

  it("does not change creator context resolution either", async () => {
    const { dependencies, getBuyerProfileByAuthUserId } = deps({ user, seller, creator, buyer: buyerProfile });

    await expect(resolveCreatorContext(dependencies)).resolves.toEqual({
      creatorId: creator.id,
      handle: creator.handle,
      country: "GH",
    });
    expect(getBuyerProfileByAuthUserId).not.toHaveBeenCalled();
  });
});

describe("resolveBuyerActor", () => {
  it("is anonymous with no session", async () => {
    const { dependencies, getBuyerProfileByAuthUserId } = deps({ user: null, buyer: buyerProfile });

    await expect(resolveBuyerActor(dependencies)).resolves.toEqual({ kind: "anonymous", authenticated: false });
    expect(getBuyerProfileByAuthUserId).not.toHaveBeenCalled();
  });

  it("is unprovisioned for a signed-in user with no buyer profile yet", async () => {
    const { dependencies } = deps({ user, buyer: null });

    await expect(resolveBuyerActor(dependencies)).resolves.toEqual({
      kind: "unprovisioned",
      authenticated: true,
      userId: user.id,
      email: user.email,
    });
  });

  it("resolves a buyer with their profile, phone and consent", async () => {
    const { dependencies, getBuyerProfileByAuthUserId } = deps({ user, buyer: buyerProfile });

    await expect(resolveBuyerActor(dependencies)).resolves.toEqual({
      kind: "buyer",
      authenticated: true,
      userId: user.id,
      buyerProfileId: buyerProfile.id,
      phone: buyerProfile.phone,
      consented: true,
    });
    expect(getBuyerProfileByAuthUserId).toHaveBeenCalledWith(user.id);
  });

  it("reports a buyer who has not consented to the shared profile", async () => {
    const { dependencies } = deps({ user, buyer: { ...buyerProfile, consentedAt: null } });

    await expect(resolveBuyerActor(dependencies)).resolves.toMatchObject({ kind: "buyer", consented: false });
  });

  it("resolves a shop owner as a buyer on buyer routes, while resolveActor keeps them a seller", async () => {
    const { dependencies } = deps({ user, seller, buyer: buyerProfile });

    await expect(resolveBuyerActor(dependencies)).resolves.toMatchObject({ kind: "buyer" });
    await expect(resolveActor(dependencies)).resolves.toMatchObject({ kind: "seller", sellerAccountId: seller.id });
  });

  it("never gives an operator session a buyer identity", async () => {
    const { dependencies, getBuyerProfileByAuthUserId } = deps({ user: operatorUser, buyer: buyerProfile });

    await expect(resolveBuyerActor(dependencies)).resolves.toEqual({ kind: "anonymous", authenticated: false });
    expect(getBuyerProfileByAuthUserId).not.toHaveBeenCalled();
  });

  it("treats a resolver without the buyer dependency as having no profile", async () => {
    const dependencies: ActorResolverDependencies = {
      getVerifiedUser: vi.fn().mockResolvedValue(user),
      getSellerByAuthUserId: vi.fn().mockResolvedValue(null),
    };

    await expect(resolveBuyerActor(dependencies)).resolves.toMatchObject({ kind: "unprovisioned" });
  });
});
