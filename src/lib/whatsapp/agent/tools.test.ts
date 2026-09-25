import { describe, expect, it, vi } from "vitest";

import { FIXTURE_PRODUCTS, fixtureBackend } from "./fixtures";
import { AGENT_TOOLS, executeTool } from "./tools";

const SNEAKERS = FIXTURE_PRODUCTS[0];

describe("AGENT_TOOLS", () => {
  it("is the fixed set from the brief, in a stable order (it is part of the cached prefix)", () => {
    expect(AGENT_TOOLS.map((tool) => tool.name)).toEqual([
      "search_catalog",
      "get_product",
      "check_stock",
      "quote_delivery",
      "create_checkout_link",
      "get_order_status",
      "handoff_to_human",
    ]);
  });

  // The binding to a seller and buyer is server-side; the model cannot widen it.
  it("takes no seller, shop or phone from the model", () => {
    const properties = AGENT_TOOLS.flatMap((tool) => Object.keys(tool.input_schema.properties ?? {}));
    expect(properties.some((name) => /seller|shop|phone/.test(name))).toBe(false);
  });
});

describe("executeTool", () => {
  it("returns search results and the prices they contain", async () => {
    const outcome = await executeTool("search_catalog", { query: "sneakers" }, fixtureBackend());
    expect(outcome.isError).toBe(false);
    expect(JSON.parse(outcome.content).products[0].id).toBe(SNEAKERS.id);
    expect(outcome.prices).toContain("GH₵450.00");
  });

  it("rejects a product id that is not a UUID before touching the backend", async () => {
    const getProduct = vi.fn();
    const outcome = await executeTool("get_product", { product_id: "1 OR 1=1" }, fixtureBackend({ getProduct }));
    expect(outcome.isError).toBe(true);
    expect(getProduct).not.toHaveBeenCalled();
  });

  it("reports an unknown tool as an error result, not an exception", async () => {
    await expect(executeTool("delete_shop", {}, fixtureBackend())).resolves.toMatchObject({ isError: true });
  });

  it("marks a paid order only when the lookup says so", async () => {
    const paid = await executeTool("get_order_status", { reference: "sd-paid123456" }, fixtureBackend());
    expect(paid.confirmedPaidOrder).toBe(true);
    const missing = await executeTool("get_order_status", { reference: "SD-OTHER12345" }, fixtureBackend());
    expect(missing.confirmedPaidOrder).toBeUndefined();
    expect(JSON.parse(missing.content).found).toBe(false);
  });

  it("carries the handoff reason out", async () => {
    const outcome = await executeTool("handoff_to_human", { reason: "Wants 50 pairs wholesale" }, fixtureBackend());
    expect(outcome.handoffReason).toBe("Wants 50 pairs wholesale");
  });

  it("turns a backend failure into a tool error the model can recover from", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const outcome = await executeTool(
      "quote_delivery",
      {},
      fixtureBackend({ quoteDelivery: vi.fn().mockRejectedValue(new Error("db down")) }),
    );
    expect(outcome).toMatchObject({ isError: true });
    expect(outcome.content).not.toContain("db down");
  });
});
