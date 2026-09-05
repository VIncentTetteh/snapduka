import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  isInternalJobRequest: vi.fn(),
  createAdminClient: vi.fn(),
  sendEmail: vi.fn(),
  sendWhatsApp: vi.fn(),
  sendPush: vi.fn(),
}));

vi.mock("@/lib/internal-jobs/auth", () => ({ isInternalJobRequest: mocks.isInternalJobRequest }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.createAdminClient }));
vi.mock("@/lib/notifications/email", () => ({ sendEmail: mocks.sendEmail }));
vi.mock("@/lib/notifications/whatsapp", () => ({ sendWhatsApp: mocks.sendWhatsApp }));
vi.mock("@/lib/notifications/push", () => ({ sendPush: mocks.sendPush }));
vi.mock("@/lib/app-url", () => ({ appOrigin: async () => "https://snapduka.test" }));

import { POST } from "./route";

function request() {
  return new Request("http://localhost/api/internal/marketing/process", { method: "POST" });
}

type Row = { id: string } & Record<string, unknown>;

const BROADCAST: Row = {
  id: "b-1",
  seller_account_id: "seller-1",
  segment_id: null,
  channel: "email",
  subject: "New drop",
  body: "Come see",
  customer_segments: null,
};

const customer = (id: string): Row => ({
  id,
  email: `${id}@buyer.test`,
  phone: "+233200000000",
  orders: [],
  customer_consents: [{ purpose: "marketing", status: "granted" }],
});

/**
 * Chainable and thenable at every link, with a keyset page served on await, so
 * the route's paging runs for real. `maybeSingle` and the head/count form are
 * terminal and answer separately.
 */
function builder(config: {
  rows?: Row[];
  single?: unknown;
  count?: number;
  onPage?: (ids: string[]) => void;
  error?: unknown;
}) {
  let cursor: string | null = null;
  let size = Number.MAX_SAFE_INTEGER;
  const chain: Record<string, unknown> = {};
  for (const method of ["is", "eq", "lte", "gte", "not", "in", "order"]) chain[method] = () => chain;
  chain.limit = (n: number) => {
    size = n;
    return chain;
  };
  chain.gt = (_column: string, value: string) => {
    cursor = value;
    return chain;
  };
  chain.select = () => chain;
  chain.maybeSingle = () => Promise.resolve({ data: config.single ?? null, error: null });
  chain.then = (onfulfilled: (value: unknown) => unknown) => {
    if (config.error) return Promise.resolve(onfulfilled({ data: null, error: config.error }));
    if (config.count !== undefined) return Promise.resolve(onfulfilled({ count: config.count }));
    const rows = config.rows ?? [];
    const page = (cursor ? rows.filter((row) => row.id > cursor!) : rows).slice(0, size);
    config.onPage?.(page.map((row) => row.id));
    return Promise.resolve(onfulfilled({ data: page, error: null }));
  };
  return chain;
}

function adminMock(opts: {
  broadcasts?: Row[];
  customers?: Row[];
  customersError?: unknown;
  onCustomerPage?: (ids: string[]) => void;
  updateSpy?: (table: string, payload: Record<string, unknown>) => void;
}) {
  return {
    from: (table: string) => ({
      select: (_columns?: string, options?: { head?: boolean }) => {
        if (table === "marketing_broadcasts") return builder({ rows: opts.broadcasts ?? [BROADCAST] });
        if (table === "customers") {
          return builder({
            rows: opts.customers ?? [],
            error: opts.customersError,
            onPage: opts.onCustomerPage,
          });
        }
        if (table === "notification_preferences") return builder({ single: { marketing_frequency_cap: 10 } });
        if (table === "marketing_deliveries" && options?.head) return builder({ count: 0 });
        if (table === "push_subscriptions") return builder({ single: { endpoint: "https://push.test" } });
        return builder({ rows: [] });
      },
      update: (payload: Record<string, unknown>) => {
        opts.updateSpy?.(table, payload);
        // The broadcast claim reads back through .select().maybeSingle().
        return builder({ single: { id: "b-1" } });
      },
      upsert: () => builder({ single: { id: `d-${Math.random()}` } }),
    }),
  };
}

describe("POST /api/internal/marketing/process", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isInternalJobRequest.mockReturnValue(true);
    mocks.sendEmail.mockResolvedValue({ delivered: true });
    mocks.sendWhatsApp.mockResolvedValue({ delivered: true });
    mocks.sendPush.mockResolvedValue({ delivered: true });
  });

  it("rejects unauthorized requests", async () => {
    mocks.isInternalJobRequest.mockReturnValue(false);
    expect((await POST(request())).status).toBe(401);
  });

  /**
   * The audience read was `.limit(1000)`, sitting exactly on db.max_rows. A
   * seller with 1,200 customers had 200 silently dropped — never emailed, no
   * delivery row written — and the broadcast was still marked sent.
   */
  it("sends to an audience larger than one page", async () => {
    const pages: string[][] = [];
    const audience = Array.from({ length: 1_200 }, (_, i) =>
      customer(`c-${String(i).padStart(5, "0")}`),
    );

    mocks.createAdminClient.mockReturnValue(
      adminMock({ customers: audience, onCustomerPage: (ids) => pages.push(ids) }),
    );

    const body = await (await POST(request())).json();

    expect(body.delivered).toBe(1_200);
    expect(mocks.sendEmail).toHaveBeenCalledTimes(1_200);
    expect(pages.length).toBeGreaterThan(1);
  });

  it("skips a customer who has not consented to marketing", async () => {
    const withheld = { ...customer("c-1"), customer_consents: [{ purpose: "marketing", status: "revoked" }] };
    mocks.createAdminClient.mockReturnValue(adminMock({ customers: [withheld] }));

    const body = await (await POST(request())).json();

    expect(body.delivered).toBe(0);
    expect(mocks.sendEmail).not.toHaveBeenCalled();
  });

  /**
   * A failed audience read must not send to whoever happened to load and then
   * mark the broadcast sent — the rest would never hear from the shop, and
   * nothing would ever retry. The broadcast goes back to scheduled instead.
   */
  it("reschedules the broadcast instead of sending to a partial audience", async () => {
    const updates: [string, Record<string, unknown>][] = [];
    mocks.createAdminClient.mockReturnValue(
      adminMock({
        customersError: { message: "boom" },
        updateSpy: (table, payload) => updates.push([table, payload]),
      }),
    );

    const body = await (await POST(request())).json();

    expect(body.delivered).toBe(0);
    expect(mocks.sendEmail).not.toHaveBeenCalled();
    expect(updates).toContainEqual(["marketing_broadcasts", { state: "scheduled" }]);
    expect(updates).not.toContainEqual(["marketing_broadcasts", { state: "sent" }]);
  });
});
