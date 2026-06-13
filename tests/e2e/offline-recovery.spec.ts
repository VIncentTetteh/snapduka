import { expect, test } from "@playwright/test";

test("checkout preserves entered values after a network failure", async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto("/ama-market/checkout?product=11111111-1111-4111-8111-111111111114", { waitUntil: "domcontentloaded" });
  await page.getByPlaceholder("Full name").fill("Kojo Buyer");
  await page.getByPlaceholder("Email").fill("kojo@example.com");
  await page.getByPlaceholder("024 123 4567").fill("0241234567");
  await page.getByRole("radio").check();
  await page.route("**/api/checkout/orders", (route) => route.abort());
  await page.getByRole("button", { name: "Place order" }).click();
  await expect(page.locator("[aria-live='polite']")).not.toHaveText("");
  await expect(page.getByPlaceholder("Full name")).toHaveValue("Kojo Buyer");
});
