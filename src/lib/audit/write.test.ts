import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Matches the pattern in src/lib/internal-jobs/auth.test.ts: the real
// server-only package throws unconditionally outside webpack.
vi.mock("server-only", () => ({}));

import { writeAuditEvent } from "./write";

type RpcResult = { error: { message: string; code?: string; details?: string } | null };

function client(result: RpcResult) {
  const rpc = vi.fn().mockResolvedValue(result);
  // The helper only ever calls .rpc(); the rest of the client is irrelevant here.
  return { client: { rpc } as unknown as Parameters<typeof writeAuditEvent>[0], rpc };
}

const base = {
  actorType: "admin" as const,
  actorId: "11111111-1111-1111-1111-111111111111",
  action: "creator_suspended",
  entityType: "creator",
  entityId: "22222222-2222-2222-2222-222222222222",
};

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("writeAuditEvent", () => {
  it("maps the input onto the RPC's parameter names", async () => {
    const { client: admin, rpc } = client({ error: null });

    await writeAuditEvent(admin, { ...base, after: { status: "suspended" }, metadata: { reason: "spam" } });

    expect(rpc).toHaveBeenCalledWith("write_audit_event", {
      p_actor_type: "admin",
      p_actor_id: base.actorId,
      p_action: "creator_suspended",
      p_entity_type: "creator",
      p_entity_id: base.entityId,
      p_before_data: null,
      p_after_data: { status: "suspended" },
      p_metadata: { reason: "spam" },
    });
  });

  it("reports true when the event was recorded", async () => {
    const { client: admin } = client({ error: null });
    await expect(writeAuditEvent(admin, base)).resolves.toBe(true);
  });

  // The whole point of the helper: a discarded error is how an audit trail goes
  // quietly empty, and absence of a record is read as absence of the action.
  it("reports and returns false when the write fails", async () => {
    const { client: admin } = client({ error: { message: "permission denied", code: "42501" } });

    await expect(writeAuditEvent(admin, base)).resolves.toBe(false);
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining("creator_suspended"),
      expect.objectContaining({ code: "42501" }),
    );
  });

  // Logging being down must never block suspending an abusive account.
  it("never throws, so it cannot fail the operation it is recording", async () => {
    const { client: admin } = client({ error: { message: "connection reset" } });
    await expect(writeAuditEvent(admin, base)).resolves.toBe(false);
  });

  it("refuses a non-system event with no actor rather than tripping the DB constraint", async () => {
    const { client: admin, rpc } = client({ error: null });

    await expect(writeAuditEvent(admin, { ...base, actorId: null })).resolves.toBe(false);
    expect(rpc).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("requires an actor_id"));
  });

  it("allows a system event with no actor, which the constraint permits", async () => {
    const { client: admin, rpc } = client({ error: null });

    await expect(
      writeAuditEvent(admin, { ...base, actorType: "system", actorId: null }),
    ).resolves.toBe(true);
    expect(rpc).toHaveBeenCalled();
  });

  it("defaults the optional fields the RPC still requires", async () => {
    const { client: admin, rpc } = client({ error: null });

    await writeAuditEvent(admin, { actorType: "system", actorId: null, action: "x", entityType: "y" });

    expect(rpc).toHaveBeenCalledWith(
      "write_audit_event",
      expect.objectContaining({ p_entity_id: undefined, p_before_data: null, p_after_data: null, p_metadata: {} }),
    );
  });
});
