import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  resolveServerActor: vi.fn(),
  createClient: vi.fn(),
  revalidatePath: vi.fn(),
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
  getSellerPlan: vi.fn(),
  planAllows: vi.fn(),
  planLimit: vi.fn(),
  sendEmail: vi.fn(),
  sendSms: vi.fn(),
  appOrigin: vi.fn(),
}));

vi.mock("@/lib/auth/actor", () => ({ resolveServerActor: mocks.resolveServerActor }));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/lib/billing/resolve", () => ({
  getSellerPlan: mocks.getSellerPlan,
  planAllows: mocks.planAllows,
  planLimit: mocks.planLimit,
  upgradeMessage: (feature: string) => `Your current plan does not include ${feature}.`,
}));
vi.mock("@/lib/notifications/email", () => ({ sendEmail: mocks.sendEmail }));
vi.mock("@/lib/notifications/sms", () => ({ sendSms: mocks.sendSms }));
vi.mock("@/lib/app-url", () => ({ appOrigin: mocks.appOrigin }));

import { inviteCreator, markCommissionsPaid } from "./actions";

/**
 * Chainable + thenable stub: every builder method returns itself and awaiting
 * anywhere in the chain yields a zero count. Avoids hand-modelling each call
 * sequence, which is what broke when the action's query order changed.
 */
function chain(result: unknown = { count: 0 }) {
  const self: Record<string, unknown> = {};
  for (const method of ["eq", "in", "is", "gt", "lt", "not", "select", "order", "limit"]) {
    self[method] = () => self;
  }
  self.then = (resolve: (value: unknown) => unknown) => Promise.resolve(result).then(resolve);
  self.maybeSingle = () => Promise.resolve(result);
  self.single = () => Promise.resolve(result);
  return self;
}

function formData(values: Record<string, string | string[]>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) {
    if (Array.isArray(value)) value.forEach((entry) => data.append(key, entry));
    else data.set(key, value);
  }
  return data;
}

/** Counting queries used by the seat check, then the invitation insert. */
function supabaseForInvite(overrides: { insertError?: unknown } = {}) {
  const insert = vi.fn().mockReturnValue({
    select: () => ({ single: () => Promise.resolve({ data: { id: "invite-1" }, error: overrides.insertError ?? null }) }),
  });
  const del = vi.fn().mockReturnValue({ eq: () => Promise.resolve({ error: null }) });
  const counting = {
    select: () => chain(),
  };
  return {
    from: vi.fn((table: string) =>
      table === "creator_invitations" ? { ...counting, insert, delete: del } : counting,
    ),
    insert,
    delete: del,
  };
}

const OWNER = { kind: "seller", sellerAccountId: "seller-1", userId: "user-1", status: "active", role: undefined };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getSellerPlan.mockResolvedValue({ planName: "Growth" });
  mocks.planAllows.mockReturnValue(true);
  mocks.planLimit.mockReturnValue(5);
  mocks.appOrigin.mockResolvedValue("https://snapduka.example");
  mocks.sendEmail.mockResolvedValue({ delivered: true });
  mocks.sendSms.mockResolvedValue({ delivered: true });
  mocks.resolveServerActor.mockResolvedValue(OWNER);
});

