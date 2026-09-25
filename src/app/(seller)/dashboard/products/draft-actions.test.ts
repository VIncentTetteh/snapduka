import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  resolveServerActor: vi.fn(),
  checkRateLimit: vi.fn(),
  createListingDraft: vi.fn(),
}));

vi.mock("@/lib/auth/actor", () => ({ resolveServerActor: mocks.resolveServerActor }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: mocks.checkRateLimit }));
vi.mock("@/lib/ai/listing-draft", () => ({ createListingDraft: mocks.createListingDraft }));

import { draftListingFromPhotoAction } from "./draft-actions";

const SELLER = {
  kind: "seller",
  authenticated: true,
  sellerAccountId: "seller-1",
  status: "active",
  role: undefined,
};
const DATA_URL = "data:image/jpeg;base64,aGVsbG8gd29ybGQhIQ==";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.resolveServerActor.mockResolvedValue(SELLER);
  mocks.checkRateLimit.mockResolvedValue({ ok: true });
  mocks.createListingDraft.mockResolvedValue({ ok: true, draft: { title: "x" } });
});

describe("draftListingFromPhotoAction", () => {
  it("sends the photo to the drafter as base64 for the seller's own account", async () => {
    await expect(draftListingFromPhotoAction({ dataUrl: DATA_URL })).resolves.toEqual({
      ok: true,
      draft: { title: "x" },
    });
    expect(mocks.createListingDraft).toHaveBeenCalledWith({
      sellerAccountId: "seller-1",
      image: { kind: "base64", data: "aGVsbG8gd29ybGQhIQ==", mediaType: "image/jpeg" },
    });
  });

  // A team member resolves as kind "seller"; the role is the actual check.
  it("refuses a role without products.manage", async () => {
    mocks.resolveServerActor.mockResolvedValue({ ...SELLER, role: "analyst" });
    const result = await draftListingFromPhotoAction({ dataUrl: DATA_URL });
    expect(result.ok).toBe(false);
    expect(mocks.createListingDraft).not.toHaveBeenCalled();
  });

  it("refuses a suspended seller", async () => {
    mocks.resolveServerActor.mockResolvedValue({ ...SELLER, status: "suspended" });
    expect((await draftListingFromPhotoAction({ dataUrl: DATA_URL })).ok).toBe(false);
  });

  it("refuses something that is not an image data URL", async () => {
    const result = await draftListingFromPhotoAction({ dataUrl: "data:text/html;base64,PGgxPg==" });
    expect(result).toMatchObject({ ok: false, reason: "invalid_image" });
  });

  it("is rate limited", async () => {
    mocks.checkRateLimit.mockResolvedValue({ ok: false, retryAfterMs: 1000 });
    expect((await draftListingFromPhotoAction({ dataUrl: DATA_URL })).ok).toBe(false);
    expect(mocks.createListingDraft).not.toHaveBeenCalled();
  });
});
