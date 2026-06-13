import { describe, expect, it, vi } from "vitest";

import {
  resolveActor,
  resolveServerActor,
  type ActorResolverDependencies,
  type SellerAccountIdentity,
  type VerifiedAuthUser,
} from "./actor";

const user: VerifiedAuthUser = {
  id: "00000000-0000-0000-0000-000000000101",
  email: "seller@example.com",
  appMetadata: {},
};

const activeSeller: SellerAccountIdentity = {
  id: "00000000-0000-0000-0000-000000000201",
  country: "GH",
  status: "active",
};

function dependencies(
  verifiedUser: VerifiedAuthUser | null,
  seller: SellerAccountIdentity | null = null,
): ActorResolverDependencies {
  return {
    getVerifiedUser: vi.fn().mockResolvedValue(verifiedUser),
    getSellerByAuthUserId: vi.fn().mockResolvedValue(seller),
  };
}

describe("resolveActor", () => {
  it("returns an unauthenticated anonymous actor when there is no verified user", async () => {
    const deps = dependencies(null);

    await expect(resolveActor(deps)).resolves.toEqual({
      kind: "anonymous",
      authenticated: false,
    });
    expect(deps.getSellerByAuthUserId).not.toHaveBeenCalled();
  });

  it("returns an authenticated unprovisioned actor when the user has no seller account", async () => {
    const deps = dependencies(user);

    await expect(resolveActor(deps)).resolves.toEqual({
      kind: "unprovisioned",
      authenticated: true,
      userId: user.id,
      email: user.email,
    });
    expect(deps.getSellerByAuthUserId).toHaveBeenCalledWith(user.id);
  });

  it("returns an active seller actor resolved from the verified user ID", async () => {
    const deps = dependencies(user, activeSeller);

    await expect(resolveActor(deps)).resolves.toEqual({
      kind: "seller",
      authenticated: true,
      userId: user.id,
      email: user.email,
      sellerAccountId: activeSeller.id,
      country: "GH",
      status: "active",
    });
    expect(deps.getSellerByAuthUserId).toHaveBeenCalledWith(user.id);
  });

  it("keeps a suspended seller identified with their status", async () => {
    const suspendedSeller: SellerAccountIdentity = {
      ...activeSeller,
      status: "suspended",
    };

    await expect(
      resolveActor(dependencies(user, suspendedSeller)),
    ).resolves.toMatchObject({
      kind: "seller",
      authenticated: true,
      sellerAccountId: suspendedSeller.id,
      status: "suspended",
    });
  });

  it("returns an operator from verified app metadata without requiring a seller", async () => {
    const operator: VerifiedAuthUser = {
      ...user,
      appMetadata: { snapduka_role: "operator" },
    };
    const deps = dependencies(operator, activeSeller);

    await expect(resolveActor(deps)).resolves.toEqual({
      kind: "operator",
      authenticated: true,
      userId: operator.id,
      email: operator.email,
      role: "operator",
    });
    expect(deps.getSellerByAuthUserId).not.toHaveBeenCalled();
  });
});

describe("resolveServerActor", () => {
  it("uses injected trusted dependencies for server-side authorization", async () => {
    const deps = dependencies(user, activeSeller);

    await expect(resolveServerActor(deps)).resolves.toMatchObject({
      kind: "seller",
      userId: user.id,
      sellerAccountId: activeSeller.id,
    });
  });
});
