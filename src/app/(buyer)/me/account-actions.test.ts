import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
  session: vi.fn(),
  consent: vi.fn(),
  claim: vi.fn(),
  deletion: vi.fn(),
  insert: vi.fn(),
  signOut: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/buyer/session", () => ({ getBuyerSession: mocks.session }));
vi.mock("@/lib/buyer/account", () => ({
  setSharedProfileConsent: mocks.consent,
  claimGuestOrders: mocks.claim,
  requestBuyerDeletion: mocks.deletion,
}));

import { SHARED_PROFILE_CONSENT_VERSION } from "@/lib/buyer/consent";

import { deleteBuyerProfileAction, grantConsentAction, saveAddressAction } from "./account-actions";

const client = {
  auth: { signOut: mocks.signOut },
  from: () => ({ insert: (row: unknown) => mocks.insert(row) }),
};

function form(values: Record<string, string>) {
  const data = new FormData();
  Object.entries(values).forEach(([k, v]) => data.set(k, v));
  return data;
}

async function redirectOf(promise: Promise<unknown>): Promise<string> {
  const error = await promise.then(
    () => null,
    (e: Error) => e,
  );
  return decodeURIComponent(String(error?.message).replace("NEXT_REDIRECT:", "")).replace(/\+/g, " ");
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.session.mockResolvedValue({
    state: "buyer",
    buyer: { kind: "buyer", buyerProfileId: "my-profile", userId: "u1", phone: "+233241234567", consented: false },
    client,
  });
  mocks.consent.mockResolvedValue(true);
  mocks.claim.mockResolvedValue({ status: "ok", claimed: 2 });
  mocks.deletion.mockResolvedValue(true);
  mocks.insert.mockResolvedValue({ error: null });
});

describe("account actions", () => {
  it("send a signed-out visitor back to sign in", async () => {
    mocks.session.mockResolvedValue({ state: "anonymous" });

    expect(await redirectOf(grantConsentAction(form({ version: SHARED_PROFILE_CONSENT_VERSION })))).toBe("/me");
    expect(mocks.consent).not.toHaveBeenCalled();
  });

  it("record consent to the shown version, then claim and report what was found", async () => {
    const url = await redirectOf(grantConsentAction(form({ version: SHARED_PROFILE_CONSENT_VERSION })));

    expect(mocks.consent).toHaveBeenCalledWith(client, true, SHARED_PROFILE_CONSENT_VERSION);
    expect(mocks.claim).toHaveBeenCalledWith(client);
    expect(url).toContain("2 earlier orders");
  });

  it("refuse consent submitted from a page showing older wording", async () => {
    const url = await redirectOf(grantConsentAction(form({ version: "2020-01-v0" })));

    expect(mocks.consent).not.toHaveBeenCalled();
    expect(url).toContain("/me/privacy?error=");
  });

  it("require typing DELETE before erasing the profile", async () => {
    const url = await redirectOf(deleteBuyerProfileAction(form({ confirm: "yes" })));

    expect(mocks.deletion).not.toHaveBeenCalled();
    expect(url).toContain("Type DELETE");
  });

  it("erase, then sign out", async () => {
    const url = await redirectOf(deleteBuyerProfileAction(form({ confirm: "delete", reason: "moving" })));

    expect(mocks.deletion).toHaveBeenCalledWith(client, "moving");
    expect(mocks.signOut).toHaveBeenCalled();
    expect(url).toContain("deleted");
  });

  it("save a new address to the session's profile, whatever the form claims", async () => {
    await redirectOf(
      saveAddressAction(form({ line1: "12 Oxford St", city: "Accra", buyer_profile_id: "someone-else" })),
    );

    expect(mocks.insert).toHaveBeenCalledWith(expect.objectContaining({ buyer_profile_id: "my-profile", line1: "12 Oxford St" }));
  });
});
