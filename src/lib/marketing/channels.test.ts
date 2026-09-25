import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ isFeatureEnabled: vi.fn(), canBroadcastWhatsApp: vi.fn() }));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/flags", () => ({ isFeatureEnabled: mocks.isFeatureEnabled }));
vi.mock("@/lib/notifications/whatsapp", () => ({ canBroadcastWhatsApp: mocks.canBroadcastWhatsApp }));

import { broadcastChannels } from "./channels";

beforeEach(() => vi.clearAllMocks());

describe("broadcastChannels", () => {
  it("offers only email and push when WhatsApp and SMS cannot deliver", async () => {
    mocks.canBroadcastWhatsApp.mockResolvedValue(false);
    mocks.isFeatureEnabled.mockResolvedValue(false);
    expect(await broadcastChannels("seller-1")).toEqual(["email", "push"]);
  });

  it("adds WhatsApp and SMS once each can deliver", async () => {
    mocks.canBroadcastWhatsApp.mockResolvedValue(true);
    mocks.isFeatureEnabled.mockResolvedValue(true);
    expect(await broadcastChannels("seller-1")).toEqual(["email", "whatsapp", "push", "sms"]);
    expect(mocks.isFeatureEnabled).toHaveBeenCalledWith("sms_broadcasts", { sellerAccountId: "seller-1" });
  });
});
