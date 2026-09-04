import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  verifyPaystackWebhook: vi.fn(() => true),
  createAdminClient: vi.fn(),
  eventInserts: [] as Record<string, unknown>[],
  seen: new Set<string>(),
}));

vi.mock("@/lib/payments/webhook", () => ({ verifyPaystackWebhook: mocks.verifyPaystackWebhook }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.createAdminClient }));

import { POST } from "./route";

/**
 * The idempotency key must be namespaced by event type.
 *
 * Paystack's `data.id` is the subscription object, identical across
 * subscription.create, subscription.disable and invoice.update. Keying on it
 * alone meant that once a create was recorded, the seller's later cancellation
 * collided with it on the unique constraint, returned `applied: false`, and was
 * silently dropped — the seller cancelled and kept being billed.
 *
 * The order webhook has always namespaced its key; this one did not.
 */

const SUBSCRIPTION = {
  id: "sub-1",
  seller_account_id: "seller-1",
  state: "active",
  pending_change_type: null,
  pending_plan_id: null,
  pending_plan_version: null,
  pending_price_id: null,
};

/** Emulates the unique constraint on subscription_events.event_key. */
function admin() {
  return {
    from(table: string) {
      if (table === "subscription_events") {
        return {
          insert: async (row: Record<string, unknown>) => {
            const key = String(row.event_key);
            if (mocks.seen.has(key)) return { error: { code: "23505" } };
            mocks.seen.add(key);
            mocks.eventInserts.push(row);
            return { error: null };
          },
        };
      }
      return {
        select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: SUBSCRIPTION }) }) }),
        update: () => ({ eq: async () => ({ error: null }) }),
      };
    },
  };
}

/** Both events carry the SAME data.id — that is the whole point. */
function event(name: string) {
  const body = JSON.stringify({
    event: name,
    data: { id: 998877, subscription_code: "SUB_abc", customer: {}, plan: {} },
  });
  return new Request("http://localhost/api/payments/paystack/subscription-webhook", {
    method: "POST",
    body,
    headers: { "x-paystack-signature": "sig" },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.eventInserts.length = 0;
  mocks.seen.clear();
  mocks.verifyPaystackWebhook.mockReturnValue(true);
  mocks.createAdminClient.mockReturnValue(admin());
  vi.stubEnv("PAYSTACK_SECRET_KEY", "sk_test");
});

describe("POST /api/payments/paystack/subscription-webhook", () => {
  it("applies a cancellation that follows a create with the same data.id", async () => {
    await POST(event("subscription.create"));
    const response = await POST(event("subscription.disable"));
    const body = await response.json();

    // Before the fix this was `applied: false` and the seller stayed subscribed.
    expect(body.applied).not.toBe(false);
    expect(mocks.eventInserts).toHaveLength(2);
  });

  it("namespaces the event key by event type", async () => {
    await POST(event("subscription.create"));
    await POST(event("subscription.disable"));

    const keys = mocks.eventInserts.map((row) => String(row.event_key));
    expect(keys[0]).toContain("subscription.create");
    expect(keys[1]).toContain("subscription.disable");
    expect(keys[0]).not.toBe(keys[1]);
  });

  it("still treats a genuine replay of the same event as a duplicate", async () => {
    await POST(event("subscription.disable"));
    const response = await POST(event("subscription.disable"));
    const body = await response.json();

    expect(body.applied).toBe(false);
    expect(mocks.eventInserts).toHaveLength(1);
  });

  it("refuses an unsigned request", async () => {
    mocks.verifyPaystackWebhook.mockReturnValue(false);

    const response = await POST(event("subscription.disable"));

    expect(response.status).toBe(401);
    expect(mocks.eventInserts).toHaveLength(0);
  });
});