describe("inviteCreator", () => {
  it("does nothing for a non-seller", async () => {
    mocks.resolveServerActor.mockResolvedValue({ kind: "creator", creatorId: "c1" });
    const client = supabaseForInvite();
    mocks.createClient.mockResolvedValue(client);

    await inviteCreator(formData({ contact: "c@example.com", ratePercent: "10" }));

    expect(client.from).not.toHaveBeenCalled();
  });

  it("rejects a team role without campaigns.manage", async () => {
    mocks.resolveServerActor.mockResolvedValue({ ...OWNER, role: "fulfillment" });
    const client = supabaseForInvite();
    mocks.createClient.mockResolvedValue(client);

    await inviteCreator(formData({ contact: "c@example.com", ratePercent: "10" }));

    expect(client.from).not.toHaveBeenCalled();
  });

  // Most existing gates return silently; this one must say why.
  it("tells a Free seller why nothing happened", async () => {
    mocks.planAllows.mockReturnValue(false);
    mocks.createClient.mockResolvedValue(supabaseForInvite());

    await expect(inviteCreator(formData({ contact: "c@example.com", ratePercent: "10" }))).rejects.toThrow(
      "NEXT_REDIRECT",
    );
    expect(mocks.redirect).toHaveBeenCalledWith(expect.stringContaining("does%20not%20include%20the%20creator%20program"));
  });

  it.each(["not-an-email", "0241234567", ""])("rejects the malformed contact %s", async (contact) => {
    mocks.createClient.mockResolvedValue(supabaseForInvite());

    await expect(inviteCreator(formData({ contact, ratePercent: "10" }))).rejects.toThrow("NEXT_REDIRECT");
    expect(mocks.redirect).toHaveBeenCalledWith(expect.stringContaining("email%20address%20or%20phone"));
  });

  it.each(["0", "-5", "60", "abc"])("rejects the out-of-range rate %s", async (ratePercent) => {
    mocks.createClient.mockResolvedValue(supabaseForInvite());

    await expect(
      inviteCreator(formData({ contact: "c@example.com", ratePercent })),
    ).rejects.toThrow("NEXT_REDIRECT");
    expect(mocks.redirect).toHaveBeenCalledWith(expect.stringContaining("Commission%20must%20be"));
  });

  it("rejects a hold period outside 0-90 days", async () => {
    mocks.createClient.mockResolvedValue(supabaseForInvite());

    await expect(
      inviteCreator(formData({ contact: "c@example.com", ratePercent: "10", holdDays: "120" })),
    ).rejects.toThrow("NEXT_REDIRECT");
    expect(mocks.redirect).toHaveBeenCalledWith(expect.stringContaining("Hold%20period"));
  });

  it("stores the rate in basis points and emails the invite", async () => {
    const client = supabaseForInvite();
    mocks.createClient.mockResolvedValue(client);

    await expect(
      inviteCreator(formData({ contact: "creator@example.com", ratePercent: "12.5", holdDays: "14" })),
    ).rejects.toThrow("NEXT_REDIRECT");

    expect(client.insert).toHaveBeenCalledWith(
      expect.objectContaining({ rate_bps: 1250, hold_days: 14, contact_kind: "email" }),
    );
    expect(mocks.sendEmail).toHaveBeenCalled();
    expect(mocks.redirect).toHaveBeenCalledWith(expect.stringContaining("Invitation%20sent"));
  });

  it("sends by SMS when the contact is a phone number", async () => {
    const client = supabaseForInvite();
    mocks.createClient.mockResolvedValue(client);

    await expect(
      inviteCreator(formData({ contact: "+233241234567", ratePercent: "10" })),
    ).rejects.toThrow("NEXT_REDIRECT");

    expect(client.insert).toHaveBeenCalledWith(expect.objectContaining({ contact_kind: "phone" }));
    expect(mocks.sendSms).toHaveBeenCalled();
    expect(mocks.sendEmail).not.toHaveBeenCalled();
  });

  // Otherwise the seller sees a pending invite nobody was ever told about.
  it("rolls the invitation back when delivery fails", async () => {
    mocks.sendEmail.mockResolvedValue({ delivered: false, reason: "not_configured" });
    const client = supabaseForInvite();
    mocks.createClient.mockResolvedValue(client);

    await expect(
      inviteCreator(formData({ contact: "creator@example.com", ratePercent: "10" })),
    ).rejects.toThrow("NEXT_REDIRECT");

    expect(client.delete).toHaveBeenCalled();
    expect(mocks.redirect).toHaveBeenCalledWith(expect.stringContaining("could%20not%20be%20delivered"));
  });

  it("blocks an invite once the plan's creator seats are full", async () => {
    mocks.planLimit.mockReturnValue(0);
    mocks.createClient.mockResolvedValue(supabaseForInvite());

    await expect(
      inviteCreator(formData({ contact: "creator@example.com", ratePercent: "10" })),
    ).rejects.toThrow("NEXT_REDIRECT");
    expect(mocks.redirect).toHaveBeenCalledWith(expect.stringContaining("Upgrade%20in%20Settings"));
  });
});

describe("markCommissionsPaid", () => {
  it("refuses an empty selection rather than recording a zero payment", async () => {
    mocks.createClient.mockResolvedValue({ rpc: vi.fn() });

    await expect(
      markCommissionsPaid(formData({ partnershipId: "p1", creatorId: "c1", method: "cash" })),
    ).rejects.toThrow("NEXT_REDIRECT");
    expect(mocks.redirect).toHaveBeenCalledWith(expect.stringContaining("Select%20at%20least%20one"));
  });

  it("passes the selected commissions to the definer RPC", async () => {
    const rpc = vi.fn().mockResolvedValue({ error: null });
    mocks.createClient.mockResolvedValue({ rpc });

    await expect(
      markCommissionsPaid(
        formData({
          partnershipId: "p1",
          creatorId: "c1",
          method: "mobile_money",
          externalReference: "MOMO123",
          commissionIds: ["a", "b"],
        }),
      ),
    ).rejects.toThrow("NEXT_REDIRECT");

    expect(rpc).toHaveBeenCalledWith("record_creator_commission_payment", {
      p_creator_id: "c1",
      p_commission_ids: ["a", "b"],
      p_method: "mobile_money",
      p_external_reference: "MOMO123",
      p_note: null,
    });
  });

  // The RPC rejects the whole batch when a commission is no longer payable;
  // that reason must reach the seller, not be swallowed.
  it("surfaces the RPC's rejection", async () => {
    const rpc = vi.fn().mockResolvedValue({
      error: { message: "Some commissions are no longer payable. Refresh and try again." },
    });
    mocks.createClient.mockResolvedValue({ rpc });

    await expect(
      markCommissionsPaid(
        formData({ partnershipId: "p1", creatorId: "c1", method: "cash", commissionIds: ["a"] }),
      ),
    ).rejects.toThrow("NEXT_REDIRECT");
    expect(mocks.redirect).toHaveBeenCalledWith(expect.stringContaining("no%20longer%20payable"));
  });
});
