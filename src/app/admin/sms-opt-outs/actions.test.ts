import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  resolveServerActor: vi.fn(),
  rpc: vi.fn(),
  revalidatePath: vi.fn(),
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
}));

vi.mock("@/lib/auth/actor", () => ({ resolveServerActor: mocks.resolveServerActor }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc: mocks.rpc }) }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));

import { addSmsOptOutAction } from "./actions";

function form(values: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}

const OPERATOR = { kind: "operator", authenticated: true, userId: "op-1", email: "op@test", role: "operator" };

describe("addSmsOptOutAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolveServerActor.mockResolvedValue(OPERATOR);
    mocks.rpc.mockImplementation(async (fn: string) =>
      fn === "sms_apply_opt_keyword"
        ? { data: [{ duplicate: false, opted_out: true, consents_withdrawn: 2 }], error: null }
        : { data: "audit-1", error: null },
    );
  });

  it("refuses anyone who is not an operator", async () => {
    mocks.resolveServerActor.mockResolvedValue({ kind: "seller", sellerAccountId: "s1" });
    await expect(addSmsOptOutAction(form({ phone: "+233201234567", reason: "x" }))).rejects.toThrow("NEXT_REDIRECT:/login");
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("refuses a local-format number rather than guessing the country", async () => {
    await expect(addSmsOptOutAction(form({ phone: "0201234567", reason: "asked" }))).rejects.toThrow("error=");
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("requires a reason", async () => {
    await expect(addSmsOptOutAction(form({ phone: "+233201234567", reason: " " }))).rejects.toThrow("error=");
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("applies a platform opt-out attributed to the operator, and audits it without the phone", async () => {
    await expect(addSmsOptOutAction(form({ phone: "+233 20 123 4567", reason: "Asked by phone" }))).rejects.toThrow(
      "NEXT_REDIRECT:/admin/sms-opt-outs?saved=1",
    );
    expect(mocks.rpc).toHaveBeenCalledWith("sms_apply_opt_keyword", expect.objectContaining({
      p_phone: "+233201234567",
      p_action: "opt_out",
      p_source: "operator",
      p_actor: "op-1",
    }));
    const audit = mocks.rpc.mock.calls.find(([fn]) => fn === "write_audit_event");
    expect(audit?.[1]).toMatchObject({ p_action: "sms_opt_out_added", p_actor_id: "op-1" });
    expect(JSON.stringify(audit?.[1])).not.toContain("233201234567");
  });

  it("says so when the opt-out could not be saved", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: "down" } });
    await expect(addSmsOptOutAction(form({ phone: "+233201234567", reason: "x" }))).rejects.toThrow("error=");
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });
});
